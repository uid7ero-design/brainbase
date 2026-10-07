import sql from '@/lib/db';
import { createBudget, getBudget, getBudgetVersion, setBudgetCommitmentMapping, setBudgetPeriodAllocation, upsertBudgetLine } from './budgets';
import { getFinancialYear, listFinancialPeriods } from './financialPeriods';
import { getBudgetAccount } from './budgetAccounts';
import { getCostCentre } from './costCentres';

export class BudgetSetupError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT', message: string) { super(message); this.name = 'BudgetSetupError'; }
}
export function setupId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BudgetSetupError('INVALID_INPUT', 'Choose a valid record.');
  return value;
}
export function setupAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || value.trim().length > 19 || BigInt(value.trim()) > BigInt('9223372036854775807')) throw new BudgetSetupError('INVALID_INPUT', 'Amount must be a non-negative integer minor-unit string within the supported range.');
  return BigInt(value.trim());
}
function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BudgetSetupError('INVALID_INPUT', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
export async function listSetupBudgets(organisationId: string) {
  return await sql`
    SELECT b.id AS budget_id,b.name,b.financial_year_id,b.currency,b.tax_basis,b.periodisation_mode,
      v.id AS version_id,v.version_number,v.status,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'budget_account_id',l.budget_account_id,'cost_centre_id',l.cost_centre_id,'annual_budget_cents',l.annual_budget_cents::text) ORDER BY l.id)
        FROM commercial_budget_lines l WHERE l.budget_version_id=v.id AND l.organisation_id=b.organisation_id),'[]'::jsonb) AS lines,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('budget_line_id',a.budget_line_id,'financial_period_id',a.financial_period_id,'amount_cents',a.amount_cents::text) ORDER BY a.id)
        FROM commercial_budget_period_allocations a JOIN commercial_budget_lines l ON l.id=a.budget_line_id AND l.organisation_id=a.organisation_id WHERE l.budget_version_id=v.id AND a.organisation_id=b.organisation_id),'[]'::jsonb) AS allocations,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('cost_centre_id',m.cost_centre_id,'budget_account_id',m.budget_account_id) ORDER BY m.id)
        FROM commercial_budget_commitment_mappings m WHERE m.budget_version_id=v.id AND m.organisation_id=b.organisation_id),'[]'::jsonb) AS mappings
    FROM commercial_budgets b JOIN commercial_budget_versions v ON v.budget_id=b.id AND v.organisation_id=b.organisation_id
    WHERE b.organisation_id=${organisationId} ORDER BY b.name,v.version_number DESC
  `;
}
export async function createSetupBudget(organisationId: string, userId: string, value: unknown) {
  const input = objectInput(value);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new BudgetSetupError('INVALID_INPUT', 'Enter a Budget name of up to 100 characters.');
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency) || typeof input.taxBasis !== 'string' || !['INCLUSIVE','EXCLUSIVE'].includes(input.taxBasis) || typeof input.periodisationMode !== 'string' || !['ANNUAL_ONLY','PERIODISED'].includes(input.periodisationMode)) throw new BudgetSetupError('INVALID_INPUT', 'Choose a currency, tax basis and periodisation mode.');
  const financialYearId = setupId(input.financialYearId);
  const year = await getFinancialYear(organisationId, financialYearId);
  if (!year) throw new BudgetSetupError('NOT_FOUND', 'Financial year not found.');
  if (year.status !== 'OPEN') throw new BudgetSetupError('CONFLICT', 'Budget financial year must be OPEN.');
  return createBudget({ organisationId, userId, financialYearId, name, currency, taxBasis: input.taxBasis as 'INCLUSIVE' | 'EXCLUSIVE', periodisationMode: input.periodisationMode as 'ANNUAL_ONLY' | 'PERIODISED' });
}
export async function changeSetupBudget(organisationId: string, userId: string, budgetId: string, versionId: string, value: unknown) {
  setupId(budgetId); setupId(versionId);
  const input = objectInput(value);
  const [budget, version] = await Promise.all([getBudget(organisationId, budgetId),getBudgetVersion(organisationId,versionId)]);
  if (!budget || !version || version.budget_id !== budget.id) throw new BudgetSetupError('NOT_FOUND', 'Budget version not found.');
  if (version.status !== 'DRAFT') throw new BudgetSetupError('CONFLICT', 'Only DRAFT budget versions are editable.');
  if (input.action === 'allocation') {
    if (budget.periodisation_mode !== 'PERIODISED') throw new BudgetSetupError('CONFLICT', 'Annual-only Budgets do not accept period allocations.');
    const budgetLineId = setupId(input.budgetLineId), financialPeriodId = setupId(input.financialPeriodId);
    const periods = await listFinancialPeriods(organisationId,budget.financial_year_id);
    if (!periods.some(period => period.id === financialPeriodId)) throw new BudgetSetupError('NOT_FOUND', 'Period not found in this financial year.');
    return setBudgetPeriodAllocation({ organisationId,userId,budgetVersionId:versionId,budgetLineId,financialPeriodId,amountCents:setupAmount(input.amountCents) });
  }
  if (input.action !== 'line' && input.action !== 'mapping') throw new BudgetSetupError('INVALID_INPUT','Choose a supported Budget action.');
  const budgetAccountId = setupId(input.budgetAccountId), costCentreId = setupId(input.costCentreId);
  const [account, centre] = await Promise.all([getBudgetAccount(organisationId,budgetAccountId),getCostCentre(organisationId,costCentreId)]);
  if (!account || !centre) throw new BudgetSetupError('NOT_FOUND','Account or cost centre not found.');
  if (!account.active || !centre.active) throw new BudgetSetupError('CONFLICT','Choose active accounts and cost centres.');
  return input.action === 'line'
    ? upsertBudgetLine({ organisationId,userId,budgetVersionId:versionId,budgetAccountId,costCentreId,annualBudgetCents:setupAmount(input.annualBudgetCents) })
    : setBudgetCommitmentMapping({ organisationId,userId,budgetVersionId:versionId,budgetAccountId,costCentreId });
}
export function budgetSetupFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof BudgetSetupError) return { status: error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409, message: error.message };
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return { status: 409, message: 'A Budget already exists for this financial year and currency.' };
  if (error instanceof Error && ['Only DRAFT budget versions are editable','Budget financial year must be OPEN','budget_line_id not found for this DRAFT version'].includes(error.message)) return { status: 409, message: error.message };
  return null;
}
