import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Settings → Reference data (jsdom): the shared locations / assets /
// external organisations manager — Active/Inactive filter, admin vs
// read-only rendering, empty states, and the exact request bodies for
// create / edit / deactivate / reactivate. No delete control anywhere.

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/assurance/settings/reference-data/locations',
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  useParams: () => ({}),
}));

const { default: ReferenceDataManager } = await import('@/app/assurance/_components/ReferenceDataManager');
type Row = Parameters<typeof ReferenceDataManager>[0]['rows'][number];

const loc = (n: number, name: string, status = 'ACTIVE', extra: Partial<Row> = {}): Row => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, reference: `LOC-${n}`, name, type: 'DEPOT', status,
  fields: { locationType: 'DEPOT', description: null, addressLine1: null, addressLine2: null, suburb: 'Lonsdale', state: 'SA', postcode: null, countryCode: 'AU' },
  revision: `rev-${n}`, usage_count: n, ...extra,
});
const ROWS: Row[] = [loc(1, 'Southern Depot'), loc(2, 'Northern Yard'), loc(3, 'Old Works', 'INACTIVE'), loc(4, 'Archived Yard', 'ARCHIVED')];

function mockFetch(status = 200, body: unknown = { id: 'x' }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sentBody = (f: ReturnType<typeof vi.fn>) => JSON.parse(f.mock.calls[0][1].body as string);

afterEach(() => { vi.unstubAllGlobals(); refresh.mockReset(); });

describe('ReferenceDataManager', () => {
  it('shows active records by default; Inactive and All reveal the rest', () => {
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister />);
    const table = screen.getByRole('table', { name: 'Locations' });
    const names = () => within(table).queryAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent);
    expect(names()).toEqual(['Southern Depot', 'Northern Yard']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'INACTIVE' } });
    expect(names()).toEqual(['Old Works', 'Archived Yard']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'ALL' } });
    expect(names()).toHaveLength(4);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), { target: { value: 'loc-2' } });
    expect(names()).toEqual(['Northern Yard']);
  });

  it('renders type labels, status badges and usage counts', () => {
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister />);
    const row = within(screen.getByRole('table', { name: 'Locations' })).getAllByRole('row')[1];
    expect(row.textContent).toContain('LOC-1');
    expect(row.textContent).toContain('Depot');
    expect(row.textContent).toContain('Active');
    expect(row.textContent).toContain('1 record');
  });

  it('admins get create / edit / deactivate / reactivate; archived records are not reactivatable here; never delete', () => {
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'ALL' } });
    expect(screen.getByRole('button', { name: 'Create location' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit Southern Depot' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Deactivate Southern Depot' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Reactivate Old Works' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Reactivate Archived Yard' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Deactivate Archived Yard' })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('non-admins see the list but no mutation controls', () => {
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister={false} />);
    expect(screen.getByRole('table', { name: 'Locations' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create|Edit|Deactivate|Reactivate/ })).toBeNull();
  });

  it('empty states use the exact wording; admins get the create action, others a pointer to an admin', () => {
    const { unmount } = renderBrainbase(<ReferenceDataManager kind="asset" rows={[]} canAdminister />);
    expect(screen.getByText('No assets are available.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeTruthy();
    unmount();
    renderBrainbase(<ReferenceDataManager kind="external_organisation" rows={[]} canAdminister={false} />);
    expect(screen.getByText('No external organisations have been configured.')).toBeTruthy();
    expect(screen.getByText('Ask an organisation admin to add external organisations.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('create posts reference + fields (roles as a list) to the kind endpoint and refreshes', async () => {
    const f = mockFetch();
    renderBrainbase(<ReferenceDataManager kind="external_organisation" rows={[]} canAdminister />);
    fireEvent.click(screen.getByRole('button', { name: 'Create external organisation' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: 'acme' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Acme Waste' } });
    fireEvent.click(within(dialog).getByLabelText('Contractor'));
    fireEvent.click(within(dialog).getByLabelText('Supplier'));
    fireEvent.change(within(dialog).getByLabelText(/General email/), { target: { value: 'ops@acme.example' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Create external organisation' }).closest('form')!);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe('/api/assurance/reference-data/external-organisations');
    expect(sentBody(f)).toMatchObject({ reference: 'acme', name: 'Acme Waste', roles: ['CONTRACTOR', 'SUPPLIER'], email: 'ops@acme.example' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('website is a plain text field so "example.com" is not blocked by browser URL validation', () => {
    renderBrainbase(<ReferenceDataManager kind="external_organisation" rows={[]} canAdminister />);
    fireEvent.click(screen.getByRole('button', { name: 'Create external organisation' }));
    const site = within(screen.getByRole('dialog')).getByLabelText(/Website/) as HTMLInputElement;
    expect(site.type).toBe('text');
    site.value = 'example.com';
    expect(site.checkValidity()).toBe(true);
  });

  it('edit sends the revision, never a new reference', async () => {
    const f = mockFetch();
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Southern Depot' })[0]);
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(/Reference/) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Southern Ops Depot' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Save changes' }).closest('form')!);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe('/api/assurance/reference-data/locations/00000000-0000-4000-8000-000000000001');
    const body = sentBody(f);
    expect(body).toMatchObject({ name: 'Southern Ops Depot', expectedRevision: 'rev-1', locationType: 'DEPOT', suburb: 'Lonsdale' });
    expect(body).not.toHaveProperty('reference');
  });

  it('deactivate explains the historical behaviour, posts the revision, and shows server errors without closing', async () => {
    const f = mockFetch(409, { error: 'This location was changed by someone else. Refresh and try again.' });
    renderBrainbase(<ReferenceDataManager kind="location" rows={ROWS} canAdminister />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate Northern Yard' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Existing records keep this location and continue to show it. Nothing is deleted or reassigned.');
    expect(dialog.textContent).toContain('Currently used by 2 records.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(/changed by someone else/)).toBeTruthy());
    expect(f.mock.calls[0][0]).toBe('/api/assurance/reference-data/locations/00000000-0000-4000-8000-000000000002/deactivate');
    expect(sentBody(f)).toEqual({ expectedRevision: 'rev-2' });
    expect(refresh).not.toHaveBeenCalled();
  });
});
