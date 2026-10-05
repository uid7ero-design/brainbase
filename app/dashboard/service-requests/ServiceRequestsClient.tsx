'use client';

import { useState, useMemo, useRef, useId } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { useAppStore } from '@/lib/state/useAppStore';
import type { SRRow, UploadMeta } from './page';
import { HlnaInsightBanner } from '@/components/hlna/InsightBanner';
import {
  PageHeader, Panel, MetricStrip, Metric, Button, Badge, StateMessage,
  TableContainer, tableStyles, type SemanticState,
} from '@/components/ui/app';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import s from './ServiceRequests.module.css';

// ─── Status encodings ─────────────────────────────────────────────────────────
// Request status / priority are semantic: Badges carry the written label plus
// a state shape; chart series read the theme-aware palette (useDashboardChart).

const STATUS_STATE: Record<string, SemanticState> = {
  Open:    'warning',
  Closed:  'success',
  Pending: 'info',
};

const PRIORITY_STATE: Record<string, SemanticState> = {
  High:   'error',
  Medium: 'warning',
  Low:    'success',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function DataSourceBanner({ meta }: { meta: UploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className={s.source}>
      <Badge state="success">Live Data</Badge>
      <span>
        <span className={s.strong}>{meta.fileName}</span>
        <span className={s.sep} aria-hidden="true">·</span>
        <span>{meta.recordCount.toLocaleString()} records</span>
        <span className={s.sep} aria-hidden="true">·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

function DemoBanner() {
  return (
    <div className={s.source} data-tone="warning">
      <Badge state="warning">Demo</Badge>
      <div>
        Sample data is shown below.{' '}
        <span className={s.strong}>Upload a service requests spreadsheet to activate with real data.</span>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'queue',  label: 'Open Queue' },
  { id: 'trend',  label: 'Monthly Trend' },
  { id: 'suburb', label: 'By Suburb' },
  { id: 'type',   label: 'By Type' },
] as const;

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
  const chart = useDashboardChart();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

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

  const trendSeries = [
    { key: 'Closed',  color: chart.palette.success },
    { key: 'Pending', color: chart.palette.info },
    { key: 'Open',    color: chart.palette.warning },
  ] as const;

  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex(t => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const panelProps = {
    role: 'tabpanel',
    id: `${baseId}-panel`,
    'aria-labelledby': `${baseId}-tab-${tab}`,
    className: s.panel,
  } as const;

  return (
    <main className={s.page}>
      <div className={s.inner}>

      {/* ── Header ── */}
      <PageHeader
        title="Service Requests"
        meta={highPriOpen.length > 0 ? <Badge state="error">{highPriOpen.length} HIGH PRIORITY</Badge> : undefined}
        description={isDemo ? 'Demo data — upload a spreadsheet to see real requests' : `${rows.length} total requests`}
        actions={
          <Button
            variant="secondary"
            onClick={() => useAppStore.getState().fireHelena('Analyse the current service requests — which suburbs and request types are generating the most open items? Are there any resolution time concerns?')}
          >
            Ask HLNΛ
          </Button>
        }
      />

      {/* ── Data source / demo banner ── */}
      {!isDemo && uploadMeta ? <DataSourceBanner meta={uploadMeta} /> : isDemo ? <DemoBanner /> : null}

      {/* HLNA proactive insight */}
      {!isDemo && <HlnaInsightBanner dashboardType="service_requests" />}

      {/* ── KPI strip ── */}
      <MetricStrip>
        <Metric label="Open"            value={String(open.length)}    sub={highPriOpen.length > 0 ? `${highPriOpen.length} high priority` : 'None high priority'} />
        <Metric label="Avg Days Open"   value={avgDaysOpen > 0 ? avgDaysOpen.toFixed(1) : '—'} sub="For open requests" tone={avgDaysOpen > 7 ? 'danger' : undefined} />
        <Metric label="Resolution Rate" value={`${resolutionRate}%`}   sub={`${closed.length} closed`} tone={resolutionRate >= 70 ? 'success' : 'warning'} />
        <Metric label="Pending"         value={String(pending.length)} sub="Awaiting action" />
        <Metric label="Total Cost"      value={fmt$(totalCost)}        sub="All requests" />
      </MetricStrip>

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Service request views" className={s.tabList} onKeyDown={onTabKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={s.tab}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Queue tab ── */}
      {tab === 'queue' && (
        <div {...panelProps}>
          {/* Filters */}
          <div className={s.filters}>
            <div className={s.segment} role="group" aria-label="Filter by status">
              {(['All','Open','Closed','Pending'] as const).map(st => (
                <button key={st} type="button" aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)} className={s.segmentButton}>
                  {st}
                </button>
              ))}
            </div>
            <div className={s.segment} role="group" aria-label="Filter by priority">
              {(['All','High','Medium','Low'] as const).map(p => (
                <button key={p} type="button" aria-pressed={priorityFilter === p} onClick={() => setPriorityFilter(p)} className={s.segmentButton}>
                  {p}
                </button>
              ))}
            </div>
            <span className={s.count}>
              {filtered.length} of {rows.length}
            </span>
          </div>

          {/* Table */}
          <div className={s.tableBlock}>
            <TableContainer label="Service request queue" minWidth={760}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    {['ID','Type','Suburb','Month','Status','Priority','Days Open','Cost'].map(h => (
                      <th key={h} scope="col" className={h === 'Days Open' || h === 'Cost' ? tableStyles.num : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 80).map((r, i) => (
                    <tr key={i}>
                      <td className={s.mono}>{r.request_id}</td>
                      <td>{r.service_type}</td>
                      <td className={tableStyles.primary}>{r.suburb}</td>
                      <td>{r.month}</td>
                      <td><Badge state={STATUS_STATE[r.status] ?? 'inactive'}>{r.status}</Badge></td>
                      <td><Badge state={PRIORITY_STATE[r.priority] ?? 'inactive'}>{r.priority}</Badge></td>
                      <td className={tableStyles.num}>
                        <span className={r.days_open > 7 ? s.dangerText : undefined}>{r.days_open}d</span>
                      </td>
                      <td className={tableStyles.num}>{fmt$(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableContainer>
            {filtered.length > 80 && (
              <p className={s.overflowNote}>
                Showing 80 of {filtered.length} — refine filters to narrow results
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Monthly trend tab ── */}
      {tab === 'trend' && (
        <div {...panelProps}>
          <Panel title="Request Volume by Month">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="month" tick={chart.tick} axisLine={false} tickLine={false} />
                  <YAxis tick={chart.tick} axisLine={false} tickLine={false} />
                  <Tooltip {...chart.tooltip} />
                  <Bar dataKey="Closed"  fill={chart.palette.success} stackId="s" radius={[0,0,0,0]} />
                  <Bar dataKey="Pending" fill={chart.palette.info} stackId="s" />
                  <Bar dataKey="Open"    fill={chart.palette.warning} stackId="s" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className={s.chartEmpty}>
                <StateMessage kind="empty" title="No trend data" />
              </div>
            )}
            <ul className={s.legend} aria-label="Legend">
              {trendSeries.map(({ key, color }) => (
                <li key={key} className={s.legendItem}>
                  <span className={s.swatch} style={{ background: color }} aria-hidden="true" />
                  {key}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* ── By suburb tab ── */}
      {tab === 'suburb' && (
        <div {...panelProps}>
          <div className={s.split}>
            <Panel title="Open Requests by Suburb">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={suburbData.slice(0,8)} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" tick={chart.tick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="suburb" tick={chart.tick} axisLine={false} tickLine={false} width={90} />
                  <Tooltip {...chart.tooltip} />
                  <Bar dataKey="open" fill={chart.palette.warning} radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <div className={s.tableBlock}>
              <h2 className={s.blockTitle}>Suburb Summary</h2>
              <TableContainer label="Suburb summary" minWidth={420}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Suburb','Open','High Priority','Avg Days'].map(h => (
                        <th key={h} scope="col" className={h === 'Suburb' ? undefined : tableStyles.num}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {suburbData.map((row, i) => (
                      <tr key={i}>
                        <td className={tableStyles.primary}>{row.suburb}</td>
                        <td className={tableStyles.num}><span className={row.open > 3 ? s.warnText : undefined}>{row.open}</span></td>
                        <td className={tableStyles.num}><span className={row.high > 0 ? s.dangerText : undefined}>{row.high}</span></td>
                        <td className={tableStyles.num}><span className={row.avgDays > 7 ? s.dangerText : undefined}>{row.avgDays}d</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── By type tab ── */}
      {tab === 'type' && (
        <div {...panelProps}>
          <div className={s.split}>
            <Panel title="Requests by Service Type">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={typeData} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={90} label={(p) => `${(p as { type?: string; percent?: number }).type ?? ''} ${(((p as { percent?: number }).percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ stroke: chart.palette.axis, strokeWidth: 0.5 }} fontSize={10} fill={chart.palette.axis}>
                    {typeData.map((_, i) => (
                      <Cell key={i} fill={chart.series[i % chart.series.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...chart.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>
            <div className={s.tableBlock}>
              <h2 className={s.blockTitle}>Type Breakdown</h2>
              <TableContainer label="Type breakdown" minWidth={420}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Service Type','Total','Open','Total Cost'].map(h => (
                        <th key={h} scope="col" className={h === 'Service Type' ? undefined : tableStyles.num}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {typeData.map((t, i) => (
                      <tr key={i}>
                        <td className={tableStyles.primary}>{t.type}</td>
                        <td className={tableStyles.num}>{t.count}</td>
                        <td className={tableStyles.num}><span className={t.open > 2 ? s.warnText : undefined}>{t.open}</span></td>
                        <td className={tableStyles.num}>{fmt$(t.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </div>
          </div>
        </div>
      )}

      </div>
    </main>
  );
}
