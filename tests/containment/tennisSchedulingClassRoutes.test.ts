import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures=vi.hoisted(()=>({ authorize:vi.fn(), runtime:vi.fn(), generate:vi.fn(), saved:vi.fn() }));
vi.mock('@/lib/scheduling/access',()=>({authorizeSchedulingRequest:fixtures.authorize}));
vi.mock('@/lib/scheduling/runtime',()=>({loadSchedulingRuntime:fixtures.runtime,SchedulingConfigurationError:class extends Error { code='not_ready'; }}));
import { POST, GET } from '@/app/api/scheduling/offerings/[offeringId]/generate-classes/route';

const request=(body:unknown={idempotencyKey:'synthetic-generation-key'},origin='https://synthetic.invalid')=>new Request('https://synthetic.invalid/api/scheduling/offerings/class/generate-classes',{
  method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body),
});
const run=(r=request())=>POST(r,{params:Promise.resolve({offeringId:'class'})});
beforeEach(()=>{
  vi.clearAllMocks();
  fixtures.authorize.mockResolvedValue({ok:true,session:{organisationId:'synthetic',userId:'staff'}});
  fixtures.runtime.mockResolvedValue({coaching:{generateClasses:fixtures.generate,savedGeneration:fixtures.saved}});
  fixtures.generate.mockResolvedValue({created:[{id:'dated-class',date:'2099-11-03'}],existing:0,skipped:[]});
});
describe('class generation through the actual central HTTP guard',()=>{
  it('checks saved receipts through a read-only request without invoking generation',async()=>{
    fixtures.saved.mockResolvedValue(null);
    const response=await GET(new Request('https://synthetic.invalid/api/scheduling/offerings/class/generate-classes?key=synthetic-generation-key'),{params:Promise.resolve({offeringId:'class'})});
    expect(response.status).toBe(200); expect(await response.json()).toEqual({result:null});
    expect(fixtures.saved).toHaveBeenCalledWith('class','synthetic-generation-key');
    expect(fixtures.generate).not.toHaveBeenCalled();
  });
  it('checks management permission before loading the runtime and exposes only the command result',async()=>{
    const response=await run(); expect(response.status).toBe(200);
    expect(fixtures.authorize).toHaveBeenCalledWith('scheduling.manage');
    expect(fixtures.generate).toHaveBeenCalledWith('class','synthetic-generation-key');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({created:[{id:'dated-class',date:'2099-11-03'}],existing:0,skipped:[]});
  });
  it('denies unauthenticated and revoked requests before any service call',async()=>{
    for(const status of [401,403]) {
      fixtures.authorize.mockResolvedValue({ok:false,response:Response.json({error:'Denied'},{status})});
      expect((await run()).status).toBe(status);
    }
    expect(fixtures.runtime).not.toHaveBeenCalled(); expect(fixtures.generate).not.toHaveBeenCalled();
  });
  it('refuses foreign origins, injected tenant fields and malformed request keys',async()=>{
    expect((await run(request(undefined,'https://foreign.invalid'))).status).toBe(403);
    expect((await run(request({idempotencyKey:'synthetic-generation-key',organisationId:'foreign'}))).status).toBe(400);
    expect((await run(request({idempotencyKey:'short'}))).status).toBe(400);
    expect(fixtures.generate).not.toHaveBeenCalled();
  });
  it('keeps an unactivated integration closed and does not expose internal errors',async()=>{
    fixtures.generate.mockRejectedValue(Object.assign(Error('private table details'),{code:'STOFF'}));
    const response=await run(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'Coaching integration is not available.',code:'COACHING_NOT_READY'});
  });
  it('reports a changed class distinctly from an uncertain save and never retries',async()=>{
    fixtures.generate.mockRejectedValueOnce(Object.assign(Error('private details'),{code:'STCHG'}));
    expect((await run()).status).toBe(409);
    fixtures.generate.mockRejectedValueOnce(Error('network reset with private details'));
    const response=await run(); expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('OUTCOME_UNKNOWN');
    expect(fixtures.generate).toHaveBeenCalledTimes(2);
  });
});
