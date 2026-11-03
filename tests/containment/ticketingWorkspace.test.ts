import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), events: vi.fn(), overview: vi.fn() }));
vi.mock('@/lib/ticketing/authorize', () => ({ authorizeTicketingApiRequest: m.auth }));
vi.mock('@/lib/ticketing/rateLimit', () => ({ limit: m.limit, LIMITS: { organiserRead: {} } }));
vi.mock('@/lib/events/organiserOverview', () => ({ readWorkspaceEvents: m.events, readOrganiserOverview: m.overview, OVERVIEW_EVENT_CAP: 25 }));
import { GET } from '@/app/api/ticketing/auth/session/route';

const ctx = { userId: 'user-a', organisationId: 'org-a', name: 'Owner', role: 'viewer', organisationName: 'Example', organisationSlug: 'example' };
const req = (include = '') => new Request(`https://api.example/api/ticketing/auth/session${include ? '?include=' + include : ''}`);
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, context: ctx });
  m.limit.mockResolvedValue({ allowed: true });
  m.events.mockResolvedValue([{ id: 'event-a', name: 'Example', status: 'DRAFT', crm_contact_id: 'private', ticket_token: 'private' }]);
  m.overview.mockResolvedValue({ orderCount: 2, paidOrderCount: 1, ticketCount: 3, checkedInCount: 1 });
});
describe('Authenticated initial workspace', () => {
  it('returns identity and allow-listed events with one fresh authorisation', async () => {
    const r = await GET(req('events'));
    const body = await r.json();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(body.organisationId).toBe('org-a');
    expect(body.events).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/private|crm_contact|ticket_token/);
    expect(m.auth).toHaveBeenCalledTimes(1);
    expect(m.events).toHaveBeenCalledWith('org-a');
    expect(m.overview).not.toHaveBeenCalled();
  });
  it('provides totals using only authorised event IDs, without list-detail fanout', async () => {
    const body = await (await GET(req('overview'))).json();
    expect(body.overview).toEqual({ eventCount: 1, publishedCount: 0, orderCount: 2, paidOrderCount: 1, ticketCount: 3, checkedInCount: 1, truncated: false });
    expect(m.overview).toHaveBeenCalledWith('org-a', ['event-a']);
    expect(m.auth).toHaveBeenCalledTimes(1);
  });
  it('preserves the existing identity-only contract and ignores unknown includes', async () => {
    for (const include of ['', 'something-else']) {
      const b = await (await GET(req(include))).json();
      expect(Object.keys(b).sort()).toEqual(['organisation', 'organisationId', 'user']);
    }
    expect(m.events).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])('reads no data when fresh authorisation returns %s', async status => {
    m.auth.mockResolvedValue({ ok: false, response: Response.json({ error: 'Denied' }, { status }) });
    expect((await GET(req('overview'))).status).toBe(status);
    expect(m.events).not.toHaveBeenCalled();
    expect(m.overview).not.toHaveBeenCalled();
  });
  it.each([['LIMIT', 429], ['UNAVAILABLE', 503]] as const)('respects request limits: %s', async (reason, status) => {
    m.limit.mockResolvedValue({ allowed: false, reason });
    expect((await GET(req('events'))).status).toBe(status);
    expect(m.events).not.toHaveBeenCalled();
  });
  it('does not fabricate zero totals when the overview query fails', async () => {
    m.overview.mockRejectedValue(new Error('DB unavailable'));
    await expect(GET(req('overview'))).rejects.toThrow('DB unavailable');
  });
});
