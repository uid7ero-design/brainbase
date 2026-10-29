import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const state=vi.hoisted(()=>({session:vi.fn(),save:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/org',()=>({requireSession:()=>state.session()}));
vi.mock('@/lib/organisationUsers/service',()=>({saveOrganisationUser:(...a:unknown[])=>state.save(...a),listOrganisationUsers:(...a:unknown[])=>state.list(...a),UserAdministrationError:class extends Error{status=403;}}));
const {GET,POST}=await import('@/app/api/organisation/users/route');
describe('organisation user HTTP boundary',()=>{
  beforeEach(()=>{vi.clearAllMocks();state.session.mockResolvedValue({userId:'admin',organisationId:'own',role:'admin'});state.save.mockResolvedValue({id:'new',delivery:'sent'});state.list.mockResolvedValue({users:[],modules:[]});});
  it('accepts a real same-host browser behind a TLS reverse proxy',async()=>{const r=await POST(new NextRequest('http://127.0.0.1:3000/api/organisation/users',{method:'POST',headers:{host:'app.example.test',origin:'https://app.example.test','Content-Type':'application/json'},body:'{"action":"invite"}'}));expect(r.status).toBe(200);expect(state.save.mock.calls[0][0].organisationId).toBe('own');});
  it('rejects foreign and opaque Origins before reading session or mutating',async()=>{for(const origin of ['https://attacker.test','null']){expect((await POST(new NextRequest('https://app.example.test/api/organisation/users',{method:'POST',headers:{origin,host:'app.example.test'},body:'{}'}))).status).toBe(403);}expect(state.session).not.toHaveBeenCalled();expect(state.save).not.toHaveBeenCalled();});
  it('returns no-store 401 on a revoked session',async()=>{state.session.mockRejectedValue(Error('revoked'));const r=await GET();expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('private, no-store');});
  it('never returns provider or database exception details',async()=>{state.save.mockRejectedValue(Error('secret connection string'));const r=await POST(new NextRequest('https://app.example.test/api/organisation/users',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret connection');});
});
