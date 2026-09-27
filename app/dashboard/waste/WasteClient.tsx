'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import DashboardShell, {
  type KPI, type MonthlyPoint, type CostAccount, type InsightCard,
  type RecommendedAction,
} from '@/components/dashboard/DashboardShell';
import type { ZoneRow, MonthlyRow, MonthlyByTypeRow, ContaminationRow, UploadMeta, KpiRule } from './page';
import { HlnaInsightBanner } from '@/components/hlna/InsightBanner';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';
import { TONE } from '@/components/dashboard/ui/tokens';
import type { ChartPalette } from '@/components/ui/app/chartPalette';

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
  kpiRules?: KpiRule[];
};

// ─── Colours ──────────────────────────────────────────────────────────────────

// Authenticated visual-completion pass: service streams keep distinct,
// conventional hues, resolved from the theme-aware chart palette (≥3:1 on the
// panel in both themes). Unknown streams fall back to the categorical series.
type PaletteKey = 'neutral' | 'info' | 'success' | 'warning' | 'secondary';
const SVC_KEYS: Record<string, PaletteKey> = {
  'General Waste': 'neutral',
  'Recycling':     'info',
  'Organics':      'success',
  'Hard Waste':    'warning',
  'Other':         'secondary',
};
function svcColor(pal: ChartPalette, series: string[], name: string, i: number) {
  const key = SVC_KEYS[name];
  return key ? pal[key] : series[i % series.length];
}

// ─── Design tokens (theme-following) ─────────────────────────────────────────

const DC: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 20,
};
const T1 = 'var(--text-primary)';
const T2 = 'var(--text-secondary)';
const T3 = 'var(--text-muted)';
const BORDER = 'var(--border)';
const ROW_BDR = 'var(--border-light)';
const ROW_HEAD = 'var(--bg-sunken)';
type ToneKey = keyof typeof TONE;

// ─── Pill badge ───────────────────────────────────────────────────────────────

