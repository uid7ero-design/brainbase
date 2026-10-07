import 'server-only';
import sql from '@/lib/db';
import { logFinancialPeriodStatusChanged } from './auditLog';

export type FinancialPeriodCloseStatus = 'CLOSED' | 'INVALIDATED';

export interface CommercialFinancialPeriodClose {
  id: string;
  organisation_id: string;
  financial_period_id: string;
  close_sequence: number;
  status: FinancialPeriodCloseStatus;
  closed_by: string;
  closed_at: string;
  close_reason: string | null;
  control_totals: Record<string, unknown>;
  reconciliation_status: string;
  invalidated_by: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
}

export class FinanceCloseError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'PERIOD_NOT_OPEN'
      | 'PERIOD_NOT_CLOSED'
      | 'FINANCIAL_YEAR_CLOSED'
      | 'PERIOD_OVERLAP'
      | 'DRAFT_ADJUSTMENTS_EXIST'
      | 'NO_ACTIVE_CLOSE'
      | 'REOPEN_REASON_REQUIRED'
      | 'CONCURRENT_STATE_CHANGE',
    message: string,
  ) {
    super(message);
    this.name = 'FinanceCloseError';
  }
}

type PeriodLockRow = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  financial_year_status: 'OPEN' | 'CLOSED';
  financial_year_id: string;
};
type OverlapRow = { overlap_count: number };
type DraftAdjustmentRow = { draft_adjustment_count: number };

function assertClosePreconditions(
  period: PeriodLockRow | undefined,
  overlap: OverlapRow | undefined,
  draftAdjustment: DraftAdjustmentRow | undefined,
) {
  if (!period) throw new FinanceCloseError('NOT_FOUND', 'Financial period not found for this organisation.');
  if (period.status !== 'OPEN') throw new FinanceCloseError('PERIOD_NOT_OPEN', 'Only an OPEN financial period can be closed.');
  if (period.financial_year_status !== 'OPEN') {
    throw new FinanceCloseError('FINANCIAL_YEAR_CLOSED', 'The parent financial year must be OPEN to close a period.');
  }
  if (Number(overlap?.overlap_count ?? 0) > 0) {
    throw new FinanceCloseError('PERIOD_OVERLAP', 'Financial period overlaps another period in the same financial year.');
  }
  if (Number(draftAdjustment?.draft_adjustment_count ?? 0) > 0) {
    throw new FinanceCloseError('DRAFT_ADJUSTMENTS_EXIST', 'Draft finance adjustments must be posted or resolved before closing the period.');
  }
}

export async function listFinancialPeriodCloses(organisationId: string, financialPeriodId: string) {
  return await sql`
    SELECT * FROM commercial_financial_period_closes
    WHERE organisation_id = ${organisationId} AND financial_period_id = ${financialPeriodId}
    ORDER BY close_sequence DESC
  ` as CommercialFinancialPeriodClose[];
}

