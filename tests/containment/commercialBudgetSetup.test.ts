import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({entryRemoval:vi.fn(),remove:vi.fn(),auth:vi.fn(),create:vi.fn(),budget:vi.fn(),version:vi.fn(),line:vi.fn(),allocation:vi.fn(),mapping:vi.fn(),settings:vi.fn(),year:vi.fn(),periods:vi.fn(),account:vi.fn(),centre:vi.fn()}));
vi.mock('@/lib/commercial/budgetLineRemoval',async()=>{const actual=await vi.importActual<typeof import('@/lib/commercial/budgetLineRemoval')>('@/lib/commercial/budgetLineRemoval');return {...actual,removeDraftBudgetLine:mocks.remove};});
vi.mock('@/lib/commercial/budgetDraftEntryRemoval',async()=>{const actual=await vi.importActual<typeof import('@/lib/commercial/budgetDraftEntryRemoval')>('@/lib/commercial/budgetDraftEntryRemoval');return {...actual,removeDraftBudgetEntry:mocks.entryRemoval};});
vi.mock('@/lib/db',()=>({default:vi.fn()}));
vi.mock('@/lib/commercial/authorize',()=>({authorizeCommercialRequest:mocks.auth,COMMERCIAL_MIN_ROLE:{administer:'admin'}}));
vi.mock('@/lib/commercial/budgets',()=>({createBudget:mocks.create,getBudget:mocks.budget,getBudgetVersion:mocks.version,upsertBudgetLine:mocks.line,setBudgetPeriodAllocation:mocks.allocation,setBudgetCommitmentMapping:mocks.mapping,updateDraftBudgetSettings:mocks.settings}));
vi.mock('@/lib/commercial/financialPeriods',()=>({getFinancialYear:mocks.year,listFinancialPeriods:mocks.periods}));
vi.mock('@/lib/commercial/budgetAccounts',()=>({getBudgetAccount:mocks.account}));
vi.mock('@/lib/commercial/costCentres',()=>({getCostCentre:mocks.centre}));
const {setupAmount}=await import('@/lib/commercial/budgetSetup');
const createRoute=await import('@/app/api/commercial/budgeting/budgets/route');
const changeRoute=await import('@/app/api/commercial/budgeting/budgets/[id]/versions/[versionId]/setup/route');
const id='00000000-0000-4000-8000-000000000901';
const context={params:Promise.resolve({id,versionId:id})};
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
const header={name:' Budget ',financialYearId:id,currency:'aud',taxBasis:'INCLUSIVE',periodisationMode:'PERIODISED',organisationId:'foreign'};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,session:{organisationId:'org-a',userId:'user-a'}});mocks.year.mockResolvedValue({id,status:'OPEN'});mocks.budget.mockResolvedValue({id,financial_year_id:id,periodisation_mode:'PERIODISED'});mocks.version.mockResolvedValue({id,budget_id:id,status:'DRAFT'});mocks.account.mockResolvedValue({id,active:true});mocks.centre.mockResolvedValue({id,active:true});mocks.periods.mockResolvedValue([{id}]);});
describe('Budget setup boundary',()=>{
  it.each(['remove-allocation','remove-mapping'])('binds %s removal to session and version',async action=>{
    mocks.entryRemoval.mockResolvedValue({removed:true});
    expect((await changeRoute.POST(request({action,budgetLineId:id,financialPeriodId:id,costCentreId:id,reason:'  Accidental entry  ',organisationId:'foreign',userId:'foreign'}),context)).status).toBe(200);
    expect(mocks.entryRemoval).toHaveBeenCalledWith({organisationId:'org-a',userId:'user-a',budgetId:id,budgetVersionId:id,reason:'Accidental entry',...(action==='remove-allocation'?{kind:'allocation',budgetLineId:id,financialPeriodId:id}:{kind:'mapping',costCentreId:id})});
  });
  it.each(['remove-allocation','remove-mapping'])('rejects invalid reason for %s',async action=>{
    expect((await changeRoute.POST(request({action,budgetLineId:id,financialPeriodId:id,costCentreId:id,reason:'xx'}),context)).status).toBe(400);
    expect(mocks.entryRemoval).not.toHaveBeenCalled();
  });
  it.each(['remove-allocation','remove-mapping'])('rejects malformed identity for %s',async action=>{
    expect((await changeRoute.POST(request({action,budgetLineId:'bad',financialPeriodId:'bad',costCentreId:'bad',reason:'Accidental entry'}),context)).status).toBe(400);
    expect(mocks.entryRemoval).not.toHaveBeenCalled();
  });
  it('refuses allocation removal from an annual-only Budget',async()=>{
    mocks.budget.mockResolvedValue({id,financial_year_id:id,periodisation_mode:'ANNUAL_ONLY'});
    expect((await changeRoute.POST(request({action:'remove-allocation',budgetLineId:id,financialPeriodId:id,reason:'Accidental entry'}),context)).status).toBe(409);
    expect(mocks.entryRemoval).not.toHaveBeenCalled();
  });
  it('removes a bound draft line with a normalized reason and session identity',async()=>{
    mocks.remove.mockResolvedValue({removed:true});
    expect((await changeRoute.POST(request({action:'remove-line',budgetLineId:id,reason:'  Accidental line  ',organisationId:'foreign',userId:'foreign'}),context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({organisationId:'org-a',userId:'user-a',budgetId:id,budgetVersionId:id,budgetLineId:id,reason:'Accidental line'});
  });
  it.each([null,123,'','  ','xx','x'.repeat(501)])('rejects invalid removal reason %j',async reason=>{
    expect((await changeRoute.POST(request({action:'remove-line',budgetLineId:id,reason}),context)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects malformed removal identity',async()=>{
    expect((await changeRoute.POST(request({action:'remove-line',budgetLineId:'foreign',reason:'Accidental line'}),context)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE','SUPERSEDED'])('refuses removal from %s',async status=>{
    mocks.version.mockResolvedValue({id,budget_id:id,status});
    expect((await changeRoute.POST(request({action:'remove-line',budgetLineId:id,reason:'Accidental line'}),context)).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('updates draft settings with the session actor and normalized name',async()=>{
    mocks.settings.mockResolvedValue({id});
    expect((await changeRoute.POST(request({action:'settings',name:' Revised ',taxBasis:'EXCLUSIVE',organisationId:'foreign',userId:'foreign'}),context)).status).toBe(200);
    expect(mocks.settings).toHaveBeenCalledWith({organisationId:'org-a',userId:'user-a',budgetId:id,budgetVersionId:id,name:'Revised',taxBasis:'EXCLUSIVE'});
  });
  it.each([{name:''},{name:123},{name:'x'.repeat(101)},{taxBasis:['INCLUSIVE']},{taxBasis:'UNKNOWN'},{taxBasis:null},{currency:'USD'},{periodisationMode:'ANNUAL_ONLY'},{financialYearId:id}])('rejects malformed or immutable settings %j',async value=>{
    expect((await changeRoute.POST(request({action:'settings',name:'Revised',taxBasis:'INCLUSIVE',...value}),context)).status).toBe(400);
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it('returns a conflict if publication or year close wins the mutation lock',async()=>{
    mocks.settings.mockRejectedValue(new Error('Budget settings can only be changed before activation and while the financial year is OPEN.'));
    expect((await changeRoute.POST(request({action:'settings',name:'Revised',taxBasis:'INCLUSIVE'}),context)).status).toBe(409);
  });
  it.each(['ACTIVE','SUPERSEDED'])('rejects settings changes to %s versions',async status=>{
    mocks.version.mockResolvedValue({id,budget_id:id,status});
    expect((await changeRoute.POST(request({action:'settings',name:'Revised',taxBasis:'INCLUSIVE'}),context)).status).toBe(409);
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it.each([{taxBasis:['INCLUSIVE']},{taxBasis:{}},{taxBasis:null},{periodisationMode:['PERIODISED']},{periodisationMode:{}},{periodisationMode:false}])('rejects non-string Budget enums %j',async value=>{
    expect((await createRoute.POST(request({...header,...value}))).status).toBe(400);
    expect(mocks.year).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([null,true,[],{},1,1.5,'1.5','1e3','-1','9223372036854775808'])('rejects invalid minor units %j',value=>expect(()=>setupAmount(value)).toThrow());
  it('keeps values above JavaScript safe integer precision exact',()=>expect(setupAmount('9007199254740993')).toBe(BigInt('9007199254740993')));
  it.each([401,403,503])('preserves authorization denial %s',async status=>{mocks.auth.mockResolvedValue({ok:false,response:new Response(null,{status})});expect((await createRoute.POST(request(header))).status).toBe(status);expect((await changeRoute.POST(request({}),context)).status).toBe(status);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.budget).not.toHaveBeenCalled();});
  it('normalizes Budget input and derives identity from session',async()=>{mocks.create.mockResolvedValue({budget:{id},version:{id}});expect((await createRoute.POST(request(header))).status).toBe(201);expect(mocks.create).toHaveBeenCalledWith({organisationId:'org-a',userId:'user-a',financialYearId:id,name:'Budget',currency:'AUD',taxBasis:'INCLUSIVE',periodisationMode:'PERIODISED'});});
  it('rejects closed-year creation',async()=>{mocks.year.mockResolvedValue({id,status:'CLOSED'});expect((await createRoute.POST(request(header))).status).toBe(409);expect(mocks.create).not.toHaveBeenCalled();});
  it('rejects a foreign version',async()=>{mocks.version.mockResolvedValue(null);expect((await changeRoute.POST(request({action:'line'}),context)).status).toBe(404);expect(mocks.line).not.toHaveBeenCalled();});
  it('rejects edits to an ACTIVE version',async()=>{mocks.version.mockResolvedValue({id,budget_id:id,status:'ACTIVE'});expect((await changeRoute.POST(request({action:'line'}),context)).status).toBe(409);expect(mocks.line).not.toHaveBeenCalled();});
  it('binds an exact amount to a tenant-scoped draft line',async()=>{mocks.line.mockResolvedValue({id});expect((await changeRoute.POST(request({action:'line',budgetAccountId:id,costCentreId:id,annualBudgetCents:'9007199254740993'}),context)).status).toBe(200);expect(mocks.line).toHaveBeenCalledWith({organisationId:'org-a',userId:'user-a',budgetVersionId:id,budgetAccountId:id,costCentreId:id,annualBudgetCents:BigInt('9007199254740993')});});
  it('rejects periods from another financial year',async()=>{mocks.periods.mockResolvedValue([]);expect((await changeRoute.POST(request({action:'allocation',budgetLineId:id,financialPeriodId:id,amountCents:'100'}),context)).status).toBe(404);expect(mocks.allocation).not.toHaveBeenCalled();});
  it('rejects inactive dimensions',async()=>{mocks.account.mockResolvedValue({id,active:false});expect((await changeRoute.POST(request({action:'mapping',budgetAccountId:id,costCentreId:id}),context)).status).toBe(409);expect(mocks.mapping).not.toHaveBeenCalled();});
});
