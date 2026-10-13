'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FinanceAdjustmentReview } from './FinanceAdjustmentReview';
import { formatAustralianDate, formatAustralianTimestamp, isFinanceCalendarDate, isFinanceAuditTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { FinanceWorkflow } from '../../_components/FinanceWorkflow';
import { buttonProps, fieldControlClassName, TableContainer, tableStyles } from '@/components/ui/app';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import {
  financePeriodCloseHref,
  financePeriodReopenHref,
  financeYearCloseHref,
  financeYearReopenHref,
  financeReconciliationAction,
  financeReconciliationReviewHref,
  financeReconciliationSignOffHref,
} from '@/lib/commercial/financeControlUi';

const CARD = 'var(--bg-surface)';
const BORDER = 'var(--border)';
const MUTED = 'var(--text-muted)';
const INPUT_BG = 'var(--bg-sunken)';

type CloseStatus = 'CLOSED' | 'INVALIDATED';
type PeriodStatus = 'OPEN' | 'CLOSED';
type ReconciliationStatus = 'PREPARED' | 'REVIEWED' | 'SIGNED_OFF' | 'STALE';

type CloseRecord = {
  id: string;
  close_sequence: number;
  status: CloseStatus;
  closed_at: string;
  close_reason: string | null;
  reconciliation_status: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
};

type FinancialPeriod = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: PeriodStatus;
  closes: CloseRecord[];
};

type YearCloseRecord = {
  id: string;
  close_sequence: number;
  status: CloseStatus;
  closed_at: string;
  close_reason: string | null;
  control_totals: Record<string, unknown>;
  invalidated_at: string | null;
  invalidation_reason: string | null;
};

type FinancialYear = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: PeriodStatus;
  closes: YearCloseRecord[];
  periods: FinancialPeriod[];
};

type ReconciliationState = {
  id: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  sourceSystemId: string;
  currency: string;
  status: ReconciliationStatus;
  closeId: string | null;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlTotalCents: string;
  varianceCents: string;
  unresolvedItemCount: number;
  snapshotAt: string;
  preparedAt: string;
  reviewedAt: string | null;
  notes: string | null;
};

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(row: Record<string, unknown>, fields: string[]) { return fields.every(field => typeof row[field] === 'string'); }
function validClose(value: unknown, year: boolean): boolean {
  return record(value) && text(value, ['id', 'closed_at']) && value.id !== ''
    && isFinanceAuditTimestamp(value.closed_at) && (value.invalidated_at === null || isFinanceAuditTimestamp(value.invalidated_at))
    && Number.isSafeInteger(value.close_sequence) && Number(value.close_sequence) > 0
    && (value.status === 'CLOSED' || value.status === 'INVALIDATED')
    && ['close_reason', 'invalidated_at', 'invalidation_reason'].every(field => value[field] === null || typeof value[field] === 'string')
    && (year ? record(value.control_totals) : typeof value.reconciliation_status === 'string');
}
function validPeriod(value: unknown, year: boolean): boolean {
  return record(value) && text(value, ['id', 'name', 'starts_on', 'ends_on']) && value.id !== ''
    && isFinanceCalendarDate(value.starts_on) && isFinanceCalendarDate(value.ends_on) && value.ends_on >= value.starts_on
    && (value.status === 'OPEN' || value.status === 'CLOSED')
    && Array.isArray(value.closes) && value.closes.every(close => validClose(close, year))
    && (!year || (Array.isArray(value.periods) && value.periods.every(period => validPeriod(period, false) && record(period) && String(period.starts_on) >= String(value.starts_on) && String(period.ends_on) <= String(value.ends_on))));
}
function validReconciliation(value: unknown): boolean {
  return record(value) && text(value, ['id', 'financialYearId', 'financialYearName', 'financialPeriodId', 'financialPeriodName', 'sourceSystemId', 'currency', 'snapshotAt', 'preparedAt'])
    && isFinanceAuditTimestamp(value.snapshotAt) && isFinanceAuditTimestamp(value.preparedAt)
    && (value.reviewedAt === null || isFinanceAuditTimestamp(value.reviewedAt))
    && value.id !== '' && ['PREPARED', 'REVIEWED', 'SIGNED_OFF', 'STALE'].includes(String(value.status))
    && ['closeId', 'reviewedAt', 'notes'].every(field => value[field] === null || typeof value[field] === 'string')
    && ['sourceActualCents', 'financeAdjustmentCents', 'brainbaseEffectiveActualCents', 'externalGlTotalCents', 'varianceCents'].every(field => typeof value[field] === 'string' && /^-?(0|[1-9]\d*)$/.test(value[field] as string))
    && Number.isSafeInteger(value.unresolvedItemCount) && Number(value.unresolvedItemCount) >= 0;
}

