import { beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({authorize:vi.fn(),runtime:vi.fn(),execute:vi.fn(),saved:vi.fn(),dates:vi.fn(),roster:vi.fn(),can:vi.fn()}));
vi.mock('@/lib/scheduling/access',()=>({authorizeSchedulingRequest:f.authorize}));
vi.mock('@/lib/scheduling/runtime',()=>({loadSchedulingRuntime:f.runtime,SchedulingConfigurationError:class extends Error {}}));
import {POST,GET} from '@/app/api/scheduling/coaching/actions/route';
import {GET as dates} from '@/app/api/scheduling/coaching/route';
const action={kind:'attendance',bookingId:'booking',value:'attended',expectedVersion:0,idempotencyKey:'synthetic-roster-key'};
const request=(body:unknown=action,origin='https://synthetic.invalid')=>new Request('https://synthetic.invalid/api/scheduling/coaching/actions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const context={params:Promise.resolve({})};
beforeEach(()=>{vi.clearAllMocks();f.can.mockReturnValue(true);f.authorize.mockResolvedValue({ok:true,session:{organisationId:'synthetic',userId:'staff'}});f.runtime.mockResolvedValue({tenant:{can:f.can},coachingRoster:f});f.execute.mockResolvedValue({id:'booking'});});
it('authorizes roster operations before runtime access and keeps results uncached',async()=>{
  const response=await POST(request(),context);expect(response.status).toBe(200);expect(f.authorize).toHaveBeenCalledWith('scheduling.reserve');expect(response.headers.get('cache-control')).toBe('no-store');
  for(const status of [401,403]){f.authorize.mockResolvedValue({ok:false,response:Response.json({error:'Denied'},{status})});expect((await POST(request(),context)).status).toBe(status);}
  expect(f.execute).toHaveBeenCalledOnce();
});
it('rejects foreign origins, injected tenants, malformed commands and separately checks attendance',async()=>{
  expect((await POST(request(action,'https://foreign.invalid'),context)).status).toBe(403);
  expect((await POST(request({...action,organisationId:'other'}),context)).status).toBe(400);
  expect((await POST(request({...action,expectedVersion:-1}),context)).status).toBe(400);
  f.can.mockReturnValue(false);expect((await POST(request(),context)).status).toBe(403);expect(f.execute).not.toHaveBeenCalled();
});
it('uses a read-only recovery and never interprets a missing receipt as a failed write',async()=>{
  f.saved.mockResolvedValue(false);
  const response=await GET(new Request('https://synthetic.invalid/api/scheduling/coaching/actions?key=synthetic-roster-key&kind=attendance&bookingId=booking'),context);
  expect(await response.json()).toEqual({confirmed:false});expect(f.execute).not.toHaveBeenCalled();
});
it('does not leak internal errors or retry an uncertain write',async()=>{
  f.execute.mockRejectedValue(Error('private SQL and contact details'));
  const response=await POST(request(),context);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'OUTCOME_UNKNOWN'});expect(f.execute).toHaveBeenCalledOnce();
});
it('rejects duplicate range parameters without invoking a read',async()=>{
  const response=await dates(new Request('https://synthetic.invalid/api/scheduling/coaching?from=2099-01-01&from=2099-01-02&until=2099-01-03'),context);
  expect(response.status).toBe(400);expect(f.dates).not.toHaveBeenCalled();
});
