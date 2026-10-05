import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Assurance docs-to-product reconciliation (UI behaviour):
//   - one-click consequential actions (template Retire)
//     require an explicit confirmation step before anything is sent;
//   - existing evidence can be linked to every supported target type from
//     one record-type selector, posting to the existing links endpoint.

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/assurance',
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  useParams: () => ({}),
}));

const { default: ActionPanel } = await import('@/app/assurance/_components/ActionPanel');
const { default: EvidenceLinkPanel, LINK_TARGET_LABELS } = await import('@/app/assurance/evidence/[id]/EvidenceLinkPanel');

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));

beforeEach(() => {
  fetchMock.mockClear();
  refresh.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ActionPanel confirm (template Retire)', () => {
  it('does not send anything until the confirmation is given', async () => {
    renderBrainbase(
      <ActionPanel label="Retire" endpoint="/api/assurance/templates/t1/retire" extraBody={{ kind: 'inspection' }} variant="danger"
        submitLabel="Retire template" confirm="Version 1 will no longer be offered when planning new inspections." />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'Confirm: Retire' });
    expect(within(group).getByText(/no longer be offered/)).toBeTruthy();

    // Backing out sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Confirm: Retire' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire template' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assurance/templates/t1/retire');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'inspection' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('without confirm, an ordinary one-click action is unchanged', async () => {
    renderBrainbase(<ActionPanel label="Start inspection" endpoint="/api/assurance/inspections/i1/start" variant="primary" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('EvidenceLinkPanel', () => {
  const options = {
    incident: [{ id: 'inc-1', label: 'INC-1 — Slip' }],
    investigation: [{ id: 'inv-1', label: 'INV-1 — Wash bay' }],
    inspection: [{ id: 'ins-1', label: 'INS-1 — Depot walk' }],
    audit: [{ id: 'aud-1', label: 'AUD-1 — Waste audit' }],
    finding: [{ id: 'fnd-1', label: 'FND-1 — Grate' }],
    action: [{ id: 'act-1', label: 'ACT-1 — Bolt grate' }],
  };

  it('offers all six supported target types (never verification) and posts to the existing endpoint', async () => {
    renderBrainbase(<EvidenceLinkPanel evidenceId="ev-1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link to a record' }));
    const kind = screen.getByLabelText(/Record type/) as HTMLSelectElement;
    const offered = [...kind.options].map(o => o.textContent).filter(t => t !== 'Choose…');
    expect(offered).toEqual(['Incident', 'Investigation', 'Inspection', 'Audit', 'Finding', 'Action']);
    expect(Object.keys(LINK_TARGET_LABELS)).not.toContain('verification');

    for (const [k, opts] of Object.entries(options)) {
      fireEvent.change(kind, { target: { value: k } });
      const rec = screen.getByLabelText(new RegExp(`^${LINK_TARGET_LABELS[k as keyof typeof LINK_TARGET_LABELS]}`)) as HTMLSelectElement;
      expect([...rec.options].map(o => o.value)).toContain(opts[0].id);
    }

    fireEvent.change(kind, { target: { value: 'action' } });
    fireEvent.change(screen.getByLabelText(/^Action/), { target: { value: 'act-1' } });
    fireEvent.change(screen.getByLabelText(/Why it is linked/), { target: { value: 'Proof of repair' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assurance/evidence/ev-1/links');
    expect(JSON.parse(String(init.body))).toEqual({ target: 'action', targetId: 'act-1', purpose: 'Proof of repair' });
  });

  it('only lists types that have linkable records, and renders nothing when there are none', () => {
    const empty = { incident: [], investigation: [], inspection: [], audit: [], finding: [], action: [] };
    const { container, unmount } = renderBrainbase(<EvidenceLinkPanel evidenceId="ev-1" options={empty} />);
    expect(container.textContent).toBe('');
    unmount();
    renderBrainbase(<EvidenceLinkPanel evidenceId="ev-1" options={{ ...empty, audit: options.audit }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link to a record' }));
    const kind = screen.getByLabelText(/Record type/) as HTMLSelectElement;
    expect([...kind.options].map(o => o.textContent).filter(t => t !== 'Choose…')).toEqual(['Audit']);
  });

  it('shows the server refusal (e.g. a restricted or finished record) without claiming success', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: 'This record is finished; its evidence is part of the closure record and can no longer be changed.' }), { status: 409 })));
    renderBrainbase(<EvidenceLinkPanel evidenceId="ev-1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link to a record' }));
    fireEvent.change(screen.getByLabelText(/Record type/), { target: { value: 'finding' } });
    fireEvent.change(screen.getByLabelText(/^Finding/), { target: { value: 'fnd-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/finished/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
