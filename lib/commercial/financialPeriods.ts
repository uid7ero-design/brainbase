import sql from '@/lib/db';
import { logFinancialYearStatusChanged } from './auditLog';

// Phase C2 — tenant-scoped data access for commercial_financial_years /
// commercial_financial_periods. Deliberately independent of Debtors'
// own imported debtor_accounts.financial_year TEXT field — see
// scripts/create-commercial-core.sql's header comment.

export type FinancialStatus = 'OPEN' | 'CLOSED';

export interface CommercialFinancialYear {
  id: string;
  organisation_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: FinancialStatus;
  created_at: string;
  updated_at: string;
}

export class FinancialYearStatusError extends Error {
  constructor(
    public readonly code:
      | 'OPEN_PERIODS_EXIST'
      | 'MISSING_CURRENT_CLOSE'
      | 'DRAFT_ADJUSTMENTS_EXIST'
      | 'STALE_RECONCILIATION_EXISTS'
      | 'UNSTABLE_BUDGET_VERSION'
      | 'NO_ACTIVE_CLOSE'
      | 'REOPEN_REASON_REQUIRED'
      | 'CONCURRENT_STATE_CHANGE',
    message: string,
  ) {
    super(message);
    this.name = 'FinancialYearStatusError';
  }
}

export type FinancialYearCloseStatus = 'CLOSED' | 'INVALIDATED';

export interface CommercialFinancialYearClose {
  id: string;
  organisation_id: string;
  financial_year_id: string;
  close_sequence: number;
  status: FinancialYearCloseStatus;
  closed_by: string;
  closed_at: string;
  close_reason: string | null;
  control_totals: Record<string, unknown>;
  invalidated_by: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
}

export interface CommercialFinancialPeriod {
  id: string;
  financial_year_id: string;
  organisation_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: FinancialStatus;
  created_at: string;
  updated_at: string;
}

export async function listFinancialYears(organisationId: string): Promise<CommercialFinancialYear[]> {
  return (await sql`
    SELECT * FROM commercial_financial_years WHERE organisation_id = ${organisationId} ORDER BY starts_on DESC
  `) as CommercialFinancialYear[];
}

export async function getFinancialYear(organisationId: string, financialYearId: string): Promise<CommercialFinancialYear | null> {
  const rows = (await sql`
    SELECT * FROM commercial_financial_years WHERE id = ${financialYearId} AND organisation_id = ${organisationId}
  `) as CommercialFinancialYear[];
  return rows[0] ?? null;
}

// The CHECK (ends_on > starts_on) constraint (scripts/create-commercial-
// core.sql) is the actual enforcement of a valid date range — this
// function does not duplicate that check in application code; an
// invalid range surfaces as a thrown Postgres CHECK-violation error.
export async function createFinancialYear(params: {
  organisationId: string; name: string; startsOn: string; endsOn: string;
}): Promise<CommercialFinancialYear> {
  const rows = (await sql`
    INSERT INTO commercial_financial_years (organisation_id, name, starts_on, ends_on)
    VALUES (${params.organisationId}, ${params.name}, ${params.startsOn}, ${params.endsOn})
    RETURNING *
  `) as CommercialFinancialYear[];
  return rows[0];
}

// Composite-FK'd onto commercial_financial_years(id, organisation_id) —
// a period for one organisation's financial year structurally cannot be
// created against a different organisation's year, even if this
// function were ever called with a mismatched pair by a future caller
// bug (the INSERT itself would fail the FK constraint).
export async function createFinancialPeriod(params: {
  organisationId: string; financialYearId: string; name: string; startsOn: string; endsOn: string;
}): Promise<CommercialFinancialPeriod> {
  const rows = (await sql`
    INSERT INTO commercial_financial_periods (organisation_id, financial_year_id, name, starts_on, ends_on)
    VALUES (${params.organisationId}, ${params.financialYearId}, ${params.name}, ${params.startsOn}, ${params.endsOn})
    RETURNING *
  `) as CommercialFinancialPeriod[];
  return rows[0];
}

