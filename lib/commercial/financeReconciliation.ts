import 'server-only';
import { randomUUID } from 'crypto';
import sql from '@/lib/db';

export type FinanceReconciliationOutcome =
  | 'RECONCILED'
  | 'VARIANCE'
  | 'UNMAPPED_BRAINBASE_ACCOUNT'
  | 'UNMAPPED_EXTERNAL_GL_ACCOUNT'
  | 'UNMAPPED_COST_CENTRE'
  | 'MISSING_EXTERNAL_ENTRY'
  | 'EXTERNAL_ONLY_ENTRY';

export class FinanceReconciliationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'AMBIGUOUS_MAPPING'
      | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'FinanceReconciliationError';
  }
}

type PeriodRow = {
  id: string;
  starts_on: string | Date;
  ends_on: string | Date;
  snapshot_at: string | Date;
};

type SourceRow = {
  budget_account_id: string;
  cost_centre_id: string;
  source_actual_cents: string | number | bigint;
  source_actual_count: string | number | bigint;
};
type AdjustmentRow = {
  budget_account_id: string;
  cost_centre_id: string;
  finance_adjustment_cents: string | number | bigint;
};

type MappingRow = {
  id: string;
  budget_account_id: string;
  external_gl_account_code: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
};

type ExternalRow = {
  external_gl_account_mapping_id: string | null;
  budget_account_id: string | null;
  external_gl_account_code: string;
  external_cost_centre_mapping_id: string | null;
  cost_centre_id: string | null;
  external_cost_centre_code: string | null;
  external_gl_cents: string | number | bigint;
  external_entry_count: string | number | bigint;
};

export type PreparedFinanceReconciliationItem = {
  id: string;
  budgetAccountId: string | null;
  externalGlAccountMappingId: string | null;
  externalGlAccountCode: string | null;
  externalCostCentreMappingId: string | null;
  costCentreId: string | null;
  externalCostCentreCode: string | null;
  currency: string;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlCents: string;
  varianceCents: string;
  sourceActualCount: number;
  externalEntryCount: number;
  outcome: FinanceReconciliationOutcome;
};export type PreparedFinanceReconciliation = {
  id: string;
  organisationId: string;
  financialPeriodId: string;
  sourceSystemId: string;
  currency: string;
  status: 'PREPARED';
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlTotalCents: string;
  varianceCents: string;
  unresolvedItemCount: number;
  snapshotAt: string;
  preparedBy: string;
  notes: string | null;
  items: PreparedFinanceReconciliationItem[];
};

export type ReviewedFinanceReconciliation = {
  id: string;
  organisationId: string;
  financialPeriodId: string;
  sourceSystemId: string;
  currency: string;
  status: 'REVIEWED';
  reviewedBy: string;
  reviewedAt: string;
};

export type SignedOffFinanceReconciliation = {
  id: string;
  organisationId: string;
  financialPeriodId: string;
  sourceSystemId: string;
  currency: string;
  status: 'SIGNED_OFF';
  closeId: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type FinanceReconciliationStatus =
  | 'PREPARED'
  | 'REVIEWED'
  | 'SIGNED_OFF'
  | 'STALE';

export type FinanceReconciliationQueueItem = {
  id: string;
  budgetAccountId: string | null;
  budgetAccountCode: string | null;
  budgetAccountName: string | null;
  externalGlAccountCode: string | null;
  costCentreId: string | null;
  costCentreCode: string | null;
  costCentreName: string | null;
  externalCostCentreCode: string | null;
  currency: string;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlCents: string;
  varianceCents: string;
  sourceActualCount: number;
  externalEntryCount: number;
  outcome: Exclude<FinanceReconciliationOutcome, 'RECONCILED'>;
};

export type FinanceReconciliationControlState = {
  id: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  sourceSystemId: string;
  currency: string;
  status: FinanceReconciliationStatus;
  closeId: string | null;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlTotalCents: string;
  varianceCents: string;
  unresolvedItemCount: number;
  snapshotAt: string;
  preparedAt: string;
  reviewedAt: string | null;
  notes: string | null;
};

export type FinanceReconciliationQueueEntry = {
  id: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  sourceSystemId: string;
  currency: string;
  status: FinanceReconciliationStatus;
  closeId: string | null;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlTotalCents: string;
  varianceCents: string;
  unresolvedItemCount: number;
  snapshotAt: string;
  preparedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  items: FinanceReconciliationQueueItem[];
};

type ReconciliationLifecycleRow = {
  id: string;
  organisation_id: string;
  financial_period_id: string;
  source_system_id: string;
  currency: string;
  status: 'PREPARED' | 'REVIEWED' | 'SIGNED_OFF' | 'STALE';
  close_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | Date | null;
};

function required(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new FinanceReconciliationError('INVALID_INPUT', `${label} is required.`);
  return cleaned;
}

function normaliseOptionalUuid(value: string | null | undefined, label: string) {
  const cleaned = value?.trim() || null;
  if (!cleaned) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)) {
    throw new FinanceReconciliationError('INVALID_INPUT', `${label} must be a valid UUID.`);
  }
  return cleaned;
}

function normaliseCurrency(value: string) {
  const currency = required(value, 'Currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new FinanceReconciliationError('INVALID_INPUT', 'Currency must be a three-letter ISO code.');
  }
  return currency;
}

function money(value: string | number | bigint | null | undefined) {
  return BigInt(value ?? 0);
}

