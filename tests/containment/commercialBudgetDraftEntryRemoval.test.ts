import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({transaction:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/db',()=>({default:{transaction:mocks.transaction}}));
vi.mock('@/lib/commercial/auditLog',()=>({logBudgetDraftEntryRemoved:mocks.audit}));
const {removeDraftBudgetEntry}=await import('@/lib/commercial/budgetDraftEntryRemoval');
const identity={organisationId:'org',userId:'actor',budgetId:'budget',budgetVersionId:'version',reason:' Accidental entry '};
const targets=[{kind:'allocation',budgetLineId:'line',financialPeriodId:'period'},{kind:'mapping',costCentreId:'centre'}] as const;
const before_state={budget_version_id:'version',amount_cents:'9007199254740993'};
const snapshot={status:'DRAFT',year_status:'OPEN',entry_id:'entry',has_finance_evidence:false,before_state};
beforeEach(()=>{vi.clearAllMocks();mocks.transaction.mockResolvedValue([[],[],[],[snapshot],[{id:'entry'}]]);});
describe('Saved draft entry removal',()=>{
  it.each(targets)('audits exact $kind before-state and reason after commit',async target=>{
    expect(await removeDraftBudgetEntry({...identity,...target})).toEqual({removed:true,kind:target.kind,id:'entry'});
    expect(mocks.audit).toHaveBeenCalledWith({organisationId:'org',userId:'actor',kind:target.kind,entryId:'entry',before:before_state,reason:'Accidental entry'});
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
  });
  it.each(['ACTIVE','SUPERSEDED'])('rejects %s after waiting for locks',async status=>{
    mocks.transaction.mockResolvedValue([[],[],[],[{...snapshot,status}],[]]);
    for(const target of targets) await expect(removeDraftBudgetEntry({...identity,...target})).rejects.toMatchObject({code:'CONFLICT'});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([{year_status:'CLOSED'},{has_finance_evidence:true}])('preserves protected state %j',async change=>{
    mocks.transaction.mockResolvedValue([[],[],[],[{...snapshot,...change}],[]]);
    await expect(removeDraftBudgetEntry({...identity,...targets[0]})).rejects.toMatchObject({code:'CONFLICT'});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('returns not found for foreign, mismatched or missing entries',async()=>{
    mocks.transaction.mockResolvedValue([[],[],[],[],[]]);
    for(const target of targets) await expect(removeDraftBudgetEntry({...identity,...target})).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('does not audit rollback or an uncertain mutation',async()=>{
    mocks.transaction.mockRejectedValue(new Error('Rollback'));
    await expect(removeDraftBudgetEntry({...identity,...targets[0]})).rejects.toThrow('Rollback');
    mocks.transaction.mockResolvedValue([[],[],[],[snapshot],[]]);
    await expect(removeDraftBudgetEntry({...identity,...targets[0]})).rejects.toMatchObject({code:'CONFLICT'});
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(['','xx','x'.repeat(501)])('rejects malformed reason before locks',async reason=>{
    await expect(removeDraftBudgetEntry({...identity,...targets[0],reason})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
