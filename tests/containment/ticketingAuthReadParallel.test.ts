import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), capability: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: mocks.db }));
vi.mock('@/lib/ticketing/gate', () => ({ checkTicketingGate: () => ({ ok: true }), TICKETING_SESSION_HEADER: 'x-session' }));
vi.mock('@/lib/ticketing/session', () => ({ verifyTicketingSession: async () => ({ jti: 'session', userId: 'user', organisationId: 'org' }) }));
vi.mock('@/lib/capabilities/requireCapability', () => ({ requireCapability: mocks.capability, CapabilityDatabaseError: class extends Error {} }));
import { authorizeTicketingApiRequest } from '@/lib/ticketing/authorize';

describe('Request-local authorisation reads', () => {
  it.each([0, 1])('refuses the request if parallel database read %s fails', async failed => {
    mocks.db.mockReset();
    const rows = [
      [{ id: 'user', organisation_id: 'org', role: 'viewer', status: 'ACTIVE', session_live: true }],
      [{ id: 'org', status: 'ACTIVE', settings: { events: { eveEnabled: true } } }],
    ];
    let index = 0;
    mocks.db.mockImplementation(() => { const i = index++; return i === failed ? Promise.reject(new Error('Read unavailable')) : Promise.resolve(rows[i]); });
    mocks.capability.mockClear();
    const result = await authorizeTicketingApiRequest(new Request('https://api.example'), 'viewer');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(mocks.capability).not.toHaveBeenCalled();
  });
  it('starts both reads before either finishes, without caching across requests', async () => {
    const finish: ((v: unknown) => void)[] = [];
    mocks.db.mockImplementation(() => new Promise(resolve => finish.push(resolve)));
    mocks.capability.mockResolvedValue({ key: 'events' });
    const pending = authorizeTicketingApiRequest(new Request('https://api.example'), 'viewer');
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[0]([{ id: 'user', organisation_id: 'org', role: 'viewer', status: 'ACTIVE', name: 'Example', session_live: true }]);
    finish[1]([{ id: 'org', status: 'ACTIVE', settings: { events: { eveEnabled: true } } }]);
    expect((await pending).ok).toBe(true);
    const revoked = authorizeTicketingApiRequest(new Request('https://api.example'), 'viewer');
    await vi.waitFor(() => expect(finish).toHaveLength(4));
    finish[2]([{ id: 'user', organisation_id: 'org', role: 'viewer', status: 'ACTIVE', session_live: false }]);
    finish[3]([{ id: 'org', status: 'ACTIVE', settings: { events: { eveEnabled: true } } }]);
    const result = await revoked;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
