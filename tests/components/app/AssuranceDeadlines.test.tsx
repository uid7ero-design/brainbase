import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Deadline section (jsdom): no-due-date state, original vs effective dates
// in the organisation timezone, urgency badges, and which controls each
// role sees — including that the requester never sees Approve/Reject on
// their own request. The server re-checks all of this; this proves the UI
// does not offer actions it should not.

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/assurance/actions/x',
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  useParams: () => ({}),
}));

const { DeadlineSection } = await import('@/app/assurance/_components/deadlines');
type TF = Parameters<typeof DeadlineSection>[0]['timeframes'][number];
type Caps = Parameters<typeof DeadlineSection>[0]['caps'];

const DAY = 864e5;
const base = (over: Partial<TF> = {}): TF => ({
  id: '11111111-1111-4111-8111-111111111111', timeframe_type: 'ACTION', status: 'ACTIVE',
  // 23:59 Adelaide (ACST, +09:30) on 20 and 27 Nov 2026 (+10:30 in DST)
  original_due_at: '2026-11-20T13:29:00.000Z', current_due_at: '2026-11-27T13:29:00.000Z',
  open: true, extensions: [], escalations: [], ...over,
});
const caps = (over: Partial<Caps> = {}): Caps => ({ canRecord: true, canAdminister: false, userId: 'u-mgr', timeZone: 'Australia/Adelaide', users: [{ value: 'u2', label: 'Max Manager' }], ...over });
const pending = { id: '22222222-2222-4222-8222-222222222222', status: 'PENDING', reason: 'Parts delayed.', requested_due_at: '2026-12-04T13:29:00.000Z',
  previous_due_at: '2026-11-27T13:29:00.000Z', approved_due_at: null, requested_at: '2026-11-01T00:00:00.000Z', requested_by: 'u-mgr',
  requested_by_name: 'Mia Manager', decided_at: null, decided_by_name: null, decision_notes: null };

afterEach(() => { vi.unstubAllGlobals(); refresh.mockReset(); });

describe('DeadlineSection', () => {
  it('shows a clean "No due date" state', () => {
    renderBrainbase(<DeadlineSection timeframes={[]} caps={caps()} recordLabel="action" />);
    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByText(/created without a due date/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows effective and original dates in the organisation timezone, with Extended', () => {
    renderBrainbase(<DeadlineSection timeframes={[base()]} caps={caps()} recordLabel="action" />);
    const card = screen.getByRole('region', { name: 'Action deadline' });
    expect(card.textContent).toMatch(/Effective due date.*27 Nov 2026/);
    expect(card.textContent).toMatch(/Original due date.*20 Nov 2026/);
    expect(card.textContent).toContain('Extended');
  });

  it('urgency: overdue and due soon are derived from the effective date; closed records show no controls', () => {
    const { unmount } = renderBrainbase(<DeadlineSection timeframes={[base({ current_due_at: new Date(Date.now() - DAY).toISOString(), original_due_at: new Date(Date.now() - DAY).toISOString() })]} caps={caps()} recordLabel="action" />);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    unmount();
    const r2 = renderBrainbase(<DeadlineSection timeframes={[base({ current_due_at: new Date(Date.now() + DAY).toISOString() })]} caps={caps()} recordLabel="action" />);
    expect(screen.getByText('Due soon')).toBeTruthy();
    r2.unmount();
    renderBrainbase(<DeadlineSection timeframes={[base({ open: false })]} caps={caps()} recordLabel="action" />);
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Request extension|Escalate/ })).toBeNull();
  });

  it('viewers see the deadline but no controls', () => {
    renderBrainbase(<DeadlineSection timeframes={[base({ extensions: [pending] })]} caps={caps({ canRecord: false, userId: 'u-viewer' })} recordLabel="action" />);
    expect(screen.getByText('Extension requested — awaiting a decision')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('managers can request and escalate; with a pending request they can withdraw their own, never decide', () => {
    const { unmount } = renderBrainbase(<DeadlineSection timeframes={[base()]} caps={caps()} recordLabel="action" />);
    expect(screen.getByRole('button', { name: 'Request extension' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeTruthy();
    unmount();
    renderBrainbase(<DeadlineSection timeframes={[base({ extensions: [pending] })]} caps={caps()} recordLabel="action" />);
    expect(screen.queryByRole('button', { name: 'Request extension' })).toBeNull(); // one waiting request at a time
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('an admin who asked cannot decide their own request; another admin can', () => {
    const own = { ...pending, requested_by: 'u-admin', requested_by_name: 'Ada Admin' };
    const { unmount } = renderBrainbase(<DeadlineSection timeframes={[base({ extensions: [own] })]} caps={caps({ canAdminister: true, userId: 'u-admin' })} recordLabel="action" />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText(/another organisation admin must decide it/)).toBeTruthy();
    unmount();
    renderBrainbase(<DeadlineSection timeframes={[base({ extensions: [own] })]} caps={caps({ canAdminister: true, userId: 'u-admin2' })} recordLabel="action" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByText(/moves the effective due date from/).textContent).toMatch(/27 Nov 2026.*4 Dec 2026/);
  });

  it('request extension posts the chosen date (end of day) and reason to the timeframe endpoint', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
    vi.stubGlobal('fetch', f);
    renderBrainbase(<DeadlineSection timeframes={[base()]} caps={caps()} recordLabel="action" />);
    fireEvent.click(screen.getByRole('button', { name: 'Request extension' }));
    const group = screen.getByText(/stays/).closest('div')!.parentElement!;
    fireEvent.change(within(group).getByLabelText(/New due date/), { target: { value: '2026-12-11' } });
    fireEvent.change(within(group).getByLabelText(/Reason/), { target: { value: 'Supplier delay.' } });
    fireEvent.submit(within(group).getByRole('button', { name: 'Request extension' }).closest('form')!);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe('/api/assurance/timeframes/11111111-1111-4111-8111-111111111111/extensions');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.reason).toBe('Supplier delay.');
    expect(new Date(body.requestedDueAt).getTime()).toBe(new Date('2026-12-11T23:59:00').getTime());
  });

  it('history and escalations render with their states and the right next controls only', () => {
    const decided = { ...pending, id: '3', status: 'REJECTED', decided_at: '2026-11-02T00:00:00Z', decided_by_name: 'Ada Admin', decision_notes: 'Not needed.' };
    const esc = (id: string, status: string) => ({ id, escalation_level: 2, reason: 'Needs attention.', status, escalated_at: '2026-11-03T00:00:00Z', escalated_by_name: 'Mia Manager',
      assigned_user_name: 'Max Manager', acknowledged_at: status === 'OPEN' ? null : '2026-11-03T01:00:00Z', acknowledged_by_name: status === 'OPEN' ? null : 'Max Manager',
      resolved_at: null, resolved_by_name: null, notes: null, updated_at: '2026-11-03T01:00:00Z' });
    renderBrainbase(<DeadlineSection timeframes={[base({ extensions: [decided], escalations: [esc('e1', 'OPEN'), esc('e2', 'ACKNOWLEDGED'), esc('e3', 'RESOLVED')] })]} caps={caps()} recordLabel="action" />);
    expect(screen.getByText('Extension history')).toBeTruthy();
    expect(screen.getByText(/Rejected because: Not needed\./)).toBeTruthy();
    expect(screen.getByText('Escalated · Level 2')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Cancel escalation' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });
});
