import { createBudgetAccount, deactivateBudgetAccount, getBudgetAccount, listBudgetAccounts } from './budgetAccounts';
import { createCostCentre, deactivateCostCentre, getCostCentre, listCostCentres } from './costCentres';
import sql from '@/lib/db';
import { logFinanceDimensionReactivated } from './auditLog';

export type FinanceDimensionKind = 'accounts' | 'cost-centres';
export class FinanceDimensionError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'DUPLICATE_CODE' | 'NOT_FOUND' | 'IN_USE', message: string) { super(message); this.name = 'FinanceDimensionError'; }
}
export function dimensionKind(value: string): FinanceDimensionKind {
  if (value !== 'accounts' && value !== 'cost-centres') throw new FinanceDimensionError('NOT_FOUND', 'Setup resource not found.');
  return value;
}
export function listFinanceDimensions(kind: FinanceDimensionKind, organisationId: string) {
  return kind === 'accounts' ? listBudgetAccounts(organisationId) : listCostCentres(organisationId);
}
export async function createFinanceDimension(kind: FinanceDimensionKind, organisationId: string, userId: string, body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FinanceDimensionError('INVALID_INPUT', 'A JSON object is required.');
  const input = body as Record<string, unknown>;
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!code || code.length > 50 || !name || name.length > 100) throw new FinanceDimensionError('INVALID_INPUT', 'Enter a code (up to 50 characters) and name (up to 100 characters).');
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > 1000)) throw new FinanceDimensionError('INVALID_INPUT', 'Description must be text of up to 1,000 characters.');
  const params = { organisationId, userId, code, name, description: typeof input.description === 'string' ? input.description.trim() || null : null };
  try { return kind === 'accounts' ? await createBudgetAccount(params) : await createCostCentre(params); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new FinanceDimensionError('DUPLICATE_CODE', 'This code already exists in your organisation, including inactive records.');
    throw error;
  }
}
export async function deactivateFinanceDimension(kind: FinanceDimensionKind, organisationId: string, userId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new FinanceDimensionError('INVALID_INPUT', 'Invalid record.');
  const record = kind === 'accounts' ? await getBudgetAccount(organisationId, id) : await getCostCentre(organisationId, id);
  if (!record) throw new FinanceDimensionError('NOT_FOUND', 'Record not found.');
  if (!record.active) return { ...record, active: false };
  const changed = kind === 'accounts' ? await deactivateBudgetAccount({ organisationId, userId, budgetAccountId: id }) : await deactivateCostCentre({ organisationId, userId, costCentreId: id });
  if (!changed) throw new FinanceDimensionError('IN_USE', 'This record is in use by an active Budget or changed during this request. Refresh before trying again.');
  return { ...record, active: false };
}

export async function reactivateFinanceDimension(kind: FinanceDimensionKind, organisationId: string, userId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new FinanceDimensionError('INVALID_INPUT', 'Invalid record.');
  // A guarded UPDATE locks the retained row and records only a real transition.
  // Its identity, references and history remain unchanged.
  const rows = kind === 'accounts'
    ? await sql`UPDATE commercial_budget_accounts SET active=true, updated_at=now() WHERE id=${id} AND organisation_id=${organisationId} AND active=false RETURNING *`
    : await sql`UPDATE commercial_cost_centres SET active=true, updated_at=now() WHERE id=${id} AND organisation_id=${organisationId} AND active=false RETURNING *`;
  if (rows[0]) {
    await logFinanceDimensionReactivated({ organisationId, userId, kind, id });
    return rows[0];
  }
  const record = kind === 'accounts' ? await getBudgetAccount(organisationId, id) : await getCostCentre(organisationId, id);
  if (!record) throw new FinanceDimensionError('NOT_FOUND', 'Record not found.');
  return record;
}
