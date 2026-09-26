import 'server-only';
import sql from '@/lib/db';
import {
  logBudgetCreated,
  logBudgetVersionCreated,
  logBudgetLineChanged,
  logBudgetPeriodAllocationChanged,
  logBudgetCommitmentMappingChanged,
} from './auditLog';

export type BudgetTaxBasis = 'EXCLUSIVE' | 'INCLUSIVE';
export type BudgetPeriodisationMode = 'ANNUAL_ONLY' | 'PERIODISED';
export type BudgetVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

function assertBudgetHeaderInput(currency: string, taxBasis: string, periodisationMode: string): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error('currency must be a 3-letter code');
  if (taxBasis !== 'EXCLUSIVE' && taxBasis !== 'INCLUSIVE') throw new Error('invalid tax_basis');
  if (periodisationMode !== 'ANNUAL_ONLY' && periodisationMode !== 'PERIODISED') throw new Error('invalid periodisation_mode');
  return normalizedCurrency;
}

async function requireBudgetLineReferences(organisationId: string, budgetAccountId: string, costCentreId: string): Promise<void> {
  const rows = await sql`
    SELECT
      EXISTS(SELECT 1 FROM commercial_budget_accounts WHERE id = ${budgetAccountId} AND organisation_id = ${organisationId}) AS account_exists,
      EXISTS(SELECT 1 FROM commercial_cost_centres WHERE id = ${costCentreId} AND organisation_id = ${organisationId}) AS cost_centre_exists
  ` as { account_exists: boolean; cost_centre_exists: boolean }[];
  const refs = rows[0];
  if (!refs?.account_exists) throw new Error('budget_account_id not found for this organisation');
  if (!refs.cost_centre_exists) throw new Error('cost_centre_id not found for this organisation');
}

