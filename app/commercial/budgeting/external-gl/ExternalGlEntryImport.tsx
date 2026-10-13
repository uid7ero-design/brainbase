'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emptyLedgerDraft, prepareLedgerImport, savedLedgerMatches, validSavedLedgerEntry, type LedgerImportDraft, type LedgerImportInput, type SavedLedgerEntry } from '@/lib/commercial/externalGlImportDisplay';
import { formatAustralianDate, formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { buttonProps, fieldControlClassName } from '@/components/ui/app';
import styles from './page.module.css';

const endpoint = '/api/commercial/budgeting/external-gl/entries';
const fields: Array<[keyof LedgerImportDraft, string, boolean]> = [
  ['sourceSystemId', 'Ledger source', true], ['externalEntryId', 'External entry identity', true], ['externalAccountCode', 'External account code', true],
  ['transactionDate', 'Transaction date (DD/MM/YYYY)', true], ['currency', 'Entry currency', true], ['amountMinorUnits', 'Signed entry amount', true],
  ['sourcePayloadHash', 'Source evidence hash', true], ['sourceLineageId', 'Source lineage reference', true],
  ['externalJournalId', 'External journal reference', false], ['externalCostCentreCode', 'External cost-centre code', false],
  ['accountingPeriodKey', 'External period reference', false], ['description', 'Entry description', false],
];

export function ExternalGlEntryImport({ disabled, onSaved }: { disabled: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<LedgerImportDraft>({ ...emptyLedgerDraft });
  const [pending, setPending] = useState<LedgerImportInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedLedgerEntry | null>(null);
  const [different, setDifferent] = useState(false);
  const inFlight = useRef(false);
  const review = useRef<HTMLDivElement>(null);
  const entryInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { if (pending) review.current?.focus(); else if (returnFocus.current) { returnFocus.current = false; entryInput.current?.focus(); } }, [pending]);

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (disabled || inFlight.current || recovery || pending) return;
    setError(null); setNotice(null); setSaved(null); setDifferent(false);
    try { setPending(prepareLedgerImport(draft)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the entry details.'); }
  }

  async function submit() {
    if (!pending || disabled || inFlight.current || recovery) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const data = await response.json();
      if (!response.ok) {
        if ([400, 401, 403, 404].includes(response.status)) {
          setPending(null); setError(typeof data?.error === 'string' ? data.error : 'Entry import was rejected. Check the details and access.');
          return;
        }
        throw new Error('The import result needs checking.');
      }
      if (!['IMPORTED', 'IDEMPOTENT'].includes(data?.outcome) || !Number.isSafeInteger(data?.staleReconciliationCount) || data.staleReconciliationCount < 0
        || !validSavedLedgerEntry(data?.entry) || !savedLedgerMatches(data.entry, pending)) throw new Error('Incomplete or different import receipt.');
      setSaved(data.entry); setPending(null);
      setNotice(data.outcome === 'IDEMPOTENT' ? 'This exact entry was already saved. No duplicate was created.' : 'Ledger entry saved.');
      if (data.staleReconciliationCount > 0) setNotice(`Ledger entry saved. ${data.staleReconciliationCount} reconciliation snapshot(s) became stale. Review Finance controls.`);
      onSaved();
    } catch {
      setRecovery(true); setError('The import outcome is unconfirmed. Check the saved entry before making another import. This action will not resend the import.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function checkSaved() {
    if (!pending || disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const query = new URLSearchParams({ sourceSystemId: pending.sourceSystemId, externalEntryId: pending.externalEntryId });
      const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data || typeof data !== 'object' || !Object.hasOwn(data, 'entry')) throw new Error();
      if (data.entry === null) {
        setNotice(recovery ? 'No saved entry is visible yet. Check again; the import has not been resent.' : 'No saved entry exists for this source and identity. Review before importing.');
        return;
      }
      if (!validSavedLedgerEntry(data.entry) || data.entry.source_system_id !== pending.sourceSystemId || data.entry.external_entry_id !== pending.externalEntryId) throw new Error();
      setSaved(data.entry);
      if (!savedLedgerMatches(data.entry, pending)) {
        setRecovery(true); setDifferent(true); setError('This identity already has different saved facts. The saved entry cannot be overwritten. Start another entry only with its own source identity.');
        return;
      }
      setRecovery(false); setPending(null); setNotice('The exact entry is confirmed in saved records. No import was resent. Review reconciliation status in Finance controls.');
      onSaved();
    } catch { setError('Unable to check a complete saved entry for this source and identity. Retain the details and try the read-only check again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section aria-label="Ledger entry import" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 18 }}>
    <h2 style={{ fontSize: 16, marginTop: 0 }}>Import a ledger entry</h2>
    <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Enter one entry from your external ledger, using its original identity, evidence hash (at least 32 characters) and lineage reference. Amounts use two decimal places; negative entries are supported. Mapping and reconciliation remain separate steps. A new or conflicting fact can make affected reconciliation evidence stale.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <form aria-label="Prepare ledger entry" onSubmit={prepare}>
      <fieldset disabled={disabled || busy || !!pending || recovery} className={styles.mappingGrid}>
        {fields.map(([key, label, required]) => <label key={key} style={{ display: 'grid', gap: 5, fontSize: 12 }}>{label}{required ? ' · Required' : ''}
          <input ref={key === 'externalEntryId' ? entryInput : undefined} required={required} maxLength={key === 'description' ? 1000 : 300}
            placeholder={key === 'transactionDate' ? 'DD/MM/YYYY' : key === 'amountMinorUnits' ? '100.00 or -100.00' : undefined}
            value={draft[key]} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setSaved(null); setNotice(null); }} className={fieldControlClassName} />
        </label>)}
        <button type="submit" {...buttonProps('primary', 'sm')}>Review ledger entry</button>
      </fieldset>
    </form>
    {pending ? <div ref={review} role="region" aria-label="Review ledger import" tabIndex={-1} style={{ marginTop: 18, overflowWrap: 'anywhere' }}>
      <h3 style={{ fontSize: 14 }}>Review before import</h3>
      <dl>{fields.map(([key, label]) => <div key={key} style={{ marginBottom: 8 }}><dt style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</dt>
        <dd style={{ margin: 0 }}>{key === 'amountMinorUnits' ? formatMoneyCentsExact(pending.amountMinorUnits, pending.currency) : key === 'transactionDate' ? formatAustralianDate(pending.transactionDate) : pending[key] ?? 'Not supplied'}</dd></div>)}</dl>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={disabled || busy || recovery} onClick={() => void submit()} {...buttonProps('primary', 'sm')}>Confirm entry import</button>
        <button type="button" disabled={disabled || busy} onClick={() => void checkSaved()} {...buttonProps('secondary', 'sm')}>Check saved entry</button>
        {!recovery ? <button type="button" disabled={busy} onClick={() => { returnFocus.current = true; setPending(null); setNotice(null); setError(null); }} {...buttonProps('secondary', 'sm')}>Cancel import review</button> : null}
        {different ? <button type="button" disabled={disabled || busy} onClick={() => { returnFocus.current = true; setDraft({ ...emptyLedgerDraft }); setPending(null); setRecovery(false); setDifferent(false); setSaved(null); setError(null); setNotice(null); }} {...buttonProps('secondary', 'sm')}>Start another entry</button> : null}
      </div>
    </div> : null}
    {saved ? <div role="region" aria-label="Saved ledger entry" style={{ marginTop: 18, overflowWrap: 'anywhere' }}>
      <strong>{saved.source_system_id} · {saved.external_entry_id}</strong>
      <p>{formatMoneyCentsExact(saved.amount_minor_units, saved.currency)} · {formatAustralianDate(saved.transaction_date)} · Account {saved.external_account_code}</p>
      <p style={{ fontSize: 12 }}>Saved record {saved.id} · Imported {formatAustralianTimestamp(saved.imported_at)}</p>
      <p style={{ fontSize: 12 }}>Evidence hash: {saved.source_payload_hash} · Lineage: {saved.source_lineage_id}</p>
    </div> : null}
  </section>;
}