export async function listFinancialPeriods(organisationId: string, financialYearId: string): Promise<CommercialFinancialPeriod[]> {
  return (await sql`
    SELECT * FROM commercial_financial_periods
    WHERE organisation_id = ${organisationId} AND financial_year_id = ${financialYearId}
    ORDER BY starts_on ASC
  `) as CommercialFinancialPeriod[];
}

export async function listFinancialYearCloses(
  organisationId: string,
  financialYearId: string,
): Promise<CommercialFinancialYearClose[]> {
  return (await sql`
    SELECT *
    FROM commercial_financial_year_closes
    WHERE organisation_id=${organisationId}
      AND financial_year_id=${financialYearId}
    ORDER BY close_sequence DESC
  `) as CommercialFinancialYearClose[];
}

export async function setFinancialYearStatus(params: {
  organisationId: string;
  userId: string;
  financialYearId: string;
  status: FinancialStatus;
  reason?: string | null;
}): Promise<CommercialFinancialYear | null> {
  const existing = await getFinancialYear(params.organisationId, params.financialYearId);
  if (!existing) return null;
  if (existing.status === params.status) return existing;

  if (params.status === 'CLOSED') {
    type YearLockRow = CommercialFinancialYear & {
      has_open_periods: boolean;
      has_missing_current_close: boolean;
      has_draft_adjustments: boolean;
      has_stale_reconciliation: boolean;
      has_unstable_budget_version: boolean;
    };
    const [yearRows, updatedRows] = await sql.transaction(txn => [
      txn`
        SELECT year.*,
               EXISTS (
                 SELECT 1
                 FROM commercial_financial_periods period
                 WHERE period.organisation_id=year.organisation_id
                   AND period.financial_year_id=year.id
                   AND period.status='OPEN'
               ) AS has_open_periods,
               EXISTS (
                 SELECT 1
                 FROM commercial_financial_periods period
                 WHERE period.organisation_id=year.organisation_id
                   AND period.financial_year_id=year.id
                   AND period.status='CLOSED'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM commercial_financial_period_closes close_record
                     WHERE close_record.organisation_id=period.organisation_id
                       AND close_record.financial_period_id=period.id
                       AND close_record.status='CLOSED'
                   )
               ) AS has_missing_current_close,
               EXISTS (
                 SELECT 1
                 FROM commercial_finance_adjustments adjustment
                 JOIN commercial_financial_periods period
                   ON period.id=adjustment.effective_financial_period_id
                  AND period.organisation_id=adjustment.organisation_id
                 WHERE adjustment.organisation_id=year.organisation_id
                   AND period.financial_year_id=year.id
                   AND adjustment.status='DRAFT'
               ) AS has_draft_adjustments,
               EXISTS (
                 SELECT 1
                 FROM commercial_financial_periods period
                 JOIN commercial_financial_period_closes close_record
                   ON close_record.financial_period_id=period.id
                  AND close_record.organisation_id=period.organisation_id
                  AND close_record.status='CLOSED'
                 WHERE period.organisation_id=year.organisation_id
                   AND period.financial_year_id=year.id
                   AND close_record.reconciliation_status='STALE'
               ) AS has_stale_reconciliation,
               EXISTS (
                 SELECT 1
                 FROM commercial_budgets budget
                 WHERE budget.organisation_id=year.organisation_id
                   AND budget.financial_year_id=year.id
                   AND (
                     budget.active_version_id IS NULL
                     OR NOT EXISTS (
                       SELECT 1
                       FROM commercial_budget_versions version
                       WHERE version.id=budget.active_version_id
                         AND version.budget_id=budget.id
                         AND version.organisation_id=budget.organisation_id
                         AND version.status='ACTIVE'
                     )
                   )
               ) AS has_unstable_budget_version
        FROM commercial_financial_years year
        WHERE year.id=${params.financialYearId}
          AND year.organisation_id=${params.organisationId}
        FOR UPDATE OF year
      `,
      txn`
        WITH target AS MATERIALIZED (
          SELECT year.*
          FROM commercial_financial_years year
          WHERE year.id=${params.financialYearId}
            AND year.organisation_id=${params.organisationId}
            AND year.status='OPEN'
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_financial_periods period
              WHERE period.organisation_id=year.organisation_id
                AND period.financial_year_id=year.id
                AND period.status='OPEN'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_financial_periods period
              WHERE period.organisation_id=year.organisation_id
                AND period.financial_year_id=year.id
                AND period.status='CLOSED'
                AND NOT EXISTS (
                  SELECT 1
                  FROM commercial_financial_period_closes close_record
                  WHERE close_record.organisation_id=period.organisation_id
                    AND close_record.financial_period_id=period.id
                    AND close_record.status='CLOSED'
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_finance_adjustments adjustment
              JOIN commercial_financial_periods period
                ON period.id=adjustment.effective_financial_period_id
               AND period.organisation_id=adjustment.organisation_id
              WHERE adjustment.organisation_id=year.organisation_id
                AND period.financial_year_id=year.id
                AND adjustment.status='DRAFT'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_financial_periods period
              JOIN commercial_financial_period_closes close_record
                ON close_record.financial_period_id=period.id
               AND close_record.organisation_id=period.organisation_id
               AND close_record.status='CLOSED'
              WHERE period.organisation_id=year.organisation_id
                AND period.financial_year_id=year.id
                AND close_record.reconciliation_status='STALE'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_budgets budget
              WHERE budget.organisation_id=year.organisation_id
                AND budget.financial_year_id=year.id
                AND (
                  budget.active_version_id IS NULL
                  OR NOT EXISTS (
                    SELECT 1
                    FROM commercial_budget_versions version
                    WHERE version.id=budget.active_version_id
                      AND version.budget_id=budget.id
                      AND version.organisation_id=budget.organisation_id
                      AND version.status='ACTIVE'
                  )
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM commercial_financial_year_closes current_close
              WHERE current_close.organisation_id=year.organisation_id
                AND current_close.financial_year_id=year.id
                AND current_close.status='CLOSED'
            )
        ),
        inserted AS (
          INSERT INTO commercial_financial_year_closes(
            organisation_id,financial_year_id,close_sequence,status,
            closed_by,close_reason,control_totals
          )
          SELECT
            target.organisation_id,
            target.id,
            COALESCE((
              SELECT MAX(history.close_sequence)
              FROM commercial_financial_year_closes history
              WHERE history.organisation_id=target.organisation_id
                AND history.financial_year_id=target.id
            ),0)+1,
            'CLOSED',
            ${params.userId},
            ${params.reason?.trim() || null},
            jsonb_build_object(
              'basis','C7_9_YEAR_CLOSE',
              'financialPeriodCount',(
                SELECT COUNT(*)::int
                FROM commercial_financial_periods period
                WHERE period.organisation_id=target.organisation_id
                  AND period.financial_year_id=target.id
              ),
              'currentPeriodCloseCount',(
                SELECT COUNT(*)::int
                FROM commercial_financial_periods period
                JOIN commercial_financial_period_closes close_record
                  ON close_record.organisation_id=period.organisation_id
                 AND close_record.financial_period_id=period.id
                 AND close_record.status='CLOSED'
                WHERE period.organisation_id=target.organisation_id
                  AND period.financial_year_id=target.id
              )
            )
          FROM target
          RETURNING *
        ),
        year_updated AS (
          UPDATE commercial_financial_years year
          SET status='CLOSED'
          WHERE year.id=${params.financialYearId}
            AND year.organisation_id=${params.organisationId}
            AND year.status='OPEN'
            AND EXISTS (SELECT 1 FROM inserted)
          RETURNING year.*
        )
        SELECT year_updated.*
        FROM year_updated
        JOIN inserted ON true
      `,
    ], { isolationLevel: 'ReadCommitted' });

    const before = (yearRows as YearLockRow[])[0];
    if (!before) return null;
    if (before.status === 'CLOSED') return before;
    if (before.has_open_periods) {
      throw new FinancialYearStatusError(
        'OPEN_PERIODS_EXIST',
        'All financial periods must be CLOSED before closing the financial year.',
      );
    }
    if (before.has_missing_current_close) {
      throw new FinancialYearStatusError(
        'MISSING_CURRENT_CLOSE',
        'Every CLOSED financial period must have a current durable close record.',
      );
    }
    if (before.has_draft_adjustments) {
      throw new FinancialYearStatusError(
        'DRAFT_ADJUSTMENTS_EXIST',
        'Draft finance adjustments must be resolved before closing the financial year.',
      );
    }
    if (before.has_stale_reconciliation) {
      throw new FinancialYearStatusError(
        'STALE_RECONCILIATION_EXISTS',
        'Stale finance reconciliation evidence must be resolved before closing the financial year.',
      );
    }
    if (before.has_unstable_budget_version) {
      throw new FinancialYearStatusError(
        'UNSTABLE_BUDGET_VERSION',
        'Every Budget for the financial year must point to an ACTIVE version before close.',
      );
    }

    const after = (updatedRows as CommercialFinancialYear[])[0];
    if (!after) {
      throw new FinancialYearStatusError(
        'CONCURRENT_STATE_CHANGE',
        'Financial year close did not complete.',
      );
    }

    await logFinancialYearStatusChanged({
      organisationId: params.organisationId,
      userId: params.userId,
      financialYearId: params.financialYearId,
      before: before.status,
      after: after.status,
    });
    return after;
  }

  const before = existing;
  const reason = params.reason?.trim() ?? '';
  if (!reason) {
    throw new FinancialYearStatusError(
      'REOPEN_REASON_REQUIRED',
      'A financial year reopen reason is required.',
    );
  }

  const [closeRows, reopenedRows] = await sql.transaction(txn => [
    txn`
      SELECT *
      FROM commercial_financial_year_closes
      WHERE organisation_id=${params.organisationId}
        AND financial_year_id=${params.financialYearId}
        AND status='CLOSED'
      FOR UPDATE
    `,
    txn`
      WITH invalidated AS (
        UPDATE commercial_financial_year_closes close_record
        SET status='INVALIDATED',
            invalidated_by=${params.userId},
            invalidated_at=now(),
            invalidation_reason=${reason}
        WHERE close_record.organisation_id=${params.organisationId}
          AND close_record.financial_year_id=${params.financialYearId}
          AND close_record.status='CLOSED'
          AND EXISTS (
            SELECT 1
            FROM commercial_financial_years year
            WHERE year.id=close_record.financial_year_id
              AND year.organisation_id=close_record.organisation_id
              AND year.status='CLOSED'
          )
        RETURNING close_record.*
      ),
      year_updated AS (
        UPDATE commercial_financial_years year
        SET status='OPEN'
        WHERE year.id=${params.financialYearId}
          AND year.organisation_id=${params.organisationId}
          AND year.status='CLOSED'
          AND EXISTS (SELECT 1 FROM invalidated)
        RETURNING year.*
      )
      SELECT year_updated.*
      FROM year_updated
      JOIN invalidated ON true
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const activeClose = (closeRows as CommercialFinancialYearClose[])[0];
  if (!activeClose) {
    throw new FinancialYearStatusError(
      'NO_ACTIVE_CLOSE',
      'Closed financial year has no active durable close record.',
    );
  }

  const after = (reopenedRows as CommercialFinancialYear[])[0];
  if (!after) {
    throw new FinancialYearStatusError(
      'CONCURRENT_STATE_CHANGE',
      'Financial year reopen did not complete.',
    );
  }

  await logFinancialYearStatusChanged({
    organisationId: params.organisationId,
    userId: params.userId,
    financialYearId: params.financialYearId,
    before: before.status,
    after: after.status,
  });

  return after;
}

export async function getFinancialPeriod(organisationId: string, financialPeriodId: string): Promise<CommercialFinancialPeriod | null> {
  const rows = (await sql`
    SELECT * FROM commercial_financial_periods WHERE id = ${financialPeriodId} AND organisation_id = ${organisationId}
  `) as CommercialFinancialPeriod[];
  return rows[0] ?? null;
}

export async function setFinancialPeriodStatus(params: {
  organisationId: string; userId: string; financialPeriodId: string; status: FinancialStatus;
}): Promise<CommercialFinancialPeriod | null> {
  const before = await getFinancialPeriod(params.organisationId, params.financialPeriodId);
  if (!before) return null;
  if (before.status === params.status) return before;

  throw new Error(
    'Direct financial-period status changes are disabled. Use the governed close/reopen finance controls.',
  );
}
