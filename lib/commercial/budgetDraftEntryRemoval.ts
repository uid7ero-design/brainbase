import 'server-only';
import sql from '@/lib/db';
import { logBudgetDraftEntryRemoved } from './auditLog';

export class BudgetDraftEntryRemovalError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT', message: string) { super(message); }
}
type Identity = { organisationId: string; userId: string; budgetId: string; budgetVersionId: string; reason: string };
type Target = { kind: 'allocation'; budgetLineId: string; financialPeriodId: string } | { kind: 'mapping'; costCentreId: string };
type Snapshot = { status: string; year_status: string; entry_id: string; before_state: Record<string, unknown>; has_finance_evidence: boolean };

export async function removeDraftBudgetEntry(params: Identity & Target) {
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw new BudgetDraftEntryRemovalError('INVALID_INPUT', 'Enter a removal reason of 3 to 500 characters.');
  // Same order as activation; fresh statements after locks recheck publication/year closure.
  const [, , , snapshots, removed] = await sql.transaction(tx => [
    tx`SELECT b.id FROM commercial_budgets b JOIN commercial_financial_years y ON y.id=b.financial_year_id AND y.organisation_id=b.organisation_id
      WHERE b.id=${params.budgetId} AND b.organisation_id=${params.organisationId} FOR UPDATE OF b,y`,
    tx`SELECT id FROM commercial_budget_versions WHERE budget_id=${params.budgetId} AND organisation_id=${params.organisationId} ORDER BY id FOR UPDATE`,
    params.kind === 'allocation'
      ? tx`SELECT l.id FROM commercial_budget_lines l JOIN commercial_budget_period_allocations a ON a.budget_line_id=l.id AND a.organisation_id=l.organisation_id
          WHERE l.id=${params.budgetLineId} AND l.budget_version_id=${params.budgetVersionId} AND l.organisation_id=${params.organisationId}
            AND a.financial_period_id=${params.financialPeriodId} FOR UPDATE OF l,a`
      : tx`SELECT id FROM commercial_budget_commitment_mappings WHERE budget_version_id=${params.budgetVersionId} AND organisation_id=${params.organisationId} AND cost_centre_id=${params.costCentreId} FOR UPDATE`,
    params.kind === 'allocation'
      ? tx`SELECT v.status,y.status AS year_status,a.id AS entry_id,
          jsonb_build_object('budget_version_id',v.id,'budget_line_id',l.id,'financial_period_id',a.financial_period_id,'amount_cents',a.amount_cents::text) AS before_state,
          EXISTS(SELECT 1 FROM commercial_finance_adjustment_lines f WHERE f.resolved_budget_line_id=l.id AND f.organisation_id=l.organisation_id) AS has_finance_evidence
          FROM commercial_budget_period_allocations a JOIN commercial_budget_lines l ON l.id=a.budget_line_id AND l.organisation_id=a.organisation_id
          JOIN commercial_budget_versions v ON v.id=l.budget_version_id AND v.organisation_id=l.organisation_id
          JOIN commercial_budgets b ON b.id=v.budget_id AND b.organisation_id=v.organisation_id
          JOIN commercial_financial_years y ON y.id=b.financial_year_id AND y.organisation_id=b.organisation_id
          JOIN commercial_financial_periods p ON p.id=a.financial_period_id AND p.organisation_id=a.organisation_id AND p.financial_year_id=y.id
          WHERE a.organisation_id=${params.organisationId} AND l.id=${params.budgetLineId} AND a.financial_period_id=${params.financialPeriodId}
            AND v.id=${params.budgetVersionId} AND b.id=${params.budgetId}`
      : tx`SELECT v.status,y.status AS year_status,m.id AS entry_id,
          jsonb_build_object('budget_version_id',v.id,'cost_centre_id',m.cost_centre_id,'budget_account_id',m.budget_account_id) AS before_state,false AS has_finance_evidence
          FROM commercial_budget_commitment_mappings m JOIN commercial_budget_versions v ON v.id=m.budget_version_id AND v.organisation_id=m.organisation_id
          JOIN commercial_budgets b ON b.id=v.budget_id AND b.organisation_id=v.organisation_id
          JOIN commercial_financial_years y ON y.id=b.financial_year_id AND y.organisation_id=b.organisation_id
          WHERE m.organisation_id=${params.organisationId} AND m.cost_centre_id=${params.costCentreId} AND v.id=${params.budgetVersionId} AND b.id=${params.budgetId}`,
    params.kind === 'allocation'
      ? tx`DELETE FROM commercial_budget_period_allocations a USING commercial_budget_lines l,commercial_budget_versions v,commercial_budgets b,commercial_financial_years y,commercial_financial_periods p
          WHERE a.organisation_id=${params.organisationId} AND a.budget_line_id=l.id AND l.organisation_id=a.organisation_id AND l.id=${params.budgetLineId}
            AND a.financial_period_id=${params.financialPeriodId} AND p.id=a.financial_period_id AND p.organisation_id=a.organisation_id AND p.financial_year_id=y.id
            AND l.budget_version_id=v.id AND v.id=${params.budgetVersionId} AND v.organisation_id=a.organisation_id AND v.status='DRAFT'
            AND v.budget_id=b.id AND b.id=${params.budgetId} AND b.organisation_id=a.organisation_id
            AND y.id=b.financial_year_id AND y.organisation_id=a.organisation_id AND y.status='OPEN'
            AND NOT EXISTS(SELECT 1 FROM commercial_finance_adjustment_lines f WHERE f.resolved_budget_line_id=l.id AND f.organisation_id=a.organisation_id) RETURNING a.id`
      : tx`DELETE FROM commercial_budget_commitment_mappings m USING commercial_budget_versions v,commercial_budgets b,commercial_financial_years y
          WHERE m.organisation_id=${params.organisationId} AND m.cost_centre_id=${params.costCentreId} AND m.budget_version_id=v.id
            AND v.id=${params.budgetVersionId} AND v.organisation_id=m.organisation_id AND v.status='DRAFT'
            AND v.budget_id=b.id AND b.id=${params.budgetId} AND b.organisation_id=m.organisation_id
            AND y.id=b.financial_year_id AND y.organisation_id=m.organisation_id AND y.status='OPEN' RETURNING m.id`,
  ], { isolationLevel: 'ReadCommitted' });
  const before = (snapshots as Snapshot[])[0];
  if (!before) throw new BudgetDraftEntryRemovalError('NOT_FOUND', 'Saved entry not found in this Budget version.');
  if (before.status !== 'DRAFT' || before.year_status !== 'OPEN') throw new BudgetDraftEntryRemovalError('CONFLICT', 'Only DRAFT entries in an OPEN financial year can be removed.');
  if (before.has_finance_evidence) throw new BudgetDraftEntryRemovalError('CONFLICT', 'This line has finance evidence; its allocations cannot be removed.');
  if (!(removed as { id: string }[]).length) throw new BudgetDraftEntryRemovalError('CONFLICT', 'The draft changed. Reload it before removing an entry.');
  await logBudgetDraftEntryRemoved({ organisationId: params.organisationId, userId: params.userId, kind: params.kind, entryId: before.entry_id, before: before.before_state, reason });
  return { removed: true, kind: params.kind, id: before.entry_id };
}
