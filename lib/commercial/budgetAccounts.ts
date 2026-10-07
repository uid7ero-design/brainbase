import 'server-only';
import sql from '@/lib/db';
import { logBudgetAccountCreated, logBudgetAccountUpdated, logBudgetAccountDeactivated } from './auditLog';

export interface CommercialBudgetAccount {
  id: string;
  organisation_id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listBudgetAccounts(organisationId: string, opts: { activeOnly?: boolean } = {}): Promise<CommercialBudgetAccount[]> {
  if (opts.activeOnly) {
    return await sql`
      SELECT * FROM commercial_budget_accounts
      WHERE organisation_id = ${organisationId} AND active = true
      ORDER BY code ASC
    ` as CommercialBudgetAccount[];
  }
  return await sql`
    SELECT * FROM commercial_budget_accounts
    WHERE organisation_id = ${organisationId}
    ORDER BY code ASC
  ` as CommercialBudgetAccount[];
}

export async function getBudgetAccount(organisationId: string, budgetAccountId: string): Promise<CommercialBudgetAccount | null> {
  const rows = await sql`
    SELECT * FROM commercial_budget_accounts
    WHERE id = ${budgetAccountId} AND organisation_id = ${organisationId}
  ` as CommercialBudgetAccount[];
  return rows[0] ?? null;
}

export async function createBudgetAccount(params: {
  organisationId: string;
  userId: string;
  code: string;
  name: string;
  description?: string | null;
}): Promise<CommercialBudgetAccount> {
  const code = params.code.trim();
  const name = params.name.trim();
  if (!code) throw new Error('code is required');
  if (!name) throw new Error('name is required');

  const rows = await sql`
    INSERT INTO commercial_budget_accounts
      (organisation_id, code, name, description, created_by)
    VALUES
      (${params.organisationId}, ${code}, ${name}, ${params.description ?? null}, ${params.userId})
    RETURNING *
  ` as CommercialBudgetAccount[];
  const account = rows[0];

  await logBudgetAccountCreated({
    organisationId: params.organisationId,
    userId: params.userId,
    budgetAccountId: account.id,
    after: { code: account.code, name: account.name },
  });

  return account;
}

export async function updateBudgetAccount(params: {
  organisationId: string;
  userId: string;
  budgetAccountId: string;
  code?: string;
  name?: string;
  description?: string | null;
}): Promise<CommercialBudgetAccount | null> {
  const before = await getBudgetAccount(params.organisationId, params.budgetAccountId);
  if (!before) return null;
  if (params.code !== undefined && !params.code.trim()) throw new Error('code cannot be blank');
  if (params.name !== undefined && !params.name.trim()) throw new Error('name cannot be blank');

  const rows = await sql`
    UPDATE commercial_budget_accounts SET
      code = COALESCE(${params.code?.trim() ?? null}, code),
      name = COALESCE(${params.name?.trim() ?? null}, name),
      description = CASE WHEN ${params.description !== undefined} THEN ${params.description ?? null} ELSE description END,
      updated_at = now()
    WHERE id = ${params.budgetAccountId} AND organisation_id = ${params.organisationId}
    RETURNING *
  ` as CommercialBudgetAccount[];
  const after = rows[0] ?? null;
  if (!after) return null;

  await logBudgetAccountUpdated({
    organisationId: params.organisationId,
    userId: params.userId,
    budgetAccountId: params.budgetAccountId,
    before: { code: before.code, name: before.name, description: before.description },
    after: { code: after.code, name: after.name, description: after.description },
  });
  return after;
}

export async function deactivateBudgetAccount(params: {
  organisationId: string;
  userId: string;
  budgetAccountId: string;
}): Promise<boolean> {
  const [, rows] = await sql.transaction(txn => [
    txn`SELECT id FROM commercial_budget_accounts WHERE id=${params.budgetAccountId} AND organisation_id=${params.organisationId} FOR UPDATE`,
    txn`
    UPDATE commercial_budget_accounts
    SET active = false, updated_at = now()
    WHERE id = ${params.budgetAccountId}
      AND organisation_id = ${params.organisationId}
      AND active = true
      AND NOT EXISTS (
        SELECT 1
        FROM commercial_budget_lines bl
        JOIN commercial_budget_versions bv
          ON bv.id = bl.budget_version_id
         AND bv.organisation_id = bl.organisation_id
        WHERE bl.budget_account_id = commercial_budget_accounts.id
          AND bl.organisation_id = commercial_budget_accounts.organisation_id
          AND bv.status = 'ACTIVE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM commercial_budget_commitment_mappings m
        JOIN commercial_budget_versions bv ON bv.id=m.budget_version_id AND bv.organisation_id=m.organisation_id
        WHERE m.budget_account_id=commercial_budget_accounts.id AND m.organisation_id=commercial_budget_accounts.organisation_id AND bv.status='ACTIVE'
      )
    RETURNING id
    `,
  ], { isolationLevel: 'ReadCommitted' });
  if ((rows as { id: string }[]).length === 0) return false;

  await logBudgetAccountDeactivated({
    organisationId: params.organisationId,
    userId: params.userId,
    budgetAccountId: params.budgetAccountId,
  });
  return true;
}
