import 'server-only';
import crypto from 'node:crypto';
import sql from '@/lib/db';

export type FinanceAdjustmentStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type FinanceAdjustmentType =
  | 'PRIOR_PERIOD_RECLASSIFICATION'
  | 'BUDGET_CLASSIFICATION_CORRECTION'
  | 'EXTERNAL_GL_TRUE_UP'
  | 'MANUAL_FINANCE_ADJUSTMENT';

export interface CommercialFinanceAdjustment {
  id: string;
  organisation_id: string;
  adjustment_number: string | number;
  status: FinanceAdjustmentStatus;
  adjustment_type: FinanceAdjustmentType;
  effective_financial_period_id: string;
  reference_financial_period_id: string | null;
  currency: string;
  description: string;
  reason_code: string;
  source_type: string | null;
  source_id: string | null;
  reversal_of_adjustment_id: string | null;
  created_by: string;
  created_at: string;
  posted_by: string | null;
  posted_at: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
}

export interface FinanceAdjustmentLineInput {
  budgetAccountId: string;
  costCentreId: string;
  amountExclusiveCents: string | number | bigint;
  taxCents: string | number | bigint;
  amountInclusiveCents: string | number | bigint;
  sourceSupplierBillLineId?: string | null;
  narrative?: string | null;
}
export class FinanceAdjustmentError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'PERIOD_CLOSED'
      | 'NOT_DRAFT'
      | 'NOT_POSTED'
      | 'EMPTY_ADJUSTMENT'
      | 'INVALID_AMOUNT'
      | 'UNRESOLVED_BUDGET_CLASSIFICATION'
      | 'UNBALANCED_RECLASSIFICATION'
      | 'REVERSAL_OF_REVERSAL'
      | 'CONCURRENT_STATE_CHANGE',
    message: string,
  ) {
    super(message);
    this.name = 'FinanceAdjustmentError';
  }
}

function minorUnits(value: string | number | bigint, field: string): bigint {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error();
    const parsed = BigInt(value);
    return parsed;
  } catch {
    throw new FinanceAdjustmentError('INVALID_AMOUNT', `${field} must be an integer number of minor units.`);
  }
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new FinanceAdjustmentError('INVALID_AMOUNT', 'Currency must be a three-letter code.');
  }
  return currency;
}

function validateLines(lines: FinanceAdjustmentLineInput[]) {
  if (lines.length === 0) throw new FinanceAdjustmentError('EMPTY_ADJUSTMENT', 'At least one adjustment line is required.');
  return lines.map((line, index) => {
    const exclusive = minorUnits(line.amountExclusiveCents, 'amountExclusiveCents');
    const tax = minorUnits(line.taxCents, 'taxCents');
    const inclusive = minorUnits(line.amountInclusiveCents, 'amountInclusiveCents');
    if (exclusive + tax !== inclusive) {
      throw new FinanceAdjustmentError('INVALID_AMOUNT', 'amountInclusiveCents must equal amountExclusiveCents + taxCents.');
    }
    return { ...line, position: index + 1, exclusive, tax, inclusive };
  });
}
type CreateResult = { id: string };

