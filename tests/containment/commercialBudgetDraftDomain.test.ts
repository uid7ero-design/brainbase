import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const transactionMock = vi.fn();
Object.assign(sqlMock, { transaction: transactionMock });
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const audit = {
  logBudgetAccountCreated: vi.fn(),
  logBudgetAccountUpdated: vi.fn(),
  logBudgetAccountDeactivated: vi.fn(),
  logBudgetCreated: vi.fn(),
  logBudgetVersionCreated: vi.fn(),
  logBudgetLineChanged: vi.fn(),
  logBudgetPeriodAllocationChanged: vi.fn(),
  logBudgetCommitmentMappingChanged: vi.fn(),
};
vi.mock('@/lib/commercial/auditLog', () => audit);

const accounts = await import('@/lib/commercial/budgetAccounts');
const budgets = await import('@/lib/commercial/budgets');

const draftVersion = {
  id: 'v1', organisation_id: 'org-a', budget_id: 'b1', version_number: 1, status: 'DRAFT',
  notes: null, created_by: 'u1', created_at: 'now', activated_by: null, activated_at: null, superseded_at: null,
};

beforeEach(() => {
  sqlMock.mockReset();
  transactionMock.mockReset();
  for (const mock of Object.values(audit)) mock.mockReset();
});

describe('C7.7C — Budget account domain', () => {
  it('tenant-scopes account lookup and returns null for no row', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(accounts.getBudgetAccount('org-a', 'acc-1')).resolves.toBeNull();
    const strings = sqlMock.mock.calls[0][0] as string[];
    expect(strings.join('')).toContain('WHERE id = ');
    expect(strings.join('')).toContain('AND organisation_id = ');
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(['acc-1', 'org-a']);
  });

  it('trims account code/name and audits creation', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'acc-1', organisation_id: 'org-a', code: 'OPS', name: 'Operations', description: null, active: true }]);
    const account = await accounts.createBudgetAccount({ organisationId: 'org-a', userId: 'u1', code: ' OPS ', name: ' Operations ' });
    expect(account.code).toBe('OPS');
    expect(audit.logBudgetAccountCreated).toHaveBeenCalledOnce();
  });

  it('refuses deactivation when the guarded update affects no row', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(accounts.deactivateBudgetAccount({ organisationId: 'org-a', userId: 'u1', budgetAccountId: 'acc-1' })).resolves.toBe(false);
    expect(audit.logBudgetAccountDeactivated).not.toHaveBeenCalled();
    expect((sqlMock.mock.calls[0][0] as string[]).join('')).toContain("bv.status = 'ACTIVE'");
  });
});

