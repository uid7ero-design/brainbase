'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Metric, MetricStrip, StateMessage, TableContainer, fieldControlClassName, tableStyles,
} from '@/components/ui/app';
import styles from './command.module.css';

// Phase D2 — on the shared app system: theme tokens (was dark-only),
// MetricStrip, the Phase C table contract, a real tablist, keyboard-operable
// edit cells and visible focus. Data, PATCH calls, debouncing and every
// calculation are unchanged. Colour carries meaning only: variance sign
// (also written as a minus sign), the manual-override marker (also a
// titled, announced glyph) and focus/selection accent.

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  gl: string;
  description: string;
  category: 'EXPENSE' | 'RECOVERY' | 'REVENUE';
  budget_fy: number;
  ytd_actual: number;
  commitments: number;
  eofy_forecast: number;
  variance: number;
  variance_pct: number;
  has_override: boolean;
}

interface RafEntry {
  gl: string;
  description: string;
  contractor: string;
  base_value: number;
  escalation_pct: number;
}

interface ForecastParams {
  multiplier: number;
  as_at_date: string;
}

interface CategoryTotals {
  budget_fy: number;
  ytd_actual: number;
  commitments: number;
  eofy_forecast: number;
  variance: number;
}

interface FinancialData {
  financial_year: string;
  forecast_params: ForecastParams;
  line_items: LineItem[];
  rise_and_fall: RafEntry[];
  summary: {
    expenses:   CategoryTotals;
    recoveries: CategoryTotals;
    revenue:    CategoryTotals;
    net: { budget_fy: number; eofy_forecast: number };
  };
}

type SubTab = 'summary' | 'expenses' | 'recoveries' | 'revenue' | 'rise-fall';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTIVE_FY = '2025-26';