export async function closeFinancialPeriod(params: {
  organisationId: string;
  userId: string;
  financialPeriodId: string;
  reason?: string | null;
}): Promise<CommercialFinancialPeriodClose> {
  const [lockRows, overlapRows, draftAdjustmentRows, closeRows] = await sql.transaction(txn => [
    txn`
      SELECT cfp.id, cfp.status, cfp.financial_year_id,
             cfy.status AS financial_year_status
      FROM commercial_financial_periods cfp
      JOIN commercial_financial_years cfy
        ON cfy.id = cfp.financial_year_id
       AND cfy.organisation_id = cfp.organisation_id
      WHERE cfp.id = ${params.financialPeriodId}
        AND cfp.organisation_id = ${params.organisationId}
      FOR UPDATE OF cfp, cfy
    `,
    txn`
      SELECT COUNT(*)::int AS overlap_count
      FROM commercial_financial_periods target
      JOIN commercial_financial_periods other
        ON other.financial_year_id = target.financial_year_id
       AND other.organisation_id = target.organisation_id
       AND other.id <> target.id
       AND other.starts_on <= target.ends_on
       AND other.ends_on >= target.starts_on
      WHERE target.id = ${params.financialPeriodId}
        AND target.organisation_id = ${params.organisationId}
    `,
    txn`
      SELECT COUNT(*)::int AS draft_adjustment_count
      FROM commercial_finance_adjustments
      WHERE organisation_id = ${params.organisationId}
        AND effective_financial_period_id = ${params.financialPeriodId}
        AND status = 'DRAFT'
    `,
    txn`
      WITH target AS MATERIALIZED (
        SELECT cfp.*
        FROM commercial_financial_periods cfp
        JOIN commercial_financial_years cfy
          ON cfy.id = cfp.financial_year_id
         AND cfy.organisation_id = cfp.organisation_id
        WHERE cfp.id = ${params.financialPeriodId}
          AND cfp.organisation_id = ${params.organisationId}
          AND cfp.status = 'OPEN'
          AND cfy.status = 'OPEN'
          AND NOT EXISTS (
            SELECT 1 FROM commercial_financial_periods other
            WHERE other.financial_year_id = cfp.financial_year_id
              AND other.organisation_id = cfp.organisation_id
              AND other.id <> cfp.id
              AND other.starts_on <= cfp.ends_on
              AND other.ends_on >= cfp.starts_on
          )
          AND NOT EXISTS (
            SELECT 1 FROM commercial_financial_period_closes current_close
            WHERE current_close.financial_period_id = cfp.id
              AND current_close.organisation_id = cfp.organisation_id
              AND current_close.status = 'CLOSED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM commercial_finance_adjustments draft_adjustment
            WHERE draft_adjustment.organisation_id = cfp.organisation_id
              AND draft_adjustment.effective_financial_period_id = cfp.id
              AND draft_adjustment.status = 'DRAFT'
          )
      ),

      source_by_currency AS MATERIALIZED (
        SELECT sb.currency,
               COUNT(sbl.id)::int AS line_count,
               COALESCE(SUM(sbl.line_subtotal_cents), 0)::text AS subtotal_cents,
               COALESCE(SUM(sbl.line_tax_cents), 0)::text AS tax_cents,
               COALESCE(SUM(sbl.line_total_cents), 0)::text AS total_cents
        FROM target t
        JOIN commercial_supplier_bills sb
          ON sb.organisation_id = t.organisation_id
         AND sb.status = 'POSTED'
         AND sb.posted_at IS NOT NULL
         AND sb.posted_at::date BETWEEN t.starts_on AND t.ends_on
        JOIN commercial_supplier_bill_lines sbl
          ON sbl.supplier_bill_id = sb.id
         AND sbl.organisation_id = sb.organisation_id
        GROUP BY sb.currency
      ),
      inserted AS (
        INSERT INTO commercial_financial_period_closes (
          organisation_id, financial_period_id, close_sequence, status,
          closed_by, close_reason, control_totals, reconciliation_status
        )
        SELECT
          t.organisation_id,
          t.id,
          COALESCE((
            SELECT MAX(history.close_sequence)
            FROM commercial_financial_period_closes history
            WHERE history.financial_period_id = t.id
              AND history.organisation_id = t.organisation_id
          ), 0) + 1,
          'CLOSED',
          ${params.userId},
          ${params.reason?.trim() || null},
          jsonb_build_object(
            'basis', 'C7_8_SOURCE_ACTUAL',
            'sourceActualByCurrency', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'currency', s.currency,
                  'lineCount', s.line_count,
                  'subtotalCents', s.subtotal_cents,
                  'taxCents', s.tax_cents,
                  'totalCents', s.total_cents
                ) ORDER BY s.currency
              )
              FROM source_by_currency s
            ), '[]'::jsonb)
          ),
          'NOT_CONFIGURED'
        FROM target t
        RETURNING *
      ),
      period_updated AS (
        UPDATE commercial_financial_periods cfp
        SET status = 'CLOSED', updated_at = now()
        WHERE cfp.id = ${params.financialPeriodId}
          AND cfp.organisation_id = ${params.organisationId}
          AND cfp.status = 'OPEN'
          AND EXISTS (SELECT 1 FROM inserted)
        RETURNING cfp.id
      )
      SELECT inserted.*
      FROM inserted
      JOIN period_updated ON true
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const period = (lockRows as PeriodLockRow[])[0];
  const overlap = (overlapRows as OverlapRow[])[0];
  const draftAdjustment = (draftAdjustmentRows as DraftAdjustmentRow[])[0];
  const closed = (closeRows as CommercialFinancialPeriodClose[])[0];

  if (!closed) {
    assertClosePreconditions(period, overlap, draftAdjustment);
    throw new FinanceCloseError('CONCURRENT_STATE_CHANGE', 'Financial period close did not complete.');
  }

  await logFinancialPeriodStatusChanged({
    organisationId: params.organisationId,
    userId: params.userId,
    financialPeriodId: params.financialPeriodId,
    before: 'OPEN',
    after: 'CLOSED',
  });
  return closed;
}

export async function reopenFinancialPeriod(params: {
  organisationId: string;
  userId: string;
  financialPeriodId: string;
  reason: string;
}): Promise<CommercialFinancialPeriodClose> {
  const reason = params.reason.trim();
  if (!reason) {
    throw new FinanceCloseError('REOPEN_REASON_REQUIRED', 'A reopen reason is required.');
  }

  const [lockRows, activeCloseRows, reopenedRows] = await sql.transaction(txn => [
    txn`
      SELECT cfp.id, cfp.status, cfp.financial_year_id,
             cfy.status AS financial_year_status
      FROM commercial_financial_periods cfp
      JOIN commercial_financial_years cfy
        ON cfy.id = cfp.financial_year_id
       AND cfy.organisation_id = cfp.organisation_id
      WHERE cfp.id = ${params.financialPeriodId}
        AND cfp.organisation_id = ${params.organisationId}
      FOR UPDATE OF cfp, cfy
    `,
    txn`
      SELECT *
      FROM commercial_financial_period_closes
      WHERE financial_period_id = ${params.financialPeriodId}
        AND organisation_id = ${params.organisationId}
        AND status = 'CLOSED'
      FOR UPDATE
    `,
    txn`
      WITH invalidated AS (
        UPDATE commercial_financial_period_closes close_record
        SET status = 'INVALIDATED',
            invalidated_by = ${params.userId},
            invalidated_at = now(),
            invalidation_reason = ${reason},
            reconciliation_status = CASE
              WHEN EXISTS (
                SELECT 1
                FROM commercial_finance_reconciliations reconciliation
                WHERE reconciliation.organisation_id = close_record.organisation_id
                  AND reconciliation.close_id = close_record.id
                  AND reconciliation.status = 'SIGNED_OFF'
              ) THEN 'STALE'
              ELSE close_record.reconciliation_status
            END
        WHERE close_record.financial_period_id = ${params.financialPeriodId}
          AND close_record.organisation_id = ${params.organisationId}
          AND close_record.status = 'CLOSED'
          AND EXISTS (
            SELECT 1
            FROM commercial_financial_periods cfp
            JOIN commercial_financial_years cfy
              ON cfy.id = cfp.financial_year_id
             AND cfy.organisation_id = cfp.organisation_id
            WHERE cfp.id = close_record.financial_period_id
              AND cfp.organisation_id = close_record.organisation_id
              AND cfp.status = 'CLOSED'
              AND cfy.status = 'OPEN'
          )
        RETURNING close_record.*
      ),
      stale_reconciliations AS (
        UPDATE commercial_finance_reconciliations reconciliation
        SET status = 'STALE'
        WHERE reconciliation.organisation_id = ${params.organisationId}
          AND reconciliation.status = 'SIGNED_OFF'
          AND reconciliation.close_id IN (SELECT id FROM invalidated)
        RETURNING reconciliation.id, reconciliation.organisation_id,
                  reconciliation.close_id, reconciliation.financial_period_id
      ),
      stale_events AS (
        INSERT INTO commercial_finance_reconciliation_events (
          organisation_id, reconciliation_id, event_type, actor_user_id, details
        )
        SELECT stale.organisation_id, stale.id, 'STALE', ${params.userId},
               jsonb_build_object(
                 'closeId', stale.close_id,
                 'financialPeriodId', stale.financial_period_id,
                 'reason', ${reason}::text,
                 'cause', 'PERIOD_REOPENED'
               )
        FROM stale_reconciliations stale
        RETURNING reconciliation_id
      ),
      period_updated AS (
        UPDATE commercial_financial_periods cfp
        SET status = 'OPEN', updated_at = now()
        WHERE cfp.id = ${params.financialPeriodId}
          AND cfp.organisation_id = ${params.organisationId}
          AND cfp.status = 'CLOSED'
          AND EXISTS (SELECT 1 FROM invalidated)
        RETURNING cfp.id
      )
      SELECT invalidated.*
      FROM invalidated
      JOIN period_updated ON true
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const period = (lockRows as PeriodLockRow[])[0];
  const activeClose = (activeCloseRows as CommercialFinancialPeriodClose[])[0];
  const invalidated = (reopenedRows as CommercialFinancialPeriodClose[])[0];

  if (!period) throw new FinanceCloseError('NOT_FOUND', 'Financial period not found for this organisation.');
  if (period.status !== 'CLOSED') {
    throw new FinanceCloseError('PERIOD_NOT_CLOSED', 'Only a CLOSED financial period can be reopened.');
  }
  if (period.financial_year_status !== 'OPEN') {
    throw new FinanceCloseError(
      'FINANCIAL_YEAR_CLOSED',
      'The parent financial year must be OPEN to reopen a period.',
    );
  }
  if (!activeClose) throw new FinanceCloseError('NO_ACTIVE_CLOSE', 'Closed period has no active durable close record.');
  if (!invalidated) {
    throw new FinanceCloseError('CONCURRENT_STATE_CHANGE', 'Financial period reopen did not complete.');
  }

  await logFinancialPeriodStatusChanged({
    organisationId: params.organisationId,
    userId: params.userId,
    financialPeriodId: params.financialPeriodId,
    before: 'CLOSED',
    after: 'OPEN',
  });
  return invalidated;
}