export interface CommercialBudget {
  id: string; organisation_id: string; financial_year_id: string; name: string; currency: string;
  tax_basis: BudgetTaxBasis; periodisation_mode: BudgetPeriodisationMode; active_version_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface CommercialBudgetVersion {
  id: string; organisation_id: string; budget_id: string; version_number: number; status: BudgetVersionStatus;
  notes: string | null; created_by: string | null; created_at: string; activated_by: string | null;
  activated_at: string | null; superseded_at: string | null;
}
export interface CommercialBudgetLine {
  id: string; organisation_id: string; budget_version_id: string; budget_account_id: string;
  cost_centre_id: string; annual_budget_cents: string | number; created_at: string;
}
export interface CommercialBudgetPeriodAllocation {
  id: string; organisation_id: string; budget_line_id: string; financial_period_id: string;
  amount_cents: string | number; created_at: string;
}
export interface CommercialBudgetCommitmentMapping {
  id: string; organisation_id: string; budget_version_id: string; cost_centre_id: string;
  budget_account_id: string; created_by: string | null; created_at: string;
}

export async function getBudget(organisationId: string, budgetId: string): Promise<CommercialBudget | null> {
  const rows = await sql`SELECT * FROM commercial_budgets WHERE id = ${budgetId} AND organisation_id = ${organisationId}` as CommercialBudget[];
  return rows[0] ?? null;
}
export async function getBudgetVersion(organisationId: string, versionId: string): Promise<CommercialBudgetVersion | null> {
  const rows = await sql`SELECT * FROM commercial_budget_versions WHERE id = ${versionId} AND organisation_id = ${organisationId}` as CommercialBudgetVersion[];
  return rows[0] ?? null;
}
async function requireDraftVersion(organisationId: string, versionId: string): Promise<CommercialBudgetVersion> {
  const version = await getBudgetVersion(organisationId, versionId);
  if (!version) throw new Error('budget_version_id not found for this organisation');
  if (version.status !== 'DRAFT') throw new Error('Only DRAFT budget versions are editable');
  return version;
}

export async function createBudget(params: {
  organisationId: string; userId: string; financialYearId: string; name: string; currency: string;
  taxBasis: BudgetTaxBasis; periodisationMode: BudgetPeriodisationMode; notes?: string | null;
}): Promise<{ budget: CommercialBudget; version: CommercialBudgetVersion }> {
  const name = params.name.trim();
  if (!name) throw new Error('name is required');
  const currency = assertBudgetHeaderInput(params.currency, params.taxBasis, params.periodisationMode);
  const fy = await sql`SELECT id FROM commercial_financial_years WHERE id = ${params.financialYearId} AND organisation_id = ${params.organisationId}`;
  if (fy.length === 0) throw new Error('financial_year_id not found for this organisation');

  const results = await sql.transaction(tx => [
    tx`INSERT INTO commercial_budgets
      (organisation_id, financial_year_id, name, currency, tax_basis, periodisation_mode, created_by)
      VALUES (${params.organisationId}, ${params.financialYearId}, ${name}, ${currency}, ${params.taxBasis}, ${params.periodisationMode}, ${params.userId})
      RETURNING *`,
    tx`INSERT INTO commercial_budget_versions
      (organisation_id, budget_id, version_number, status, notes, created_by)
      SELECT ${params.organisationId}, id, 1, 'DRAFT', ${params.notes ?? null}, ${params.userId}
      FROM commercial_budgets
      WHERE organisation_id = ${params.organisationId}
        AND financial_year_id = ${params.financialYearId}
        AND currency = ${currency}
      RETURNING *`,
  ]);
  const budget = (results[0] as CommercialBudget[])[0];
  const version = (results[1] as CommercialBudgetVersion[])[0];
  await logBudgetCreated({ organisationId: params.organisationId, userId: params.userId, budgetId: budget.id, after: { financial_year_id: budget.financial_year_id, currency: budget.currency, tax_basis: budget.tax_basis, periodisation_mode: budget.periodisation_mode } });
  await logBudgetVersionCreated({ organisationId: params.organisationId, userId: params.userId, budgetVersionId: version.id, budgetId: budget.id, versionNumber: 1 });
  return { budget, version };
}

export async function createDraftBudgetVersion(params: {
  organisationId: string; userId: string; budgetId: string; notes?: string | null;
}): Promise<CommercialBudgetVersion> {
  const budget = await getBudget(params.organisationId, params.budgetId);
  if (!budget) throw new Error('budget_id not found for this organisation');
  const rows = await sql`
    INSERT INTO commercial_budget_versions (organisation_id, budget_id, version_number, status, notes, created_by)
    SELECT ${params.organisationId}, ${params.budgetId}, COALESCE(MAX(version_number), 0) + 1, 'DRAFT', ${params.notes ?? null}, ${params.userId}
    FROM commercial_budget_versions
    WHERE budget_id = ${params.budgetId} AND organisation_id = ${params.organisationId}
    RETURNING *
  ` as CommercialBudgetVersion[];
  const version = rows[0];
  await logBudgetVersionCreated({ organisationId: params.organisationId, userId: params.userId, budgetVersionId: version.id, budgetId: version.budget_id, versionNumber: version.version_number });
  return version;
}
export async function upsertBudgetLine(params: {
  organisationId: string; userId: string; budgetVersionId: string; budgetAccountId: string;
  costCentreId: string; annualBudgetCents: bigint;
}): Promise<CommercialBudgetLine> {
  await requireDraftVersion(params.organisationId, params.budgetVersionId);
  if (params.annualBudgetCents < BigInt(0)) throw new Error('annual_budget_cents must be non-negative');
  await requireBudgetLineReferences(params.organisationId, params.budgetAccountId, params.costCentreId);
  const rows = await sql`
    INSERT INTO commercial_budget_lines
      (organisation_id, budget_version_id, budget_account_id, cost_centre_id, annual_budget_cents)
    VALUES
      (${params.organisationId}, ${params.budgetVersionId}, ${params.budgetAccountId}, ${params.costCentreId}, ${params.annualBudgetCents.toString()})
    ON CONFLICT (budget_version_id, budget_account_id, cost_centre_id)
    DO UPDATE SET annual_budget_cents = EXCLUDED.annual_budget_cents
    RETURNING *
  ` as CommercialBudgetLine[];
  const line = rows[0];
  await logBudgetLineChanged({ organisationId: params.organisationId, userId: params.userId, budgetLineId: line.id, budgetVersionId: params.budgetVersionId, after: { budget_account_id: line.budget_account_id, cost_centre_id: line.cost_centre_id, annual_budget_cents: String(line.annual_budget_cents) } });
  return line;
}

export async function setBudgetPeriodAllocation(params: {
  organisationId: string; userId: string; budgetVersionId: string; budgetLineId: string;
  financialPeriodId: string; amountCents: bigint;
}): Promise<CommercialBudgetPeriodAllocation> {
  await requireDraftVersion(params.organisationId, params.budgetVersionId);
  if (params.amountCents < BigInt(0)) throw new Error('amount_cents must be non-negative');
  const rows = await sql`
    INSERT INTO commercial_budget_period_allocations
      (organisation_id, budget_line_id, financial_period_id, amount_cents)
    SELECT ${params.organisationId}, bl.id, ${params.financialPeriodId}, ${params.amountCents.toString()}
    FROM commercial_budget_lines bl
    WHERE bl.id = ${params.budgetLineId}
      AND bl.organisation_id = ${params.organisationId}
      AND bl.budget_version_id = ${params.budgetVersionId}
    ON CONFLICT (budget_line_id, financial_period_id)
    DO UPDATE SET amount_cents = EXCLUDED.amount_cents
    RETURNING *
  ` as CommercialBudgetPeriodAllocation[];
  if (!rows[0]) throw new Error('budget_line_id not found for this draft version');
  const allocation = rows[0];
  await logBudgetPeriodAllocationChanged({ organisationId: params.organisationId, userId: params.userId, budgetPeriodAllocationId: allocation.id, budgetVersionId: params.budgetVersionId, after: { financial_period_id: allocation.financial_period_id, amount_cents: String(allocation.amount_cents) } });
  return allocation;
}

export async function setBudgetCommitmentMapping(params: {
  organisationId: string; userId: string; budgetVersionId: string; costCentreId: string; budgetAccountId: string;
}): Promise<CommercialBudgetCommitmentMapping> {
  await requireDraftVersion(params.organisationId, params.budgetVersionId);
  await requireBudgetLineReferences(params.organisationId, params.budgetAccountId, params.costCentreId);
  const rows = await sql`
    INSERT INTO commercial_budget_commitment_mappings
      (organisation_id, budget_version_id, cost_centre_id, budget_account_id, created_by)
    VALUES
      (${params.organisationId}, ${params.budgetVersionId}, ${params.costCentreId}, ${params.budgetAccountId}, ${params.userId})
    ON CONFLICT (budget_version_id, cost_centre_id)
    DO UPDATE SET budget_account_id = EXCLUDED.budget_account_id
    RETURNING *
  ` as CommercialBudgetCommitmentMapping[];
  const mapping = rows[0];
  await logBudgetCommitmentMappingChanged({ organisationId: params.organisationId, userId: params.userId, budgetCommitmentMappingId: mapping.id, budgetVersionId: params.budgetVersionId, after: { cost_centre_id: mapping.cost_centre_id, budget_account_id: mapping.budget_account_id } });
  return mapping;
}