function dateOnly(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function timestamp(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.toISOString();
}type MutableItem = Omit<PreparedFinanceReconciliationItem,
  'id' | 'sourceActualCents' | 'financeAdjustmentCents' |
  'brainbaseEffectiveActualCents' | 'externalGlCents' | 'varianceCents'> & {
    sourceActualCents: bigint;
    financeAdjustmentCents: bigint;
    brainbaseEffectiveActualCents: bigint;
    externalGlCents: bigint;
    varianceCents: bigint;
  };

function finaliseItem(item: MutableItem): PreparedFinanceReconciliationItem {
  return {
    ...item,
    id: randomUUID(),
    sourceActualCents: item.sourceActualCents.toString(),
    financeAdjustmentCents: item.financeAdjustmentCents.toString(),
    brainbaseEffectiveActualCents: item.brainbaseEffectiveActualCents.toString(),
    externalGlCents: item.externalGlCents.toString(),
    varianceCents: item.varianceCents.toString(),
  };
}

type FinanceReconciliationControlStateRow = {
  reconciliation_id: string;
  financial_year_id: string;
  financial_year_name: string;
  financial_period_id: string;
  financial_period_name: string;
  source_system_id: string;
  reconciliation_currency: string;
  reconciliation_status: FinanceReconciliationStatus;
  close_id: string | null;
  source_actual_cents: string | number | bigint;
  finance_adjustment_cents: string | number | bigint;
  brainbase_effective_actual_cents: string | number | bigint;
  external_gl_total_cents: string | number | bigint;
  reconciliation_variance_cents: string | number | bigint;
  unresolved_item_count: string | number | bigint;
  snapshot_at: string | Date;
  prepared_at: string | Date;
  reviewed_at: string | Date | null;
  notes: string | null;
};

export async function listLatestFinanceReconciliations(params: {
  organisationId: string;
  sourceSystemId?: string | null;
  status?: FinanceReconciliationStatus | null;
  financialPeriodId?: string | null;
  currency?: string | null;
}): Promise<FinanceReconciliationControlState[]> {
  const organisationId = required(params.organisationId, 'Organisation');
  const sourceSystemId = params.sourceSystemId?.trim() || null;
  const financialPeriodId = normaliseOptionalUuid(
    params.financialPeriodId,
    'Financial period',
  );
  const status = params.status ?? null;
  const currency = params.currency?.trim()
    ? normaliseCurrency(params.currency)
    : null;

  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (
        reconciliation.financial_period_id,
        reconciliation.source_system_id,
        reconciliation.currency
      )
        reconciliation.*
      FROM commercial_finance_reconciliations reconciliation
      WHERE reconciliation.organisation_id=${organisationId}
        AND (${sourceSystemId}::text IS NULL OR reconciliation.source_system_id=${sourceSystemId})
        AND (${financialPeriodId}::uuid IS NULL OR reconciliation.financial_period_id=${financialPeriodId}::uuid)
        AND (${currency}::text IS NULL OR reconciliation.currency=${currency})
      ORDER BY reconciliation.financial_period_id,
               reconciliation.source_system_id,
               reconciliation.currency,
               reconciliation.prepared_at DESC,
               reconciliation.id DESC
    )
    SELECT
      latest.id AS reconciliation_id,
      year.id AS financial_year_id,
      year.name AS financial_year_name,
      latest.financial_period_id,
      period.name AS financial_period_name,
      latest.source_system_id,
      latest.currency AS reconciliation_currency,
      latest.status AS reconciliation_status,
      latest.close_id,
      latest.source_actual_cents,
      latest.finance_adjustment_cents,
      latest.brainbase_effective_actual_cents,
      latest.external_gl_total_cents,
      latest.variance_cents AS reconciliation_variance_cents,
      latest.unresolved_item_count,
      latest.snapshot_at,
      latest.prepared_at,
      latest.reviewed_at,
      latest.notes
    FROM latest
    JOIN commercial_financial_periods period
      ON period.id=latest.financial_period_id
     AND period.organisation_id=latest.organisation_id
    JOIN commercial_financial_years year
      ON year.id=period.financial_year_id
     AND year.organisation_id=period.organisation_id
    WHERE (${status}::text IS NULL OR latest.status=${status})
    ORDER BY latest.prepared_at DESC, latest.id
  ` as FinanceReconciliationControlStateRow[];

  return rows.map(row => ({
    id: row.reconciliation_id,
    financialYearId: row.financial_year_id,
    financialYearName: row.financial_year_name,
    financialPeriodId: row.financial_period_id,
    financialPeriodName: row.financial_period_name,
    sourceSystemId: row.source_system_id,
    currency: row.reconciliation_currency,
    status: row.reconciliation_status,
    closeId: row.close_id,
    sourceActualCents: row.source_actual_cents.toString(),
    financeAdjustmentCents: row.finance_adjustment_cents.toString(),
    brainbaseEffectiveActualCents: row.brainbase_effective_actual_cents.toString(),
    externalGlTotalCents: row.external_gl_total_cents.toString(),
    varianceCents: row.reconciliation_variance_cents.toString(),
    unresolvedItemCount: Number(row.unresolved_item_count),
    snapshotAt: timestamp(row.snapshot_at),
    preparedAt: timestamp(row.prepared_at),
    reviewedAt: row.reviewed_at ? timestamp(row.reviewed_at) : null,
    notes: row.notes,
  }));
}

type FinanceReconciliationQueueRow = {
  reconciliation_id: string;
  financial_year_id: string;
  financial_year_name: string;
  financial_period_id: string;
  financial_period_name: string;
  source_system_id: string;
  reconciliation_currency: string;
  reconciliation_status: FinanceReconciliationStatus;
  close_id: string | null;
  source_actual_cents: string | number | bigint;
  finance_adjustment_cents: string | number | bigint;
  brainbase_effective_actual_cents: string | number | bigint;
  external_gl_total_cents: string | number | bigint;
  reconciliation_variance_cents: string | number | bigint;
  unresolved_item_count: string | number | bigint;
  snapshot_at: string | Date;
  prepared_at: string | Date;
  reviewed_at: string | Date | null;
  notes: string | null;
  item_id: string;
  budget_account_id: string | null;
  budget_account_code: string | null;
  budget_account_name: string | null;
  external_gl_account_code: string | null;
  cost_centre_id: string | null;
  cost_centre_code: string | null;
  cost_centre_name: string | null;
  external_cost_centre_code: string | null;
  item_currency: string;
  item_source_actual_cents: string | number | bigint;
  item_finance_adjustment_cents: string | number | bigint;
  item_brainbase_effective_actual_cents: string | number | bigint;
  item_external_gl_cents: string | number | bigint;
  item_variance_cents: string | number | bigint;
  source_actual_count: string | number | bigint;
  external_entry_count: string | number | bigint;
  outcome: Exclude<FinanceReconciliationOutcome, 'RECONCILED'>;
};

export async function listFinanceReconciliationQueue(params: {
  organisationId: string;
  sourceSystemId?: string | null;
  status?: FinanceReconciliationStatus | null;
  financialPeriodId?: string | null;
  currency?: string | null;
}): Promise<FinanceReconciliationQueueEntry[]> {
  const organisationId = required(params.organisationId, 'Organisation');
  const sourceSystemId = params.sourceSystemId?.trim() || null;
  const financialPeriodId = normaliseOptionalUuid(
    params.financialPeriodId,
    'Financial period',
  );
  const status = params.status ?? null;
  const currency = params.currency?.trim()
    ? normaliseCurrency(params.currency)
    : null;

  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (
        reconciliation.financial_period_id,
        reconciliation.source_system_id,
        reconciliation.currency
      )
        reconciliation.*
      FROM commercial_finance_reconciliations reconciliation
      WHERE reconciliation.organisation_id=${organisationId}
        AND (${sourceSystemId}::text IS NULL OR reconciliation.source_system_id=${sourceSystemId})
        AND (${financialPeriodId}::uuid IS NULL OR reconciliation.financial_period_id=${financialPeriodId}::uuid)
        AND (${currency}::text IS NULL OR reconciliation.currency=${currency})
      ORDER BY reconciliation.financial_period_id,
               reconciliation.source_system_id,
               reconciliation.currency,
               reconciliation.prepared_at DESC,
               reconciliation.id DESC
    )
    SELECT
      latest.id AS reconciliation_id,
      year.id AS financial_year_id,
      year.name AS financial_year_name,
      latest.financial_period_id,
      period.name AS financial_period_name,
      latest.source_system_id,
      latest.currency AS reconciliation_currency,
      latest.status AS reconciliation_status,
      latest.close_id,
      latest.source_actual_cents,
      latest.finance_adjustment_cents,
      latest.brainbase_effective_actual_cents,
      latest.external_gl_total_cents,
      latest.variance_cents AS reconciliation_variance_cents,
      latest.unresolved_item_count,
      latest.snapshot_at,
      latest.prepared_at,
      latest.reviewed_at,
      latest.notes,
      item.id AS item_id,
      item.budget_account_id,
      account.code AS budget_account_code,
      account.name AS budget_account_name,
      item.external_gl_account_code,
      item.cost_centre_id,
      cost_centre.code AS cost_centre_code,
      cost_centre.name AS cost_centre_name,
      item.external_cost_centre_code,
      item.currency AS item_currency,
      item.source_actual_cents AS item_source_actual_cents,
      item.finance_adjustment_cents AS item_finance_adjustment_cents,
      item.brainbase_effective_actual_cents AS item_brainbase_effective_actual_cents,
      item.external_gl_cents AS item_external_gl_cents,
      item.variance_cents AS item_variance_cents,
      item.source_actual_count,
      item.external_entry_count,
      item.outcome
    FROM latest
    JOIN commercial_financial_periods period
      ON period.id=latest.financial_period_id
     AND period.organisation_id=latest.organisation_id
    JOIN commercial_financial_years year
      ON year.id=period.financial_year_id
     AND year.organisation_id=period.organisation_id
    JOIN commercial_finance_reconciliation_items item
      ON item.reconciliation_id=latest.id
     AND item.organisation_id=latest.organisation_id
     AND item.outcome<>'RECONCILED'
    LEFT JOIN commercial_budget_accounts account
      ON account.id=item.budget_account_id
     AND account.organisation_id=item.organisation_id
    LEFT JOIN commercial_cost_centres cost_centre
      ON cost_centre.id=item.cost_centre_id
     AND cost_centre.organisation_id=item.organisation_id
    WHERE latest.unresolved_item_count>0
      AND (${status}::text IS NULL OR latest.status=${status})
    ORDER BY latest.prepared_at DESC,
             latest.id,
             item.outcome,
             account.code NULLS LAST,
             item.external_gl_account_code NULLS LAST,
             cost_centre.code NULLS LAST,
             item.external_cost_centre_code NULLS LAST,
             item.id
  ` as FinanceReconciliationQueueRow[];

  const grouped = new Map<string, FinanceReconciliationQueueEntry>();
  for (const row of rows) {
    let reconciliation = grouped.get(row.reconciliation_id);
    if (!reconciliation) {
      reconciliation = {
        id: row.reconciliation_id,
        financialYearId: row.financial_year_id,
        financialYearName: row.financial_year_name,
        financialPeriodId: row.financial_period_id,
        financialPeriodName: row.financial_period_name,
        sourceSystemId: row.source_system_id,
        currency: row.reconciliation_currency,
        status: row.reconciliation_status,
        closeId: row.close_id,
        sourceActualCents: row.source_actual_cents.toString(),
        financeAdjustmentCents: row.finance_adjustment_cents.toString(),
        brainbaseEffectiveActualCents: row.brainbase_effective_actual_cents.toString(),
        externalGlTotalCents: row.external_gl_total_cents.toString(),
        varianceCents: row.reconciliation_variance_cents.toString(),
        unresolvedItemCount: Number(row.unresolved_item_count),
        snapshotAt: timestamp(row.snapshot_at),
        preparedAt: timestamp(row.prepared_at),
        reviewedAt: row.reviewed_at ? timestamp(row.reviewed_at) : null,
        notes: row.notes,
        items: [],
      };
      grouped.set(row.reconciliation_id, reconciliation);
    }

    reconciliation.items.push({
      id: row.item_id,
      budgetAccountId: row.budget_account_id,
      budgetAccountCode: row.budget_account_code,
      budgetAccountName: row.budget_account_name,
      externalGlAccountCode: row.external_gl_account_code,
      costCentreId: row.cost_centre_id,
      costCentreCode: row.cost_centre_code,
      costCentreName: row.cost_centre_name,
      externalCostCentreCode: row.external_cost_centre_code,
      currency: row.item_currency,
      sourceActualCents: row.item_source_actual_cents.toString(),
      financeAdjustmentCents: row.item_finance_adjustment_cents.toString(),
      brainbaseEffectiveActualCents: row.item_brainbase_effective_actual_cents.toString(),
      externalGlCents: row.item_external_gl_cents.toString(),
      varianceCents: row.item_variance_cents.toString(),
      sourceActualCount: Number(row.source_actual_count),
      externalEntryCount: Number(row.external_entry_count),
      outcome: row.outcome,
    });
  }

  return [...grouped.values()];
}

