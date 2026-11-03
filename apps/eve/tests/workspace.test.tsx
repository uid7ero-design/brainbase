import { beforeEach, describe, expect, it, vi } from 'vitest';
const gw = vi.hoisted(() => ({ getSession: vi.fn(), listEvents: vi.fn(), listOrders: vi.fn(), listAttendees: vi.fn() }));
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));
vi.mock('@/lib/session', () => ({ readSessionToken: async () => 'session' }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import { loadWorkspace } from '@/lib/organiserData';
import Dashboard from '@/app/(organiser)/organiser/page';

const identity = { user: { id: 'user', name: 'Example', role: 'viewer' }, organisationId: 'org', organisation: { slug: 'example', name: 'Example' } };
beforeEach(() => { vi.clearAllMocks(); });
describe('Single-call workspace loading', () => {
  it('uses one gateway call for identity and an explicit empty event list', async () => {
    gw.getSession.mockResolvedValue({ status: 'ok', data: { ...identity, events: [] } });
    expect((await loadWorkspace()).events).toEqual([]);
    expect(gw.getSession).toHaveBeenCalledWith('session', 'events');
    expect(gw.listEvents).not.toHaveBeenCalled();
  });
  it('renders a populated dashboard without loading order or attendee details', async () => {
    gw.getSession.mockResolvedValue({ status: 'ok', data: { ...identity, events: [{ id: 'event' }], overview: { eventCount: 1, publishedCount: 0, orderCount: 3, paidOrderCount: 1, ticketCount: 4, checkedInCount: 2, truncated: false } } });
    await Dashboard();
    expect(gw.getSession).toHaveBeenCalledWith('session', 'overview');
    expect(gw.listEvents).not.toHaveBeenCalled();
    expect(gw.listOrders).not.toHaveBeenCalled();
    expect(gw.listAttendees).not.toHaveBeenCalled();
  });
  it('supports an older backend during a staggered release', async () => {
    gw.getSession.mockResolvedValue({ status: 'ok', data: identity });
    gw.listEvents.mockResolvedValue({ status: 'ok', data: { events: [{ id: 'legacy-event' }] } });
    expect((await loadWorkspace()).events).toEqual([{ id: 'legacy-event' }]);
    expect(gw.listEvents).toHaveBeenCalledWith('session');
  });
  it('reduces the capped 25-event dashboard from 52 upstream reads to one', async () => {
    const events = Array.from({ length: 25 }, (_, i) => ({ id: `event-${i}`, status: 'DRAFT' }));
    gw.getSession.mockResolvedValue({ status: 'ok', data: identity });
    gw.listEvents.mockResolvedValue({ status: 'ok', data: { events } });
    gw.listOrders.mockResolvedValue({ status: 'ok', data: { orders: [] } });
    gw.listAttendees.mockResolvedValue({ status: 'ok', data: { attendees: [] } });
    await Dashboard();
    const count = () => Object.values(gw).reduce((total, fn) => total + fn.mock.calls.length, 0);
    expect(count()).toBe(52);
    vi.clearAllMocks();
    gw.getSession.mockResolvedValue({ status: 'ok', data: { ...identity, events, overview: { eventCount: 25, publishedCount: 0, orderCount: 0, paidOrderCount: 0, ticketCount: 0, checkedInCount: 0, truncated: false } } });
    await Dashboard();
    expect(count()).toBe(1);
  });
  it('never falls back to stale data when Eve is disabled', async () => {
    gw.getSession.mockResolvedValue({ status: 'forbidden', code: 'EVE_NOT_ENABLED' });
    await expect(loadWorkspace()).rejects.toThrow('REDIRECT:/signin?reason=not-enabled');
    expect(gw.listEvents).not.toHaveBeenCalled();
  });
});