export default function FinanceControlsPage() {
  const [adjustmentRevision,setAdjustmentRevision]=useState(0);
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [selectedYearId, setSelectedYearId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [sourceSystemId, setSourceSystemId] = useState('');
  const [currency, setCurrency] = useState('');
  const [reconciliations, setReconciliations] = useState<ReconciliationState[]>([]);
  const [yearCloseReason, setYearCloseReason] = useState('');
  const [yearReopenReason, setYearReopenReason] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const serial = useRef(0);
  const operation = useRef(false);
  const blocked = useRef(true);
  const recoveryRequired = useRef(false);
  const loadedScope = useRef('');
  const [savedScope, setSavedScope] = useState('');
  const review = useRef<HTMLHeadingElement>(null);
  const scopeKey = JSON.stringify([selectedYearId, selectedPeriodId, sourceSystemId, currency.trim().toUpperCase()]);
  const locked = loading || working || needsReload || !loaded || savedScope !== scopeKey;
  const invalidateReads = useCallback(() => { serial.current++; }, []);

  const selectedYear = useMemo(
    () => years.find(year => year.id === selectedYearId) ?? null,
    [years, selectedYearId],
  );
  const selectedPeriod = useMemo(
    () => selectedYear?.periods.find(period => period.id === selectedPeriodId)
      ?? selectedYear?.periods[0]
      ?? null,
    [selectedYear, selectedPeriodId],
  );
  const effectiveSelectedPeriodId = selectedPeriod?.id ?? '';
  const activeClose = useMemo(
    () => selectedPeriod?.closes.find(close => close.status === 'CLOSED') ?? null,
    [selectedPeriod],
  );

  const loadSnapshot = useCallback(async () => {
    const request = ++serial.current;
    blocked.current = true;
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all([
        fetch('/api/commercial/budgeting/financial-periods', { cache: 'no-store' }),
        fetch('/api/commercial/budgeting/external-gl/sources', { cache: 'no-store' }),
      ]);
      if (request !== serial.current) return false;
      if (responses.some(response => response.status === 403)) throw new Error('Budgeting administrator access is required to operate finance controls.');
      if (responses.some(response => !response.ok)) throw new Error('Unable to load finance control configuration.');
      const [periodData, sourceData] = await Promise.all(responses.map(response => response.json()));
      if (request !== serial.current) return false;
      if (!Array.isArray(periodData?.years) || !periodData.years.every((year: unknown) => validPeriod(year, true))
        || !Array.isArray(sourceData?.sourceSystemIds) || !sourceData.sourceSystemIds.every((value: unknown) => typeof value === 'string')) throw new Error('The saved finance control view is incomplete.');
      const nextYears = periodData.years as FinancialYear[];
      const nextSources = sourceData.sourceSystemIds as string[];
      const nextYear = !selectedYearId && loadedScope.current ? undefined : nextYears.find(year => year.id === selectedYearId) ?? nextYears[0];
      const nextPeriod = nextYear?.periods.find(period => period.id === selectedPeriodId) ?? nextYear?.periods[0];
      const nextSource = !sourceSystemId && loadedScope.current ? '' : nextSources.includes(sourceSystemId) ? sourceSystemId : nextSources[0] ?? '';
      let nextReconciliations: ReconciliationState[] = [];
      if (nextPeriod) {
        const params = new URLSearchParams({ financialPeriodId: nextPeriod.id });
        if (nextSource) params.set('sourceSystemId', nextSource);
        if (currency.trim()) params.set('currency', currency.trim().toUpperCase());
        const response = await fetch(`/api/commercial/budgeting/reconciliations/control-state?${params.toString()}`, { cache: 'no-store' });
        if (request !== serial.current) return false;
        if (!response.ok) throw new Error(response.status === 403 ? 'Budgeting administrator access is required to operate finance controls.' : 'Unable to load reconciliation control state.');
        const payload = await response.json();
        if (request !== serial.current) return false;
        if (!Array.isArray(payload?.reconciliations) || !payload.reconciliations.every((row: unknown) => validReconciliation(row) && record(row)
          && row.financialYearId === nextYear?.id && row.financialPeriodId === nextPeriod.id
          && (!nextSource || row.sourceSystemId === nextSource)
          && (!currency.trim() || row.currency === currency.trim().toUpperCase()))) throw new Error('The saved reconciliation control view is incomplete.');
        nextReconciliations = payload.reconciliations;
      }
      loadedScope.current = JSON.stringify([nextYear?.id ?? '', nextPeriod?.id ?? '', nextSource, currency.trim().toUpperCase()]);
      setSavedScope(loadedScope.current);
      setYears(nextYears); setSources(nextSources); setReconciliations(nextReconciliations);
      setSelectedYearId(nextYear?.id ?? ''); setSelectedPeriodId(nextPeriod?.id ?? ''); setSourceSystemId(nextSource);
      setAdjustmentRevision(value=>value+1);
      setLoaded(true); setNeedsReload(false); blocked.current = false; recoveryRequired.current = false;
      return true;
    } catch (failure) {
      if (request !== serial.current) return false;
      recoveryRequired.current = true; setNeedsReload(true);
      setError(failure instanceof Error ? failure.message : 'Unable to load finance control configuration.');
      return false;
    } finally { if (request === serial.current) setLoading(false); }
  }, [currency, selectedYearId, selectedPeriodId, sourceSystemId]);

  useEffect(() => {
    if (operation.current || recoveryRequired.current) return;
    if (loadedScope.current === scopeKey && !blocked.current) return;
    const timer = window.setTimeout(() => {
      if (!operation.current && !recoveryRequired.current) void loadSnapshot();
    }, 0);
    return () => { window.clearTimeout(timer); invalidateReads(); };
  }, [loadSnapshot, scopeKey, invalidateReads]);

  function changeScope(change: () => void) {
    if (operation.current || recoveryRequired.current) return;
    invalidateReads(); blocked.current = true; setLoading(true); setNotice(null); change();
  }

  async function refreshControls() {
    if (operation.current || loading) return;
    operation.current = true; setWorking(true); setNotice(null);
    try {
      if (!await loadSnapshot()) return;
      setYearCloseReason(''); setYearReopenReason(''); setCloseReason(''); setReopenReason(''); setNotes('');
      setNotice('Finance controls refreshed. Review the saved state before continuing. Unsaved reasons and notes have been cleared.');
      review.current?.focus({ preventScroll: true }); review.current?.scrollIntoView({ block: 'start' });
    } finally { operation.current = false; setWorking(false); }
  }

  async function postJson(url: string, body: Record<string, unknown>) {
    if (operation.current || blocked.current || locked) return false;
    operation.current = true; blocked.current = true; invalidateReads();
    setWorking(true); setError(null); setNotice(null);
    let outcome: 'sent' | 'confirmed' | 'rejected' = 'sent';
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      outcome = response.ok ? 'confirmed' : response.status < 500 ? 'rejected' : 'sent';
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'The finance control action could not be completed.');
      const yearAction = url.includes('/financial-years/');
      const periodAction = url.includes('/financial-periods/');
      const saved = yearAction ? payload?.year : periodAction ? payload?.close : payload?.reconciliation;
      const targetId = decodeURIComponent(url.split('/').at(-2)!);
      const expected = yearAction ? { id: selectedYearId }
        : periodAction ? { financial_period_id: effectiveSelectedPeriodId,
          ...(url.endsWith('/reopen') ? { id: activeClose?.id } : {}) }
        : { financialPeriodId: effectiveSelectedPeriodId,
          ...(url.endsWith('/prepare')
            ? { sourceSystemId: body.sourceSystemId, currency: body.currency }
            : { id: targetId, sourceSystemId: reconciliations.find(row => row.id === targetId)?.sourceSystemId,
              currency: reconciliations.find(row => row.id === targetId)?.currency }),
          ...(url.endsWith('/sign-off') ? { closeId: body.closeId } : {}) };
      const expectedStatus = url.endsWith('/reopen') ? (yearAction ? 'OPEN' : 'INVALIDATED') : url.endsWith('/close') ? 'CLOSED' : url.endsWith('/review') ? 'REVIEWED' : url.endsWith('/sign-off') ? 'SIGNED_OFF' : 'PREPARED';
      if (!record(saved) || typeof saved.id !== 'string' || saved.id === '' || saved.status !== expectedStatus
        || !Object.entries(expected).every(([key, value]) => value !== undefined && saved[key] === value)) throw new Error('Incomplete finance action response.');
      if (!await loadSnapshot()) throw new Error('Saved finance readback unavailable.');
      return true;
    } catch (failure) {
      if (outcome !== 'rejected') {
        blocked.current = true; recoveryRequired.current = true; setNeedsReload(true);
        setError(outcome === 'confirmed' ? 'The finance action was saved, but its saved state could not be confirmed. Refresh finance controls before continuing.' : 'The finance action outcome could not be confirmed. Refresh finance controls before continuing.');
      } else { blocked.current = false; setError(failure instanceof Error ? failure.message : 'The finance control action could not be completed.'); }
      return false;
    } finally { operation.current = false; setWorking(false); }
  }

  function refreshAfterMutation(message: string) { setNotice(message); }

  async function closeYear() {
    if (operation.current || blocked.current || locked) return;
    if (!selectedYear) return;
    const ok = await postJson(
      financeYearCloseHref(selectedYear.id),
      { reason: yearCloseReason.trim() || null },
    );
    if (!ok) return;
    setYearCloseReason('');
    await refreshAfterMutation('Financial year closed.');
  }

  async function reopenYear(event: FormEvent) {
    event.preventDefault();
    if (operation.current || blocked.current || locked) return;
    if (!selectedYear || !yearReopenReason.trim()) {
      setError('A financial year reopen reason is required.');
      return;
    }
    const ok = await postJson(
      financeYearReopenHref(selectedYear.id),
      { reason: yearReopenReason.trim() },
    );
    if (!ok) return;
    setYearReopenReason('');
    await refreshAfterMutation('Financial year reopened. Prior year-close evidence remains as invalidated history.');
  }

  async function closePeriod() {
    if (operation.current || blocked.current || locked) return;
    if (!selectedPeriod) return;
    const ok = await postJson(
      financePeriodCloseHref(selectedPeriod.id),
      { reason: closeReason.trim() || null },
    );
    if (!ok) return;
    setCloseReason('');
    await refreshAfterMutation('Financial period closed.');
  }

  async function reopenPeriod(event: FormEvent) {
    event.preventDefault();
    if (operation.current || blocked.current || locked) return;
    if (!selectedPeriod || !reopenReason.trim()) {
      setError('A reopen reason is required.');
      return;
    }
    const ok = await postJson(
      financePeriodReopenHref(selectedPeriod.id),
      { reason: reopenReason.trim() },
    );
    if (!ok) return;
    setReopenReason('');
    await refreshAfterMutation('Financial period reopened. Prior close evidence remains as invalidated history.');
  }

  async function prepareReconciliation(event: FormEvent) {
    event.preventDefault();
    if (operation.current || blocked.current || locked) return;
    const cleanCurrency = currency.trim().toUpperCase();
    if (!effectiveSelectedPeriodId || !sourceSystemId || !/^[A-Z]{3}$/.test(cleanCurrency)) {
      setError('Choose a period and source, and enter a three-letter currency code.');
      return;
    }
    const ok = await postJson('/api/commercial/budgeting/reconciliations/prepare', {
      financialPeriodId: effectiveSelectedPeriodId,
      sourceSystemId,
      currency: cleanCurrency,
      notes: notes.trim() || null,
    });
    if (!ok) return;
    setNotes('');
    setCurrency(cleanCurrency);
    await refreshAfterMutation('Finance reconciliation prepared.');
  }

  async function reviewReconciliation(id: string) {
    if (operation.current || blocked.current || locked) return;
    const ok = await postJson(
      financeReconciliationReviewHref(id),
      {},
    );
    if (!ok) return;
    await refreshAfterMutation('Finance reconciliation reviewed.');
  }

  async function signOffReconciliation(id: string) {
    if (operation.current || blocked.current || locked) return;
    if (!activeClose) {
      setError('A current CLOSED period record is required before sign-off.');
      return;
    }
    const ok = await postJson(
      financeReconciliationSignOffHref(id),
      { closeId: activeClose.id },
    );
    if (!ok) return;
    await refreshAfterMutation('Finance reconciliation signed off.');
  }

  return (
    <div style={{ maxWidth: 1220 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
          <Link href="/commercial" style={{ color: MUTED }}>Commercial</Link>
          {' / '}
          <Link href="/commercial/budgeting/commitments" style={{ color: MUTED }}>Budgeting</Link>
          {' / Finance controls'}
        </div>
        <h1 ref={review} tabIndex={-1} style={{ margin: 0, fontSize: 24, scrollMarginTop: 200 }}>Finance controls</h1>
        <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 13, lineHeight: 1.6 }}>
          Operate financial-period close/reopen and the governed reconciliation lifecycle.
          Durable close and reconciliation history is preserved; these controls do not delete finance evidence.
        </p>
      </div>

      {error ? <div role="alert" style={errorBox}>{error}</div> : null}
      {notice ? <div role="status" style={noticeBox}>{notice}</div> : null}

      {loading ? <p role="status">Loading saved finance controls…</p> : null}
      {needsReload ? <p>Actions are paused until the complete saved state can be checked. Previously loaded controls may be out of date. Refresh uses read-only requests.</p> : null}
      {!loading && !needsReload && !error && <FinanceWorkflow current="controls" setupHint={years.length === 0 ? 'Create your financial year and periods in Finance setup before using finance controls.' : selectedYear && selectedYear.periods.length === 0 ? 'This financial year has no periods. Add its periods in Finance setup before preparing a reconciliation.' : undefined} />}

      <section style={{ ...panel, marginBottom: 18 }}>
        <h2 style={heading}>Control scope</h2>
        <div style={formGrid}>
          <Field label="Financial year">
            <select value={selectedYearId} onChange={event => { const value = event.target.value; if (value !== selectedYearId) changeScope(() => { setSelectedYearId(value); setSelectedPeriodId(''); }); }} className={fieldControlClassName} disabled={working || needsReload || !loaded}>
              <option value="">Choose year</option>
              {years.map(year => (
                <option key={year.id} value={year.id}>{year.name} — {year.status}</option>
              ))}
            </select>
          </Field>
          <Field label="Financial period">
            <select value={effectiveSelectedPeriodId} onChange={event => { const value = event.target.value; if (value !== selectedPeriodId) changeScope(() => setSelectedPeriodId(value)); }} className={fieldControlClassName} disabled={working || needsReload || !selectedYear}>
              <option value="">Choose period</option>
              {(selectedYear?.periods ?? []).map(period => (
                <option key={period.id} value={period.id}>{period.name} — {period.status}</option>
              ))}
            </select>
          </Field>
          <Field label="External GL source">
            <select value={sourceSystemId} disabled={working || needsReload || !loaded} onChange={event => { const value = event.target.value; if (value !== sourceSystemId) changeScope(() => setSourceSystemId(value)); }} className={fieldControlClassName}>
              <option value="">Choose source</option>
              {sources.map(source => <option key={source} value={source}>{source}</option>)}
            </select>
          </Field>
          <Field label="Currency">
            <input
              value={currency}
              maxLength={3}
              placeholder="AUD"
              disabled={working || needsReload || !loaded} onChange={event => { const value = event.target.value.toUpperCase(); if (value !== currency) changeScope(() => setCurrency(value)); }}
              className={fieldControlClassName}
              aria-label="Reconciliation currency"
            />
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <button type="button" {...buttonProps('secondary', 'sm')} disabled={loading || working} onClick={() => void refreshControls()}>
              Refresh
            </button>
          </div>
        </div>
      </section>

      <YearControlPanel
        year={selectedYear}
        closeReason={yearCloseReason}
        setCloseReason={setYearCloseReason}
        reopenReason={yearReopenReason}
        setReopenReason={setYearReopenReason}
        working={locked}
        onClose={closeYear}
        onReopen={reopenYear}
      />

      <PeriodControlPanel
        period={selectedPeriod}
        activeClose={activeClose}
        closeReason={closeReason}
        setCloseReason={setCloseReason}
        reopenReason={reopenReason}
        setReopenReason={setReopenReason}
        working={locked}
        onClose={closePeriod}
        onReopen={reopenPeriod}
      />

      <section style={{ ...panel, marginBottom: 18 }}>
        <h2 style={heading}>Prepare reconciliation</h2>
        <p style={description}>
          Snapshot BrainBase source actuals and finance adjustments against one explicit External GL source and currency.
        </p>
        <form aria-label="Prepare reconciliation" onSubmit={prepareReconciliation} style={{ display: 'grid', gap: 10 }}>
          <Field label="Notes">
            <textarea disabled={locked} value={notes} onChange={event => setNotes(event.target.value)} rows={2} className={fieldControlClassName} />
          </Field>
          <div>
            <button type="submit" {...buttonProps('primary', 'sm')} disabled={locked || !effectiveSelectedPeriodId || !sourceSystemId}>
              Prepare reconciliation
            </button>
          </div>
        </form>
      </section>

      <FinanceAdjustmentReview periodId={effectiveSelectedPeriodId} currency={currency.trim().toUpperCase()} enabled={!locked} revision={adjustmentRevision} />

      {loaded ? <ReconciliationControlTable
        reconciliations={reconciliations}
        activeClose={activeClose}
        working={locked}
        onReview={reviewReconciliation}
        onSignOff={signOffReconciliation}
      /> : <p>Saved reconciliation controls are not available yet.</p>}
    </div>
  );
}

