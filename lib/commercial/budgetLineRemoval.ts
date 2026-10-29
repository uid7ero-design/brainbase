import 'server-only';
import sql from '@/lib/db';
import { logBudgetLineRemoved } from './auditLog';

export class BudgetLineRemovalError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT', message: string) { super(message); }
}

export async function removeDraftBudgetLine(params: {
  organisationId: string; userId: string; budgetId: string; budgetVersionId: string; budgetLineId: string; reason: string;
}) {
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw new BudgetLineRemovalError('INVALID_INPUT', 'Provide a removal reason between 3 and 500 characters.');
  // Activation uses budget/year -> ordered versions. Line writers take the
  // version lock; the line lock also serializes any new finance FK reference.
  const [, , , snapshots, , removed] = await sql.transaction(tx => [
    tx`SELECT cb.id FROM commercial_budgets cb
      JOIN commercial_financial_years fy ON fy.id=cb.financial_year_id AND fy.organisation_id=cb.organisation_id
      WHERE cb.id=${params.budgetId} AND cb.organisation_id=${params.organisationId} FOR UPDATE OF cb, fy`,
    tx`SELECT id FROM commercial_budget_versions WHERE budget_id=${params.budgetId}
      AND organisation_id=${params.organisationId} ORDER BY id FOR UPDATE`,
    tx`SELECT id FROM commercial_budget_lines WHERE id=${params.budgetLineId}
      AND budget_version_id=${params.budgetVersionId} AND organisation_id=${params.organisationId} FOR UPDATE`,
    tx`SELECT v.status, fy.status AS year_status, l.id AS line_id,
      l.budget_account_id, l.cost_centre_id, l.annual_budget_cents::text AS annual_budget_cents,
      EXISTS(SELECT 1 FROM commercial_finance_adjustment_lines fa WHERE fa.resolved_budget_line_id=l.id AND fa.organisation_id=${params.organisationId}) AS has_finance_evidence,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'financial_period_id',a.financial_period_id,'amount_cents',a.amount_cents::text) ORDER BY a.id)
        FROM commercial_budget_period_allocations a WHERE a.budget_line_id=l.id AND a.organisation_id=${params.organisationId}),'[]'::jsonb) AS allocations
      FROM commercial_budgets cb JOIN commercial_budget_versions v ON v.budget_id=cb.id AND v.organisation_id=cb.organisation_id
      JOIN commercial_financial_years fy ON fy.id=cb.financial_year_id AND fy.organisation_id=cb.organisation_id
      LEFT JOIN commercial_budget_lines l ON l.id=${params.budgetLineId} AND l.budget_version_id=v.id AND l.organisation_id=cb.organisation_id
      WHERE cb.id=${params.budgetId} AND cb.organisation_id=${params.organisationId} AND v.id=${params.budgetVersionId}`,
    tx`DELETE FROM commercial_budget_period_allocations a USING commercial_budget_lines l, commercial_budget_versions v, commercial_budgets cb, commercial_financial_years fy
      WHERE a.budget_line_id=l.id AND a.organisation_id=${params.organisationId} AND l.id=${params.budgetLineId}
        AND l.organisation_id=a.organisation_id AND l.budget_version_id=v.id AND v.id=${params.budgetVersionId}
        AND v.organisation_id=a.organisation_id AND v.status='DRAFT' AND v.budget_id=cb.id AND cb.id=${params.budgetId}
        AND cb.organisation_id=a.organisation_id AND fy.id=cb.financial_year_id AND fy.organisation_id=a.organisation_id AND fy.status='OPEN'
        AND NOT EXISTS(SELECT 1 FROM commercial_finance_adjustment_lines fa WHERE fa.resolved_budget_line_id=l.id AND fa.organisation_id=a.organisation_id)`,
    tx`DELETE FROM commercial_budget_lines l USING commercial_budget_versions v, commercial_budgets cb, commercial_financial_years fy
      WHERE l.id=${params.budgetLineId} AND l.organisation_id=${params.organisationId} AND l.budget_version_id=v.id
        AND v.id=${params.budgetVersionId} AND v.organisation_id=l.organisation_id AND v.status='DRAFT'
        AND v.budget_id=cb.id AND cb.id=${params.budgetId} AND cb.organisation_id=l.organisation_id
        AND fy.id=cb.financial_year_id AND fy.organisation_id=l.organisation_id AND fy.status='OPEN'
        AND NOT EXISTS(SELECT 1 FROM commercial_finance_adjustment_lines fa WHERE fa.resolved_budget_line_id=l.id AND fa.organisation_id=l.organisation_id)
      RETURNING l.id`,
  ], { isolationLevel: 'ReadCommitted' });
  const before = (snapshots as { status: string; year_status: string; line_id: string | null; budget_account_id: string; cost_centre_id: string; annual_budget_cents: string; has_finance_evidence: boolean; allocations: unknown[] }[])[0];
  if (!before) throw new BudgetLineRemovalError('NOT_FOUND', 'Budget version not found.');
  if (before.status !== 'DRAFT' || before.year_status !== 'OPEN') throw new BudgetLineRemovalError('CONFLICT', 'Only a DRAFT line in an OPEN financial year can be removed.');
  if (!before.line_id) throw new BudgetLineRemovalError('NOT_FOUND', 'Line not found in this Budget version.');
  if (before.has_finance_evidence) throw new BudgetLineRemovalError('CONFLICT', 'This line has finance evidence and cannot be removed.');
  if (!(removed as { id: string }[]).length) throw new BudgetLineRemovalError('CONFLICT', 'The draft changed. Reload it before removing a line.');
  await logBudgetLineRemoved({ organisationId: params.organisationId, userId: params.userId, budgetLineId: before.line_id,
    before: { budget_version_id: params.budgetVersionId, budget_account_id: before.budget_account_id, cost_centre_id: before.cost_centre_id, annual_budget_cents: before.annual_budget_cents, allocations: before.allocations }, reason });
  return { removed: true, budgetLineId: before.line_id };
}
