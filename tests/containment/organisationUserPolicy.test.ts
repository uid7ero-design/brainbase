import { describe,it,expect } from 'vitest';
import { managedRequestAllowed as allowed,moduleForPath,parsePermissions } from '@/lib/organisationUsers/policy';
import { resolveNav } from '@/components/nav/navModel';
describe('organisation user permission boundary',()=>{
  it('denies unassigned modules and unknown routes',()=>{expect(allowed({},'/api/hr/people','GET','viewer')).toBe(false);expect(allowed({people:'use'},'/api/unmapped','POST','admin')).toBe(false);});
  it.each(['POST','PUT','PATCH','DELETE'])('denies %s for view-only accounts',method=>expect(allowed({people:'view'},'/api/hr/people',''+method,'admin')).toBe(false));
  it('allows view reads and module use without granting platform access',()=>{expect(allowed({people:'view'},'/people','GET','viewer')).toBe(true);expect(allowed({people:'use'},'/api/hr/people','POST','viewer')).toBe(true);expect(allowed({people:'use'},'/api/admin/users','GET','admin')).toBe(false);});
  it('keeps user administration distinct from module permissions',()=>{expect(allowed({},'/settings/users','GET','admin')).toBe(true);expect(allowed({people:'use'},'/api/organisation/users','POST','manager')).toBe(false);});
  it('does not match lookalike prefixes or unrelated commercial modules',()=>{expect(moduleForPath('/api/hr-other')).toEqual([]);expect(moduleForPath('/api/commercial/invoices')).toEqual(['invoicing']);expect(allowed({quotes:'use'},'/api/commercial/invoices','GET','admin')).toBe(false);});
  it('rejects malformed/unknown/prototype permission keys',()=>{for(const p of [[],null,{super_admin:'use'},{people:'admin'},JSON.parse('{"__proto__":"use"}')])expect(()=>parsePermissions(p)).toThrow();});
  it('permits own profile without permitting other account endpoints',()=>{expect(allowed({},'/api/account/profile','PATCH','viewer')).toBe(true);expect(allowed({},'/api/account/anything','GET','viewer')).toBe(false);});
  it('hides managed account navigation outside its explicit modules',()=>{const nav=resolveNav({role:'admin',enabledCapabilities:['people'],dashboardVariant:'ld-tennis',managedAccess:true});expect(nav.home.href).toBe('/workspace');expect(nav.work.map(e=>e.id)).toEqual(['people']);expect(nav.manage.map(e=>e.id)).toEqual(['organisation-users']);expect(nav.requests).toBeNull();});
});
