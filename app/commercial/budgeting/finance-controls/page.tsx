'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import {
  financePeriodCloseHref,
  financePeriodReopenHref,
  financeReconciliationAction,
  financeReconciliationReviewHref,
  financeReconciliationSignOffHref,
} from '@/lib/commercial/financeControlUi';

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const MUTED = '#9ca3af';
const INPUT_BG = '#090b0f';

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

type FinancialYear = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: PeriodStatus;
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

export default function FinanceControlsPage() {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [selectedYearId, setSelectedYearId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [sourceSystemId, setSourceSystemId] = useState('');
  const [currency, setCurrency] = useState('');
  const [reconciliations, setReconciliations] = useState<ReconciliationState[]>([]);
  const [closeReason, setCloseReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [periodResponse, sourceResponse] = await Promise.all([
      fetch('/api/commercial/budgeting/financial-periods', { cache: 'no-store' }),
      fetch('/api/commercial/budgeting/external-gl/sources', { cache: 'no-store' }),
    ]);

    if (periodResponse.status === 403) {
      setError('Budgeting administrator access is required to operate finance controls.');
      setLoading(false);
      return;
    }
    if (!periodResponse.ok || !sourceResponse.ok) {
      setError('Unable to load finance control configuration.');
      setLoading(false);
      return;
    }

    const [periodData, sourceData] = await Promise.all([
      periodResponse.json() as Promise<{ years?: FinancialYear[] }>,
      sourceResponse.json() as Promise<{ sourceSystemIds?: string[] }>,
    ]);
    const nextYears = Array.isArray(periodData.years) ? periodData.years : [];
    const nextSources = Array.isArray(sourceData.sourceSystemIds)
      ? sourceData.sourceSystemIds.filter(value => typeof value === 'string')
      : [];

    setYears(nextYears);
    setSources(nextSources);
    setSelectedYearId(current => {
      if (current && nextYears.some(year => year.id === current)) return current;
      return nextYears[0]?.id ?? '';
    });
    setSourceSystemId(current => {
      if (current && nextSources.includes(current)) return current;
      return nextSources[0] ?? '';
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCore();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCore]);

  const loadReconciliations = useCallback(async () => {
    if (!effectiveSelectedPeriodId) {
      setReconciliations([]);
      return;
    }

    const params = new URLSearchParams({ financialPeriodId: effectiveSelectedPeriodId });
    if (sourceSystemId) params.set('sourceSystemId', sourceSystemId);
    if (currency.trim()) params.set('currency', currency.trim().toUpperCase());

    const response = await fetch(
      `/api/commercial/budgeting/reconciliations/control-state?${params.toString()}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error || 'Unable to load reconciliation control state.');
      setReconciliations([]);
      return;
    }
    const payload = await response.json() as { reconciliations?: ReconciliationState[] };
    setReconciliations(Array.isArray(payload.reconciliations) ? payload.reconciliations : []);
  }, [currency, effectiveSelectedPeriodId, sourceSystemId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReconciliations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReconciliations]);

  async function postJson(url: string, body: Record<string, unknown>) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error || 'The finance control action could not be completed.');
        return false;
      }
      return true;
    } finally {
      setWorking(false);
    }
  }

  async function refreshAfterMutation(message: string) {
    setNotice(message);
    await loadCore();
    await loadReconciliations();
  }

  async function closePeriod() {
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
    const ok = await postJson(
      financeReconciliationReviewHref(id),
      {},
    );
    if (!ok) return;
    await refreshAfterMutation('Finance reconciliation reviewed.');
  }

  async function signOffReconciliation(id: string) {
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
        <h1 style={{ margin: 0, fontSize: 24 }}>Finance controls</h1>
        <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 13, lineHeight: 1.6 }}>
          Operate financial-period close/reopen and the governed reconciliation lifecycle.
          Durable close and reconciliation history is preserved; these controls do not delete finance evidence.
        </p>
      </div>

      {error ? <div role="alert" style={errorBox}>{error}</div> : null}
      {notice ? <div role="status" style={noticeBox}>{notice}</div> : null}

      <section style={{ ...panel, marginBottom: 18 }}>
        <h2 style={heading}>Control scope</h2>
        <div style={formGrid}>
          <Field label="Financial year">
            <select value={selectedYearId} onChange={event => setSelectedYearId(event.target.value)} style={control} disabled={loading}>
              <option value="">Choose year</option>
              {years.map(year => (
                <option key={year.id} value={year.id}>{year.name} — {year.status}</option>
              ))}
            </select>
          </Field>
          <Field label="Financial period">
            <select value={effectiveSelectedPeriodId} onChange={event => setSelectedPeriodId(event.target.value)} style={control} disabled={!selectedYear}>
              <option value="">Choose period</option>
              {(selectedYear?.periods ?? []).map(period => (
                <option key={period.id} value={period.id}>{period.name} — {period.status}</option>
              ))}
            </select>
          </Field>
          <Field label="External GL source">
            <select value={sourceSystemId} onChange={event => setSourceSystemId(event.target.value)} style={control}>
              <option value="">Choose source</option>
              {sources.map(source => <option key={source} value={source}>{source}</option>)}
            </select>
          </Field>
          <Field label="Currency">
            <input
              value={currency}
              maxLength={3}
              placeholder="AUD"
              onChange={event => setCurrency(event.target.value.toUpperCase())}
              style={control}
              aria-label="Reconciliation currency"
            />
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <button type="button" style={secondaryButton} disabled={loading || working} onClick={() => void refreshAfterMutation('Finance controls refreshed.')}>
              Refresh
            </button>
          </div>
        </div>
      </section>

      <PeriodControlPanel
        period={selectedPeriod}
        activeClose={activeClose}
        closeReason={closeReason}
        setCloseReason={setCloseReason}
        reopenReason={reopenReason}
        setReopenReason={setReopenReason}
        working={working}
        onClose={closePeriod}
        onReopen={reopenPeriod}
      />

      <section style={{ ...panel, marginBottom: 18 }}>
        <h2 style={heading}>Prepare reconciliation</h2>
        <p style={description}>
          Snapshot BrainBase source actuals and finance adjustments against one explicit External GL source and currency.
        </p>
        <form onSubmit={prepareReconciliation} style={{ display: 'grid', gap: 10 }}>
          <Field label="Notes">
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} style={control} />
          </Field>
          <div>
            <button type="submit" style={primaryButton} disabled={working || !effectiveSelectedPeriodId || !sourceSystemId}>
              Prepare reconciliation
            </button>
          </div>
        </form>
      </section>

      <ReconciliationControlTable
        reconciliations={reconciliations}
        activeClose={activeClose}
        working={working}
        onReview={reviewReconciliation}
        onSignOff={signOffReconciliation}
      />
    </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Metric label="Period" value={period.name} />
            <Metric label="Status" value={period.status} />
            <Metric label="Start" value={period.starts_on.slice(0, 10)} />
            <Metric label="End" value={period.ends_on.slice(0, 10)} />
          </div>

          {period.status === 'OPEN' ? (
            <div style={formGrid}>
              <Field label="Close reason (optional)">
                <input value={closeReason} onChange={event => setCloseReason(event.target.value)} style={control} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="button" onClick={onClose} disabled={working} style={primaryButton}>Close period</button>
              </div>
            </div>
          ) : (
            <form onSubmit={onReopen} style={formGrid}>
              <Field label="Reopen reason (required)">
                <input required value={reopenReason} onChange={event => setReopenReason(event.target.value)} style={control} />
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <button type="submit" disabled={working || !reopenReason.trim()} style={dangerButton}>Reopen period</button>
              </div>
            </form>
          )}

          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Durable close history</h3>
            {period.closes.length === 0 ? (
              <div style={emptyBox}>No close history for this period.</div>
            ) : (
              <table style={tableStyle}>
                <thead><tr>{['Sequence','Status','Closed','Reconciliation','Reason','Invalidation'].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead>
                <tbody>
                  {period.closes.map(close => (
                    <tr key={close.id} data-close-id={close.id}>
                      <td style={td}>{close.close_sequence}</td>
                      <td style={td}>{close.status}{activeClose?.id === close.id ? <div style={sub}>Current close</div> : null}</td>
                      <td style={td}>{new Date(close.closed_at).toLocaleString()}</td>
                      <td style={td}>{close.reconciliation_status}</td>
                      <td style={td}>{close.close_reason ?? '—'}</td>
                      <td style={td}>{close.invalidated_at ? <>{new Date(close.invalidated_at).toLocaleString()}<div style={sub}>{close.invalidation_reason}</div></> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ ...tableStyle, minWidth: 1250 }}>
            <thead><tr>{[
              'Source','Currency','Status','Source Actual','Finance Adjustments','Effective Actual',
              'External GL','Variance','Unresolved','Prepared','Close','Action',
            ].map(label => <th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>
              {reconciliations.map(reconciliation => {
                const action = financeReconciliationAction(
                  reconciliation.status,
                  Boolean(activeClose),
                );
                return (
                  <tr key={reconciliation.id} data-reconciliation-id={reconciliation.id}>
                    <td style={td}>{reconciliation.sourceSystemId}</td>
                    <td style={td}>{reconciliation.currency}</td>
                    <td style={td}><strong>{reconciliation.status}</strong></td>
                    <td style={moneyTd}>{formatMoneyCentsExact(reconciliation.sourceActualCents, reconciliation.currency)}</td>
                    <td style={moneyTd}>{formatMoneyCentsExact(reconciliation.financeAdjustmentCents, reconciliation.currency)}</td>
                    <td style={moneyTd}>{formatMoneyCentsExact(reconciliation.brainbaseEffectiveActualCents, reconciliation.currency)}</td>
                    <td style={moneyTd}>{formatMoneyCentsExact(reconciliation.externalGlTotalCents, reconciliation.currency)}</td>
                    <td style={moneyTd}>{formatMoneyCentsExact(reconciliation.varianceCents, reconciliation.currency)}</td>
                    <td style={td}>{reconciliation.unresolvedItemCount}</td>
                    <td style={td}>{new Date(reconciliation.preparedAt).toLocaleString()}</td>
                    <td style={td}>{reconciliation.closeId ?? '—'}</td>
                    <td style={td}>
                      {action === 'REVIEW' ? (
                        <button type="button" disabled={working} onClick={() => onReview(reconciliation.id)} style={secondaryButton}>Review</button>
                      ) : action === 'SIGN_OFF' || action === 'SIGN_OFF_BLOCKED' ? (
                        <button
                          type="button"
                          disabled={working || action === 'SIGN_OFF_BLOCKED'}
                          onClick={() => onSignOff(reconciliation.id)}
                          style={primaryButton}
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
        </div>
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

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18 };
const heading: React.CSSProperties = { margin: 0, fontSize: 16 };
const description: React.CSSProperties = { margin: '6px 0 16px', fontSize: 12, color: MUTED, lineHeight: 1.5 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, alignItems: 'end' };
const control: React.CSSProperties = { background: INPUT_BG, border: `1px solid ${BORDER}`, color: '#f9fafb', borderRadius: 7, padding: '8px 9px', fontSize: 12 };
const primaryButton: React.CSSProperties = { background: '#6d5dfc', color: '#fff', border: 0, borderRadius: 7, padding: '9px 12px', cursor: 'pointer', fontWeight: 600 };
const secondaryButton: React.CSSProperties = { background: 'transparent', color: '#d1d5db', border: `1px solid ${BORDER}`, borderRadius: 7, padding: '8px 12px', cursor: 'pointer' };
const dangerButton: React.CSSProperties = { background: 'transparent', color: '#fca5a5', border: '1px solid rgba(248,113,113,.35)', borderRadius: 7, padding: '8px 12px', cursor: 'pointer' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${BORDER}`, padding: '9px 8px' };
const td: React.CSSProperties = { borderBottom: `1px solid ${BORDER}`, padding: '10px 8px', verticalAlign: 'top' };
const moneyTd: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sub: React.CSSProperties = { color: MUTED, marginTop: 3, fontSize: 11 };
const emptyBox: React.CSSProperties = { color: MUTED, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, textAlign: 'center' };
const errorBox: React.CSSProperties = { marginBottom: 14, border: '1px solid rgba(248,113,113,.35)', background: 'rgba(127,29,29,.18)', color: '#fecaca', borderRadius: 8, padding: 10, fontSize: 12 };
const noticeBox: React.CSSProperties = { marginBottom: 14, border: '1px solid rgba(52,211,153,.3)', background: 'rgba(6,78,59,.18)', color: '#a7f3d0', borderRadius: 8, padding: 10, fontSize: 12 };
