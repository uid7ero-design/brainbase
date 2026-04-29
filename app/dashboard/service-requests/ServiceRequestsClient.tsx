'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { useAppStore } from '@/lib/state/useAppStore';
import type { SRRow, UploadMeta } from './page';

// ─── Design tokens ────────────────────────────────────────────────────────────

const FONT  = "var(--font-inter), -apple-system, sans-serif";
const T1    = '#F5F7FA';
const T2    = 'rgba(230,237,243,0.55)';
const T3    = 'rgba(230,237,243,0.35)';
const DC: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12, padding: '18px 20px',
};

const STATUS_COLOR: Record<string, string> = {
  Open:    '#F59E0B',
  Closed:  '#22C55E',
  Pending: '#818CF8',
};

const PRIORITY_COLOR: Record<string, string> = {
  High:   '#EF4444',
  Medium: '#F59E0B',
  Low:    '#4ADE80',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0,
      background: `${color}20`, color, border: `1px solid ${color}40`,
    }}>
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 20, borderLeft: `3px solid ${accent}` }}>
      <p style={{ fontSize: 10, color: T3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: T1, margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 10px' }}>{children}</p>
  );
}

function DataSourceBanner({ meta }: { meta: UploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <Pill label="Live Data" color="#10b981" />
      <span style={{ fontSize: 13, color: T2 }}>
        <span style={{ color: T1, fontWeight: 600 }}>{meta.fileName}</span>
        <span style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{meta.recordCount.toLocaleString()} records</span>
        <span style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

function DemoBanner() {
  return (
    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <Pill label="Demo" color="#f59e0b" />
      <div style={{ fontSize: 13, color: T2 }}>
        Sample data is shown below.{' '}
        <span style={{ color: T1, fontWeight: 600 }}>Upload a service requests spreadsheet to activate with real data.</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  isDemo: boolean;
  uploadMeta: UploadMeta | null;
  rows: SRRow[];
  monthOrder: string[];
}

export default function ServiceRequestsClient({ isDemo, uploadMeta, rows, monthOrder }: Props) {
  const [tab,          setTab]          = useState<'queue' | 'trend' | 'suburb' | 'type'>('queue');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter   !== 'All' && r.status   !== statusFilter)   return false;
    if (priorityFilter !== 'All' && r.priority !== priorityFilter) return false;
    return true;
  }), [rows, statusFilter, priorityFilter]);

  // KPIs
  const open    = rows.filter(r => r.status === 'Open');
  const closed  = rows.filter(r => r.status === 'Closed');
  const pending = rows.filter(r => r.status === 'Pending');
  const highPriOpen = open.filter(r => r.priority === 'High');
  const avgDaysOpen  = open.length  ? (open.reduce((s,r) => s + r.days_open, 0) / open.length) : 0;
  const resolutionRate = rows.length > 0 ? Math.round((closed.length / rows.length) * 100) : 0;
  const totalCost = rows.reduce((s,r) => s + r.cost, 0);

  // Trend: counts per month
  const trendData = useMemo(() => {
    const monthsInData = [...new Set(rows.map(r => r.month))];
    const ordered = monthOrder.filter(m => monthsInData.includes(m));
    return ordered.map(month => {
      const monthRows = rows.filter(r => r.month === month);
      return {
        month,
        Open:    monthRows.filter(r => r.status === 'Open').length,
        Closed:  monthRows.filter(r => r.status === 'Closed').length,
        Pending: monthRows.filter(r => r.status === 'Pending').length,
      };
    });
  }, [rows, monthOrder]);

  // By suburb
  const suburbData = useMemo(() => {
    const map = new Map<string, { open: number; high: number; avg: number; count: number; sumDays: number }>();
    for (const r of rows) {
      const e = map.get(r.suburb) ?? { open: 0, high: 0, avg: 0, count: 0, sumDays: 0 };
      e.count++;
      if (r.status === 'Open')    e.open++;
      if (r.priority === 'High')  e.high++;
      e.sumDays += r.days_open;
      map.set(r.suburb, e);
    }
    return [...map.entries()]
      .map(([suburb, s]) => ({ suburb, open: s.open, high: s.high, avgDays: Math.round(s.sumDays / s.count) }))
      .sort((a, b) => b.open - a.open);
  }, [rows]);

  // By service type
  const typeData = useMemo(() => {
    const map = new Map<string, { count: number; open: number; cost: number }>();
    for (const r of rows) {
      const e = map.get(r.service_type) ?? { count: 0, open: 0, cost: 0 };
      e.count++;
      if (r.status === 'Open') e.open++;
      e.cost += r.cost;
      map.set(r.service_type, e);
    }
    return [...map.entries()]
      .map(([type, s]) => ({ type, count: s.count, open: s.open, cost: s.cost }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const fmt$ = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n}`;

  const DTT = { contentStyle: { background: '#0d0f14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11 }, labelStyle: { color: T3 } };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: T1, fontFamily: FONT, padding: '24px 28px 80px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: T1 }}>
              Service Requests
            </h1>
            {highPriOpen.length > 0 && (
              <span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 10, fontWeight: 700, color: '#FCA5A5', letterSpacing: '0.06em' }}>
                {highPriOpen.length} HIGH PRIORITY
              </span>
            )}
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: T3 }}>
            {isDemo ? 'Demo data — upload a spreadsheet to see real requests' : `${rows.length} total requests`}
          </p>
        </div>
        <button
          onClick={() => useAppStore.getState().fireHelena('Analyse the current service requests — which suburbs and request types are generating the most open items? Are there any resolution time concerns?')}
          style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.28)', color: '#C4B5FD', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
        >
          Ask HLNΛ
        </button>
      </div>

      {/* ── Data source / demo banner ── */}
      {!isDemo && uploadMeta ? <DataSourceBanner meta={uploadMeta} /> : isDemo ? <DemoBanner /> : null}

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        <KpiCard label="Open"           value={String(open.length)}    sub={highPriOpen.length > 0 ? `${highPriOpen.length} high priority` : 'None high priority'} accent="#F59E0B" />
        <KpiCard label="Avg Days Open"  value={avgDaysOpen > 0 ? avgDaysOpen.toFixed(1) : '—'} sub="For open requests" accent={avgDaysOpen > 7 ? '#EF4444' : '#22C55E'} />
        <KpiCard label="Resolution Rate" value={`${resolutionRate}%`}  sub={`${closed.length} closed`} accent={resolutionRate >= 70 ? '#22C55E' : '#F59E0B'} />
        <KpiCard label="Pending"        value={String(pending.length)} sub="Awaiting action"  accent="#818CF8" />
        <KpiCard label="Total Cost"     value={fmt$(totalCost)}        sub="All requests"      accent="#A78BFA" />
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 18, gap: 0 }}>
        {([
          { id: 'queue',  label: 'Open Queue' },
          { id: 'trend',  label: 'Monthly Trend' },
          { id: 'suburb', label: 'By Suburb' },
          { id: 'type',   label: 'By Type' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? '2px solid #8B5CF6' : '2px solid transparent',
            color: tab === t.id ? '#C4B5FD' : 'rgba(255,255,255,0.40)',
            fontSize: 12, fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
            transition: 'all 0.15s', fontFamily: FONT, marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Queue tab ── */}
      {tab === 'queue' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(['All','Open','Closed','Pending'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: FONT,
                background: statusFilter === s ? (s === 'All' ? 'rgba(124,58,237,0.25)' : `${STATUS_COLOR[s] ?? '#7C3AED'}28`) : 'rgba(255,255,255,0.04)',
                border: `1px solid ${statusFilter === s ? (STATUS_COLOR[s] ?? '#7C3AED') + '60' : 'rgba(255,255,255,0.08)'}`,
                color: statusFilter === s ? (STATUS_COLOR[s] ?? '#C4B5FD') : 'rgba(255,255,255,0.45)',
              }}>
                {s}
              </button>
            ))}
            <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.08)', margin: '0 4px', alignSelf: 'center' }} />
            {(['All','High','Medium','Low'] as const).map(p => (
              <button key={p} onClick={() => setPriorityFilter(p)} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: FONT,
                background: priorityFilter === p ? `${PRIORITY_COLOR[p] ?? '#7C3AED'}28` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${priorityFilter === p ? (PRIORITY_COLOR[p] ?? '#7C3AED') + '60' : 'rgba(255,255,255,0.08)'}`,
                color: priorityFilter === p ? (PRIORITY_COLOR[p] ?? '#C4B5FD') : 'rgba(255,255,255,0.45)',
              }}>
                {p}
              </button>
            ))}
            <span style={{ fontSize: 11, color: T3, alignSelf: 'center', marginLeft: 4 }}>
              {filtered.length} of {rows.length}
            </span>
          </div>

          {/* Table */}
          <div style={{ ...DC, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.025)' }}>
                  {['ID','Type','Suburb','Month','Status','Priority','Days Open','Cost'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T3, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 80).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: 11, color: T3 }}>{r.request_id}</td>
                    <td style={{ padding: '9px 14px', color: T2 }}>{r.service_type}</td>
                    <td style={{ padding: '9px 14px', color: T1, fontWeight: 500 }}>{r.suburb}</td>
                    <td style={{ padding: '9px 14px', color: T3 }}>{r.month}</td>
                    <td style={{ padding: '9px 14px' }}><Pill label={r.status}   color={STATUS_COLOR[r.status]   ?? '#A78BFA'} /></td>
                    <td style={{ padding: '9px 14px' }}><Pill label={r.priority} color={PRIORITY_COLOR[r.priority] ?? '#A78BFA'} /></td>
                    <td style={{ padding: '9px 14px', color: r.days_open > 7 ? '#FCA5A5' : T2, fontWeight: r.days_open > 7 ? 600 : 400 }}>
                      {r.days_open}d
                    </td>
                    <td style={{ padding: '9px 14px', color: T2 }}>{fmt$(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 80 && (
              <div style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, color: T3, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                Showing 80 of {filtered.length} — refine filters to narrow results
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Monthly trend tab ── */}
      {tab === 'trend' && (
        <div style={DC}>
          <SectionLabel>Request Volume by Month</SectionLabel>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...DTT} />
                <Bar dataKey="Closed"  fill="#22C55E" stackId="s" radius={[0,0,0,0]} />
                <Bar dataKey="Pending" fill="#818CF8" stackId="s" />
                <Bar dataKey="Open"    fill="#F59E0B" stackId="s" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T3, fontSize: 12 }}>No trend data</div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
            {[['Closed','#22C55E'],['Pending','#818CF8'],['Open','#F59E0B']].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T3 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── By suburb tab ── */}
      {tab === 'suburb' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={DC}>
            <SectionLabel>Open Requests by Suburb</SectionLabel>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={suburbData.slice(0,8)} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: T3, fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="suburb" tick={{ fill: T2, fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip {...DTT} />
                <Bar dataKey="open" fill="#F59E0B" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...DC, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T3 }}>Suburb Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  {['Suburb','Open','High Priority','Avg Days'].map(h => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T3, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suburbData.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '9px 14px', fontWeight: 500, color: T1 }}>{s.suburb}</td>
                    <td style={{ padding: '9px 14px', color: s.open > 3 ? '#FCD34D' : T2 }}>{s.open}</td>
                    <td style={{ padding: '9px 14px', color: s.high > 0 ? '#FCA5A5' : T3 }}>{s.high}</td>
                    <td style={{ padding: '9px 14px', color: s.avgDays > 7 ? '#FCA5A5' : T3 }}>{s.avgDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── By type tab ── */}
      {tab === 'type' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={DC}>
            <SectionLabel>Requests by Service Type</SectionLabel>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={typeData} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={90} label={(p) => `${(p as { type?: string; percent?: number }).type ?? ''} ${(((p as { percent?: number }).percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ stroke: T3, strokeWidth: 0.5 }} fontSize={10} fill={T3}>
                  {typeData.map((_, i) => (
                    <Cell key={i} fill={['#A78BFA','#38BDF8','#4ADE80','#F59E0B','#F87171','#818CF8','#34D399','#FB923C'][i % 8]} />
                  ))}
                </Pie>
                <Tooltip {...DTT} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...DC, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T3 }}>Type Breakdown</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  {['Service Type','Total','Open','Total Cost'].map(h => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T3, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {typeData.map((t, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '9px 14px', fontWeight: 500, color: T1 }}>{t.type}</td>
                    <td style={{ padding: '9px 14px', color: T2 }}>{t.count}</td>
                    <td style={{ padding: '9px 14px', color: t.open > 2 ? '#FCD34D' : T3 }}>{t.open}</td>
                    <td style={{ padding: '9px 14px', color: T2 }}>{fmt$(t.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
