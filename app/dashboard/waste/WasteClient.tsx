'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import DashboardShell, {
  type KPI, type MonthlyPoint, type CostAccount, type InsightCard,
  type RecommendedAction,
} from '@/components/dashboard/DashboardShell';
import type { ZoneRow, MonthlyRow, MonthlyByTypeRow, ContaminationRow, UploadMeta } from './page';

// ─── Props ────────────────────────────────────────────────────────────────────

export type WasteClientProps = {
  isDemo: boolean;
  uploadMeta: UploadMeta | null;
  zones: ZoneRow[];
  monthly: MonthlyRow[];
  monthlyByType: MonthlyByTypeRow[];
  contamination: ContaminationRow[];
  composition: { name: string; value: number }[];
  serviceTypes: string[];
  financialYears: string[];
};

// ─── Colours ──────────────────────────────────────────────────────────────────

const SVC_COLORS: Record<string, string> = {
  'General Waste': '#64748b',
  'Recycling':     '#3b82f6',
  'Organics':      '#10b981',
  'Hard Waste':    '#f59e0b',
  'Other':         '#8b5cf6',
};
const FALLBACK = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
function svcColor(name: string, i: number) { return SVC_COLORS[name] ?? FALLBACK[i % FALLBACK.length]; }

// ─── Design tokens ────────────────────────────────────────────────────────────

