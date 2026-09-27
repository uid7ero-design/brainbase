'use client';

import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useAppStore } from '@/lib/state/useAppStore';
import { Badge, Metric, MetricStrip, buttonProps, type MetricTone } from '@/components/ui/app';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import styles from './OverviewClient.module.css';

// Authenticated visual-completion pass (user-approved decision B): the
// Command Overview is token-driven and reads in light and dark. Data, the
// computed fields, thresholds, the HLNΛ prompts, the series toggles and the
// quick-nav routes are unchanged; only presentation moved to tokens, the
// shared MetricStrip and the theme-aware chart palette.

type Alert = { severity: 'HIGH' | 'MED' | 'LOW'; label: string; detail: string };
type TrendPoint = { month: string; waste: number; fleet: number };
type SRRow = { status: string; count: number; avg_days: number };
type UploadSummary = { fileName: string; serviceType: string; uploadedAt: string; recordCount: number };

interface Props {
  waste: Record<string, number>;
  fleet: Record<string, number>;
  serviceRequests: SRRow[];
  trend: TrendPoint[];
  alerts: Alert[];
  uploadSummary?: UploadSummary[];
}

// Alert severity → semantic tone (written label + tinted row, never colour alone).
const SEVERITY_TONE: Record<Alert['severity'], 'danger' | 'warning' | 'success'> = {
  HIGH: 'danger',
  MED:  'warning',
  LOW:  'success',
};

const QUICK_NAV = [
  { label: 'Waste',    href: '/dashboard/waste' },
  { label: 'Fleet',    href: '/dashboard/fleet' },
  { label: 'Water',    href: '/dashboard/water' },
  { label: 'Roads',    href: '/dashboard/roads' },
  { label: 'Parks',    href: '/dashboard/parks' },
  { label: 'Labour',   href: '/dashboard/labour' },
  { label: 'Integrations', href: '/dashboard/integrations' },
];