export async function createFinanceAdjustment(params: {
  organisationId: string;
  userId: string;
  adjustmentType: FinanceAdjustmentType;
  effectiveFinancialPeriodId: string;
  referenceFinancialPeriodId?: string | null;
  currency: string;
  description: string;
  reasonCode: string;
  sourceType?: string | null;
  sourceId?: string | null;
  lines: FinanceAdjustmentLineInput[];
}): Promise<CommercialFinanceAdjustment> {
  const lines = validateLines(params.lines);
  const description = params.description.trim();
  const reasonCode = params.reasonCode.trim();
  if (!description || !reasonCode) {
    throw new FinanceAdjustmentError('INVALID_AMOUNT', 'Description and reason code are required.');
  }
  const currency = normalizeCurrency(params.currency);
  const adjustmentId = crypto.randomUUID();

  const results = await sql.transaction(txn => [
    txn`
      SELECT id, status
      FROM commercial_financial_periods
      WHERE id = ${params.effectiveFinancialPeriodId}
        AND organisation_id = ${params.organisationId}
      FOR UPDATE
    `,
    txn`
      INSERT INTO commercial_finance_adjustments (
        id, organisation_id, adjustment_type, effective_financial_period_id,
        reference_financial_period_id, currency, description, reason_code,
        source_type, source_id, created_by
      )
      SELECT ${adjustmentId}, ${params.organisationId}, ${params.adjustmentType},
             cfp.id, ref.id, ${currency}, ${description}, ${reasonCode},
             ${params.sourceType?.trim() || null}, ${params.sourceId?.trim() || null},
             ${params.userId}
      FROM commercial_financial_periods cfp
      LEFT JOIN commercial_financial_periods ref
        ON ref.id = ${params.referenceFinancialPeriodId ?? null}
       AND ref.organisation_id = cfp.organisation_id
      WHERE cfp.id = ${params.effectiveFinancialPeriodId}
        AND cfp.organisation_id = ${params.organisationId}
        AND cfp.status = 'OPEN'
        AND (
          ${params.referenceFinancialPeriodId ?? null}::uuid IS NULL
          OR ref.id IS NOT NULL
        )
      RETURNING id
    `,
    ...lines.map(line => txn`
      INSERT INTO commercial_finance_adjustment_lines (
        organisation_id, adjustment_id, financial_period_id, position,
        budget_account_id, cost_centre_id,
        amount_exclusive_cents, tax_cents, amount_inclusive_cents,
        source_supplier_bill_line_id, narrative
      )
      SELECT ${params.organisationId}, fa.id, fa.effective_financial_period_id, ${line.position},
             ${line.budgetAccountId}, ${line.costCentreId},
             ${line.exclusive.toString()}::bigint, ${line.tax.toString()}::bigint, ${line.inclusive.toString()}::bigint,
             ${line.sourceSupplierBillLineId ?? null}, ${line.narrative?.trim() || null}
      FROM commercial_finance_adjustments fa
      WHERE fa.id = ${adjustmentId}
        AND fa.organisation_id = ${params.organisationId}
        AND fa.status = 'DRAFT'
      RETURNING id
    `),
    txn`
      INSERT INTO commercial_finance_adjustment_events (
        organisation_id, adjustment_id, event_type, actor_user_id, details
      )
      SELECT ${params.organisationId}, fa.id, 'CREATED', ${params.userId},
             jsonb_build_object('status','DRAFT','adjustmentType',fa.adjustment_type)
      FROM commercial_finance_adjustments fa
      WHERE fa.id = ${adjustmentId}
        AND fa.organisation_id = ${params.organisationId}
      RETURNING id
    `,
    txn`
      SELECT *
      FROM commercial_finance_adjustments
      WHERE id = ${adjustmentId}
        AND organisation_id = ${params.organisationId}
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const periodRows = results[0] as { id: string; status: string }[];
  const headerRows = results[1] as CreateResult[];
  if (periodRows.length === 0) throw new FinanceAdjustmentError('NOT_FOUND', 'Financial period not found for this organisation.');
  if (periodRows[0].status !== 'OPEN' || headerRows.length === 0) {
    throw new FinanceAdjustmentError('PERIOD_CLOSED', 'Finance adjustments may only target an OPEN financial period.');
  }
  return ((results[results.length - 1] as CommercialFinanceAdjustment[])[0]);
}
type PostValidation = {
  line_count: number;
  unresolved_count: number;
  exclusive_sum: string;
  tax_sum: string;
  inclusive_sum: string;
};

function assertPostValidation(adjustment: CommercialFinanceAdjustment | undefined, validation: PostValidation | undefined) {
  if (!adjustment) throw new FinanceAdjustmentError('NOT_FOUND', 'Finance adjustment not found for this organisation.');
  if (adjustment.status !== 'DRAFT') throw new FinanceAdjustmentError('NOT_DRAFT', 'Only DRAFT finance adjustments can be posted.');
  if (Number(validation?.line_count ?? 0) === 0) throw new FinanceAdjustmentError('EMPTY_ADJUSTMENT', 'At least one adjustment line is required.');
  if (Number(validation?.unresolved_count ?? 0) > 0) {
    throw new FinanceAdjustmentError(
      'UNRESOLVED_BUDGET_CLASSIFICATION',
      'Every finance adjustment line must resolve to the ACTIVE Budget, account and cost-centre grain.',
    );
  }
  const reclassification = adjustment.adjustment_type === 'PRIOR_PERIOD_RECLASSIFICATION'
    || adjustment.adjustment_type === 'BUDGET_CLASSIFICATION_CORRECTION';
  if (reclassification && (
    BigInt(validation?.exclusive_sum ?? 0) !== BigInt(0)
    || BigInt(validation?.tax_sum ?? 0) !== BigInt(0)
    || BigInt(validation?.inclusive_sum ?? 0) !== BigInt(0)
  )) {
    throw new FinanceAdjustmentError('UNBALANCED_RECLASSIFICATION', 'Reclassification adjustments must net to zero.');
  }
}
export async function postFinanceAdjustment(params: {
  organisationId: string;
  userId: string;
  financeAdjustmentId: string;
}): Promise<CommercialFinanceAdjustment> {
  const [lockRows, validationRows, resolvedRows, postedRows] = await sql.transaction(txn => [
    txn`
      SELECT fa.*, cfp.status AS effective_period_status
      FROM commercial_finance_adjustments fa
      JOIN commercial_financial_periods cfp
        ON cfp.id = fa.effective_financial_period_id
       AND cfp.organisation_id = fa.organisation_id
      WHERE fa.id = ${params.financeAdjustmentId}
        AND fa.organisation_id = ${params.organisationId}
      FOR UPDATE OF fa, cfp
    `,
    txn`
      SELECT
        COUNT(fal.id)::int AS line_count,
        COUNT(fal.id) FILTER (
          WHERE cb.id IS NULL OR bv.id IS NULL OR bl.id IS NULL
        )::int AS unresolved_count,
        COALESCE(SUM(fal.amount_exclusive_cents),0)::text AS exclusive_sum,
        COALESCE(SUM(fal.tax_cents),0)::text AS tax_sum,
        COALESCE(SUM(fal.amount_inclusive_cents),0)::text AS inclusive_sum
      FROM commercial_finance_adjustments fa
      LEFT JOIN commercial_finance_adjustment_lines fal
        ON fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
      LEFT JOIN commercial_financial_periods cfp
        ON cfp.id = fal.financial_period_id AND cfp.organisation_id = fal.organisation_id
      LEFT JOIN commercial_budgets cb
        ON cb.organisation_id = fal.organisation_id
       AND cb.financial_year_id = cfp.financial_year_id
       AND cb.currency = fa.currency
       AND cb.active_version_id IS NOT NULL
      LEFT JOIN commercial_budget_versions bv
        ON bv.id = cb.active_version_id
       AND bv.organisation_id = cb.organisation_id
       AND bv.status = 'ACTIVE'
      LEFT JOIN commercial_budget_lines bl
        ON bl.budget_version_id = bv.id
       AND bl.organisation_id = bv.organisation_id
       AND bl.budget_account_id = fal.budget_account_id
       AND bl.cost_centre_id = fal.cost_centre_id
      WHERE fa.id = ${params.financeAdjustmentId}
        AND fa.organisation_id = ${params.organisationId}
      GROUP BY fa.id
    `,
    txn`
      WITH validity AS MATERIALIZED (
        SELECT fa.id
        FROM commercial_finance_adjustments fa
        JOIN commercial_financial_periods target_period
          ON target_period.id = fa.effective_financial_period_id
         AND target_period.organisation_id = fa.organisation_id
        WHERE fa.id = ${params.financeAdjustmentId}
          AND fa.organisation_id = ${params.organisationId}
          AND fa.status = 'DRAFT'
          AND target_period.status = 'OPEN'
          AND EXISTS (
            SELECT 1 FROM commercial_finance_adjustment_lines fal
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM commercial_finance_adjustment_lines fal
            JOIN commercial_financial_periods cfp
              ON cfp.id = fal.financial_period_id AND cfp.organisation_id = fal.organisation_id
            LEFT JOIN commercial_budgets cb
              ON cb.organisation_id = fal.organisation_id
             AND cb.financial_year_id = cfp.financial_year_id
             AND cb.currency = fa.currency
             AND cb.active_version_id IS NOT NULL
            LEFT JOIN commercial_budget_versions bv
              ON bv.id = cb.active_version_id AND bv.organisation_id = cb.organisation_id
             AND bv.status = 'ACTIVE'
            LEFT JOIN commercial_budget_lines bl
              ON bl.budget_version_id = bv.id AND bl.organisation_id = bv.organisation_id
             AND bl.budget_account_id = fal.budget_account_id
             AND bl.cost_centre_id = fal.cost_centre_id
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
              AND (cb.id IS NULL OR bv.id IS NULL OR bl.id IS NULL)
          )
          AND (
            fa.adjustment_type NOT IN ('PRIOR_PERIOD_RECLASSIFICATION','BUDGET_CLASSIFICATION_CORRECTION')
            OR NOT EXISTS (
              SELECT 1
              FROM commercial_finance_adjustment_lines fal
              WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
              HAVING SUM(fal.amount_exclusive_cents) <> 0
                  OR SUM(fal.tax_cents) <> 0
                  OR SUM(fal.amount_inclusive_cents) <> 0
            )
          )
      )
      UPDATE commercial_finance_adjustment_lines fal
      SET resolved_budget_id = cb.id,
          resolved_budget_version_id = bv.id,
          resolved_budget_line_id = bl.id,
          resolved_tax_basis = cb.tax_basis,
          budget_basis_cents = CASE cb.tax_basis
            WHEN 'EXCLUSIVE' THEN fal.amount_exclusive_cents
            ELSE fal.amount_inclusive_cents
          END,
          updated_at = now()
      FROM validity v,
           commercial_financial_periods cfp,
           commercial_budgets cb,
           commercial_budget_versions bv,
           commercial_budget_lines bl
      WHERE fal.adjustment_id = v.id
        AND fal.organisation_id = ${params.organisationId}
        AND cfp.id = fal.financial_period_id
        AND cfp.organisation_id = fal.organisation_id
        AND cb.organisation_id = fal.organisation_id
        AND cb.financial_year_id = cfp.financial_year_id
        AND cb.currency = (SELECT currency FROM commercial_finance_adjustments WHERE id=v.id)
        AND cb.active_version_id = bv.id
        AND bv.organisation_id = cb.organisation_id
        AND bv.status = 'ACTIVE'
        AND bl.budget_version_id = bv.id
        AND bl.organisation_id = bv.organisation_id
        AND bl.budget_account_id = fal.budget_account_id
        AND bl.cost_centre_id = fal.cost_centre_id
      RETURNING fal.id
    `,
    txn`
      WITH posted AS (
        UPDATE commercial_finance_adjustments fa
        SET status = 'POSTED', posted_by = ${params.userId}, posted_at = now(), updated_at = now()
        WHERE fa.id = ${params.financeAdjustmentId}
          AND fa.organisation_id = ${params.organisationId}
          AND fa.status = 'DRAFT'
          AND EXISTS (
            SELECT 1 FROM commercial_financial_periods cfp
            WHERE cfp.id = fa.effective_financial_period_id
              AND cfp.organisation_id = fa.organisation_id
              AND cfp.status = 'OPEN'
          )
          AND EXISTS (
            SELECT 1 FROM commercial_finance_adjustment_lines fal
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM commercial_finance_adjustment_lines fal
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
              AND fal.resolved_budget_line_id IS NULL
          )
          AND (
            fa.adjustment_type NOT IN ('PRIOR_PERIOD_RECLASSIFICATION','BUDGET_CLASSIFICATION_CORRECTION')
            OR NOT EXISTS (
              SELECT 1 FROM commercial_finance_adjustment_lines fal
              WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
              HAVING SUM(fal.amount_exclusive_cents) <> 0
                  OR SUM(fal.tax_cents) <> 0
                  OR SUM(fal.amount_inclusive_cents) <> 0
            )
          )
        RETURNING fa.*
      ),
      event AS (
        INSERT INTO commercial_finance_adjustment_events (
          organisation_id, adjustment_id, event_type, actor_user_id, details
        )
        SELECT p.organisation_id, p.id, 'POSTED', ${params.userId},
               jsonb_build_object('status','POSTED')
        FROM posted p
        RETURNING id
      )
      SELECT * FROM posted
    `,
  ], { isolationLevel: 'ReadCommitted' });

  void resolvedRows;
  const locked = (lockRows as (CommercialFinanceAdjustment & { effective_period_status: string })[])[0];
  if (!locked) throw new FinanceAdjustmentError('NOT_FOUND', 'Finance adjustment not found for this organisation.');
  if (locked.effective_period_status !== 'OPEN') {
    throw new FinanceAdjustmentError('PERIOD_CLOSED', 'Finance adjustments cannot be posted into a CLOSED period.');
  }
  const posted = (postedRows as CommercialFinanceAdjustment[])[0];
  if (!posted) {
    assertPostValidation(locked, (validationRows as PostValidation[])[0]);
    throw new FinanceAdjustmentError('CONCURRENT_STATE_CHANGE', 'Finance adjustment post did not complete.');
  }
  return posted;
}
type ReversalValidation = {
  line_count: number;
  unresolved_count: number;
};

export async function reverseFinanceAdjustment(params: {
  organisationId: string;
  userId: string;
  financeAdjustmentId: string;
  reversalFinancialPeriodId: string;
  reason: string;
}): Promise<CommercialFinanceAdjustment> {
  const reason = params.reason.trim();
  if (!reason) throw new FinanceAdjustmentError('INVALID_AMOUNT', 'A reversal reason is required.');
  const reversalId = crypto.randomUUID();

  const [lockRows, validationRows, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT fa.*, target_period.status AS reversal_period_status
      FROM commercial_finance_adjustments fa
      JOIN commercial_financial_periods source_period
        ON source_period.id = fa.effective_financial_period_id
       AND source_period.organisation_id = fa.organisation_id
      JOIN commercial_financial_periods target_period
        ON target_period.id = ${params.reversalFinancialPeriodId}
       AND target_period.organisation_id = fa.organisation_id
      WHERE fa.id = ${params.financeAdjustmentId}
        AND fa.organisation_id = ${params.organisationId}
      FOR UPDATE OF fa, source_period, target_period
    `,
    txn`
      SELECT
        COUNT(fal.id)::int AS line_count,
        COUNT(fal.id) FILTER (
          WHERE cb.id IS NULL OR bv.id IS NULL OR bl.id IS NULL
        )::int AS unresolved_count
      FROM commercial_finance_adjustments fa
      JOIN commercial_finance_adjustment_lines fal
        ON fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
      JOIN commercial_financial_periods target_period
        ON target_period.id = ${params.reversalFinancialPeriodId}
       AND target_period.organisation_id = fa.organisation_id
      LEFT JOIN commercial_budgets cb
        ON cb.organisation_id = fa.organisation_id
       AND cb.financial_year_id = target_period.financial_year_id
       AND cb.currency = fa.currency
       AND cb.active_version_id IS NOT NULL
      LEFT JOIN commercial_budget_versions bv
        ON bv.id = cb.active_version_id AND bv.organisation_id = cb.organisation_id
       AND bv.status = 'ACTIVE'
      LEFT JOIN commercial_budget_lines bl
        ON bl.budget_version_id = bv.id AND bl.organisation_id = bv.organisation_id
       AND bl.budget_account_id = fal.budget_account_id
       AND bl.cost_centre_id = fal.cost_centre_id
      WHERE fa.id = ${params.financeAdjustmentId}
        AND fa.organisation_id = ${params.organisationId}
      GROUP BY fa.id
    `,
    txn`
      WITH original AS MATERIALIZED (
        SELECT fa.*, target_period.financial_year_id AS target_year_id
        FROM commercial_finance_adjustments fa
        JOIN commercial_financial_periods target_period
          ON target_period.id = ${params.reversalFinancialPeriodId}
         AND target_period.organisation_id = fa.organisation_id
        WHERE fa.id = ${params.financeAdjustmentId}
          AND fa.organisation_id = ${params.organisationId}
          AND fa.status = 'POSTED'
          AND fa.reversal_of_adjustment_id IS NULL
          AND target_period.status = 'OPEN'
          AND EXISTS (
            SELECT 1 FROM commercial_finance_adjustment_lines fal
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM commercial_finance_adjustment_lines fal
            LEFT JOIN commercial_budgets cb
              ON cb.organisation_id = fal.organisation_id
             AND cb.financial_year_id = target_period.financial_year_id
             AND cb.currency = fa.currency
             AND cb.active_version_id IS NOT NULL
            LEFT JOIN commercial_budget_versions bv
              ON bv.id = cb.active_version_id AND bv.organisation_id = cb.organisation_id
             AND bv.status = 'ACTIVE'
            LEFT JOIN commercial_budget_lines bl
              ON bl.budget_version_id = bv.id AND bl.organisation_id = bv.organisation_id
             AND bl.budget_account_id = fal.budget_account_id
             AND bl.cost_centre_id = fal.cost_centre_id
            WHERE fal.adjustment_id = fa.id AND fal.organisation_id = fa.organisation_id
              AND (cb.id IS NULL OR bv.id IS NULL OR bl.id IS NULL)
          )
      ),
      reversal_header AS (
        INSERT INTO commercial_finance_adjustments (
          id, organisation_id, status, adjustment_type, effective_financial_period_id,
          reference_financial_period_id, currency, description, reason_code,
          source_type, source_id, reversal_of_adjustment_id,
          created_by, posted_by, posted_at
        )
        SELECT ${reversalId}, o.organisation_id, 'POSTED', o.adjustment_type,
               ${params.reversalFinancialPeriodId}, o.effective_financial_period_id,
               o.currency, 'Reversal of adjustment ' || o.adjustment_number,
               'REVERSAL', 'FINANCE_ADJUSTMENT', o.id::text, o.id,
               ${params.userId}, ${params.userId}, now()
        FROM original o
        RETURNING *
      ),
      reversal_lines AS (
        INSERT INTO commercial_finance_adjustment_lines (
          organisation_id, adjustment_id, financial_period_id, position,
          budget_account_id, cost_centre_id,
          amount_exclusive_cents, tax_cents, amount_inclusive_cents,
          source_supplier_bill_line_id, narrative,
          resolved_budget_id, resolved_budget_version_id, resolved_budget_line_id,
          resolved_tax_basis, budget_basis_cents
        )
        SELECT o.organisation_id, rh.id, ${params.reversalFinancialPeriodId}, fal.position,
               fal.budget_account_id, fal.cost_centre_id,
               -fal.amount_exclusive_cents, -fal.tax_cents, -fal.amount_inclusive_cents,
               fal.source_supplier_bill_line_id,
               COALESCE(fal.narrative, '') || CASE WHEN fal.narrative IS NULL THEN '' ELSE ' — ' END || ${reason},
               cb.id, bv.id, bl.id, cb.tax_basis,
               CASE cb.tax_basis
                 WHEN 'EXCLUSIVE' THEN -fal.amount_exclusive_cents
                 ELSE -fal.amount_inclusive_cents
               END
        FROM original o
        JOIN reversal_header rh ON true
        JOIN commercial_finance_adjustment_lines fal
          ON fal.adjustment_id = o.id AND fal.organisation_id = o.organisation_id
        JOIN commercial_budgets cb
          ON cb.organisation_id = o.organisation_id
         AND cb.financial_year_id = o.target_year_id
         AND cb.currency = o.currency
         AND cb.active_version_id IS NOT NULL
        JOIN commercial_budget_versions bv
          ON bv.id = cb.active_version_id AND bv.organisation_id = cb.organisation_id
         AND bv.status = 'ACTIVE'
        JOIN commercial_budget_lines bl
          ON bl.budget_version_id = bv.id AND bl.organisation_id = bv.organisation_id
         AND bl.budget_account_id = fal.budget_account_id
         AND bl.cost_centre_id = fal.cost_centre_id
        RETURNING id
      ),
      original_reversed AS (
        UPDATE commercial_finance_adjustments original
        SET status = 'REVERSED',
            reversed_by = ${params.userId},
            reversed_at = now(),
            updated_at = now()
        WHERE original.id = ${params.financeAdjustmentId}
          AND original.organisation_id = ${params.organisationId}
          AND original.status = 'POSTED'
          AND (SELECT COUNT(*) FROM reversal_lines) = (
            SELECT COUNT(*) FROM commercial_finance_adjustment_lines original_line
            WHERE original_line.adjustment_id = ${params.financeAdjustmentId}
              AND original_line.organisation_id = ${params.organisationId}
          )
        RETURNING original.id
      ),
      created_event AS (
        INSERT INTO commercial_finance_adjustment_events (
          organisation_id, adjustment_id, event_type, actor_user_id, details
        )
        SELECT rh.organisation_id, rh.id, 'CREATED', ${params.userId},
               jsonb_build_object('generatedByReversalOf', ${params.financeAdjustmentId})
        FROM reversal_header rh
      ),
      posted_event AS (
        INSERT INTO commercial_finance_adjustment_events (
          organisation_id, adjustment_id, event_type, actor_user_id, details
        )
        SELECT rh.organisation_id, rh.id, 'POSTED', ${params.userId},
               jsonb_build_object('reversalOf', ${params.financeAdjustmentId})
        FROM reversal_header rh
      ),
      reversed_event AS (
        INSERT INTO commercial_finance_adjustment_events (
          organisation_id, adjustment_id, event_type, actor_user_id, details
        )
        SELECT ${params.organisationId}, original_reversed.id, 'REVERSED', ${params.userId},
               jsonb_build_object('reversalAdjustmentId', ${reversalId}, 'reason', ${reason})
        FROM original_reversed
      )
      SELECT rh.*
      FROM reversal_header rh
      JOIN original_reversed ON true
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const locked = (lockRows as (CommercialFinanceAdjustment & { reversal_period_status: string })[])[0];
  if (!locked) throw new FinanceAdjustmentError('NOT_FOUND', 'Finance adjustment or reversal period not found for this organisation.');
  if (locked.status !== 'POSTED') throw new FinanceAdjustmentError('NOT_POSTED', 'Only POSTED finance adjustments can be reversed.');
  if (locked.reversal_of_adjustment_id) throw new FinanceAdjustmentError('REVERSAL_OF_REVERSAL', 'A reversal adjustment cannot itself be reversed.');
  if (locked.reversal_period_status !== 'OPEN') {
    throw new FinanceAdjustmentError('PERIOD_CLOSED', 'A reversal must be posted into an OPEN financial period.');
  }
  const validation = (validationRows as ReversalValidation[])[0];
  if (Number(validation?.line_count ?? 0) === 0) {
    throw new FinanceAdjustmentError('EMPTY_ADJUSTMENT', 'The finance adjustment has no lines to reverse.');
  }
  if (Number(validation?.unresolved_count ?? 0) > 0) {
    throw new FinanceAdjustmentError(
      'UNRESOLVED_BUDGET_CLASSIFICATION',
      'Reversal lines must resolve to the ACTIVE Budget in the reversal period.',
    );
  }
  const reversal = (mutationRows as CommercialFinanceAdjustment[])[0];
  if (!reversal) throw new FinanceAdjustmentError('CONCURRENT_STATE_CHANGE', 'Finance adjustment reversal did not complete.');
  return reversal;
}
