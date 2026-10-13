import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalGlEntryImport } from '@/app/commercial/budgeting/external-gl/ExternalGlEntryImport';
import { ledgerDraft, savedEntry } from '../../fixtures/commercialLedgerImport';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const labels = ['Ledger source','External entry identity','External account code','Transaction date','Entry currency','Signed entry amount','Source evidence hash','Source lineage reference'];
const values = [ledgerDraft.sourceSystemId, ledgerDraft.externalEntryId, ledgerDraft.externalAccountCode, ledgerDraft.transactionDate, ledgerDraft.currency, ledgerDraft.amountMinorUnits, ledgerDraft.sourcePayloadHash, ledgerDraft.sourceLineageId];
function fill() { labels.forEach((label, i) => fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value: values[i] } })); fireEvent.submit(screen.getByRole('form', { name: 'Prepare ledger entry' })); }
function setup(fetcher: ReturnType<typeof vi.fn>, disabled = false) { vi.stubGlobal('fetch', fetcher); const onSaved = vi.fn(); render(<ExternalGlEntryImport disabled={disabled} onSaved={onSaved} />); return onSaved; }

describe('Ledger entry review, import and read-only recovery', () => {
  it('previews exact signed money and Australian date without sending a request; cancel restores input focus', async () => {
    const fetcher = vi.fn(); setup(fetcher); fill();
    const review = screen.getByRole('region', { name: 'Review ledger import' });
    expect(within(review).getByText('-$90,071,992,547,409.93')).toBeVisible(); expect(within(review).getByText('10/09/2026')).toBeVisible();
    expect(review).toHaveFocus(); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import review' }));
    await waitFor(() => expect(screen.getByLabelText(/External entry identity/)).toHaveFocus());
    expect(screen.getByLabelText(/Signed entry amount/)).toHaveValue(ledgerDraft.amountMinorUnits);
  });
  it.each(['IMPORTED','IDEMPOTENT'])('accepts a complete matching %s receipt', async outcome => {
    const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>().mockResolvedValue(Response.json({ outcome, entry: savedEntry, staleReconciliationCount: 0 })); const onSaved = setup(fetcher); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' }));
    await screen.findByRole('region', { name: 'Saved ledger entry' });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ amountMinorUnits: '-9007199254740993', transactionDate: '2026-09-10', currency: 'AUD', sourcePayloadHash: ledgerDraft.sourcePayloadHash });
    expect(onSaved).toHaveBeenCalledOnce(); expect(screen.queryByRole('region', { name: 'Review ledger import' })).not.toBeInTheDocument();
  });
  it('reports affected stale snapshots from the receipt', async () => {
    setup(vi.fn(async () => Response.json({ outcome: 'IMPORTED', entry: savedEntry, staleReconciliationCount: 2 }))); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 reconciliation snapshot(s) became stale');
  });
  it.each(['network','incomplete','wrong-facts','server-error'])('pauses an uncertain %s result and recovers by GET without another POST', async failure => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return Response.json({ entry: savedEntry });
      if (failure === 'network') throw new Error('Lost response');
      return Response.json(failure === 'incomplete' ? { outcome: 'IMPORTED' } : { outcome: 'IMPORTED', entry: { ...savedEntry, amount_minor_units: '1' }, staleReconciliationCount: 0 }, { status: failure === 'server-error' ? 500 : 200 });
    }); const onSaved = setup(fetcher); fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' }));
    await screen.findByText(/import outcome is unconfirmed/); expect(screen.getByRole('button', { name: 'Confirm entry import' })).toBeDisabled();
    expect(screen.getByLabelText(/External entry identity/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved entry' }));
    await screen.findByText(/exact entry is confirmed/); expect(onSaved).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls[1][0]).toContain('sourceSystemId=XERO&externalEntryId=entry-1');
  });
  it('retains the recovery lock when readback is absent, wrong-scope or malformed', async () => {
    let read: unknown = { entry: null };
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => { if (options?.method === 'POST') throw new Error(); return Response.json(read); }); setup(fetcher); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' })); await screen.findByRole('alert');
    for (read of [{ entry: null }, {}, { entry: { ...savedEntry, source_system_id: 'OTHER' } }]) {
      fireEvent.click(screen.getByRole('button', { name: 'Check saved entry' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Check saved entry' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Confirm entry import' })).toBeDisabled();
      expect(screen.getByLabelText(/Signed entry amount/)).toHaveValue(ledgerDraft.amountMinorUnits);
    }
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('shows the existing immutable conflict and starts a separate entry without overwriting it', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => Response.json(options?.method === 'POST' ? { error: 'Identity conflict' } : { entry: { ...savedEntry, amount_minor_units: '1' } }, { status: options?.method === 'POST' ? 409 : 200 })); setup(fetcher); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' })); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Check saved entry' })); await screen.findByText(/already has different saved facts/);
    expect(screen.getByRole('region', { name: 'Saved ledger entry' })).toHaveTextContent('$0.01');
    fireEvent.click(screen.getByRole('button', { name: 'Start another entry' }));
    expect(screen.getByLabelText(/External entry identity/)).toHaveValue(''); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('prevents simultaneous double submission and keeps review fields locked in flight', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); setup(fetcher); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm entry import' }));
    expect(fetcher).toHaveBeenCalledOnce(); expect(screen.getByLabelText(/Ledger source/)).toBeDisabled();
    await act(async () => resolve(Response.json({ outcome: 'IMPORTED', entry: savedEntry, staleReconciliationCount: 0 })));
  });
  it('keeps mutations unavailable while parent scope is locked', () => {
    const fetcher = vi.fn(); setup(fetcher, true); fill(); expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review ledger entry' })).toBeDisabled(); expect(screen.queryByRole('region', { name: 'Review ledger import' })).not.toBeInTheDocument();
  });
  it('blocks invalid precision and impossible dates before creating a review', () => {
    const fetcher = vi.fn(); setup(fetcher); fill(); fireEvent.click(screen.getByRole('button', { name: 'Cancel import review' }));
    fireEvent.change(screen.getByLabelText(/Signed entry amount/), { target: { value: '1.001' } }); fireEvent.submit(screen.getByRole('form', { name: 'Prepare ledger entry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('two decimal places'); expect(fetcher).not.toHaveBeenCalled();
  });
});
