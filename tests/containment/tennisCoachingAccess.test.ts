import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), permissions: vi.fn() }));
vi.mock('@/lib/tennisBusiness/access', () => ({ tennisBusinessAccess: mocks.access }));
vi.mock('@/lib/organisationUsers/access', () => ({ getUserPermissions: mocks.permissions }));
const { coachingAccess } = await import('@/lib/tennisBusiness/coachingAccess');
beforeEach(() => { mocks.access.mockResolvedValue({ ok: true, session: { organisationId:'a',userId:'u',role:'manager' },modules:['scheduling'] }); mocks.permissions.mockResolvedValue(null); });
describe('Coaching staff and managed permission boundary', () => {
  it('keeps generic Scheduling viewers out of identifiable legacy booking data', async () => {
    mocks.access.mockResolvedValue({ ok:true,session:{organisationId:'a',userId:'u',role:'viewer'},modules:['scheduling'] }); expect(await coachingAccess(false)).toEqual({ok:false,status:403});
  });
  it('lets a staff view grant read, but requires use for a change', async () => {
    mocks.permissions.mockResolvedValue({scheduling:'view'}); expect((await coachingAccess(false)).ok).toBe(true); expect(await coachingAccess(true)).toEqual({ok:false,status:403});
    mocks.permissions.mockResolvedValue({scheduling:'use'}); expect((await coachingAccess(true)).ok).toBe(true);
  });
  it('denies a missing Scheduling grant and unreadable write permissions', async () => {
    mocks.access.mockResolvedValueOnce({ok:true,session:{role:'admin'},modules:['crm']}); expect(await coachingAccess(false)).toEqual({ok:false,status:403});
    mocks.permissions.mockRejectedValue(new Error('unavailable')); expect(await coachingAccess(true)).toEqual({ok:false,status:503});
  });
});