const DC: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12, padding: 20,
};
const DTT = { background: '#0d0f14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 };
const T1 = '#F5F7FA';
const T2 = 'rgba(230,237,243,0.55)';
const T3 = 'rgba(230,237,243,0.35)';
const BORDER = 'rgba(255,255,255,0.07)';
const ROW_BDR = 'rgba(255,255,255,0.05)';
const ROW_HEAD = 'rgba(255,255,255,0.04)';
const GRID = 'rgba(255,255,255,0.05)';
const TICK = 'rgba(255,255,255,0.4)';

// ─── Pill badge ───────────────────────────────────────────────────────────────

function Pill({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span style={{ background: bg, color: text, borderRadius: 6, padding: '2px 9px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>
      {label}
    </span>
  );
}

// ─── Data source banner (real data) ──────────────────────────────────────────

function DataSourceBanner({ meta }: { meta: UploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  const svcLabel = meta.serviceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Pill label="Live Data" bg="#10b981" text="#fff" />
      <span style={{ fontSize: 13, color: T2 }}>
        <span style={{ color: T1, fontWeight: 600 }}>{meta.fileName}</span>
        <span style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{meta.recordCount.toLocaleString()} records imported</span>
        <span style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{svcLabel}</span>
        <span style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

// ─── Demo banner ──────────────────────────────────────────────────────────────

function DemoBanner() {
  return (
    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Pill label="Demo" bg="#f59e0b" text="#000" />
      <div style={{ fontSize: 13, color: T2, lineHeight: 1.5 }}>
        Sample data is shown below.{' '}
        <span style={{ color: T1, fontWeight: 600 }}>Upload a spreadsheet to activate this dashboard with your real data.</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: T3 }}>
          Go to <span style={{ color: T2, fontFamily: 'monospace' }}>Data → Upload</span> and select service type <span style={{ color: T2, fontFamily: 'monospace' }}>Waste</span>.
        </span>
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 20, borderLeft: `3px solid ${accent}` }}>
      <p style={{ fontSize: 10, color: T3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: T1, margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>
    </div>
  );
}

// ─── Insight tile ─────────────────────────────────────────────────────────────

function InsightTile({ icon, color, title, body }: { icon: string; color: 'red' | 'amber' | 'green'; title: string; body: string }) {
  const c = { red: '#ef4444', amber: '#f59e0b', green: '#4ade80' }[color];
  return (
    <div style={{ background: `${c}0d`, border: `1px solid ${c}28`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, lineHeight: 1.4 }}>{icon}</span>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: T1, margin: '0 0 4px' }}>{title}</p>
          <p style={{ fontSize: 12, color: T2, lineHeight: 1.55, margin: 0 }}>{body}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 10px' }}>{children}</p>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WasteClient({
  isDemo, uploadMeta, zones, monthly, monthlyByType, contamination, composition, serviceTypes,
}: WasteClientProps) {

  // ─── Aggregates ─────────────────────────────────────────────────────────────
  const totalCost        = zones.reduce((s, z) => s + z.total_cost, 0);
  const totalTonnes      = zones.reduce((s, z) => s + z.total_tonnes, 0);
  const totalCollections = zones.reduce((s, z) => s + z.total_collections, 0);
  const avgCPT           = totalTonnes > 0 ? totalCost / totalTonnes : 0;
  const avgContamination = contamination.length > 0
    ? contamination.reduce((s, c) => s + c.rate, 0) / contamination.length
    : null;

  const sorted   = [...zones].sort((a, b) => a.cost_per_tonne - b.cost_per_tonne);
  const best     = sorted[0];
  const worst    = sorted[sorted.length - 1];
  const effGap   = best?.cost_per_tonne > 0
    ? ((worst.cost_per_tonne - best.cost_per_tonne) / best.cost_per_tonne * 100).toFixed(0)
    : '0';

  const peakZone  = [...zones].sort((a, b) => b.total_cost - a.total_cost)[0];
  const avgTotal  = totalCost / Math.max(zones.length, 1);
  const peakPct   = Math.round(((peakZone.total_cost - avgTotal) / avgTotal) * 100);
  const contamTop = contamination[0];

  // ─── Shell KPIs (header strip) ──────────────────────────────────────────────
  const kpis: KPI[] = [
    { label: 'Total Tonnes',     value: `${totalTonnes.toLocaleString()} t`,  sub: `${totalCollections.toLocaleString()} collections`, icon: '🗑', status: 'normal' },
    { label: 'Total Cost',       value: `$${totalCost.toLocaleString()}`,       sub: `${zones.length} suburbs`,                          icon: '💰', status: 'normal' },
    { label: 'Cost per Tonne',   value: `$${avgCPT.toFixed(2)}`,               sub: 'Fleet-wide average',                               icon: '📊', status: 'normal' },
    { label: 'Avg Contamination',value: avgContamination != null ? `${avgContamination.toFixed(1)}%` : '—', sub: contamTop ? `${contamTop.suburb} worst at ${contamTop.rate.toFixed(1)}%` : 'No data', icon: '⚠', status: avgContamination != null && avgContamination > 10 ? 'risk' : avgContamination != null && avgContamination > 7 ? 'watch' : 'normal' },
  ];

  // ─── Insight cards for shell ─────────────────────────────────────────────────
  const insightCards: InsightCard[] = [
    {
      problem: `${peakZone.suburb} is the highest-cost suburb at $${peakZone.total_cost.toLocaleString()} — ${peakPct}% above average`,
      cause: 'Higher tonnage or collection density is likely driving elevated costs',
      recommendation: 'Review collection routes and service frequencies for efficiency opportunities',
      severity: 'High',
    },
    ...(contamTop && contamTop.rate > 10 ? [{
      problem: `${contamTop.suburb} contamination at ${contamTop.rate.toFixed(1)}% — above the 10% threshold`,
      cause: 'Mixed-use or high-density areas often show elevated contamination without targeted education',
      recommendation: 'Deploy education campaign and consider bin audits in this suburb',
      severity: (contamTop.rate > 15 ? 'High' : 'Medium') as 'High' | 'Medium',
    }] : []),
    ...(Number(effGap) > 20 ? [{
      problem: `${effGap}% cost-per-tonne gap between ${best?.suburb} and ${worst?.suburb}`,
      cause: 'Route inefficiencies or service mix differences create significant per-unit cost variation',
      recommendation: `Share collection practices from ${best?.suburb} across higher-cost suburbs`,
      severity: (Number(effGap) > 30 ? 'High' : 'Medium') as 'High' | 'Medium',
    }] : []),
  ];

  // ─── Recommended actions ────────────────────────────────────────────────────
  const recommendedActions: RecommendedAction[] = [
    {
      title: `Audit ${peakZone.suburb} service costs`,
      explanation: `At $${peakZone.total_cost.toLocaleString()}, this suburb runs ${peakPct}% above average. Route and service-frequency review is the highest ROI action.`,
      impact: 'Est. 10–15% cost reduction in highest-cost suburb', priority: 'High',
    },
    ...(contamTop && contamTop.rate > 10 ? [{
      title: `Contamination campaign — ${contamTop.suburb}`,
      explanation: `${contamTop.rate.toFixed(1)}% contamination rate increases processing costs and risks MRF surcharges.`,
      impact: 'Reduce contamination surcharge exposure', priority: 'High' as const,
    }] : []),
    ...(Number(effGap) > 20 ? [{
      title: 'Cross-suburb route optimisation',
      explanation: `${effGap}% efficiency gap indicates routing inefficiencies. A network-level review could close the gap by ~50%.`,
      impact: 'Potential 15–25% cost-per-tonne reduction in worst-performing suburbs', priority: 'Medium' as const,
    }] : []),
  ];

  // ─── Charts ──────────────────────────────────────────────────────────────────
  const chartData = zones.map(z => ({
    id: z.suburb,
    shortId: z.suburb.length > 12 ? z.suburb.substring(0, 11) + '…' : z.suburb,
    ...z.service_costs,
  }));

  // ─── Overview content ────────────────────────────────────────────────────────
  const overviewContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Data source banner */}
      {!isDemo && uploadMeta && <DataSourceBanner meta={uploadMeta} />}
      {isDemo && <DemoBanner />}

      {/* KPI row — tonnes, collections, avg contamination, top suburb */}
      <div>
        <SectionLabel>Key Metrics</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          <KpiCard
            label="Total Tonnes"
            value={`${totalTonnes.toLocaleString()} t`}
            sub={`${totalCollections.toLocaleString()} collections`}
            accent="#10b981"
          />
          <KpiCard
            label="Avg Contamination"
            value={avgContamination != null ? `${avgContamination.toFixed(1)}%` : '—'}
            sub={contamTop ? `${contamTop.suburb} worst (${contamTop.rate.toFixed(1)}%)` : 'No contamination data'}
            accent={avgContamination != null && avgContamination > 10 ? '#ef4444' : '#f59e0b'}
          />
          <KpiCard
            label="Top Cost Suburb"
            value={peakZone.suburb}
            sub={`$${peakZone.total_cost.toLocaleString()} · ${peakPct > 0 ? '+' : ''}${peakPct}% vs avg`}
            accent="#3b82f6"
          />
          <KpiCard
            label="Cost per Tonne"
            value={`$${avgCPT.toFixed(2)}`}
            sub={`${best?.suburb ?? '—'} best · ${worst?.suburb ?? '—'} worst`}
            accent="#8b5cf6"
          />
        </div>
      </div>

      {/* Insight panel */}
      <div>
        <SectionLabel>Key Findings</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max(insightCards.length, 1), 3)}, 1fr)`, gap: 12 }}>
          {peakZone && (
            <InsightTile
              icon="⚠" color="red"
              title={`${peakZone.suburb} — highest cost`}
              body={`$${peakZone.total_cost.toLocaleString()} total, ${peakPct > 0 ? `${peakPct}% above` : 'below'} average. Review route density and service frequency.`}
            />
          )}
          {contamTop && contamTop.rate > 5 && (
            <InsightTile
              icon="♻" color="amber"
              title={`${contamTop.suburb} — highest contamination`}
              body={`${contamTop.rate.toFixed(1)}% contamination rate. ${contamTop.rate > 10 ? 'Above 10% threshold — education campaign recommended.' : 'Monitor closely.'}`}
            />
          )}
          {best && worst && Number(effGap) > 5 && (
            <InsightTile
              icon="✓" color="green"
              title={`${best.suburb} — most efficient`}
              body={`$${best.cost_per_tonne.toFixed(2)}/t vs $${worst.cost_per_tonne.toFixed(2)}/t in ${worst.suburb}. ${effGap}% gap — share practices across suburbs.`}
            />
          )}
        </div>
      </div>

      {/* Cost breakdown charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ ...DC, padding: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost Breakdown by Suburb</h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Cost by service stream per suburb</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} />
              <Legend formatter={v => v} wrapperStyle={{ fontSize: 12, color: T2 }} />
              {serviceTypes.map((st, i) => (
                <Bar key={st} dataKey={st} name={st} fill={svcColor(st, i)} radius={[3, 3, 0, 0]} stackId="a" />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...DC, padding: 24, display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost by Stream</h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>All suburbs combined — ${ totalCost.toLocaleString()}</p>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={composition} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {composition.map((c, i) => <Cell key={i} fill={svcColor(c.name, i)} />)}
                </Pie>
                <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {composition.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: svcColor(c.name, i) }} />
                  <span style={{ color: T2 }}>{c.name}</span>
                </div>
                <span style={{ fontWeight: 600, color: T1 }}>{Math.round((c.value / totalCost) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Suburb table */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, color: T1 }}>Suburb Cost Summary</h2>
            <p style={{ margin: 0, fontSize: 12, color: T3 }}>{zones.length} suburbs · Full breakdown including efficiency metrics</p>
          </div>
          {isDemo && <Pill label="Demo data" bg="rgba(245,158,11,0.15)" text="#f59e0b" />}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {['Suburb', 'Total Cost', 'Tonnes', 'Collections', 'Contamination %', '$/Tonne'].map(h => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 10, color: T3, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: h === 'Suburb' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: z.suburb === peakZone?.suburb ? 'rgba(239,68,68,0.05)' : z.suburb === best?.suburb ? 'rgba(74,222,128,0.05)' : 'transparent' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: T1 }}>
                  {z.suburb}
                  {z.suburb === peakZone?.suburb && <span style={{ marginLeft: 8, fontSize: 10, color: '#ef4444', fontWeight: 700 }}>▲ Highest</span>}
                  {z.suburb === best?.suburb      && <span style={{ marginLeft: 8, fontSize: 10, color: '#4ade80', fontWeight: 700 }}>✓ Best</span>}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: T1 }}>${z.total_cost.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>{z.total_tonnes.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>{z.total_collections.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: z.avg_contamination != null && z.avg_contamination > 10 ? '#ef4444' : z.avg_contamination != null ? '#4ade80' : T3, fontWeight: 600 }}>
                  {z.avg_contamination != null ? `${z.avg_contamination.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: z.cost_per_tonne > avgCPT * 1.1 ? '#ef4444' : z.cost_per_tonne < avgCPT * 0.9 ? '#4ade80' : T2, fontWeight: 600 }}>
                  ${z.cost_per_tonne.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid rgba(255,255,255,0.1)`, background: ROW_HEAD, fontWeight: 700 }}>
              <td style={{ padding: '10px 14px', color: T1 }}>Total / Average</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${totalCost.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>{totalTonnes.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>{totalCollections.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>—</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${avgCPT.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  // ─── Industry tabs ────────────────────────────────────────────────────────────
  const industryTabs = [
    {
      label: 'Monthly Cost Trend',
      content: (
        <div style={{ ...DC, padding: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Monthly Operating Cost by Stream</h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Actual cost across all suburbs</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyByType} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              {serviceTypes.map((st, i) => (
                <Bar key={st} dataKey={st} name={st} fill={svcColor(st, i)} radius={[3, 3, 0, 0]} stackId="m" />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    {
      label: 'Suburb Benchmarking',
      content: (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {['Suburb', 'Total Cost', '$/Tonne', 'Tonnes', 'Collections', 'Contamination %', 'Rank'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: T3, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((z, i) => (
                <tr key={z.suburb} style={{ borderBottom: `1px solid ${ROW_BDR}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: T1 }}>{z.suburb}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>${z.total_cost.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: z.cost_per_tonne > avgCPT * 1.1 ? '#ef4444' : z.cost_per_tonne < avgCPT * 0.9 ? '#4ade80' : T1, fontWeight: 600 }}>${z.cost_per_tonne.toFixed(2)}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.total_tonnes.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.total_collections.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: z.avg_contamination != null && z.avg_contamination > 10 ? '#ef4444' : '#4ade80', fontWeight: 600 }}>
                    {z.avg_contamination != null ? `${z.avg_contamination.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: i === 0 ? '#4ade80' : i >= sorted.length - 2 ? '#ef4444' : T1 }}>#{i + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      label: 'Contamination',
      content: contamination.length === 0
        ? <div style={{ ...DC, textAlign: 'center', padding: 40, color: T3 }}>No contamination data in uploaded records.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={DC}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Contamination Rate by Suburb</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, contamination.length * 38)}>
                <BarChart data={contamination} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="suburb" tick={{ fill: TICK, fontSize: 10 }} width={120} />
                  <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} contentStyle={DTT} />
                  <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                    {contamination.map((d, i) => (
                      <Cell key={i} fill={d.rate > 15 ? '#ef4444' : d.rate > 10 ? '#f59e0b' : '#4ade80'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={DC}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Contamination Detail</h3>
              {contamination.slice(0, 12).map(z => (
                <div key={z.suburb} style={{ padding: '10px 0', borderBottom: `1px solid ${ROW_BDR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: T1 }}>{z.suburb}</span>
                    <span style={{ color: z.rate > 10 ? '#ef4444' : '#4ade80', fontWeight: 700 }}>{z.rate.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(z.rate * 4, 100)}%`, height: '100%', background: z.rate > 15 ? '#ef4444' : z.rate > 10 ? '#f59e0b' : '#4ade80', borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
    },
  ];

  // ─── Cost accounts (for shell financial tab) ──────────────────────────────────
  const costAccounts: CostAccount[] = composition.map(c => ({
    account: c.name, dept: 'Operations', budget: 0, actual: Math.round(c.value),
  }));

  const executiveSummary = `$${totalCost.toLocaleString()} total operating cost across ${zones.length} suburbs at $${avgCPT.toFixed(2)}/t average.${contamTop && contamTop.rate > 10 ? ` ${contamTop.suburb} contamination at ${contamTop.rate.toFixed(1)}% is the top compliance risk.` : ''} Efficiency gap of ${effGap}% between best and worst suburb.${isDemo ? ' (Demo data — upload your spreadsheet to see real figures.)' : ''}`;

  return (
    <DashboardShell
      theme="dark"
      title="Waste & Recycling"
      subtitle={isDemo
        ? 'Demo data — upload a spreadsheet to activate'
        : `${zones.length} suburbs · ${totalTonnes.toLocaleString()} t · ${serviceTypes.join(', ')}`}
      headerColor="#064e3b"
      accentColor="#10b981"
      breadcrumbLabel="Waste & Recycling"
      kpis={kpis}
      recommendedActions={recommendedActions}
      insightCards={insightCards}
      overviewContent={overviewContent}
      industryTabs={industryTabs}
      monthlyTrend={monthly as MonthlyPoint[]}
      costAccounts={costAccounts}
      slaTargets={[]}
      defaultActions={[]}
      aiContext={`Waste dashboard: ${zones.length} suburbs, $${totalCost.toLocaleString()} total cost, $${avgCPT.toFixed(2)}/t avg. Service types: ${serviceTypes.join(', ')}. Top contamination: ${contamTop ? `${contamTop.suburb} ${contamTop.rate.toFixed(1)}%` : 'N/A'}. ${isDemo ? 'DEMO DATA.' : `Source: ${uploadMeta?.fileName ?? 'uploaded file'}`}`}
      uploadServiceType="waste"
      executiveSummary={executiveSummary}
      snapshotPanel={{
        topCostDriver: `${peakZone.suburb} — $${peakZone.total_cost.toLocaleString()}`,
        biggestRisk: contamTop && contamTop.rate > 10
          ? `Contamination at ${contamTop.rate.toFixed(1)}% in ${contamTop.suburb}`
          : `${effGap}% efficiency gap across suburbs`,
        savingsIdentified: Math.round(((worst?.cost_per_tonne ?? 0) - (best?.cost_per_tonne ?? 0)) * totalTonnes * 0.3),
        confidence: isDemo ? 0 : 78,
        lastUpdated: uploadMeta
          ? new Date(uploadMeta.uploadedAt).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
          : 'Demo data',
      }}
    />
  );
}
