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
      | 'AMBIGUOUS_MAPPING',
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
  source_actual_cents: string | number | bigint;
  source_actual_count: string | number | bigint;
};type AdjustmentRow = {
  budget_account_id: string;
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
  external_cost_centre_code: string | null;
  external_gl_cents: string | number | bigint;
  external_entry_count: string | number | bigint;
};

export type PreparedFinanceReconciliationItem = {
  id: string;
  budgetAccountId: string | null;
  externalGlAccountMappingId: string | null;
  externalGlAccountCode: string | null;
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

function required(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new FinanceReconciliationError('INVALID_INPUT', `${label} is required.`);
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
      GROUP BY bcm.budget_account_id
    `,
    txn`
      SELECT fal.budget_account_id,
             COALESCE(SUM(fal.budget_basis_cents), 0)::text AS finance_adjustment_cents
      FROM commercial_finance_adjustments fa
      JOIN commercial_finance_adjustment_lines fal
        ON fal.organisation_id = fa.organisation_id
       AND fal.adjustment_id = fa.id
      WHERE fa.organisation_id = ${organisationId}
        AND fal.financial_period_id = ${financialPeriodId}
        AND fa.currency = ${currency}
        AND fa.status IN ('POSTED','REVERSED')
      GROUP BY fal.budget_account_id
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
      ORDER BY budget_account_id, effective_from, id    `,
    txn`
      SELECT resolved.id AS external_gl_account_mapping_id,
             resolved.budget_account_id,
             e.external_account_code AS external_gl_account_code,
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
      JOIN commercial_financial_periods fp
        ON fp.id = ${financialPeriodId}
       AND fp.organisation_id = e.organisation_id
       AND e.transaction_date BETWEEN fp.starts_on AND fp.ends_on
      WHERE e.organisation_id = ${organisationId}
        AND e.source_system_id = ${sourceSystemId}
        AND e.currency = ${currency}
      GROUP BY resolved.id, resolved.budget_account_id,
               e.external_account_code, NULLIF(btrim(e.external_cost_centre_code), '')
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

  const brainByAccount = new Map<string, {
    sourceActualCents: bigint;
    financeAdjustmentCents: bigint;
    sourceActualCount: number;
  }>();

  for (const row of source) {
    brainByAccount.set(row.budget_account_id, {
      sourceActualCents: money(row.source_actual_cents),
      financeAdjustmentCents: BigInt(0),
      sourceActualCount: Number(row.source_actual_count),
    });
  }
  for (const row of adjustments) {
    const current = brainByAccount.get(row.budget_account_id) ?? {
      sourceActualCents: BigInt(0),
      financeAdjustmentCents: BigInt(0),
      sourceActualCount: 0,
    };
    current.financeAdjustmentCents += money(row.finance_adjustment_cents);
    brainByAccount.set(row.budget_account_id, current);
  }  const coveringByAccount = new Map<string, MappingRow>();
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

  const externalMapped = new Map<string, {
    mappingId: string;
    budgetAccountId: string;
    externalGlAccountCode: string;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const unresolvedCostCentre = new Map<string, {
    mappingId: string | null;
    budgetAccountId: string | null;
    externalGlAccountCode: string;
    externalCostCentreCode: string;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();
  const unmappedExternal = new Map<string, {
    externalGlAccountCode: string;
    externalGlCents: bigint;
    externalEntryCount: number;
  }>();  for (const row of external) {
    const cents = money(row.external_gl_cents);
    const count = Number(row.external_entry_count);
    if (row.external_cost_centre_code) {
      const key = [
        row.external_gl_account_mapping_id ?? '',
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

    const key = row.external_gl_account_mapping_id;
    const current = externalMapped.get(key) ?? {
      mappingId: row.external_gl_account_mapping_id,
      budgetAccountId: row.budget_account_id,
      externalGlAccountCode: row.external_gl_account_code,
      externalGlCents: BigInt(0),
      externalEntryCount: 0,
    };    current.externalGlCents += cents;
    current.externalEntryCount += count;
    externalMapped.set(key, current);
  }

  const mutableItems: MutableItem[] = [];
  const consumedMappings = new Set<string>();

  for (const [budgetAccountId, brain] of [...brainByAccount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const effective = brain.sourceActualCents + brain.financeAdjustmentCents;
    const mapping = coveringByAccount.get(budgetAccountId);

    if (!mapping) {
      mutableItems.push({
        budgetAccountId,
        externalGlAccountMappingId: null,
        externalGlAccountCode: null,
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

    const ext = externalMapped.get(mapping.id);
    if (ext) consumedMappings.add(mapping.id);
    const externalCents = ext?.externalGlCents ?? BigInt(0);
    const variance = effective - externalCents;
    const outcome: FinanceReconciliationOutcome = !ext
      ? 'MISSING_EXTERNAL_ENTRY'
      : variance === BigInt(0)
        ? 'RECONCILED'
        : 'VARIANCE';    mutableItems.push({
      budgetAccountId,
      externalGlAccountMappingId: mapping.id,
      externalGlAccountCode: mapping.external_gl_account_code,
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

  for (const ext of [...externalMapped.values()].sort((a, b) => a.externalGlAccountCode.localeCompare(b.externalGlAccountCode))) {
    if (consumedMappings.has(ext.mappingId)) continue;
    mutableItems.push({
      budgetAccountId: ext.budgetAccountId,
      externalGlAccountMappingId: ext.mappingId,
      externalGlAccountCode: ext.externalGlAccountCode,
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
      outcome: 'EXTERNAL_ONLY_ENTRY',
    });
  }  for (const ext of [...unresolvedCostCentre.values()].sort((a, b) =>
    a.externalGlAccountCode.localeCompare(b.externalGlAccountCode)
      || a.externalCostCentreCode.localeCompare(b.externalCostCentreCode),
  )) {
    mutableItems.push({
      budgetAccountId: ext.budgetAccountId,
      externalGlAccountMappingId: ext.mappingId,
      externalGlAccountCode: ext.externalGlAccountCode,
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
        cost_centre_id, external_cost_centre_code, currency,
        source_actual_cents, finance_adjustment_cents, brainbase_effective_actual_cents,
        external_gl_cents, variance_cents, source_actual_count, external_entry_count, outcome
      ) VALUES (
        ${item.id}, ${organisationId}, ${reconciliationId},
        ${item.budgetAccountId}, ${item.externalGlAccountMappingId}, ${item.externalGlAccountCode},
        ${item.costCentreId}, ${item.externalCostCentreCode}, ${currency},
        ${item.sourceActualCents}::bigint, ${item.financeAdjustmentCents}::bigint, ${item.brainbaseEffectiveActualCents}::bigint,
        ${item.externalGlCents}::bigint, ${item.varianceCents}::bigint,
        ${item.sourceActualCount}, ${item.externalEntryCount}, ${item.outcome}
      )
    `),
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
