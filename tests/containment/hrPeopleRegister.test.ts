import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePeopleRegisterQuery, parsePeopleRegisterSnapshot } from '@/lib/hr/peopleRegisterContract';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), session: vi.fn(), capability: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: mocks.sql }));
vi.mock('@/lib/org', () => ({ requireSession: mocks.session }));
vi.mock('@/lib/hr/capability', () => ({ requireHrCapability: mocks.capability }));
const { CapabilityDatabaseError } = await import('@/lib/capabilities/requireCapability');
const { loadPeopleRegister } = await import('@/lib/hr/peopleRegisterQueries');
const { GET } = await import('@/app/api/hr/people/register/route');
const session = { organisationId: 'active-org', homeOrganisationId: 'home-org', userId: 'employee', role: 'viewer' as const, name: 'Synthetic' };
const person = { id: 'p-a', first_name: 'Alex', last_name: 'Worker', job_title: 'Engineer', worker_type: 'employee', employment_status: 'active', team_name: 'Delivery', manager_first_name: 'Morgan', manager_last_name: 'Worker' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue(session); mocks.capability.mockResolvedValue(undefined);
  mocks.sql.mockResolvedValue([{ people: [person], can_manage: false, page: 1, total: 1 }]);
});
const request = (query = '') => new Request(`http://fixture.local/api/hr/people/register${query ? '?' + query : ''}`);
describe('People register transport and projection', () => {
  it.each(['page=0','page=-1','page=1.5','page=1000000','page=1&page=2','status=terminated','worker_type=admin','organisation_id=other','canManage=true','search='+ 'x'.repeat(201), 'search=%00'])('rejects invalid or authority-changing input %s without reading records', async query => {
    expect((await GET(request(query))).status).toBe(400); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('normalizes view input and treats wildcard characters as literal text', () => {
    expect(parsePeopleRegisterQuery(request('page=2&search=%20%25_%20&status=ended&worker_type=casual').url))
      .toEqual({ page: 2, search: '%_', status: 'ended', workerType: 'casual' });
  });
  it('uses active-org capability, then one parameterized scoped statement with a stable order', async () => {
    const response = await GET(request('search=Delivery&status=active&worker_type=employee'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.capability).toHaveBeenCalledWith('active-org','viewer');
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mocks.sql.mock.calls[0]; const query = strings.join('?');
    expect(values).not.toContain('home-org'); expect(values).toContain('Delivery');
    expect(query).toContain('p.organisation_id=?');
    expect(query).toContain('p.linked_user_id=? OR manager.linked_user_id=?');
    expect(query).toContain('team.organisation_id=p.organisation_id');
    expect(query).toContain('manager.organisation_id=p.organisation_id');
    expect(query).toContain('ORDER BY first_name,last_name,id');
    expect(query).not.toMatch(/p\.\*|work_email|work_phone|assigned_user|restricted|storage_key/);
  });
  it('allows only display fields, a task flag and page totals even if query data drifts', async () => {
    mocks.sql.mockResolvedValue([{ people:[{ ...person, work_email:'secret', linked_user_id:'secret', bank_details:'secret' }], can_manage:true, page:1,total:1 }]);
    const body = await (await GET(request())).json();
    expect(body).toEqual({ people:[person],canManage:true,pagination:{page:1,page_size:25,total:1} });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
  it('preserves authentication/capability denial before input validation', async () => {
    mocks.session.mockRejectedValueOnce(new Error('secret'));
    expect((await GET(request('organisation_id=other'))).status).toBe(401);
    mocks.capability.mockRejectedValueOnce(new Error('secret'));
    expect((await GET(request('organisation_id=other'))).status).toBe(403);
    mocks.capability.mockRejectedValueOnce(new CapabilityDatabaseError());
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('fails closed on read failure, invalid counts and oversized UTF-8 output', async () => {
    mocks.sql.mockRejectedValueOnce(new Error('database secret'));
    expect(await (await GET(request())).json()).toEqual({ error:'Unable to load People.' });
    mocks.sql.mockResolvedValueOnce([{ people:[person],can_manage:false,page:1,total:-1 }]);
    expect((await GET(request())).status).toBe(503);
    mocks.sql.mockResolvedValueOnce([{ people:[{...person,job_title:'秘密'.repeat(50000)}],can_manage:true,page:1,total:1 }]);
    expect(await (await GET(request())).json()).toEqual({ error:'Unable to load People.' });
  });
  it('rejects string management flags and unsupported employment values', () => {
    expect(() => parsePeopleRegisterSnapshot({ people:[],canManage:'true',pagination:{page:1,page_size:25,total:0} })).toThrow();
    expect(() => parsePeopleRegisterSnapshot({ people:[{...person,employment_status:'dismissed'}],canManage:false,pagination:{page:1,page_size:25,total:1} })).toThrow();
  });
  it('retains the active-org super-admin bypass as a parameter, never query-selected identity', async () => {
    await loadPeopleRegister({...session,role:'super_admin'},parsePeopleRegisterQuery(request().url));
    expect(mocks.sql.mock.calls[0][1]).toBe(true); expect(mocks.sql.mock.calls[0]).not.toContain('home-org');
  });
});
