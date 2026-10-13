import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({transaction:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/db',()=>({default:{transaction:mocks.transaction}}));
vi.mock('@/lib/commercial/auditLog',()=>({logBudgetLineRemoved:mocks.audit}));
const {removeDraftBudgetLine}=await import('@/lib/commercial/budgetLineRemoval');
const params={organisationId:'org',userId:'actor',budgetId:'budget',budgetVersionId:'version',budgetLineId:'line',reason:'  Accidental line  '};
const snapshot={status:'DRAFT',year_status:'OPEN',line_id:'line',budget_account_id:'account',cost_centre_id:'centre',annual_budget_cents:'9007199254740993',has_finance_evidence:false,allocations:[{id:'allocation',financial_period_id:'period',amount_cents:'9007199254740993'}]};
beforeEach(()=>{vi.clearAllMocks();mocks.transaction.mockResolvedValue([[],[],[],[snapshot],[],[{id:'line'}]]);});
describe('Draft Budget line removal transaction',()=>{
  it('audits the exact before-state only after transaction completion',async()=>{
    expect(await removeDraftBudgetLine(params)).toEqual({removed:true,budgetLineId:'line'});
    expect(mocks.audit).toHaveBeenCalledWith({organisationId:'org',userId:'actor',budgetLineId:'line',reason:'Accidental line',before:{budget_version_id:'version',budget_account_id:'account',cost_centre_id:'centre',annual_budget_cents:'9007199254740993',allocations:snapshot.allocations}});
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
  });
  it.each([
    {change:{status:'ACTIVE'},code:'CONFLICT'},
    {change:{status:'SUPERSEDED'},code:'CONFLICT'},
    {change:{year_status:'CLOSED'},code:'CONFLICT'},
    {change:{line_id:null},code:'NOT_FOUND'},
    {change:{has_finance_evidence:true},code:'CONFLICT'},
  ])('rejects guarded state $change without an audit',async({change,code})=>{
    mocks.transaction.mockResolvedValue([[],[],[],[{...snapshot,...change}],[],[]]);
    await expect(removeDraftBudgetLine(params)).rejects.toMatchObject({code});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects foreign or missing versions and uncertain removal',async()=>{
    mocks.transaction.mockResolvedValue([[],[],[],[],[],[]]);
    await expect(removeDraftBudgetLine(params)).rejects.toMatchObject({code:'NOT_FOUND'});
    mocks.transaction.mockResolvedValue([[],[],[],[snapshot],[],[]]);
    await expect(removeDraftBudgetLine(params)).rejects.toMatchObject({code:'CONFLICT'});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('propagates transaction failure without auditing a removal',async()=>{
    mocks.transaction.mockRejectedValue(new Error('Transaction rolled back'));
    await expect(removeDraftBudgetLine(params)).rejects.toThrow('Transaction rolled back');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(['','xx','x'.repeat(501)])('rejects invalid reason before acquiring locks',async reason=>{
    await expect(removeDraftBudgetLine({...params,reason})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
