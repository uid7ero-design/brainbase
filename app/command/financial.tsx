'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

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
const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

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

function varianceColor(v: number): string {
  if (v > 0)  return '#22C55E';
  if (v < 0)  return '#EF4444';
  return 'rgba(255,255,255,.40)';
}

// ── Editable number cell ──────────────────────────────────────────────────────

function EditCell({
  value, onSave, saving, align = 'right',
}: {
  value: number;
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
      <td style={{ padding: '7px 10px', textAlign: align, color: 'rgba(255,255,255,.30)', fontSize: 11 }}>
        saving…
      </td>
    );
  }

  if (editing) {
    return (
      <td style={{ padding: '4px 6px', textAlign: align }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            width: '100%', background: 'rgba(139,92,246,.15)', border: '1px solid rgba(139,92,246,.45)',
            borderRadius: 4, padding: '3px 6px', color: '#F5F7FA', fontSize: 11,
            fontFamily: FONT, textAlign: align, outline: 'none',
          }}
        />
      </td>
    );
  }

  return (
    <td
      onClick={startEdit}
      title="Click to edit"
      style={{
        padding: '7px 10px', textAlign: align, cursor: 'text',
        fontSize: 11, color: 'rgba(255,255,255,.75)',
        borderBottom: '1px dashed rgba(255,255,255,.10)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,.07)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      {fmtFull(value)}
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
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 12 }}>
        No line items. Load data via the ingest script or add rows manually.
      </div>
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
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,.10)' }}>
            {['GL', 'Description', 'Budget FY ✎', 'YTD Actual ✎', 'Commitments ✎', 'EOFY Forecast', 'Variance $', 'Var %'].map((h, i) => (
              <th key={h} style={{
                padding: '8px 10px', textAlign: i > 1 ? 'right' : 'left',
                fontWeight: 600, fontSize: 10, letterSpacing: '.06em',
                color: 'rgba(255,255,255,.38)', textTransform: 'uppercase',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.gl} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '7px 10px', fontSize: 10.5, color: 'rgba(255,255,255,.40)', fontVariantNumeric: 'tabular-nums' }}>
                {item.gl}
              </td>
              <td style={{ padding: '7px 10px', color: '#F5F7FA', fontWeight: 500, maxWidth: 200 }}>
                {item.description}
              </td>
              <EditCell value={item.budget_fy}   saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'budget_fy',   v)} />
              <EditCell value={item.ytd_actual}  saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'ytd_actual',  v)} />
              <EditCell value={item.commitments} saving={savingGl === item.gl} onSave={v => onUpdate(item.gl, 'commitments', v)} />
              <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, color: item.has_override ? '#A78BFA' : 'rgba(255,255,255,.70)' }}>
                {fmtFull(item.eofy_forecast)}
                {item.has_override && <span title="Manual override" style={{ marginLeft: 4, fontSize: 9, color: '#A78BFA' }}>●</span>}
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: varianceColor(item.variance) }}>
                {fmtFull(item.variance)}
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, color: varianceColor(item.variance_pct) }}>
                {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.025)' }}>
            <td colSpan={2} style={{ padding: '9px 10px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.60)' }}>TOTAL</td>
            {[total.budget_fy, total.ytd_actual, total.commitments, total.eofy_forecast].map((v, i) => (
              <td key={i} style={{ padding: '9px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.70)' }}>
                {fmtFull(v)}
              </td>
            ))}
            <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: varianceColor(total.variance) }}>
              {fmtFull(total.variance)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
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
      <div style={{ padding: 24, color: 'rgba(255,255,255,.35)', fontSize: 13, fontFamily: FONT }}>
        Loading financial data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: '#EF4444', fontSize: 13, fontFamily: FONT }}>
        Error loading financial data: {error}
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

  const SummaryContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {([
          { label: 'Net Budget FY',    val: fmtCurrency(summary.net.budget_fy),     color: '#5B9CF6' },
          { label: 'Gross Expenses',   val: fmtCurrency(summary.expenses.eofy_forecast), color: '#F59E0B' },
          { label: 'EOFY Net Forecast',val: fmtCurrency(summary.net.eofy_forecast),  color: '#A78BFA' },
          { label: 'Net Variance',     val: fmtCurrency(summary.net.budget_fy - summary.net.eofy_forecast),
            color: (summary.net.budget_fy - summary.net.eofy_forecast) >= 0 ? '#22C55E' : '#EF4444' },
        ] as const).map(({ label, val, color }) => (
          <div key={label} style={{ padding: 16, background: 'rgba(255,255,255,.04)', border: `1px solid ${color}33`, borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Forecast settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
            Forecast Multiplier — <span style={{ color: '#A78BFA' }}>{multiplier.toFixed(2)}×</span>
          </div>
          <input
            type="range" min="0.5" max="2.0" step="0.01"
            value={multiplier}
            onChange={e => handleMultiplierChange(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#A78BFA', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'rgba(255,255,255,.25)', marginTop: 4 }}>
            <span>0.50×</span><span>1.00× (neutral)</span><span>2.00×</span>
          </div>
        </div>
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Actuals As-At Date
          </div>
          <input
            type="date"
            defaultValue={forecast_params.as_at_date}
            onBlur={e => updateActualsAsAtDate(e.target.value)}
            style={{
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 6, padding: '6px 10px', color: '#F5F7FA', fontSize: 12,
              fontFamily: FONT, outline: 'none', width: '100%', colorScheme: 'dark',
            }}
          />
        </div>
      </div>

      {/* Category breakdown table */}
      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>
          Category Breakdown
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              {['Category', 'Budget FY', 'YTD Actual', 'Commitments', 'EOFY Forecast', 'Variance'].map((h, i) => (
                <th key={h} style={{ padding: '8px 16px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, fontSize: 10.5, color: 'rgba(255,255,255,.38)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              { label: 'Gross Expenses', totals: summary.expenses,   color: '#F59E0B' },
              { label: 'Recoveries',     totals: summary.recoveries, color: '#22C55E' },
              { label: 'Revenue',        totals: summary.revenue,    color: '#5B9CF6' },
            ] as const).map(({ label, totals, color }) => (
              <tr key={label} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                <td style={{ padding: '10px 16px', color, fontWeight: 600 }}>{label}</td>
                {[totals.budget_fy, totals.ytd_actual, totals.commitments, totals.eofy_forecast, totals.variance].map((v, i) => (
                  <td key={i} style={{ padding: '10px 16px', textAlign: 'right', color: i === 4 ? varianceColor(v) : 'rgba(255,255,255,.70)', fontWeight: i === 4 ? 600 : 400 }}>
                    {fmtFull(v)}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ background: 'rgba(255,255,255,.025)', borderTop: '1px solid rgba(255,255,255,.10)' }}>
              <td style={{ padding: '10px 16px', fontWeight: 700, color: '#F5F7FA' }}>Net</td>
              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#F5F7FA' }}>{fmtFull(summary.net.budget_fy)}</td>
              <td colSpan={3} />
              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#F5F7FA' }}>{fmtFull(summary.net.eofy_forecast)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── Rise & Fall tab ────────────────────────────────────────────────────────

  const RafContent = (
    <div style={{ overflowX: 'auto' }}>
      {rise_and_fall.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 12 }}>
          No Rise & Fall entries. Add contractor escalation data via the ingest script.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.10)' }}>
              {['GL', 'Description', 'Contractor', 'Base Value', 'Escalation %', 'Escalated Value'].map((h, i) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: i > 2 ? 'right' : 'left', fontWeight: 600, fontSize: 10, letterSpacing: '.06em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rise_and_fall.map(entry => {
              const escalated = entry.base_value * (1 + entry.escalation_pct / 100);
              return (
                <tr key={entry.gl} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <td style={{ padding: '7px 10px', fontSize: 10.5, color: 'rgba(255,255,255,.40)' }}>{entry.gl}</td>
                  <td style={{ padding: '7px 10px', color: '#F5F7FA' }}>{entry.description}</td>
                  <td style={{ padding: '7px 10px', color: 'rgba(255,255,255,.65)' }}>{entry.contractor}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'rgba(255,255,255,.70)' }}>{fmtFull(entry.base_value)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: '#F59E0B' }}>{entry.escalation_pct.toFixed(1)}%</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{fmtFull(escalated)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.025)' }}>
              <td colSpan={3} style={{ padding: '9px 10px', fontWeight: 700, color: 'rgba(255,255,255,.60)' }}>TOTAL</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'rgba(255,255,255,.70)' }}>
                {fmtFull(rise_and_fall.reduce((s, e) => s + e.base_value, 0))}
              </td>
              <td />
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>
                {fmtFull(rise_and_fall.reduce((s, e) => s + e.base_value * (1 + e.escalation_pct / 100), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: FONT }}>
      {/* Header */}
      <div style={{ padding: '18px 22px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F5F7FA', margin: 0 }}>Financial Management</h2>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 3 }}>FY {ACTIVE_FY} · Forecast ×{multiplier.toFixed(2)}</div>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.20)', letterSpacing: '.04em' }}>
            As-at {forecast_params.as_at_date || '—'}
          </div>
        </div>

        {/* Sub-tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              style={{
                padding: '8px 16px', background: 'transparent', border: 'none',
                borderBottom: subTab === t.id ? '2px solid #A78BFA' : '2px solid transparent',
                color: subTab === t.id ? '#C4B5FD' : 'rgba(255,255,255,.32)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all .15s', fontFamily: FONT,
              }}
              onMouseEnter={e => { if (subTab !== t.id) e.currentTarget.style.color = 'rgba(255,255,255,.55)'; }}
              onMouseLeave={e => { if (subTab !== t.id) e.currentTarget.style.color = 'rgba(255,255,255,.32)'; }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 48px' }}>
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