function fmtCurrency(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtFull(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

function varianceSign(v: number): 'pos' | 'neg' | 'zero' {
  if (v > 0)  return 'pos';
  if (v < 0)  return 'neg';
  return 'zero';
}

// ── Editable number cell ──────────────────────────────────────────────────────

function EditCell({
  value, onSave, saving, align = 'right', label,
}: {
  value: number;
  /** Accessible name for the value, e.g. "Budget FY, 1234 Waste disposal". */
  label: string;
  onSave: (v: number) => void;
  saving?: boolean;
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const inputRef              = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(String(Math.round(value)));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commit() {
    const n = parseFloat(draft.replace(/[^0-9.-]/g, ''));
    if (!isNaN(n) && n !== value) onSave(n);
    setEditing(false);
  }

  if (saving) {
    return (
      <td className={tableStyles.num}>
        <span className={tableStyles.muted}>saving…</span>
      </td>
    );
  }

  if (editing) {
    return (
      <td className={tableStyles.num} style={{ textAlign: align }}>
        <input
          ref={inputRef}
          value={draft}
          aria-label={label}
          inputMode="decimal"
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className={styles.editInput}
          style={{ textAlign: align }}
        />
      </td>
    );
  }

  return (
    <td className={tableStyles.num} style={{ textAlign: align }}>
      <button type="button" className={styles.editButton} onClick={startEdit} title="Click to edit" aria-label={`${label}: ${fmtFull(value)}. Edit`} style={{ textAlign: align }}>
        {fmtFull(value)}
      </button>
    </td>
  );
}

// ── Line items table ──────────────────────────────────────────────────────────

function LineItemTable({
  items, fy, onUpdate, savingGl,
}: {
  items: LineItem[];
  fy: string;
  onUpdate: (gl: string, field: string, value: number) => void;
  savingGl: string | null;
}) {
  if (items.length === 0) {
    return (
      <StateMessage kind="empty" title="No line items.">
        Load data via the ingest script or add rows manually.
      </StateMessage>
    );
  }

  const total = {
    budget_fy:     items.reduce((s, i) => s + i.budget_fy, 0),
    ytd_actual:    items.reduce((s, i) => s + i.ytd_actual, 0),
    commitments:   items.reduce((s, i) => s + i.commitments, 0),
    eofy_forecast: items.reduce((s, i) => s + i.eofy_forecast, 0),
    variance:      items.reduce((s, i) => s + i.variance, 0),
  };

  return (
    <TableContainer label="Line items" minWidth={820}>
      <table className={tableStyles.table}>
        <thead>
          <tr>
            {['GL', 'Description', 'Budget FY ✎', 'YTD Actual ✎', 'Commitments ✎', 'EOFY Forecast', 'Variance $', 'Var %'].map((h, i) => (
              <th key={h} scope="col" className={i > 1 ? tableStyles.num : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.gl}>
              <td className={tableStyles.meta} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {item.gl}
              </td>
              <td className={tableStyles.primary} style={{ maxWidth: 220 }}>
                {item.description}
              </td>
              <EditCell label={`Budget FY, ${item.gl} ${item.description}`}   value={item.budget_fy}   saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'budget_fy',   v)} />
              <EditCell label={`YTD Actual, ${item.gl} ${item.description}`}  value={item.ytd_actual}  saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'ytd_actual',  v)} />
              <EditCell label={`Commitments, ${item.gl} ${item.description}`} value={item.commitments} saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'commitments', v)} />
              <td className={`${tableStyles.num} ${item.has_override ? styles.override : ''}`}>
                {fmtFull(item.eofy_forecast)}
                {item.has_override && (
                  <span title="Manual override" style={{ marginLeft: 4, fontSize: 9 }}>
                    <span aria-hidden="true">●</span>
                    <span className={styles.srOnly}> (manual override)</span>
                  </span>
                )}
              </td>
              <td className={`${tableStyles.num} ${styles.variance}`} data-sign={varianceSign(item.variance)} style={{ fontWeight: 600 }}>
                {fmtFull(item.variance)}
              </td>
              <td className={`${tableStyles.num} ${styles.variance}`} data-sign={varianceSign(item.variance_pct)}>
                {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <td colSpan={2}>TOTAL</td>
            {[total.budget_fy, total.ytd_actual, total.commitments, total.eofy_forecast].map((v, i) => (
              <td key={i} className={tableStyles.num}>
                {fmtFull(v)}
              </td>
            ))}
            <td className={`${tableStyles.num} ${styles.variance}`} data-sign={varianceSign(total.variance)}>
              {fmtFull(total.variance)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </TableContainer>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinancialTab() {
  const [data,      setData]      = useState<FinancialData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [subTab,    setSubTab]    = useState<SubTab>('summary');
  const [savingGl,  setSavingGl]  = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState(1.0);
  const multTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/financial/${ACTIVE_FY}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json.data);
      setMultiplier(json.data.forecast_params.multiplier ?? 1.0);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function updateLineItem(gl: string, field: string, value: number) {
    setSavingGl(gl);
    try {
      await fetch(`/api/financial/${ACTIVE_FY}/line-item/${encodeURIComponent(gl)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ field, value }),
      });
      await fetchData();
    } finally {
      setSavingGl(null);
    }
  }

  async function updateRiseAndFall(gl: string, field: string, value: number | string) {
    setSavingGl(gl);
    try {
      await fetch(`/api/financial/${ACTIVE_FY}/rise-and-fall/${encodeURIComponent(gl)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ field, value }),
      });
      await fetchData();
    } finally {
      setSavingGl(null);
    }
  }

  async function updateActualsAsAtDate(date: string) {
    await fetch(`/api/financial/${ACTIVE_FY}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ as_at_date: date }),
    });
    await fetchData();
  }

  function handleMultiplierChange(v: number) {
    setMultiplier(v);
    if (multTimer.current) clearTimeout(multTimer.current);
    multTimer.current = setTimeout(async () => {
      await fetch(`/api/financial/${ACTIVE_FY}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ multiplier: v }),
      });
      await fetchData();
    }, 600);
  }

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.tabBody}>
        <StateMessage kind="loading" title="Loading financial data…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.tabBody}>
        <StateMessage kind="error" title="Error loading financial data">{error}</StateMessage>
      </div>
    );
  }

  if (!data) return null;

  const { summary, line_items, rise_and_fall, forecast_params } = data;

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'summary',    label: 'Summary'        },
    { id: 'expenses',   label: 'Gross Expenses'  },
    { id: 'recoveries', label: 'Recoveries'      },
    { id: 'revenue',    label: 'Revenue'         },
    { id: 'rise-fall',  label: 'Rise & Fall'     },
  ];

  // ── Summary tab ────────────────────────────────────────────────────────────

  const netVariance = summary.net.budget_fy - summary.net.eofy_forecast;

  const SummaryContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MetricStrip>
        <Metric label="Net Budget FY" value={fmtCurrency(summary.net.budget_fy)} />
        <Metric label="Gross Expenses" value={fmtCurrency(summary.expenses.eofy_forecast)} />
        <Metric label="EOFY Net Forecast" value={fmtCurrency(summary.net.eofy_forecast)} />
        <Metric label="Net Variance" value={fmtCurrency(netVariance)} tone={netVariance >= 0 ? 'success' : 'danger'} sub={netVariance >= 0 ? 'Within budget' : 'Over budget'} />
      </MetricStrip>

      {/* Forecast settings */}
      <div className={styles.settings}>
        <div className={styles.setting}>
          <label htmlFor="fin-multiplier" className={styles.settingLabel}>
            Forecast Multiplier — <span className={styles.settingValue}>{multiplier.toFixed(2)}×</span>
          </label>
          <input
            id="fin-multiplier"
            type="range" min="0.5" max="2.0" step="0.01"
            value={multiplier}
            onChange={e => handleMultiplierChange(parseFloat(e.target.value))}
            className={styles.range}
          />
          <div className={styles.rangeScale} aria-hidden="true">
            <span>0.50×</span><span>1.00× (neutral)</span><span>2.00×</span>
          </div>
        </div>
        <div className={styles.setting}>
          <label htmlFor="fin-as-at" className={styles.settingLabel}>
            Actuals As-At Date
          </label>
          <input
            id="fin-as-at"
            type="date"
            defaultValue={forecast_params.as_at_date}
            onBlur={e => updateActualsAsAtDate(e.target.value)}
            className={fieldControlClassName}
          />
        </div>
      </div>

      {/* Category breakdown table */}
      <div>
        <h3 className={styles.subTitle}>Category Breakdown</h3>
        <TableContainer label="Category breakdown" minWidth={640}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                {['Category', 'Budget FY', 'YTD Actual', 'Commitments', 'EOFY Forecast', 'Variance'].map((h, i) => (
                  <th key={h} scope="col" className={i === 0 ? undefined : tableStyles.num}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { label: 'Gross Expenses', totals: summary.expenses   },
                { label: 'Recoveries',     totals: summary.recoveries },
                { label: 'Revenue',        totals: summary.revenue    },
              ] as const).map(({ label, totals }) => (
                <tr key={label}>
                  <td className={tableStyles.primary}>{label}</td>
                  {[totals.budget_fy, totals.ytd_actual, totals.commitments, totals.eofy_forecast, totals.variance].map((v, i) => (
                    <td key={i} className={i === 4 ? `${tableStyles.num} ${styles.variance}` : tableStyles.num} data-sign={i === 4 ? varianceSign(v) : undefined} style={{ fontWeight: i === 4 ? 600 : undefined }}>
                      {fmtFull(v)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td>Net</td>
                <td className={tableStyles.num}>{fmtFull(summary.net.budget_fy)}</td>
                <td colSpan={3} />
                <td className={tableStyles.num}>{fmtFull(summary.net.eofy_forecast)}</td>
              </tr>
            </tbody>
          </table>
        </TableContainer>
      </div>
    </div>
  );

  // ── Rise & Fall tab ────────────────────────────────────────────────────────

  const RafContent = (
    rise_and_fall.length === 0 ? (
      <StateMessage kind="empty" title="No Rise & Fall entries.">
        Add contractor escalation data via the ingest script.
      </StateMessage>
    ) : (
      <TableContainer label="Rise and fall" minWidth={720}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              {['GL', 'Description', 'Contractor', 'Base Value', 'Escalation %', 'Escalated Value'].map((h, i) => (
                <th key={h} scope="col" className={i > 2 ? tableStyles.num : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rise_and_fall.map(entry => {
              const escalated = entry.base_value * (1 + entry.escalation_pct / 100);
              return (
                <tr key={entry.gl}>
                  <td className={tableStyles.meta}>{entry.gl}</td>
                  <td className={tableStyles.primary}>{entry.description}</td>
                  <td>{entry.contractor}</td>
                  <td className={tableStyles.num}>{fmtFull(entry.base_value)}</td>
                  <td className={tableStyles.num}>{entry.escalation_pct.toFixed(1)}%</td>
                  <td className={tableStyles.num} style={{ fontWeight: 600 }}>{fmtFull(escalated)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td colSpan={3}>TOTAL</td>
              <td className={tableStyles.num}>
                {fmtFull(rise_and_fall.reduce((s, e) => s + e.base_value, 0))}
              </td>
              <td />
              <td className={tableStyles.num}>
                {fmtFull(rise_and_fall.reduce((s, e) => s + e.base_value * (1 + e.escalation_pct / 100), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </TableContainer>
    )
  );

  function handleSubTabKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % SUB_TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + SUB_TABS.length) % SUB_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SUB_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setSubTab(SUB_TABS[next].id);
    document.getElementById(`fin-tab-${SUB_TABS[next].id}`)?.focus();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* Header */}
      <div style={{ padding: '18px 22px 0', flexShrink: 0 }}>
        <div className={styles.finHeader}>
          <div>
            <h2 className={styles.tabTitle}>Financial Management</h2>
            <div className={styles.finMeta}>FY {ACTIVE_FY} · Forecast ×{multiplier.toFixed(2)}</div>
          </div>
          <div className={styles.finMeta}>
            As-at {forecast_params.as_at_date || '—'}
          </div>
        </div>

        {/* Sub-tab bar */}
        <div className={styles.subTabs} role="tablist" aria-label="Financial views">
          {SUB_TABS.map((t, index) => (
            <button
              key={t.id}
              id={`fin-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={subTab === t.id}
              aria-controls="fin-tabpanel"
              tabIndex={subTab === t.id ? 0 : -1}
              className={styles.tab}
              onClick={() => setSubTab(t.id)}
              onKeyDown={e => handleSubTabKey(e, index)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div id="fin-tabpanel" role="tabpanel" aria-labelledby={`fin-tab-${subTab}`} style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 48px' }}>
        {subTab === 'summary'    && SummaryContent}
        {subTab === 'expenses'   && (
          <LineItemTable
            items={line_items.filter(i => i.category === 'EXPENSE')}
            fy={ACTIVE_FY}
            onUpdate={updateLineItem}
            savingGl={savingGl}
          />
        )}
        {subTab === 'recoveries' && (
          <LineItemTable
            items={line_items.filter(i => i.category === 'RECOVERY')}
            fy={ACTIVE_FY}
            onUpdate={updateLineItem}
            savingGl={savingGl}
          />
        )}
        {subTab === 'revenue'    && (
          <LineItemTable
            items={line_items.filter(i => i.category === 'REVENUE')}
            fy={ACTIVE_FY}
            onUpdate={updateLineItem}
            savingGl={savingGl}
          />
        )}
        {subTab === 'rise-fall'  && RafContent}
      </div>
    </div>
  );
}
