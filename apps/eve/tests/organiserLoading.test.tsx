import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrganiserEvent } from '@/lib/ticketing/gateway';

const gateway = vi.hoisted(() => ({ listOrders: vi.fn(), listAttendees: vi.fn() }));
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gateway }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));

import { loadOverview } from '@/lib/organiserData';
import OrganiserLoading from '@/app/(organiser)/organiser/loading';

describe('Organiser loading', () => {
  it('starts attendees before orders complete and preserves live totals', async () => {
    let finishOrders!: (value: unknown) => void;
    let finishAttendees!: (value: unknown) => void;
    gateway.listOrders.mockReturnValue(new Promise(resolve => { finishOrders = resolve; }));
    gateway.listAttendees.mockReturnValue(new Promise(resolve => { finishAttendees = resolve; }));
    const loading = loadOverview('session', [{ id: 'example', status: 'PUBLISHED' } as OrganiserEvent]);
    expect(gateway.listOrders).toHaveBeenCalledWith('session', 'example');
    expect(gateway.listAttendees).toHaveBeenCalledWith('session', 'example');
    finishOrders({ status: 'ok', data: { orders: [{ status: 'CONFIRMED', payment_status: 'PAID' }, { status: 'CANCELLED', payment_status: 'PAID' }] } });
    finishAttendees({ status: 'ok', data: { attendees: [{ order_status: 'CONFIRMED', checked_in_at: '2026-11-03' }, { order_status: 'CANCELLED', checked_in_at: '2026-11-03' }] } });
    expect(await loading).toEqual({ eventCount: 1, publishedCount: 1, orderCount: 1, paidOrderCount: 1, ticketCount: 1, checkedInCount: 1, truncated: false });
  });

  it('still refuses data if a parallel request reports revoked access', async () => {
    gateway.listOrders.mockResolvedValue({ status: 'ok', data: { orders: [] } });
    gateway.listAttendees.mockResolvedValue({ status: 'unauthorised' });
    await expect(loadOverview('revoked', [{ id: 'example', status: 'DRAFT' } as OrganiserEvent])).rejects.toThrow('REDIRECT:/signin?reason=session');
  });

  it('announces loading without showing identity or event data', () => {
    render(<OrganiserLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Eve');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