describe('C7.7C — DRAFT-only Budget editing', () => {
  it.each(['ACTIVE', 'SUPERSEDED'] as const)('blocks line mutation for %s versions before any write', async status => {
    sqlMock.mockResolvedValueOnce([{ ...draftVersion, status }]);
    await expect(budgets.upsertBudgetLine({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetAccountId: 'acc-1', costCentreId: 'cc-1', annualBudgetCents: BigInt(100),
    })).rejects.toThrow('Only DRAFT budget versions are editable');
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(audit.logBudgetLineChanged).not.toHaveBeenCalled();
  });

  it('upserts a line only after a same-tenant DRAFT version check', async () => {
    sqlMock
      .mockResolvedValueOnce([draftVersion])
      .mockResolvedValueOnce([{ account_exists: true, cost_centre_exists: true }])
      .mockResolvedValueOnce([{ id: 'line-1', organisation_id: 'org-a', budget_version_id: 'v1', budget_account_id: 'acc-1', cost_centre_id: 'cc-1', annual_budget_cents: '100' }]);
    const line = await budgets.upsertBudgetLine({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetAccountId: 'acc-1', costCentreId: 'cc-1', annualBudgetCents: BigInt(100),
    });
    expect(line.id).toBe('line-1');
    expect(audit.logBudgetLineChanged).toHaveBeenCalledOnce();
    expect((sqlMock.mock.calls[1][0] as string[]).join('')).toContain('commercial_budget_accounts');
    expect((sqlMock.mock.calls[2][0] as string[]).join('')).toContain('ON CONFLICT (budget_version_id, budget_account_id, cost_centre_id)');
  });

  it('rejects negative annual and period amounts before their writes', async () => {
    sqlMock.mockResolvedValueOnce([draftVersion]);
    await expect(budgets.upsertBudgetLine({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetAccountId: 'acc-1', costCentreId: 'cc-1', annualBudgetCents: BigInt(-1),
    })).rejects.toThrow('annual_budget_cents must be non-negative');

    sqlMock.mockResolvedValueOnce([draftVersion]);
    await expect(budgets.setBudgetPeriodAllocation({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetLineId: 'line-1', financialPeriodId: 'p1', amountCents: BigInt(-1),
    })).rejects.toThrow('amount_cents must be non-negative');
  });

  it('scopes period allocation to a line inside the checked DRAFT version', async () => {
    sqlMock
      .mockResolvedValueOnce([draftVersion])
      .mockResolvedValueOnce([{ id: 'pa-1', organisation_id: 'org-a', budget_line_id: 'line-1', financial_period_id: 'p1', amount_cents: '50' }]);
    await budgets.setBudgetPeriodAllocation({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetLineId: 'line-1', financialPeriodId: 'p1', amountCents: BigInt(50),
    });
    const q = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(q).toContain('bl.organisation_id = ');
    expect(q).toContain('bl.budget_version_id = ');
    expect(audit.logBudgetPeriodAllocationChanged).toHaveBeenCalledOnce();
  });

  it('version-scopes commitment mappings and audits changes', async () => {
    sqlMock
      .mockResolvedValueOnce([draftVersion])
      .mockResolvedValueOnce([{ account_exists: true, cost_centre_exists: true }])
      .mockResolvedValueOnce([{ id: 'm1', organisation_id: 'org-a', budget_version_id: 'v1', cost_centre_id: 'cc-1', budget_account_id: 'acc-1' }]);
    await budgets.setBudgetCommitmentMapping({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1', costCentreId: 'cc-1', budgetAccountId: 'acc-1',
    });
    expect((sqlMock.mock.calls[2][0] as string[]).join('')).toContain('ON CONFLICT (budget_version_id, cost_centre_id)');
    expect(audit.logBudgetCommitmentMappingChanged).toHaveBeenCalledOnce();
  });

  it('fails closed when a line references an account outside the tenant', async () => {
    sqlMock
      .mockResolvedValueOnce([draftVersion])
      .mockResolvedValueOnce([{ account_exists: false, cost_centre_exists: true }]);
    await expect(budgets.upsertBudgetLine({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      budgetAccountId: 'other-account', costCentreId: 'cc-1', annualBudgetCents: BigInt(100),
    })).rejects.toThrow('budget_account_id not found for this organisation');
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(audit.logBudgetLineChanged).not.toHaveBeenCalled();
  });

  it('fails closed when a mapping references a cost centre outside the tenant', async () => {
    sqlMock
      .mockResolvedValueOnce([draftVersion])
      .mockResolvedValueOnce([{ account_exists: true, cost_centre_exists: false }]);
    await expect(budgets.setBudgetCommitmentMapping({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'v1',
      costCentreId: 'other-centre', budgetAccountId: 'acc-1',
    })).rejects.toThrow('cost_centre_id not found for this organisation');
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(audit.logBudgetCommitmentMappingChanged).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant/missing version without performing a mutation', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(budgets.setBudgetCommitmentMapping({
      organisationId: 'org-a', userId: 'u1', budgetVersionId: 'other-tenant-version', costCentreId: 'cc-1', budgetAccountId: 'acc-1',
    })).rejects.toThrow('budget_version_id not found for this organisation');
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

describe('C7.7C — Budget and version creation', () => {
  it('validates currency, tax basis and periodisation mode at runtime before database work', async () => {
    await expect(budgets.createBudget({
      organisationId: 'org-a', userId: 'u1', financialYearId: 'fy-1', name: 'Budget',
      currency: 'AU', taxBasis: 'INCLUSIVE', periodisationMode: 'PERIODISED',
    })).rejects.toThrow('currency must be a 3-letter code');

    await expect(budgets.createBudget({
      organisationId: 'org-a', userId: 'u1', financialYearId: 'fy-1', name: 'Budget',
      currency: 'AUD', taxBasis: 'BAD' as never, periodisationMode: 'PERIODISED',
    })).rejects.toThrow('invalid tax_basis');

    await expect(budgets.createBudget({
      organisationId: 'org-a', userId: 'u1', financialYearId: 'fy-1', name: 'Budget',
      currency: 'AUD', taxBasis: 'INCLUSIVE', periodisationMode: 'BAD' as never,
    })).rejects.toThrow('invalid periodisation_mode');

    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('creates the Budget and version 1 in one transaction after same-tenant year validation', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'fy-1' }]);
    transactionMock.mockImplementationOnce(async (builder: (tx: unknown) => unknown[]) => {
      const tx = (() => ({})) as unknown;
      builder(tx);
      return [
        [{ id: 'b1', organisation_id: 'org-a', financial_year_id: 'fy-1', name: 'FY Budget', currency: 'AUD', tax_basis: 'INCLUSIVE', periodisation_mode: 'PERIODISED', active_version_id: null }],
        [{ ...draftVersion, budget_id: 'b1' }],
      ];
    });

    const created = await budgets.createBudget({
      organisationId: 'org-a', userId: 'u1', financialYearId: 'fy-1',
      name: ' FY Budget ', currency: 'aud', taxBasis: 'INCLUSIVE', periodisationMode: 'PERIODISED',
    });

    expect(created.budget.currency).toBe('AUD');
    expect(created.version.version_number).toBe(1);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(audit.logBudgetCreated).toHaveBeenCalledOnce();
    expect(audit.logBudgetVersionCreated).toHaveBeenCalledOnce();
  });

  it('fails closed when creating a version for a Budget outside the tenant', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(budgets.createDraftBudgetVersion({
      organisationId: 'org-a', userId: 'u1', budgetId: 'other-budget',
    })).rejects.toThrow('budget_id not found for this organisation');
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
