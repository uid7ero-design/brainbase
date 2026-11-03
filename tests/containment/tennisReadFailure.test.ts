import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({sql:vi.fn()}));
vi.mock('@/lib/db',()=>({default:mocks.sql}));
vi.mock('@/lib/org',()=>({requireRole:async()=>({organisationId:'a',userId:'u',role:'admin'})}));
const sessions=await import('@/app/api/dashboard/sessions/route');
const dates=await import('@/app/api/dashboard/sessions/instances/route');
const types=await import('@/app/api/dashboard/session-types/route');
const roster=await import('@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route');
beforeEach(()=>{vi.clearAllMocks();mocks.sql.mockRejectedValue(new Error('synthetic source unavailable'));});
it.each([['sessions',sessions.GET],['instances',dates.GET],['types',types.GET]] as const)('does not fabricate an empty %s result after a failed read',async(_label,handler)=>{
  const response=await handler(new NextRequest('https://local.test/api/dashboard/sessions'));
  expect(response.status).toBe(503);const body=await response.json();expect(body[_label]).toBeUndefined();expect(body.error).not.toContain('synthetic');
  expect(mocks.sql).toHaveBeenCalledOnce();
});
it('does not present an unreadable roster as an empty class',async()=>{
  mocks.sql.mockResolvedValueOnce([{id:'i',session_id:'s'}]);
  const response=await roster.GET(new NextRequest('https://local.test/api/dashboard/sessions/s/instances/i'),{params:Promise.resolve({id:'s',instanceId:'i'})});
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Saved bookings could not be loaded.'});
});