export async function prepareFinanceReconciliation(params: {
  organisationId: string;
  userId: string;
  financialPeriodId: string;
  sourceSystemId: string;
  currency: string;
  notes?: string | null;
}): Promise<PreparedFinanceReconciliation> {
  const organisationId = required(params.organisationId, 'Organisation');
  const userId = required(params.userId, 'User');
  const financialPeriodId = required(params.financialPeriodId, 'Financial period');
  const sourceSystemId = required(params.sourceSystemId, 'Source system');
  const currency = normaliseCurrency(params.currency);
  const notes = params.notes?.trim() || null;

  const [periodRows, sourceRows, adjustmentRows, mappingRows, externalRows] = await sql.transaction(txn => [    txn`
      SELECT id, starts_on, ends_on, transaction_timestamp() AS snapshot_at
      FROM commercial_financial_periods
      WHERE id = ${financialPeriodId}
        AND organisation_id = ${organisationId}
    `,
    txn`
      SELECT bcm.budget_account_id,
             COALESCE(pol.cost_centre_id, po.cost_centre_id) AS cost_centre_id,
             SUM(CASE cb.tax_basis
                   WHEN 'EXCLUSIVE' THEN sbl.line_subtotal_cents
                   ELSE sbl.line_total_cents
                 END)::text AS source_actual_cents,
             COUNT(sbl.id)::int AS source_actual_count
      FROM commercial_financial_periods fp
      JOIN commercial_supplier_bills sb
        ON sb.organisation_id = fp.organisation_id
       AND sb.status = 'POSTED'
       AND sb.posted_at IS NOT NULL
       AND sb.posted_at::date BETWEEN fp.starts_on AND fp.ends_on
       AND sb.currency = ${currency}
      JOIN commercial_supplier_bill_lines sbl
        ON sbl.organisation_id = sb.organisation_id
       AND sbl.supplier_bill_id = sb.id
      JOIN commercial_purchase_orders po
        ON po.organisation_id = sb.organisation_id
       AND po.id = sb.source_purchase_order_id
       AND po.currency = sb.currency
      JOIN commercial_purchase_order_lines pol
        ON pol.organisation_id = sbl.organisation_id
       AND pol.id = sbl.source_purchase_order_line_id
      JOIN commercial_budgets cb
        ON cb.organisation_id = fp.organisation_id
       AND cb.financial_year_id = fp.financial_year_id
       AND cb.currency = sb.currency
       AND cb.active_version_id IS NOT NULL
      JOIN commercial_budget_versions bv
        ON bv.organisation_id = cb.organisation_id
       AND bv.id = cb.active_version_id
       AND bv.status = 'ACTIVE'
      JOIN commercial_budget_commitment_mappings bcm        ON bcm.organisation_id = bv.organisation_id
       AND bcm.budget_version_id = bv.id
       AND bcm.cost_centre_id = COALESCE(pol.cost_centre_id, po.cost_centre_id)
      JOIN commercial_budget_lines bl
        ON bl.organisation_id = bv.organisation_id
       AND bl.budget_version_id = bv.id
       AND bl.budget_account_id = bcm.budget_account_id
       AND bl.cost_centre_id = COALESCE(pol.cost_centre_id, po.cost_centre_id)
      WHERE fp.id = ${financialPeriodId}
        AND fp.organisation_id = ${organisationId}
      GROUP BY bcm.budget_account_id, COALESCE(pol.cost_centre_id, po.cost_centre_id)
    `,
    txn`
      SELECT fal.budget_account_id,
             fal.cost_centre_id,
             COALESCE(SUM(fal.budget_basis_cents), 0)::text AS finance_adjustment_cents
      FROM commercial_finance_adjustments fa
      JOIN commercial_finance_adjustment_lines fal
        ON fal.organisation_id = fa.organisation_id
       AND fal.adjustment_id = fa.id
      WHERE fa.organisation_id = ${organisationId}
        AND fal.financial_period_id = ${financialPeriodId}
        AND fa.currency = ${currency}
        AND fa.status IN ('POSTED','REVERSED')
      GROUP BY fal.budget_account_id, fal.cost_centre_id
    `,
    txn`
      SELECT id, budget_account_id, external_gl_account_code, effective_from, effective_to
      FROM commercial_external_gl_account_mappings
      WHERE organisation_id = ${organisationId}
        AND source_system_id = ${sourceSystemId}
        AND effective_from <= (
          SELECT ends_on FROM commercial_financial_periods
          WHERE id = ${financialPeriodId} AND organisation_id = ${organisationId}
        )
        AND (effective_to IS NULL OR effective_to >= (
          SELECT starts_on FROM commercial_financial_periods
          WHERE id = ${financialPeriodId} AND organisation_id = ${organisationId}
        ))
      ORDER BY budget_account_id, effective_from, id
    `,
    txn`
      SELECT resolved.id AS external_gl_account_mapping_id,
             resolved.budget_account_id,
             e.external_account_code AS external_gl_account_code,
             resolved_cc.id AS external_cost_centre_mapping_id,
             resolved_cc.cost_centre_id,
             NULLIF(btrim(e.external_cost_centre_code), '') AS external_cost_centre_code,
             SUM(e.amount_minor_units)::text AS external_gl_cents,
             COUNT(e.id)::int AS external_entry_count
      FROM commercial_external_gl_entries e
      LEFT JOIN LATERAL (
        SELECT m.id, m.budget_account_id
        FROM commercial_external_gl_account_mappings m
        WHERE m.organisation_id = e.organisation_id
          AND m.source_system_id = e.source_system_id
          AND m.external_gl_account_code = e.external_account_code
          AND m.effective_from <= e.transaction_date
          AND (m.effective_to IS NULL OR m.effective_to >= e.transaction_date)
        ORDER BY m.effective_from DESC, m.id
        LIMIT 1
      ) resolved ON true
      LEFT JOIN LATERAL (
        SELECT m.id, m.cost_centre_id
        FROM commercial_external_gl_cost_centre_mappings m
        WHERE m.organisation_id = e.organisation_id
          AND m.source_system_id = e.source_system_id
          AND m.external_cost_centre_code = NULLIF(btrim(e.external_cost_centre_code), '')
          AND m.effective_from <= e.transaction_date
          AND (m.effective_to IS NULL OR m.effective_to >= e.transaction_date)
        ORDER BY m.effective_from DESC, m.id
        LIMIT 1
      ) resolved_cc ON true
      JOIN commercial_financial_periods fp
        ON fp.id = ${financialPeriodId}
       AND fp.organisation_id = e.organisation_id
       AND e.transaction_date BETWEEN fp.starts_on AND fp.ends_on
      WHERE e.organisation_id = ${organisationId}
        AND e.source_system_id = ${sourceSystemId}
        AND e.currency = ${currency}
      GROUP BY resolved.id, resolved.budget_account_id,
               e.external_account_code, resolved_cc.id, resolved_cc.cost_centre_id,
               NULLIF(btrim(e.external_cost_centre_code), '')
      ORDER BY e.external_account_code, external_cost_centre_code NULLS FIRST
    `,
  ], { isolationLevel: 'RepeatableRead' });  const period = (periodRows as PeriodRow[])[0];
  if (!period) {
    throw new FinanceReconciliationError('NOT_FOUND', 'Financial period not found for this organisation.');
  }

  const startsOn = dateOnly(period.starts_on);
  const endsOn = dateOnly(period.ends_on);
  const mappings = mappingRows as MappingRow[];
  const source = sourceRows as SourceRow[];
  const adjustments = adjustmentRows as AdjustmentRow[];
  const external = externalRows as ExternalRow[];

  type BrainGrain = {
    budgetAccountId: string;
    costCentreId: string;
    sourceActualCents: bigint;
    financeAdjustmentCents: bigint;
    sourceActualCount: number;
  };
  const brainByGrain = new Map<string, BrainGrain>();
  const brainKey = (budgetAccountId: string, costCentreId: string) =>
    [budgetAccountId, costCentreId].join('|');

  for (const row of source) {
    const key = brainKey(row.budget_account_id, row.cost_centre_id);
    const current = brainByGrain.get(key) ?? {
      budgetAccountId: row.budget_account_id,
      costCentreId: row.cost_centre_id,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      sourceActualCount: 0,
    };
    current.sourceActualCents += money(row.source_actual_cents);
    current.sourceActualCount += Number(row.source_actual_count);
    brainByGrain.set(key, current);
  }
  for (const row of adjustments) {
    const key = brainKey(row.budget_account_id, row.cost_centre_id);
    const current = brainByGrain.get(key) ?? {
      budgetAccountId: row.budget_account_id,
      costCentreId: row.cost_centre_id,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      sourceActualCount: 0,
    };
    current.financeAdjustmentCents += money(row.finance_adjustment_cents);
    brainByGrain.set(key, current);
  }

  const brainByAccount = new Map<string, BrainGrain[]>();
  for (const grain of brainByGrain.values()) {
    const grains = brainByAccount.get(grain.budgetAccountId) ?? [];
    grains.push(grain);
    brainByAccount.set(grain.budgetAccountId, grains);
  }

  const coveringByAccount = new Map<string, MappingRow>();
  for (const accountId of brainByAccount.keys()) {
    const covering = mappings.filter(mapping =>
      mapping.budget_account_id === accountId
      && dateOnly(mapping.effective_from) <= startsOn
      && (mapping.effective_to === null || dateOnly(mapping.effective_to) >= endsOn),
    );
    if (covering.length > 1) {
      throw new FinanceReconciliationError(
        'AMBIGUOUS_MAPPING',
        'Multiple external GL mappings cover the full financial period for one Budget account.',
      );
    }
    if (covering[0]) coveringByAccount.set(accountId, covering[0]);
  }

  const externalAccountLevel = new Map<string, {
    mappingId: string;
    budgetAccountId: string;
    externalGlAccountCode: string;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const externalByCostCentre = new Map<string, {
    mappingId: string;
    budgetAccountId: string;
    externalGlAccountCode: string;
    costCentreId: string;
    costCentreMappingIds: Set<string>;
    externalCostCentreCodes: Set<string>;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const unresolvedCostCentre = new Map<string, {
    mappingId: string;
    budgetAccountId: string;
    externalGlAccountCode: string;
    externalCostCentreCode: string | null;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const unmappedExternal = new Map<string, {
    externalGlAccountCode: string;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const costCentreModeMappings = new Set<string>();

  for (const row of external) {
    const cents = money(row.external_gl_cents);
    const count = Number(row.external_entry_count);

    if (!row.external_gl_account_mapping_id || !row.budget_account_id) {
      const current = unmappedExternal.get(row.external_gl_account_code) ?? {
        externalGlAccountCode: row.external_gl_account_code,
        externalGlCents: BigInt(0),
        externalEntryCount: 0,
      };
      current.externalGlCents += cents;
      current.externalEntryCount += count;
      unmappedExternal.set(row.external_gl_account_code, current);
      continue;
    }

    if (row.external_cost_centre_code) {
      costCentreModeMappings.add(row.external_gl_account_mapping_id);
      if (!row.external_cost_centre_mapping_id || !row.cost_centre_id) {
        const key = [
          row.external_gl_account_mapping_id,
          row.external_gl_account_code,
          row.external_cost_centre_code,
        ].join('|');
        const current = unresolvedCostCentre.get(key) ?? {
          mappingId: row.external_gl_account_mapping_id,
          budgetAccountId: row.budget_account_id,
          externalGlAccountCode: row.external_gl_account_code,
          externalCostCentreCode: row.external_cost_centre_code,
          externalGlCents: BigInt(0),
          externalEntryCount: 0,
        };
        current.externalGlCents += cents;
        current.externalEntryCount += count;
        unresolvedCostCentre.set(key, current);
        continue;
      }

      const key = [row.external_gl_account_mapping_id, row.cost_centre_id].join('|');
      const current = externalByCostCentre.get(key) ?? {
        mappingId: row.external_gl_account_mapping_id,
        budgetAccountId: row.budget_account_id,
        externalGlAccountCode: row.external_gl_account_code,
        costCentreId: row.cost_centre_id,
        costCentreMappingIds: new Set<string>(),
        externalCostCentreCodes: new Set<string>(),
        externalGlCents: BigInt(0),
        externalEntryCount: 0,
      };
      current.costCentreMappingIds.add(row.external_cost_centre_mapping_id);
      current.externalCostCentreCodes.add(row.external_cost_centre_code);
      current.externalGlCents += cents;
      current.externalEntryCount += count;
      externalByCostCentre.set(key, current);
      continue;
    }

    const key = row.external_gl_account_mapping_id;
    const current = externalAccountLevel.get(key) ?? {
      mappingId: row.external_gl_account_mapping_id,
      budgetAccountId: row.budget_account_id,
      externalGlAccountCode: row.external_gl_account_code,
      externalGlCents: BigInt(0),
      externalEntryCount: 0,
    };
    current.externalGlCents += cents;
    current.externalEntryCount += count;
    externalAccountLevel.set(key, current);
  }

  const mutableItems: MutableItem[] = [];
  const consumedAccountMappings = new Set<string>();
  const consumedCostCentreKeys = new Set<string>();

  function aggregateBrain(grains: BrainGrain[]) {
    return grains.reduce((total, grain) => ({
      sourceActualCents: total.sourceActualCents + grain.sourceActualCents,
      financeAdjustmentCents: total.financeAdjustmentCents + grain.financeAdjustmentCents,
      sourceActualCount: total.sourceActualCount + grain.sourceActualCount,
    }), {
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      sourceActualCount: 0,
    });
  }

  for (const [budgetAccountId, grains] of [...brainByAccount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mapping = coveringByAccount.get(budgetAccountId);

    if (!mapping) {
      const brain = aggregateBrain(grains);
      const effective = brain.sourceActualCents + brain.financeAdjustmentCents;
      mutableItems.push({
        budgetAccountId,
        externalGlAccountMappingId: null,
        externalGlAccountCode: null,
        externalCostCentreMappingId: null,
        costCentreId: null,
        externalCostCentreCode: null,
        currency,
        sourceActualCents: brain.sourceActualCents,
        financeAdjustmentCents: brain.financeAdjustmentCents,
        brainbaseEffectiveActualCents: effective,
        externalGlCents: BigInt(0),
        varianceCents: effective,
        sourceActualCount: brain.sourceActualCount,
        externalEntryCount: 0,
        outcome: 'UNMAPPED_BRAINBASE_ACCOUNT',
      });
      continue;
    }

    if (costCentreModeMappings.has(mapping.id)) {
      const accountLevelExternal = externalAccountLevel.get(mapping.id);
      if (accountLevelExternal) {
        consumedAccountMappings.add(mapping.id);
        mutableItems.push({
          budgetAccountId,
          externalGlAccountMappingId: mapping.id,
          externalGlAccountCode: mapping.external_gl_account_code,
          externalCostCentreMappingId: null,
          costCentreId: null,
          externalCostCentreCode: null,
          currency,
          sourceActualCents: BigInt(0),
          financeAdjustmentCents: BigInt(0),
          brainbaseEffectiveActualCents: BigInt(0),
          externalGlCents: accountLevelExternal.externalGlCents,
          varianceCents: -accountLevelExternal.externalGlCents,
          sourceActualCount: 0,
          externalEntryCount: accountLevelExternal.externalEntryCount,
          outcome: 'UNMAPPED_COST_CENTRE',
        });
      }

      for (const grain of [...grains].sort((a, b) => a.costCentreId.localeCompare(b.costCentreId))) {
        const key = [mapping.id, grain.costCentreId].join('|');
        const ext = externalByCostCentre.get(key);
        if (ext) consumedCostCentreKeys.add(key);
        const externalCents = ext?.externalGlCents ?? BigInt(0);
        const effective = grain.sourceActualCents + grain.financeAdjustmentCents;
        const variance = effective - externalCents;
        const mappingIds = ext ? [...ext.costCentreMappingIds].sort() : [];
        const externalCodes = ext ? [...ext.externalCostCentreCodes].sort() : [];
        const outcome: FinanceReconciliationOutcome = !ext
          ? 'MISSING_EXTERNAL_ENTRY'
          : variance === BigInt(0)
            ? 'RECONCILED'
            : 'VARIANCE';

        mutableItems.push({
          budgetAccountId,
          externalGlAccountMappingId: mapping.id,
          externalGlAccountCode: mapping.external_gl_account_code,
          externalCostCentreMappingId: mappingIds.length === 1 ? mappingIds[0] : null,
          costCentreId: grain.costCentreId,
          externalCostCentreCode: externalCodes.length === 1 ? externalCodes[0] : null,
          currency,
          sourceActualCents: grain.sourceActualCents,
          financeAdjustmentCents: grain.financeAdjustmentCents,
          brainbaseEffectiveActualCents: effective,
          externalGlCents: externalCents,
          varianceCents: variance,
          sourceActualCount: grain.sourceActualCount,
          externalEntryCount: ext?.externalEntryCount ?? 0,
          outcome,
        });
      }
      continue;
    }

    const brain = aggregateBrain(grains);
    const effective = brain.sourceActualCents + brain.financeAdjustmentCents;
    const ext = externalAccountLevel.get(mapping.id);
    if (ext) consumedAccountMappings.add(mapping.id);
    const externalCents = ext?.externalGlCents ?? BigInt(0);
    const variance = effective - externalCents;
    const outcome: FinanceReconciliationOutcome = !ext
      ? 'MISSING_EXTERNAL_ENTRY'
      : variance === BigInt(0)
        ? 'RECONCILED'
        : 'VARIANCE';

    mutableItems.push({
      budgetAccountId,
      externalGlAccountMappingId: mapping.id,
      externalGlAccountCode: mapping.external_gl_account_code,
      externalCostCentreMappingId: null,
      costCentreId: null,
      externalCostCentreCode: null,
      currency,
      sourceActualCents: brain.sourceActualCents,
      financeAdjustmentCents: brain.financeAdjustmentCents,
      brainbaseEffectiveActualCents: effective,
      externalGlCents: externalCents,
      varianceCents: variance,
      sourceActualCount: brain.sourceActualCount,
      externalEntryCount: ext?.externalEntryCount ?? 0,
      outcome,
    });
  }

  for (const ext of [...externalAccountLevel.values()].sort((a, b) =>
    a.externalGlAccountCode.localeCompare(b.externalGlAccountCode),
  )) {
    if (consumedAccountMappings.has(ext.mappingId)) continue;
    mutableItems.push({
      budgetAccountId: ext.budgetAccountId,
      externalGlAccountMappingId: ext.mappingId,
      externalGlAccountCode: ext.externalGlAccountCode,
      externalCostCentreMappingId: null,
      costCentreId: null,
      externalCostCentreCode: null,
      currency,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      brainbaseEffectiveActualCents: BigInt(0),
      externalGlCents: ext.externalGlCents,
      varianceCents: -ext.externalGlCents,
      sourceActualCount: 0,
      externalEntryCount: ext.externalEntryCount,
      outcome: costCentreModeMappings.has(ext.mappingId)
        ? 'UNMAPPED_COST_CENTRE'
        : 'EXTERNAL_ONLY_ENTRY',
    });
  }

  for (const [key, ext] of [...externalByCostCentre.entries()].sort(([, a], [, b]) =>
    a.externalGlAccountCode.localeCompare(b.externalGlAccountCode)
      || a.costCentreId.localeCompare(b.costCentreId),
  )) {
    if (consumedCostCentreKeys.has(key)) continue;
    const mappingIds = [...ext.costCentreMappingIds].sort();
    const externalCodes = [...ext.externalCostCentreCodes].sort();
    mutableItems.push({
      budgetAccountId: ext.budgetAccountId,
      externalGlAccountMappingId: ext.mappingId,
      externalGlAccountCode: ext.externalGlAccountCode,
      externalCostCentreMappingId: mappingIds.length === 1 ? mappingIds[0] : null,
      costCentreId: ext.costCentreId,
      externalCostCentreCode: externalCodes.length === 1 ? externalCodes[0] : null,
      currency,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      brainbaseEffectiveActualCents: BigInt(0),
      externalGlCents: ext.externalGlCents,
      varianceCents: -ext.externalGlCents,
      sourceActualCount: 0,
      externalEntryCount: ext.externalEntryCount,
      outcome: 'EXTERNAL_ONLY_ENTRY',
    });
  }

  for (const ext of [...unresolvedCostCentre.values()].sort((a, b) =>
    a.externalGlAccountCode.localeCompare(b.externalGlAccountCode)
      || (a.externalCostCentreCode ?? '').localeCompare(b.externalCostCentreCode ?? ''),
  )) {
    mutableItems.push({
      budgetAccountId: ext.budgetAccountId,
      externalGlAccountMappingId: ext.mappingId,
      externalGlAccountCode: ext.externalGlAccountCode,
      externalCostCentreMappingId: null,
      costCentreId: null,
      externalCostCentreCode: ext.externalCostCentreCode,
      currency,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      brainbaseEffectiveActualCents: BigInt(0),
      externalGlCents: ext.externalGlCents,
      varianceCents: -ext.externalGlCents,
      sourceActualCount: 0,
      externalEntryCount: ext.externalEntryCount,
      outcome: 'UNMAPPED_COST_CENTRE',
    });
  }

  for (const ext of [...unmappedExternal.values()].sort((a, b) =>
    a.externalGlAccountCode.localeCompare(b.externalGlAccountCode),
  )) {
    mutableItems.push({
      budgetAccountId: null,
      externalGlAccountMappingId: null,
      externalGlAccountCode: ext.externalGlAccountCode,
      externalCostCentreMappingId: null,
      costCentreId: null,
      externalCostCentreCode: null,
      currency,
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      brainbaseEffectiveActualCents: BigInt(0),
      externalGlCents: ext.externalGlCents,
      varianceCents: -ext.externalGlCents,      sourceActualCount: 0,
      externalEntryCount: ext.externalEntryCount,
      outcome: 'UNMAPPED_EXTERNAL_GL_ACCOUNT',
    });
  }

  const items = mutableItems.map(finaliseItem);
  const sourceActualCents = mutableItems.reduce((sum, item) => sum + item.sourceActualCents, BigInt(0));
  const financeAdjustmentCents = mutableItems.reduce((sum, item) => sum + item.financeAdjustmentCents, BigInt(0));
  const brainbaseEffectiveActualCents = sourceActualCents + financeAdjustmentCents;
  const externalGlTotalCents = mutableItems.reduce((sum, item) => sum + item.externalGlCents, BigInt(0));
  const varianceCents = brainbaseEffectiveActualCents - externalGlTotalCents;
  const unresolvedItemCount = mutableItems.filter(item => item.outcome !== 'RECONCILED').length;
  const reconciliationId = randomUUID();
  const snapshotAt = timestamp(period.snapshot_at);

  await sql.transaction(txn => [
    txn`
      INSERT INTO commercial_finance_reconciliations (
        id, organisation_id, financial_period_id, source_system_id, currency, status,
        source_actual_cents, finance_adjustment_cents, brainbase_effective_actual_cents,
        external_gl_total_cents, variance_cents, unresolved_item_count,
        snapshot_at, prepared_by, notes
      ) VALUES (
        ${reconciliationId}, ${organisationId}, ${financialPeriodId}, ${sourceSystemId}, ${currency}, 'PREPARED',
        ${sourceActualCents.toString()}::bigint, ${financeAdjustmentCents.toString()}::bigint,
        ${brainbaseEffectiveActualCents.toString()}::bigint, ${externalGlTotalCents.toString()}::bigint,
        ${varianceCents.toString()}::bigint, ${unresolvedItemCount},
        ${snapshotAt}::timestamptz, ${userId}, ${notes}
      )
    `,    ...items.map(item => txn`
      INSERT INTO commercial_finance_reconciliation_items (
        id, organisation_id, reconciliation_id,
        budget_account_id, external_gl_account_mapping_id, external_gl_account_code,
        external_cost_centre_mapping_id, cost_centre_id, external_cost_centre_code, currency,
        source_actual_cents, finance_adjustment_cents, brainbase_effective_actual_cents,
        external_gl_cents, variance_cents, source_actual_count, external_entry_count, outcome
      ) VALUES (
        ${item.id}, ${organisationId}, ${reconciliationId},
        ${item.budgetAccountId}, ${item.externalGlAccountMappingId}, ${item.externalGlAccountCode},
        ${item.externalCostCentreMappingId}, ${item.costCentreId}, ${item.externalCostCentreCode}, ${currency},
        ${item.sourceActualCents}::bigint, ${item.financeAdjustmentCents}::bigint, ${item.brainbaseEffectiveActualCents}::bigint,
        ${item.externalGlCents}::bigint, ${item.varianceCents}::bigint,
        ${item.sourceActualCount}, ${item.externalEntryCount}, ${item.outcome}
      )
    `),
    txn`
      INSERT INTO commercial_finance_reconciliation_events (
        organisation_id, reconciliation_id, event_type, actor_user_id, details
      ) VALUES (
        ${organisationId}, ${reconciliationId}, 'PREPARED', ${userId},
        jsonb_build_object(
          'financialPeriodId', ${financialPeriodId},
          'sourceSystemId', ${sourceSystemId},
          'currency', ${currency},
          'varianceCents', ${varianceCents.toString()},
          'unresolvedItemCount', ${unresolvedItemCount}
        )
      )
    `,
  ], { isolationLevel: 'ReadCommitted' });

  return {
    id: reconciliationId,
    organisationId,
    financialPeriodId,
    sourceSystemId,
    currency,
    status: 'PREPARED',
    sourceActualCents: sourceActualCents.toString(),
    financeAdjustmentCents: financeAdjustmentCents.toString(),
    brainbaseEffectiveActualCents: brainbaseEffectiveActualCents.toString(),
    externalGlTotalCents: externalGlTotalCents.toString(),
    varianceCents: varianceCents.toString(),
    unresolvedItemCount,
    snapshotAt,
    preparedBy: userId,
    notes,
    items,
  };
}


export async function reviewFinanceReconciliation(params: {
  organisationId: string;
  userId: string;
  reconciliationId: string;
}): Promise<ReviewedFinanceReconciliation> {
  const organisationId = required(params.organisationId, 'Organisation');
  const userId = required(params.userId, 'User');
  const reconciliationId = required(params.reconciliationId, 'Reconciliation');

  const [lockedRows, reviewedRows] = await sql.transaction(txn => [
    txn`
      SELECT id, organisation_id, financial_period_id, source_system_id, currency,
             status, reviewed_by, reviewed_at
      FROM commercial_finance_reconciliations
      WHERE id = ${reconciliationId}
        AND organisation_id = ${organisationId}
      FOR UPDATE
    `,
    txn`
      WITH reviewed AS (
        UPDATE commercial_finance_reconciliations
        SET status = 'REVIEWED',
            reviewed_by = ${userId},
            reviewed_at = now()
        WHERE id = ${reconciliationId}
          AND organisation_id = ${organisationId}
          AND status = 'PREPARED'
        RETURNING id, organisation_id, financial_period_id, source_system_id, currency,
                  status, reviewed_by, reviewed_at
      ),
      event_inserted AS (
        INSERT INTO commercial_finance_reconciliation_events (
          organisation_id, reconciliation_id, event_type, actor_user_id, details
        )
        SELECT organisation_id, id, 'REVIEWED', ${userId},
               jsonb_build_object('previousStatus', 'PREPARED', 'newStatus', 'REVIEWED')
        FROM reviewed
        RETURNING reconciliation_id
      )
      SELECT reviewed.*
      FROM reviewed
      JOIN event_inserted ON event_inserted.reconciliation_id = reviewed.id
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const locked = (lockedRows as ReconciliationLifecycleRow[])[0];
  if (!locked) {
    throw new FinanceReconciliationError('NOT_FOUND', 'Finance reconciliation not found for this organisation.');
  }
  if (locked.status !== 'PREPARED') {
    throw new FinanceReconciliationError(
      'INVALID_STATE',
      'Only a PREPARED finance reconciliation can be reviewed.',
    );
  }

  const reviewed = (reviewedRows as ReconciliationLifecycleRow[])[0];
  if (!reviewed?.reviewed_by || !reviewed.reviewed_at || reviewed.status !== 'REVIEWED') {
    throw new FinanceReconciliationError(
      'INVALID_STATE',
      'Finance reconciliation review did not complete.',
    );
  }

  return {
    id: reviewed.id,
    organisationId: reviewed.organisation_id,
    financialPeriodId: reviewed.financial_period_id,
    sourceSystemId: reviewed.source_system_id,
    currency: reviewed.currency,
    status: 'REVIEWED',
    reviewedBy: reviewed.reviewed_by,
    reviewedAt: timestamp(reviewed.reviewed_at),
  };
}


export async function signOffFinanceReconciliation(params: {
  organisationId: string;
  userId: string;
  reconciliationId: string;
  closeId: string;
}): Promise<SignedOffFinanceReconciliation> {
  const organisationId = required(params.organisationId, 'Organisation');
  const userId = required(params.userId, 'User');
  const reconciliationId = required(params.reconciliationId, 'Reconciliation');
  const closeId = required(params.closeId, 'Close');

  const [reconciliationRows, closeRows, signedRows] = await sql.transaction(txn => [
    txn`
      SELECT id, organisation_id, financial_period_id, source_system_id, currency,
             status, close_id, reviewed_by, reviewed_at
      FROM commercial_finance_reconciliations
      WHERE id = ${reconciliationId}
        AND organisation_id = ${organisationId}
      FOR UPDATE
    `,
    txn`
      SELECT id, financial_period_id, status, reconciliation_status
      FROM commercial_financial_period_closes
      WHERE id = ${closeId}
        AND organisation_id = ${organisationId}
      FOR UPDATE
    `,
    txn`
      WITH signed AS (
        UPDATE commercial_finance_reconciliations reconciliation
        SET status = 'SIGNED_OFF',
            close_id = ${closeId}
        WHERE reconciliation.id = ${reconciliationId}
          AND reconciliation.organisation_id = ${organisationId}
          AND reconciliation.status = 'REVIEWED'
          AND reconciliation.close_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM commercial_financial_period_closes close_record
            WHERE close_record.id = ${closeId}
              AND close_record.organisation_id = reconciliation.organisation_id
              AND close_record.financial_period_id = reconciliation.financial_period_id
              AND close_record.status = 'CLOSED'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM commercial_finance_reconciliations existing
            WHERE existing.organisation_id = reconciliation.organisation_id
              AND existing.close_id = ${closeId}
          )
        RETURNING reconciliation.id, reconciliation.organisation_id,
                  reconciliation.financial_period_id, reconciliation.source_system_id,
                  reconciliation.currency, reconciliation.status, reconciliation.close_id,
                  reconciliation.reviewed_by, reconciliation.reviewed_at
      ),
      close_updated AS (
        UPDATE commercial_financial_period_closes close_record
        SET reconciliation_status = 'SIGNED_OFF'
        WHERE close_record.id = ${closeId}
          AND close_record.organisation_id = ${organisationId}
          AND close_record.status = 'CLOSED'
          AND EXISTS (SELECT 1 FROM signed)
        RETURNING close_record.id
      ),
      event_inserted AS (
        INSERT INTO commercial_finance_reconciliation_events (
          organisation_id, reconciliation_id, event_type, actor_user_id, details
        )
        SELECT signed.organisation_id, signed.id, 'SIGNED_OFF', ${userId},
               jsonb_build_object(
                 'closeId', signed.close_id,
                 'previousStatus', 'REVIEWED',
                 'newStatus', 'SIGNED_OFF'
               )
        FROM signed
        JOIN close_updated ON close_updated.id = signed.close_id
        RETURNING reconciliation_id
      )
      SELECT signed.*
      FROM signed
      JOIN close_updated ON close_updated.id = signed.close_id
      JOIN event_inserted ON event_inserted.reconciliation_id = signed.id
    `,
  ], { isolationLevel: 'ReadCommitted' });

  const reconciliation = (reconciliationRows as ReconciliationLifecycleRow[])[0];
  if (!reconciliation) {
    throw new FinanceReconciliationError(
      'NOT_FOUND',
      'Finance reconciliation not found for this organisation.',
    );
  }

  const close = (closeRows as { id: string; financial_period_id: string; status: string }[])[0];
  if (!close) {
    throw new FinanceReconciliationError('NOT_FOUND', 'Financial period close not found for this organisation.');
  }
  if (reconciliation.status !== 'REVIEWED') {
    throw new FinanceReconciliationError(
      'INVALID_STATE',
      'Only a REVIEWED finance reconciliation can be signed off.',
    );
  }
  if (close.status !== 'CLOSED' || close.financial_period_id !== reconciliation.financial_period_id) {
    throw new FinanceReconciliationError(
      'INVALID_STATE',
      'Sign-off requires the current CLOSED record for the same financial period.',
    );
  }

  const signed = (signedRows as ReconciliationLifecycleRow[])[0];
  if (!signed?.close_id || !signed.reviewed_by || !signed.reviewed_at || signed.status !== 'SIGNED_OFF') {
    throw new FinanceReconciliationError(
      'INVALID_STATE',
      'Finance reconciliation sign-off did not complete.',
    );
  }

  return {
    id: signed.id,
    organisationId: signed.organisation_id,
    financialPeriodId: signed.financial_period_id,
    sourceSystemId: signed.source_system_id,
    currency: signed.currency,
    status: 'SIGNED_OFF',
    closeId: signed.close_id,
    reviewedBy: signed.reviewed_by,
    reviewedAt: timestamp(signed.reviewed_at),
  };
}