function fmt(n: number) {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function OverviewClient({ waste, fleet, serviceRequests, trend, alerts, uploadSummary = [] }: Props) {
  const [activeLines, setActiveLines] = useState({ waste: true, fleet: true });
  const chart = useDashboardChart();
  const SERIES_COLOR = { waste: chart.palette.primary, fleet: chart.palette.info };

  const openCount    = serviceRequests.find(r => r.status === 'Open')?.count    ?? 0;
  const closedCount  = serviceRequests.find(r => r.status === 'Closed')?.count  ?? 0;
  const pendingCount = serviceRequests.find(r => r.status === 'Pending')?.count ?? 0;
  const avgDays      = serviceRequests.find(r => r.status === 'Open')?.avg_days ?? 0;

  const wasteCost  = Number(waste.total_cost  ?? 0);
  const fleetCost  = Number(fleet.total_fuel  ?? 0) + Number(fleet.total_maintenance ?? 0) + Number(fleet.total_wages ?? 0);
  const totalSpend = wasteCost + fleetCost;

  const totalTonnes = Number(waste.total_tonnes ?? 0);
  const avgContam   = Number(waste.avg_contamination ?? 0);
  const vehicleCount = Number(fleet.vehicle_count ?? 0);
  const totalDefects = Number(fleet.total_defects ?? 0);

  const hasData = totalSpend > 0 || openCount > 0 || trend.length > 0;

  // Same thresholds as before; they now set a semantic tone instead of a hue.
  const contamTone:  MetricTone | undefined = avgContam > 10 ? 'danger' : undefined;
  const openSrTone:  MetricTone | undefined = openCount > 20 ? 'warning' : undefined;
  const defectsTone: MetricTone | undefined = totalDefects > 10 ? 'danger' : totalDefects > 5 ? 'warning' : undefined;

  const highCount = alerts.filter(a => a.severity === 'HIGH').length;

  function askHlna(q: string) {
    useAppStore.getState().fireHelena(q);
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: {value:number; name:string}[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ ...chart.tooltip.contentStyle, padding: '10px 14px' }}>
        <div style={{ fontSize: 11, color: chart.palette.axis, marginBottom: 6, fontWeight: 700 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ fontSize: 12, color: chart.palette.tooltipText, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: p.name === 'waste' ? SERIES_COLOR.waste : SERIES_COLOR.fleet }} />
            {p.name === 'waste' ? 'Waste' : 'Fleet'}: {fmt(p.value)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              Command Overview
            </h1>
            {highCount > 0 && (
              <Badge state="error">
                {highCount} HIGH ALERT{highCount !== 1 ? 'S' : ''}
              </Badge>
            )}
          </div>
          <div className={styles.subtitle}>
            {hasData ? 'Live operational data across all services' : 'No data uploaded yet — upload from a dashboard to see insights'}
          </div>
        </div>
        <button
          type="button"
          {...buttonProps('secondary', 'sm')}
          onClick={() => askHlna('Give me a full executive briefing on operational performance — cover waste, fleet, and service requests. Highlight any risks or anomalies.')}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          Ask HLNΛ for briefing
        </button>
      </div>

      {/* ── Upload summary strip ── */}
      {uploadSummary.length > 0 && (
        <ul className={styles.uploads} aria-label="Recent uploads">
          {uploadSummary.map((u, i) => {
            const label = u.serviceType === 'fleet' ? '🚛 Fleet' : u.serviceType === 'service_requests' ? '📋 SRs' : '♻ Waste';
            const date  = new Date(u.uploadedAt).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
            return (
              <li key={i} className={styles.upload}>
                <span className={styles.uploadDot} aria-hidden="true" />
                <span className={styles.uploadLabel}>{label}</span>
                <span className={styles.sep} aria-hidden="true">·</span>
                <span>{u.recordCount.toLocaleString()} records</span>
                <span className={styles.sep} aria-hidden="true">·</span>
                <span>{u.fileName}</span>
                <span className={styles.sep} aria-hidden="true">·</span>
                <span style={{ color: 'var(--text-muted)' }}>{date}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Metric Cards ── */}
      <div className={styles.metrics}>
        <MetricStrip>
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>◈</span>Total Spend</>} value={fmt(totalSpend)} sub="All services YTD" />
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>♻</span>Waste Cost</>}  value={fmt(wasteCost)}  sub={`${totalTonnes > 0 ? totalTonnes.toLocaleString('en-AU', { maximumFractionDigits: 0 }) + ' tonnes' : 'No data'}`} />
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>🚛</span>Fleet Cost</>}  value={fmt(fleetCost)}  sub={vehicleCount > 0 ? `${vehicleCount} vehicles active` : 'No data'} />
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>⚠</span>Contamination</>} value={avgContam > 0 ? `${avgContam.toFixed(1)}%` : '—'} sub="Avg across suburbs" tone={contamTone} />
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>📋</span>Open SRs</>}    value={openCount > 0 ? String(openCount) : '—'} sub={avgDays > 0 ? `avg ${avgDays.toFixed(1)} days open` : 'No open requests'} tone={openSrTone} />
          <Metric label={<><span aria-hidden="true" className={styles.metricIcon}>🔧</span>Fleet Defects</>} value={totalDefects > 0 ? String(totalDefects) : '—'} sub={vehicleCount > 0 ? `across ${vehicleCount} vehicles` : 'No fleet data'} tone={defectsTone} />
        </MetricStrip>
      </div>

      {/* ── Two-column body ── */}
      <div className={styles.body}>

        {/* Left: Cost trend */}
        <section className={styles.panel} aria-labelledby="overview-trend">
          <div className={styles.panelHead}>
            <h2 id="overview-trend" className={styles.panelTitle}>Monthly Cost Trend</h2>
            <div className={styles.seriesToggles} role="group" aria-label="Series">
              {(['waste', 'fleet'] as const).map(key => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={activeLines[key]}
                  className={styles.seriesToggle}
                  onClick={() => setActiveLines(p => ({ ...p, [key]: !p[key] }))}
                >
                  <span aria-hidden="true" className={styles.seriesSwatch} style={{ background: SERIES_COLOR[key] }} />
                  {key === 'waste' ? '♻ Waste' : '🚛 Fleet'}
                </button>
              ))}
            </div>
          </div>

          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="month" tick={{ ...chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`} tick={{ ...chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: chart.palette.axis }} />
                {activeLines.waste && (
                  <Area type="monotone" dataKey="waste" stroke={SERIES_COLOR.waste} strokeWidth={1.5} fill={SERIES_COLOR.waste} fillOpacity={0.12} dot={false} activeDot={{ r: 4, fill: SERIES_COLOR.waste }} />
                )}
                {activeLines.fleet && (
                  <Area type="monotone" dataKey="fleet" stroke={SERIES_COLOR.fleet} strokeWidth={1.5} fill={SERIES_COLOR.fleet} fillOpacity={0.1} dot={false} activeDot={{ r: 4, fill: SERIES_COLOR.fleet }} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className={styles.emptyChart}>
              <div>
                <div aria-hidden="true" style={{ fontSize: 24, marginBottom: 8, color: 'var(--text-subtle)' }}>◈</div>
                <div className={styles.emptyTitle}>No trend data yet</div>
                <div className={styles.emptySub}>Upload data from the Waste or Fleet dashboards</div>
              </div>
            </div>
          )}
        </section>

        {/* Right column: Service Requests + Alerts */}
        <div className={styles.column}>

          {/* Service Request Summary */}
          <section className={styles.panel} aria-labelledby="overview-sr">
            <h2 id="overview-sr" className={styles.panelTitle} style={{ marginBottom: 12 }}>
              Service Requests
            </h2>
            <dl className={styles.srGrid}>
              {[
                { label: 'Open',    value: openCount,    tone: openCount > 20 ? 'warning' : undefined },
                { label: 'Closed',  value: closedCount,  tone: 'success' },
                { label: 'Pending', value: pendingCount, tone: 'warning' },
                { label: 'Avg Days', value: avgDays > 0 ? avgDays.toFixed(1) : '—', tone: avgDays > 7 ? 'danger' : undefined },
              ].map(item => (
                <div key={item.label} className={styles.srCell}>
                  <dt className={styles.srLabel}>{item.label}</dt>
                  <dd className={styles.srValue} data-tone={item.tone}>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Alerts */}
          <section className={styles.panel} aria-labelledby="overview-alerts" style={{ flex: 1 }}>
            <div className={styles.panelHead} style={{ marginBottom: 12 }}>
              <h2 id="overview-alerts" className={styles.panelTitle}>
                Alerts & Anomalies
              </h2>
              {alerts.length > 0 && (
                <span className={styles.count}>{alerts.length} active</span>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className={styles.noAlerts}>
                <div aria-hidden="true" style={{ fontSize: 18, marginBottom: 6 }}>✓</div>
                <div>No anomalies detected</div>
              </div>
            ) : (
              <ul className={styles.alerts}>
                {alerts.map((a, i) => (
                  <li key={i} className={styles.alert} data-tone={SEVERITY_TONE[a.severity]}>
                    <span className={styles.alertDot} aria-hidden="true" />
                    <div>
                      <div className={styles.alertLabel}>{a.label}</div>
                      <div className={styles.alertDetail}>{a.detail}</div>
                    </div>
                    <span className={styles.alertSeverity}>{a.severity}</span>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              {...buttonProps('secondary', 'sm')}
              className={`${buttonProps('secondary', 'sm').className} ${styles.investigate}`}
              onClick={() => askHlna('Analyse the current alerts and anomalies in operational data. What are the root causes and what actions should I take?')}
            >
              Ask HLNΛ to investigate
            </button>
          </section>

        </div>
      </div>

      {/* ── Quick nav to dashboards ── */}
      <nav className={styles.quickNav} aria-labelledby="overview-quicknav">
        <h2 id="overview-quicknav" className={styles.quickNavTitle}>Service Dashboards</h2>
        <ul className={styles.quickNavList}>
          {QUICK_NAV.map(d => (
            <li key={d.href}>
              <a href={d.href} {...buttonProps('secondary', 'sm')}>
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
