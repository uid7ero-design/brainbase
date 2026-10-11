import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ExternalGlMappingsPage from '@/app/commercial/budgeting/external-gl/page';

const account = { id: 'account-map', source_system_id: 'OLD', external_gl_account_code: '600', external_gl_account_name: null, budget_account_id: 'account', budget_account_code: 'SOFTWARE', budget_account_name: 'Software', effective_from: '2026-07-01', effective_to: null as string | null, status: 'ACTIVE' };
const centre = { id: 'centre-map', source_system_id: 'OLD', external_cost_centre_code: 'OPS', cost_centre_id: 'centre', cost_centre_code: 'GENERAL', cost_centre_name: 'General', effective_from: '2026-07-01', effective_to: null as string | null, status: 'ACTIVE' };
let accounts: typeof account[], centres: typeof centre[], posts: number;
let brokenRead: string, saveMode: string;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
const fetcher = async (url: string, options?: RequestInit) => {
  const kind = url.includes('/cost-centre-mappings') ? 'centre' : 'account';
  if (options?.method === 'POST') {
    posts++;
    if (saveMode === 'reject') return Response.json({ error: 'Overlap rejected.' }, { status: 409 });
    const rows = kind === 'account' ? accounts : centres;
    const saved = { ...(kind === 'account' ? account : centre), id: kind + '-saved' };
    if (url.endsWith('/retire')) {
      rows[0].status = 'RETIRED'; rows[0].effective_to = '2026-09-30';
    } else rows.push(saved as typeof account & typeof centre);
    if (saveMode === 'lost') throw new Error('Connection lost after commit');
    if (saveMode === 'malformed') return Response.json({});
    if (saveMode === 'readback') brokenRead = 'reference-data';
    return Response.json({ mapping: url.endsWith('/retire') ? rows[0] : saved });
  }
  if (brokenRead && url.includes('/' + brokenRead)) return Response.json({});
  if (url.includes('/sources')) return Response.json({ sourceSystemIds: ['OLD', 'NEW'] });
  if (url.includes('/reference-data')) return Response.json({ budgetAccounts: [{ id: 'account', code: 'SOFTWARE', name: 'Software' }], costCentres: [{ id: 'centre', code: 'GENERAL', name: 'General' }] });
  return Response.json({ mappings: kind === 'account' ? accounts : centres });
};
beforeEach(() => { accounts = [structuredClone(account)]; centres = [structuredClone(centre)]; posts = 0; brokenRead = ''; saveMode = ''; vi.stubGlobal('fetch', vi.fn(fetcher)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const accountForm = () => within(screen.getByRole('form', { name: 'Create GL account mapping' }));
async function ready() {
  render(<ExternalGlMappingsPage />);
  await waitFor(() => expect(accountForm().getByRole('button', { name: 'Create mapping' })).toBeEnabled());
}
function fill(kind: 'account' | 'centre') {
  const form = within(screen.getByRole('form', { name: kind === 'account' ? 'Create GL account mapping' : 'Create cost-centre mapping' }));
  fireEvent.change(form.getByLabelText('Source system'), { target: { value: 'OLD' } });
  fireEvent.change(form.getByLabelText(kind === 'account' ? 'External GL code' : 'External cost-centre code'), { target: { value: 'NEW-CODE' } });
  fireEvent.change(form.getByRole('combobox'), { target: { value: kind } });
  fireEvent.change(form.getByLabelText('Effective from'), { target: { value: '2026-08-01' } });
  return screen.getByRole('form', { name: kind === 'account' ? 'Create GL account mapping' : 'Create cost-centre mapping' });
}
async function recover() {
  brokenRead = '';
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved mappings' }));
  await screen.findByText(/Saved mappings reloaded/);
  expect(screen.getByRole('heading', { name: 'External GL mappings' })).toHaveFocus();
}

describe('External GL mapping recovery', () => {
  it.each(['sources', 'mappings', 'cost-centre-mappings', 'reference-data'])('does not treat incomplete %s as an empty configuration', async endpoint => {
    brokenRead = endpoint;
    render(<ExternalGlMappingsPage />);
    await screen.findByRole('alert');
    expect(screen.queryByText('No account mappings match the current filters.')).not.toBeInTheDocument();
    expect(accountForm().getByRole('button', { name: 'Create mapping' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Create GL account mapping' }));
    expect(posts).toBe(0);
    await recover();
    expect(screen.getByText('600')).toBeVisible();
    expect(posts).toBe(0);
  });
  it.each(['account', 'centre'] as const)('recovers a committed %s create with a lost response without resubmitting', async kind => {
    await ready(); const form = fill(kind); saveMode = 'lost';
    fireEvent.submit(form);
    await screen.findByText(/save outcome could not be confirmed/);
    expect(within(form).getByLabelText('Source system')).toHaveValue('OLD');
    fireEvent.submit(form); expect(posts).toBe(1);
    brokenRead = 'reference-data';
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved mappings' }));
    await screen.findByRole('alert');
    expect(within(form).getByLabelText('Source system')).toHaveValue('OLD');
    await recover();
    expect(within(form).getByLabelText('Source system')).toHaveValue('');
    expect(posts).toBe(1);
    expect(kind === 'account' ? accounts : centres).toHaveLength(2);
  });
  it.each(['malformed', 'readback'])('pauses after a confirmed save with %s failure', async mode => {
    await ready(); const form = fill('account'); saveMode = mode;
    fireEvent.submit(form); await screen.findByText(/mapping change was saved/);
    expect(accountForm().getByRole('button', { name: 'Create mapping' })).toBeDisabled();
    fireEvent.submit(form); expect(posts).toBe(1);
    await recover(); expect(posts).toBe(1);
  });
  it('keeps authoritative rejection editable without entering recovery', async () => {
    await ready(); const form = fill('account'); saveMode = 'reject';
    fireEvent.submit(form); await screen.findByText('Overlap rejected.');
    expect(accountForm().getByRole('button', { name: 'Create mapping' })).toBeEnabled();
    expect(within(form).getByLabelText('Source system')).toHaveValue('OLD');
    expect(accounts).toHaveLength(1);
  });
  it('recovers a committed retirement without repeating it', async () => {
    await ready(); saveMode = 'lost';
    const date = screen.getAllByLabelText('Effective-to date')[0];
    fireEvent.change(date, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Retire' })[0]);
    await screen.findByText(/save outcome could not be confirmed/);
    expect(screen.getAllByRole('button', { name: 'Retire' })[0]).toBeDisabled();
    await recover();
    expect(screen.getByText('RETIRED')).toBeVisible(); expect(posts).toBe(1);
    expect(accounts[0].effective_to).toBe('2026-09-30');
  });
  it('rejects a second submit before a pending POST returns', async () => {
    let release!: () => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') await new Promise<void>(resolve => { release = resolve; });
      return fetcher(url, options);
    }));
    await ready(); const form = fill('account');
    fireEvent.submit(form); fireEvent.submit(form);
    await act(async () => release());
    await screen.findByText('GL account mapping created.'); expect(posts).toBe(1);
  });
  it('ignores a delayed previous filter body after a new filter has loaded', async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/mappings?') && url.includes('sourceSystemId=OLD')) return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
      if (url.includes('/mappings?') && url.includes('sourceSystemId=NEW')) return Response.json({ mappings: [{ ...account, external_gl_account_code: 'NEW-ACCOUNT', source_system_id: 'NEW' }] });
      return fetcher(url, options);
    }));
    await ready();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'OLD' } });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'NEW' } });
    await screen.findByText('NEW-ACCOUNT');
    await act(async () => release({ mappings: [account] }));
    expect(screen.getByText('NEW-ACCOUNT')).toBeVisible();
    expect(screen.queryByText('600')).not.toBeInTheDocument();
  });
});
