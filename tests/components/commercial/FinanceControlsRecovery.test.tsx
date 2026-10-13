import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceControlsPage from '@/app/commercial/budgeting/finance-controls/page';
import { FinanceSetupAccessProvider } from '@/app/commercial/_components/FinanceWorkflow';

const close = { id: 'close', close_sequence: 1, status: 'CLOSED', closed_at: '2026-09-30T00:00:00Z', close_reason: null, reconciliation_status: 'PENDING', control_totals: {}, invalidated_at: null, invalidation_reason: null };
const calendar = { id: 'year', name: 'FY', starts_on: '2026-07-01', ends_on: '2027-06-30', status: 'OPEN', closes: [] as typeof close[], periods: [{ id: 'period', name: 'QTR 1', starts_on: '2026-07-01', ends_on: '2026-09-30', status: 'OPEN', closes: [] as typeof close[] }] };
const reconciliation = { id: 'recon', financialYearId: 'year', financialYearName: 'FY', financialPeriodId: 'period', financialPeriodName: 'QTR 1', sourceSystemId: 'OLD', currency: 'AUD', status: 'PREPARED', closeId: null as string | null, sourceActualCents: '10000', financeAdjustmentCents: '0', brainbaseEffectiveActualCents: '10000', externalGlTotalCents: '10000', varianceCents: '0', unresolvedItemCount: 0, snapshotAt: '2026-09-30T00:00:00Z', preparedAt: '2026-09-30T00:00:00Z', reviewedAt: null, notes: null };
let year: typeof calendar, recon: typeof reconciliation, broken: string, mode: string, posts: number;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => { if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView; });
async function fetcher(url: string, options?: RequestInit) {
  if (options?.method === 'POST') {
    posts++;
    if (mode === 'reject') return Response.json({ error: 'Governed rejection.' }, { status: 409 });
    const status = url.endsWith('/reopen') ? 'INVALIDATED' : url.endsWith('/close') ? 'CLOSED' : url.endsWith('/review') ? 'REVIEWED' : url.endsWith('/sign-off') ? 'SIGNED_OFF' : 'PREPARED';
    if (url.includes('/financial-years/')) { year.status = status === 'INVALIDATED' ? 'OPEN' : 'CLOSED'; }
    else if (url.includes('/financial-periods/')) {
      year.periods[0].status = status === 'INVALIDATED' ? 'OPEN' : 'CLOSED';
      year.periods[0].closes = [{ ...close, status }];
    } else recon.status = status;
    if (mode === 'lost') throw new Error('Response lost after commit');
    if (mode === 'malformed') return Response.json({});
    if (mode === 'readback') broken = 'sources';
    const saved = url.includes('/financial-years/') ? { year }
      : url.includes('/financial-periods/') ? { close: { ...close, status, financial_period_id: 'period' } }
      : { reconciliation: { ...recon, status, ...(url.endsWith('/sign-off') ? { closeId: 'close' } : {}) } };
    if (mode === 'wrong-record') {
      if ('year' in saved) saved.year = { ...year, id: 'other-year' };
      else if ('close' in saved) saved.close = { ...saved.close!, financial_period_id: 'other-period' };
      else saved.reconciliation = { ...saved.reconciliation!, id: 'other-recon', sourceSystemId: 'OTHER' };
    }
    return Response.json(saved);
  }
  if (url.includes('/finance-adjustments/review')) { const query=new URL(url,'http://localhost').searchParams; return Response.json({report:{scope:{periodId:query.get('periodId'),currency:query.get('currency'),status:query.get('status')??''},page:Number(query.get('page')??1),pageSize:25,totalCount:0,adjustments:[]}}); }
  if (broken && url.includes(broken)) return Response.json({});
  if (url.includes('/financial-periods')) return Response.json({ years: [year] });
  if (url.includes('/sources')) return Response.json({ sourceSystemIds: ['OLD', 'NEW'] });
  return Response.json({ reconciliations: [recon] });
}
beforeEach(() => { year = structuredClone(calendar); recon = structuredClone(reconciliation); broken = ''; mode = ''; posts = 0; vi.stubGlobal('fetch', vi.fn(fetcher)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function ready() { render(<FinanceControlsPage />); await waitFor(() => expect(screen.getByRole('button', { name: 'Close period' })).toBeEnabled()); }
async function refresh() {
  broken = ''; fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/Finance controls refreshed/);
  expect(screen.getByRole('heading', { name: 'Finance controls' })).toHaveFocus();
}

describe('Finance control recovery', () => {
  it('displays calendar boundaries day first', async () => {
    await ready(); expect(screen.getAllByText('01/07/2026')).toHaveLength(2);
    expect(screen.getByText('30/06/2027')).toBeVisible();
    expect(screen.queryByText('2026-07-01')).not.toBeInTheDocument();
  });
  it.each(['financialPeriodId', 'financialYearId', 'sourceSystemId', 'currency'])('rejects a reconciliation outside selected %s scope', async field => {
    if (field === 'currency') {
      await ready(); recon.currency = 'USD';
      fireEvent.change(screen.getByLabelText('Reconciliation currency'), { target: { value: 'AUD' } });
    } else {
      Object.assign(recon, { [field]: 'OTHER' }); render(<FinanceControlsPage />);
    }
    await screen.findByText('The saved reconciliation control view is incomplete.');
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });
  it.each(['calendar', 'history', 'reconciliation'])('rejects invalid saved %s dates', async kind => {
    if (kind === 'calendar') year.starts_on = '2026-02-30';
    if (kind === 'history') year.periods[0].closes = [{ ...close, closed_at: 'not-a-date' }];
    if (kind === 'reconciliation') recon.preparedAt = '2026-02-30T00:00:00Z';
    render(<FinanceControlsPage />); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
  });
  it.each(['Close financial year', 'Close period', 'Review'])('pauses on a successful %s acknowledgement for a different target', async action => {
    await ready(); mode = 'wrong-record';
    const beforeReads = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method !== 'POST').length;
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText(/finance action was saved/);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method !== 'POST')).toHaveLength(beforeReads);
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
    await refresh(); expect(posts).toBe(1);
  });

  it('distinguishes a complete empty calendar from unavailable configuration', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/financial-periods') ? { years: [] } : { sourceSystemIds: [] })));
    render(<FinanceSetupAccessProvider allowed><FinanceControlsPage /></FinanceSetupAccessProvider>);
    await screen.findByText('Create your financial year and periods in Finance setup before using finance controls.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No reconciliation snapshots match the current scope.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
  });
  it('rejects unsafe numeric finance amounts and retains exact large strings on recovery', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => url.includes('control-state') && !options?.method ? Response.json({ reconciliations: [{ ...recon, sourceActualCents: 9007199254740992 }] }) : fetcher(url, options)));
    render(<FinanceControlsPage />); await screen.findByText('The saved reconciliation control view is incomplete.');
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
    recon.sourceActualCents = '900719925474099312'; vi.stubGlobal('fetch', vi.fn(fetcher));
    await refresh();
    expect(screen.getByText('$9,007,199,254,740,993.12')).toBeVisible();
  });
  it.each(['financial-periods', 'sources', 'control-state'])('pauses all actions when %s is incomplete', async endpoint => {
    broken = endpoint; render(<FinanceControlsPage />); await screen.findByRole('alert');
    expect(screen.queryByText('No reconciliation snapshots match the current scope.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Prepare reconciliation' })); expect(posts).toBe(0);
    await refresh(); expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled(); expect(posts).toBe(0);
  });
  it.each(['Close financial year', 'Reopen financial year', 'Close period', 'Reopen period', 'Prepare reconciliation', 'Review', 'Sign off'])('recovers a committed %s without repeating the action', async action => {
    if (action === 'Reopen financial year') year.status = 'CLOSED';
    if (action === 'Reopen period' || action === 'Sign off') { year.periods[0].status = 'CLOSED'; year.periods[0].closes = [close]; }
    if (action === 'Sign off') recon.status = 'REVIEWED';
    render(<FinanceControlsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    if (action === 'Reopen financial year') fireEvent.change(screen.getByLabelText('Year reopen reason (required)'), { target: { value: 'Review saved year' } });
    if (action === 'Reopen period') fireEvent.change(screen.getByLabelText('Reopen reason (required)'), { target: { value: 'Review saved period' } });
    if (action === 'Prepare reconciliation') fireEvent.change(screen.getByLabelText('Reconciliation currency'), { target: { value: 'AUD' } });
    await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled());
    mode = 'lost'; fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText(/finance action outcome could not be confirmed/);
    expect(screen.getByRole('button', { name: action })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: action })); expect(posts).toBe(1);
    broken = 'sources'; fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Prepare reconciliation' })).toBeDisabled();
    await refresh(); expect(posts).toBe(1);
  });
  it.each(['malformed', 'readback', 'wrong-record'])('retains notes and pauses after a confirmed action with %s failure', async failure => {
    await ready(); fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Retain this note' } }); mode = failure;
    fireEvent.click(screen.getByRole('button', { name: 'Review' })); await screen.findByText(/finance action was saved/);
    expect(screen.getByLabelText('Notes')).toHaveValue('Retain this note');
    await refresh(); expect(screen.getByLabelText('Notes')).toHaveValue(''); expect(posts).toBe(1);
  });
  it('retains editable reasons after an authoritative rejection', async () => {
    await ready(); mode = 'reject'; fireEvent.change(screen.getByLabelText('Close reason (optional)'), { target: { value: 'Review close' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close period' })); await screen.findByText('Governed rejection.');
    expect(screen.getByRole('button', { name: 'Close period' })).toBeEnabled(); expect(screen.getByLabelText('Close reason (optional)')).toHaveValue('Review close');
  });
  it('holds the synchronous action lock through readback', async () => {
    let release!: () => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => { if (options?.method === 'POST') await new Promise<void>(resolve => { release = resolve; }); return fetcher(url, options); }));
    await ready(); fireEvent.click(screen.getByRole('button', { name: 'Review' })); fireEvent.click(screen.getByRole('button', { name: 'Close period' }));
    await act(async () => release()); await screen.findByText('Finance reconciliation reviewed.'); expect(posts).toBe(1);
  });
  it('ignores a delayed old-source body after a new scope is loaded', async () => {
    let delay = false; let release!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (delay && url.includes('control-state') && url.includes('sourceSystemId=OLD')) return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
      if (url.includes('control-state') && url.includes('sourceSystemId=NEW')) return Response.json({ reconciliations: [{ ...recon, sourceSystemId: 'NEW', status: 'STALE' }] });
      return fetcher(url, options);
    }));
    await ready(); delay = true; fireEvent.change(screen.getByLabelText('Reconciliation currency'), { target: { value: 'AUD' } });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('External GL source'), { target: { value: 'NEW' } }); await screen.findByText('STALE');
    await act(async () => release({ reconciliations: [recon] }));
    expect(screen.getByText('STALE')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });
});