function YearControlPanel({
  year,
  closeReason,
  setCloseReason,
  reopenReason,
  setReopenReason,
  working,
  onClose,
  onReopen,
}: {
  year: FinancialYear | null;
  closeReason: string;
  setCloseReason: (value: string) => void;
  reopenReason: string;
  setReopenReason: (value: string) => void;
  working: boolean;
  onClose: () => void;
  onReopen: (event: FormEvent) => void;
}) {
  return (
    <section style={{ ...panel, marginBottom: 18 }}>
      <h2 style={heading}>Financial year</h2>
      <p style={description}>
        Year close is server-governed: every child period must satisfy the finance close invariants before the year can close.
      </p>
      {!year ? (
        <div style={emptyBox}>Choose a financial year to operate year-close controls.</div>
      ) : (
        <>
          <div style={metricGrid}>
            <Metric label="Year" value={year.name} />
            <Metric label="Status" value={year.status} />
            <Metric label="Start" value={formatAustralianDate(year.starts_on)} />
            <Metric label="End" value={formatAustralianDate(year.ends_on)} />
          </div>

          {year.status === 'OPEN' ? (
            <div style={formGrid}>
              <Field label="Year close reason (optional)">
                <input disabled={working} value={closeReason} onChange={event => setCloseReason(event.target.value)} className={fieldControlClassName} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="button" onClick={onClose} disabled={working} {...buttonProps('primary', 'sm')}>
                  Close financial year
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={onReopen} style={formGrid}>
              <Field label="Year reopen reason (required)">
                <input disabled={working} required value={reopenReason} onChange={event => setReopenReason(event.target.value)} className={fieldControlClassName} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="submit" disabled={working || !reopenReason.trim()} {...buttonProps('danger', 'sm')}>
                  Reopen financial year
                </button>
              </div>
            </form>
          )}

          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Durable year-close history</h3>
            {year.closes.length === 0 ? (
              <div style={emptyBox}>No close history for this financial year.</div>
            ) : (
              <TableContainer label="Year-close history">
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Sequence', 'Status', 'Closed', 'Reason', 'Control totals', 'Invalidation'].map(label => (
                        <th key={label} scope="col">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {year.closes.map(close => (
                      <tr key={close.id} data-year-close-id={close.id}>
                        <td>{close.close_sequence}</td>
                        <td>{close.status}</td>
                        <td>{formatAustralianTimestamp(close.closed_at)}</td>
                        <td>{close.close_reason ?? '—'}</td>
                        <td>
                          <div>{String(close.control_totals.financialPeriodCount ?? '—')} periods</div>
                          <div style={sub}>
                            {String(close.control_totals.currentPeriodCloseCount ?? '—')} current period closes
                          </div>
                        </td>
                        <td>
                          {close.invalidated_at ? (
                            <>
                              {formatAustralianTimestamp(close.invalidated_at)}
                              <div style={sub}>{close.invalidation_reason}</div>
                            </>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function PeriodControlPanel({
  period,
  activeClose,
  closeReason,
  setCloseReason,
  reopenReason,
  setReopenReason,
  working,
  onClose,
  onReopen,
}: {
  period: FinancialPeriod | null;
  activeClose: CloseRecord | null;
  closeReason: string;
  setCloseReason: (value: string) => void;
  reopenReason: string;
  setReopenReason: (value: string) => void;
  working: boolean;
  onClose: () => void;
  onReopen: (event: FormEvent) => void;
}) {
  return (
    <section style={{ ...panel, marginBottom: 18 }}>
      <h2 style={heading}>Financial period</h2>
      {!period ? (
        <p style={description}>Choose a financial period to operate close controls.</p>
      ) : (
        <>
          <div style={metricGrid}>
            <Metric label="Period" value={period.name} />
            <Metric label="Status" value={period.status} />
            <Metric label="Start" value={formatAustralianDate(period.starts_on)} />
            <Metric label="End" value={formatAustralianDate(period.ends_on)} />
          </div>

          {period.status === 'OPEN' ? (
            <div style={formGrid}>
              <Field label="Close reason (optional)">
                <input disabled={working} value={closeReason} onChange={event => setCloseReason(event.target.value)} className={fieldControlClassName} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="button" onClick={onClose} disabled={working} {...buttonProps('primary', 'sm')}>Close period</button>
              </div>
            </div>
          ) : (
            <form onSubmit={onReopen} style={formGrid}>
              <Field label="Reopen reason (required)">
                <input disabled={working} required value={reopenReason} onChange={event => setReopenReason(event.target.value)} className={fieldControlClassName} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="submit" disabled={working || !reopenReason.trim()} {...buttonProps('danger', 'sm')}>Reopen period</button>
              </div>
            </form>
          )}

          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Durable close history</h3>
            {period.closes.length === 0 ? (
              <div style={emptyBox}>No close history for this period.</div>
            ) : (
              <TableContainer label="Period-close history">
                <table className={tableStyles.table}>
                  <thead><tr>{['Sequence','Status','Closed','Reconciliation','Reason','Invalidation'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                  <tbody>
                    {period.closes.map(close => (
                      <tr key={close.id} data-close-id={close.id}>
                        <td>{close.close_sequence}</td>
                        <td>{close.status}{activeClose?.id === close.id ? <div style={sub}>Current close</div> : null}</td>
                        <td>{formatAustralianTimestamp(close.closed_at)}</td>
                        <td>{close.reconciliation_status}</td>
                        <td>{close.close_reason ?? '—'}</td>
                        <td>{close.invalidated_at ? <>{formatAustralianTimestamp(close.invalidated_at)}<div style={sub}>{close.invalidation_reason}</div></> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ReconciliationControlTable({
  reconciliations,
  activeClose,
  working,
  onReview,
  onSignOff,
}: {
  reconciliations: ReconciliationState[];
  activeClose: CloseRecord | null;
  working: boolean;
  onReview: (id: string) => void;
  onSignOff: (id: string) => void;
}) {
  return (
    <section style={{ ...panel, marginBottom: 18 }}>
      <h2 style={heading}>Latest reconciliation control state</h2>
      <p style={description}>
        One latest snapshot per period, External GL source and currency. Clean snapshots remain visible even when unresolved count is zero.
      </p>
      {reconciliations.length === 0 ? (
        <div style={emptyBox}>No reconciliation snapshots match the current scope.</div>
      ) : (
        <TableContainer label="Reconciliation control state" minWidth={1250}>
          <table className={tableStyles.table} style={{ minWidth: 1250 }}>
            <thead><tr>{[
              'Source','Currency','Status','Source Actual','Finance Adjustments','Effective Actual',
              'External GL','Variance','Unresolved','Prepared','Close','Action',
            ].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {reconciliations.map(reconciliation => {
                const action = financeReconciliationAction(
                  reconciliation.status,
                  Boolean(activeClose),
                );
                return (
                  <tr key={reconciliation.id} data-reconciliation-id={reconciliation.id}>
                    <td>{reconciliation.sourceSystemId}</td>
                    <td>{reconciliation.currency}</td>
                    <td><strong>{reconciliation.status}</strong></td>
                    <td className={tableStyles.num}>{formatMoneyCentsExact(reconciliation.sourceActualCents, reconciliation.currency)}</td>
                    <td className={tableStyles.num}>{formatMoneyCentsExact(reconciliation.financeAdjustmentCents, reconciliation.currency)}</td>
                    <td className={tableStyles.num}>{formatMoneyCentsExact(reconciliation.brainbaseEffectiveActualCents, reconciliation.currency)}</td>
                    <td className={tableStyles.num}>{formatMoneyCentsExact(reconciliation.externalGlTotalCents, reconciliation.currency)}</td>
                    <td className={tableStyles.num}>{formatMoneyCentsExact(reconciliation.varianceCents, reconciliation.currency)}</td>
                    <td>{reconciliation.unresolvedItemCount}</td>
                    <td>{formatAustralianTimestamp(reconciliation.preparedAt)}</td>
                    <td>{reconciliation.closeId ?? '—'}</td>
                    <td>
                      {action === 'REVIEW' ? (
                        <button type="button" disabled={working} onClick={() => onReview(reconciliation.id)} {...buttonProps('secondary', 'sm')}>Review</button>
                      ) : action === 'SIGN_OFF' || action === 'SIGN_OFF_BLOCKED' ? (
                        <button
                          type="button"
                          disabled={working || action === 'SIGN_OFF_BLOCKED'}
                          onClick={() => onSignOff(reconciliation.id)}
                          {...buttonProps('primary', 'sm')}
                        >
                          Sign off
                        </button>
                      ) : (
                        <span style={sub}>Read only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableContainer>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'grid', gap: 5, fontSize: 11, color: MUTED }}>{label}{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ background: INPUT_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10 }}><div style={{ color: MUTED, fontSize: 10 }}>{label}</div><div style={{ marginTop: 4, fontWeight: 650 }}>{value}</div></div>;
}

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 18 };
const heading: React.CSSProperties = { margin: 0, fontSize: 16 };
const description: React.CSSProperties = { margin: '6px 0 16px', fontSize: 12, color: MUTED, lineHeight: 1.5 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, alignItems: 'end' };
const metricGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 };
const sub: React.CSSProperties = { color: MUTED, marginTop: 3, fontSize: 11 };
const emptyBox: React.CSSProperties = { color: MUTED, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, textAlign: 'center' };
const errorBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-muted)', color: 'var(--status-danger)', borderRadius: 8, padding: 10, fontSize: 12 };
const noticeBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-success-border)', background: 'var(--status-success-muted)', color: 'var(--status-success)', borderRadius: 8, padding: 10, fontSize: 12 };