function Pill({ label, tone }: { label: string; tone: ToneKey }) {
  const t = TONE[tone];
  return (
    <span style={{ background: t.muted, color: t.fg, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-sm)', padding: '2px 9px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
      {label}
    </span>
  );
}

// ─── Data source banner (real data) ──────────────────────────────────────────

function DataSourceBanner({ meta }: { meta: UploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  const svcLabel = meta.serviceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div style={{ background: TONE.success.muted, border: `1px solid ${TONE.success.border}`, borderRadius: 'var(--radius-lg)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Pill label="Live Data" tone="success" />
      <span style={{ fontSize: 13, color: T2 }}>
        <span style={{ color: T1, fontWeight: 600 }}>{meta.fileName}</span>
        <span aria-hidden="true" style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{meta.recordCount.toLocaleString()} records imported</span>
        <span aria-hidden="true" style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{svcLabel}</span>
        <span aria-hidden="true" style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

// ─── Demo banner ──────────────────────────────────────────────────────────────

function DemoBanner() {
  return (
    <div style={{ background: TONE.warning.muted, border: `1px solid ${TONE.warning.border}`, borderRadius: 'var(--radius-lg)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Pill label="Demo" tone="warning" />
      <div style={{ fontSize: 13, color: T2, lineHeight: 1.5 }}>
        Sample data is shown below.{' '}
        <span style={{ color: T1, fontWeight: 600 }}>Upload a spreadsheet to activate this dashboard with your real data.</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: T3 }}>
          Go to <span style={{ color: T2, fontWeight: 600 }}>Data → Upload</span> and select service type <span style={{ color: T2, fontWeight: 600 }}>Waste</span>.
        </span>
      </div>
    </div>
  );
}

// ─── KPI rule evaluator ───────────────────────────────────────────────────────

function evalMetric(metricBase: string, value: number, rules: KpiRule[]): 'critical' | 'warning' | null {
  const relevant = rules.filter(r => r.metric.startsWith(metricBase + '.'));
  let result: 'critical' | 'warning' | null = null;
  for (const rule of relevant) {
    const breached =
      (rule.operator === 'gt'  && value >  rule.threshold) ||
      (rule.operator === 'gte' && value >= rule.threshold) ||
      (rule.operator === 'lt'  && value <  rule.threshold) ||
      (rule.operator === 'lte' && value <= rule.threshold);
    if (breached) {
      if (rule.severity === 'critical') return 'critical';
      result = 'warning';
    }
  }
  return result;
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent, breach }: { label: string; value: string; sub: string; accent: string; breach?: 'warning' | 'critical' | null }) {
  const bt = breach ? TONE[breach === 'critical' ? 'danger' : 'warning'] : null;
  return (
    <div style={{ background: 'var(--bg-surface)', border: `1px solid ${bt ? bt.border : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: 20, borderLeft: `3px solid ${bt ? bt.fg : accent}`, position: 'relative' }}>
      <p style={{ fontSize: 11, color: T3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {bt && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', background: bt.muted, color: bt.fg, border: `1px solid ${bt.border}`, borderRadius: 'var(--radius-sm)', padding: '1px 5px', textTransform: 'uppercase' }}>
            {breach === 'critical' ? 'CRITICAL' : 'WARNING'}
          </span>
        )}
      </p>
      <p style={{ fontSize: 24, fontWeight: 700, color: bt ? bt.fg : T1, margin: '0 0 4px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>
    </div>
  );
}

// ─── Insight tile ─────────────────────────────────────────────────────────────

function InsightTile({ icon, color, title, body }: { icon: string; color: 'red' | 'amber' | 'green'; title: string; body: string }) {
  const t = TONE[({ red: 'danger', amber: 'warning', green: 'success' } as const)[color]];
  return (
    <div style={{ background: t.muted, border: `1px solid ${t.border}`, borderLeft: `3px solid ${t.fg}`, borderRadius: 'var(--radius-lg)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.4 }}>{icon}</span>
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
    <p style={{ fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>{children}</p>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WasteClient({
  isDemo, uploadMeta, zones, monthly, monthlyByType, contamination, composition, serviceTypes, kpiRules = [],
}: WasteClientProps) {

  // Chart chrome + palette for the active theme.
  const chart = useDashboardChart();
  const pal   = chart.palette;
  const streamColor = (name: string, i: number) => svcColor(pal, chart.series, name, i);

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

  // ─── KPI rule evaluation ────────────────────────────────────────────────────
  const contamBreach = avgContamination != null ? evalMetric('contamination_rate', avgContamination, kpiRules) : null;
  const cptBreach    = evalMetric('cost_per_tonne', avgCPT, kpiRules);

  // Fall back to hard-coded thresholds when no rules are configured
  const contamStatus: KPI['status'] = contamBreach === 'critical' ? 'risk'
    : contamBreach === 'warning' ? 'watch'
    : avgContamination != null && avgContamination > 10 ? 'risk'
    : avgContamination != null && avgContamination > 7  ? 'watch'
    : 'normal';

  const cptStatus: KPI['status'] = cptBreach === 'critical' ? 'risk' : cptBreach === 'warning' ? 'watch' : 'normal';

  // ─── Shell KPIs (header strip) ──────────────────────────────────────────────
  const kpis: KPI[] = [
    { label: 'Total Tonnes',     value: `${totalTonnes.toLocaleString()} t`,  sub: `${totalCollections.toLocaleString()} collections`, icon: '🗑', status: 'normal' },
    { label: 'Total Cost',       value: `$${totalCost.toLocaleString()}`,       sub: `${zones.length} suburbs`,                          icon: '💰', status: 'normal' },
    { label: 'Cost per Tonne',   value: `$${avgCPT.toFixed(2)}`,               sub: 'Fleet-wide average',                               icon: '📊', status: cptStatus, alert: cptBreach != null },
    { label: 'Avg Contamination',value: avgContamination != null ? `${avgContamination.toFixed(1)}%` : '—', sub: contamTop ? `${contamTop.suburb} worst at ${contamTop.rate.toFixed(1)}%` : 'No data', icon: '⚠', status: contamStatus, alert: contamBreach != null },
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

      {/* HLNA proactive insight */}
      {!isDemo && <HlnaInsightBanner dashboardType="waste" />}

      {/* KPI row — tonnes, collections, avg contamination, top suburb */}
      <div>
        <SectionLabel>Key Metrics</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          <KpiCard
            label="Total Tonnes"
            value={`${totalTonnes.toLocaleString()} t`}
            sub={`${totalCollections.toLocaleString()} collections`}
            accent="var(--status-success)"
          />
          <KpiCard
            label="Avg Contamination"
            value={avgContamination != null ? `${avgContamination.toFixed(1)}%` : '—'}
            sub={contamTop ? `${contamTop.suburb} worst (${contamTop.rate.toFixed(1)}%)` : 'No contamination data'}
            accent={avgContamination != null && avgContamination > 10 ? TONE.danger.fg : TONE.warning.fg}
            breach={contamBreach}
          />
          <KpiCard
            label="Top Cost Suburb"
            value={peakZone.suburb}
            sub={`$${peakZone.total_cost.toLocaleString()} · ${peakPct > 0 ? '+' : ''}${peakPct}% vs avg`}
            accent="var(--status-info)"
          />
          <KpiCard
            label="Cost per Tonne"
            value={`$${avgCPT.toFixed(2)}`}
            sub={`${best?.suburb ?? '—'} best · ${worst?.suburb ?? '—'} worst`}
            accent="var(--status-inactive)"
            breach={cptBreach}
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
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="shortId" tick={{ ...chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={chart.tick} axisLine={false} tickLine={false} />
              <Tooltip {...chart.tooltip} formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} />
              <Legend formatter={v => v} wrapperStyle={chart.legend} />
              {serviceTypes.map((st, i) => (
                <Bar key={st} dataKey={st} name={st} fill={streamColor(st, i)} radius={[3, 3, 0, 0]} stackId="a" />
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
                <Pie data={composition} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3} stroke={pal.tooltipBg}>
                  {composition.map((c, i) => <Cell key={i} fill={streamColor(c.name, i)} />)}
                </Pie>
                <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} {...chart.tooltip} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {composition.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: streamColor(c.name, i) }} />
                  <span style={{ color: T2 }}>{c.name}</span>
                </div>
                <span style={{ fontWeight: 600, color: T1 }}>{Math.round((c.value / totalCost) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Suburb table */}
      <div style={{ background: 'var(--bg-surface)', border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, color: T1 }}>Suburb Cost Summary</h2>
            <p style={{ margin: 0, fontSize: 12, color: T3 }}>{zones.length} suburbs · Full breakdown including efficiency metrics</p>
          </div>
          {isDemo && <Pill label="Demo data" tone="warning" />}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {['Suburb', 'Total Cost', 'Tonnes', 'Collections', 'Contamination %', '$/Tonne'].map(h => (
                <th key={h} scope="col" style={{ padding: '10px 14px', fontWeight: 600, fontSize: 11, color: T2, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: h === 'Suburb' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: z.suburb === peakZone?.suburb ? TONE.danger.muted : z.suburb === best?.suburb ? TONE.success.muted : 'transparent' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: T1 }}>
                  {z.suburb}
                  {z.suburb === peakZone?.suburb && <span style={{ marginLeft: 8, fontSize: 11, color: TONE.danger.fg, fontWeight: 700 }}>▲ Highest</span>}
                  {z.suburb === best?.suburb      && <span style={{ marginLeft: 8, fontSize: 11, color: TONE.success.fg, fontWeight: 700 }}>✓ Best</span>}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: T1 }}>${z.total_cost.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>{z.total_tonnes.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>{z.total_collections.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: z.avg_contamination != null && z.avg_contamination > 10 ? TONE.danger.fg : z.avg_contamination != null ? TONE.success.fg : T3, fontWeight: 600 }}>
                  {z.avg_contamination != null ? `${z.avg_contamination.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: z.cost_per_tonne > avgCPT * 1.1 ? TONE.danger.fg : z.cost_per_tonne < avgCPT * 0.9 ? TONE.success.fg : T2, fontWeight: 600 }}>
                  ${z.cost_per_tonne.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border-strong)', background: ROW_HEAD, fontWeight: 700 }}>
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
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Monthly Operating Cost by Stream</h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Actual cost across all suburbs</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyByType} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" tick={chart.tick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={chart.tick} axisLine={false} tickLine={false} />
              <Tooltip {...chart.tooltip} formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} />
              <Legend wrapperStyle={chart.legend} />
              {serviceTypes.map((st, i) => (
                <Bar key={st} dataKey={st} name={st} fill={streamColor(st, i)} radius={[3, 3, 0, 0]} stackId="m" />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    {
      label: 'Suburb Benchmarking',
      content: (
        <div style={{ background: 'var(--bg-surface)', border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {['Suburb', 'Total Cost', '$/Tonne', 'Tonnes', 'Collections', 'Contamination %', 'Rank'].map(h => (
                  <th key={h} scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: T3, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((z, i) => (
                <tr key={z.suburb} style={{ borderBottom: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: T1 }}>{z.suburb}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>${z.total_cost.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: z.cost_per_tonne > avgCPT * 1.1 ? TONE.danger.fg : z.cost_per_tonne < avgCPT * 0.9 ? TONE.success.fg : T1, fontWeight: 600 }}>${z.cost_per_tonne.toFixed(2)}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.total_tonnes.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.total_collections.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: z.avg_contamination != null && z.avg_contamination > 10 ? TONE.danger.fg : TONE.success.fg, fontWeight: 600 }}>
                    {z.avg_contamination != null ? `${z.avg_contamination.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: i === 0 ? TONE.success.fg : i >= sorted.length - 2 ? TONE.danger.fg : T1 }}>#{i + 1}</td>
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
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Contamination Rate by Suburb</h2>
              <ResponsiveContainer width="100%" height={Math.max(200, contamination.length * 38)}>
                <BarChart data={contamination} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" tickFormatter={v => `${v}%`} tick={chart.tick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="suburb" tick={{ ...chart.tick, fontSize: 10 }} width={120} />
                  <Tooltip formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} {...chart.tooltip} />
                  <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                    {contamination.map((d, i) => (
                      <Cell key={i} fill={d.rate > 15 ? pal.danger : d.rate > 10 ? pal.warning : pal.success} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={DC}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Contamination Detail</h2>
              {contamination.slice(0, 12).map(z => (
                <div key={z.suburb} style={{ padding: '10px 0', borderBottom: `1px solid ${ROW_BDR}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: T1 }}>{z.suburb}</span>
                    <span style={{ color: z.rate > 10 ? TONE.danger.fg : TONE.success.fg, fontWeight: 700 }}>{z.rate.toFixed(1)}%</span>
                  </div>
                  <div aria-hidden="true" style={{ height: 4, background: 'var(--bg-sunken)', borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(z.rate * 4, 100)}%`, height: '100%', background: z.rate > 15 ? TONE.danger.fg : z.rate > 10 ? TONE.warning.fg : TONE.success.fg, borderRadius: 2 }} />
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
