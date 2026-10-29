import { beforeEach,describe,expect,it,vi } from 'vitest';
const {auth,query}=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}));
vi.mock('@/lib/commercial/authorize',()=>({authorizeCommercialRequest:auth,COMMERCIAL_MIN_ROLE:{administer:'admin'}}));
vi.mock('@/lib/db',()=>({default:{query}}));
import { GET as closeGET } from '@/app/api/commercial/budgeting/close-evidence/route';
import { GET as evidenceGET } from '@/app/api/commercial/budgeting/reconciliations/evidence/route';
import { GET as historyGET } from '@/app/api/commercial/budgeting/reconciliations/history/route';
import { financeId } from '../fixtures/commercialFinanceEvidence';
const parameters=`yearId=${financeId(1)}&periodId=${financeId(2)}&source=ledger&currency=AUD`;
const routes=[['close',closeGET,`kind=period&id=${financeId(8)}&${parameters}`],['evidence',evidenceGET,`id=${financeId(3)}&${parameters}`],['history',historyGET,parameters]] as const;
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({ok:true,session:{organisationId:'session-tenant'}});query.mockResolvedValue([]);});
describe('Administrator-scoped finance evidence reads',()=>{
  it.each(routes)('%s preserves auth denial and performs no SQL',async(_name,get,params)=>{
    for(const status of [401,403,503]){auth.mockResolvedValue({ok:false,response:new Response(null,{status})});expect((await get(new Request('http://localhost?'+params))).status).toBe(status);}
    expect(query).not.toHaveBeenCalled();expect(auth).toHaveBeenCalledWith('budgeting','admin');
  });
  it.each(routes)('%s rejects invalid identities before SQL',async(_name,get,params)=>{
    const invalid=params.replace(financeId(1),'invalid');const response=await get(new Request('http://localhost?'+invalid));expect(response.status).toBe(400);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(query).not.toHaveBeenCalled();
  });
  it.each(routes)('%s takes tenant only from the session and binds scope values',async(name,get,params)=>{
    query.mockResolvedValue(name==='history'?[{count:0,records:[]}]:[]);
    const response=await get(new Request('http://localhost?'+params+'&organisationId=foreign'));
    expect(response.status).toBe(name==='history'?200:404);expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [statement,values]=query.mock.calls[0];expect(values[0]).toBe('session-tenant');expect(values).not.toContain('foreign');expect(values).toContain(financeId(1));expect(values).toContain(financeId(2));expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(statement).toContain('organisation_id');
  });
  it.each([evidenceGET,historyGET])('rejects excessive or malformed pagination and invalid filters',async get=>{
    for(const suffix of ['page=0','page=100001','page=1e2','page=+1','currency=AU']){
      const params=new URLSearchParams(parameters+`&id=${financeId(3)}`);const [key,value]=suffix.split('=');params.set(key,value);expect((await get(new Request('http://localhost?'+params))).status).toBe(400);
    }expect(query).not.toHaveBeenCalled();
  });
  it('binds literal hostile search/type text without changing the adjustment query',async()=>{
    const {listFinanceAdjustmentReview}=await import('@/lib/commercial/financeAdjustmentReview');query.mockResolvedValue([{count:0,adjustments:[]}]);
    const search="%' OR 1=1 --";await listFinanceAdjustmentReview('session-tenant',{periodId:financeId(2),currency:'AUD',status:'',search,adjustmentType:'MANUAL_FINANCE_ADJUSTMENT'},1);
    const [statement,values]=query.mock.calls[0];expect(statement).not.toContain(search);expect(values).toContain(search);expect(values).toContain('MANUAL_FINANCE_ADJUSTMENT');expect(statement).toContain('strpos');
  });
});
