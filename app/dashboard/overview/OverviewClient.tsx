'use client';

import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useAppStore } from '@/lib/state/useAppStore';

type Alert = { severity: 'HIGH' | 'MED' | 'LOW'; label: string; detail: string };
type TrendPoint = { month: string; waste: number; fleet: number };
type SRRow = { status: string; count: number; avg_days: number };

interface Props {
  waste: Record<string, number>;
  fleet: Record<string, number>;
  serviceRequests: SRRow[];
  trend: TrendPoint[];
  alerts: Alert[];
}

const FONT = "var(--font-inter), -apple-system, sans-serif";

const SEVERITY_STYLE: Record<Alert['severity'], { dot: string; text: string; bg: string; border: string }> = {
  HIGH: { dot: '#EF4444', text: '#FCA5A5', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.20)' },
  MED:  { dot: '#F59E0B', text: '#FCD34D', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.20)' },
  LOW:  { dot: '#22C55E', text: '#86EFAC', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.20)'  },
};

function fmt(n: number) {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function MetricCard({ label, value, sub, accent = '#A78BFA', icon, danger = false }: {
  label: string; value: string; sub?: string; accent?: string; icon?: string; danger?: boolean;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)'}`,
      borderTop: `2px solid ${danger ? '#EF4444' : accent}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
      transition: 'border-color 0.2s, background 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: danger ? '#FCA5A5' : '#F4F4F5', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}

export default function OverviewClient({ waste, fleet, serviceRequests, trend, alerts }: Props) {
  const [activeLines, setActiveLines] = useState({ waste: true, fleet: true });

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

  function askHlna(q: string) {
    useAppStore.getState().fireHelena(q);
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: {value:number; name:string}[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#0D0D15', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '10px 14px', fontFamily: FONT }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginBottom: 6, fontWeight: 700 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ fontSize: 12, color: p.name === 'waste' ? '#A78BFA' : '#38BDF8', marginBottom: 2 }}>
            {p.name === 'waste' ? 'Waste' : 'Fleet'}: {fmt(p.value)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: FONT, padding: '20px 24px 80px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#F4F4F5' }}>
              Command Overview
            </h1>
            {alerts.filter(a => a.severity === 'HIGH').length > 0 && (
              <span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 10, fontWeight: 700, color: '#FCA5A5', letterSpacing: '0.06em' }}>
                {alerts.filter(a => a.severity === 'HIGH').length} HIGH ALERT{alerts.filter(a => a.severity === 'HIGH').length !== 1 ? 'S' : ''}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            {hasData ? 'Live operational data across all services' : 'No data uploaded yet — upload from a dashboard to see insights'}
          </div>
        </div>
        <button
          onClick={() => askHlna('Give me a full executive briefing on operational performance — cover waste, fleet, and service requests. Highlight any risks or anomalies.')}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 14px', borderRadius: 8,
            background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.28)',
            color: '#C4B5FD', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.2s', letterSpacing: '-0.01em', fontFamily: FONT,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.22)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(124,58,237,0.45)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.12)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(124,58,237,0.28)';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          Ask HLNΛ for briefing
        </button>
      </div>

      {/* ── Metric Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        <MetricCard label="Total Spend" value={fmt(totalSpend)} sub="All services YTD" accent="#A78BFA" icon="◈" />
        <MetricCard label="Waste Cost"  value={fmt(wasteCost)}  sub={`${totalTonnes > 0 ? totalTonnes.toLocaleString('en-AU', { maximumFractionDigits: 0 }) + ' tonnes' : 'No data'}`} accent="#8B5CF6" icon="♻" />
        <MetricCard label="Fleet Cost"  value={fmt(fleetCost)}  sub={vehicleCount > 0 ? `${vehicleCount} vehicles active` : 'No data'} accent="#38BDF8" icon="🚛" />
        <MetricCard label="Contamination" value={avgContam > 0 ? `${avgContam.toFixed(1)}%` : '—'} sub="Avg across suburbs" accent={avgContam > 10 ? '#EF4444' : '#22C55E'} danger={avgContam > 10} icon="⚠" />
        <MetricCard label="Open SRs"    value={openCount > 0 ? String(openCount) : '—'} sub={avgDays > 0 ? `avg ${avgDays.toFixed(1)} days open` : 'No open requests'} accent={openCount > 20 ? '#F59E0B' : '#22C55E'} icon="📋" />
        <MetricCard label="Fleet Defects" value={totalDefects > 0 ? String(totalDefects) : '—'} sub={vehicleCount > 0 ? `across ${vehicleCount} vehicles` : 'No fleet data'} accent={totalDefects > 5 ? '#EF4444' : '#22C55E'} danger={totalDefects > 10} icon="🔧" />
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, alignItems: 'start' }}>

        {/* Left: Cost trend */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>Monthly Cost Trend</span>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['waste', 'fleet'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setActiveLines(p => ({ ...p, [key]: !p[key] }))}
                  style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer',
                    background: activeLines[key] ? (key === 'waste' ? 'rgba(167,139,250,0.15)' : 'rgba(56,189,248,0.15)') : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${activeLines[key] ? (key === 'waste' ? 'rgba(167,139,250,0.35)' : 'rgba(56,189,248,0.35)') : 'rgba(255,255,255,0.08)'}`,
                    color: activeLines[key] ? (key === 'waste' ? '#A78BFA' : '#38BDF8') : 'rgba(255,255,255,0.28)',
                    transition: 'all 0.2s',
                    fontFamily: FONT,
                  }}
                >
                  {key === 'waste' ? '♻ Waste' : '🚛 Fleet'}
                </button>
              ))}
            </div>
          </div>

          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="wasteGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fleetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.32)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`} tick={{ fill: 'rgba(255,255,255,0.32)', fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
                <Tooltip content={<CustomTooltip />} />
                {activeLines.waste && (
                  <Area type="monotone" dataKey="waste" stroke="#A78BFA" strokeWidth={1.5} fill="url(#wasteGrad)" dot={false} activeDot={{ r: 4, fill: '#A78BFA' }} />
                )}
                {activeLines.fleet && (
                  <Area type="monotone" dataKey="fleet" stroke="#38BDF8" strokeWidth={1.5} fill="url(#fleetGrad)" dot={false} activeDot={{ r: 4, fill: '#38BDF8' }} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>◈</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>No trend data yet</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)', marginTop: 4 }}>Upload data from the Waste or Fleet dashboards</div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Service Requests + Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Service Request Summary */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)', marginBottom: 12 }}>
              Service Requests
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {[
                { label: 'Open',    value: openCount,    color: openCount > 20 ? '#F59E0B' : '#F4F4F5' },
                { label: 'Closed',  value: closedCount,  color: '#22C55E' },
                { label: 'Pending', value: pendingCount, color: '#F59E0B' },
                { label: 'Avg Days', value: avgDays > 0 ? avgDays.toFixed(1) : '—', color: avgDays > 7 ? '#EF4444' : '#F4F4F5' },
              ].map(item => (
                <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: item.color as string, letterSpacing: '-0.01em' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)' }}>
                Alerts & Anomalies
              </span>
              {alerts.length > 0 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)' }}>{alerts.length} active</span>
              )}
            </div>

            {alerts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 18, marginBottom: 6, opacity: 0.4 }}>✓</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>No anomalies detected</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {alerts.map((a, i) => {
                  const s = SEVERITY_STYLE[a.severity];
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: s.bg, border: `1px solid ${s.border}` }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, boxShadow: `0 0 6px ${s.dot}`, marginTop: 3, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: s.text, lineHeight: 1.3 }}>{a.label}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', lineHeight: 1.3, marginTop: 1 }}>{a.detail}</div>
                      </div>
                      <span style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: s.dot, flexShrink: 0 }}>{a.severity}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => askHlna('Analyse the current alerts and anomalies in operational data. What are the root causes and what actions should I take?')}
              style={{
                marginTop: 12, width: '100%', padding: '7px 12px', borderRadius: 8,
                background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.20)',
                color: '#C4B5FD', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '0.07em', transition: 'all 0.2s',
                fontFamily: FONT,
              }}
            >
              Ask HLNΛ to investigate
            </button>
          </div>

        </div>
      </div>

      {/* ── Quick nav to dashboards ── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 10 }}>Service Dashboards</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Waste',    href: '/dashboard/waste',    color: '#22C55E' },
            { label: 'Fleet',    href: '/dashboard/fleet',    color: '#38BDF8' },
            { label: 'Water',    href: '/dashboard/water',    color: '#818CF8' },
            { label: 'Roads',    href: '/dashboard/roads',    color: '#FB923C' },
            { label: 'Parks',    href: '/dashboard/parks',    color: '#4ADE80' },
            { label: 'Labour',   href: '/dashboard/labour',   color: '#F472B6' },
            { label: 'Integrations', href: '/dashboard/integrations', color: '#A78BFA' },
          ].map(d => (
            <a key={d.href} href={d.href} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              textDecoration: 'none', transition: 'all 0.2s',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.55)',
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = `rgba(${d.color.slice(1).match(/../g)!.map(h => parseInt(h, 16)).join(',')},0.10)`;
                (e.currentTarget as HTMLAnchorElement).style.color = d.color;
                (e.currentTarget as HTMLAnchorElement).style.borderColor = `${d.color}40`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.55)';
                (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.07)';
              }}
            >
              {d.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
