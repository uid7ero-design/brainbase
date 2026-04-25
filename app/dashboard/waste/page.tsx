'use client';

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, InsightCard } from '@/components/dashboard/DashboardShell';

// ─── Data ─────────────────────────────────────────────────────────────────────

const RAW_SAMPLE = [
  { id: 'Zone 1 – Northern',   wages: 9200,  fuel: 13800, maintenance: 5100, services: 1800, tonnage: 162, households: 2840 },
  { id: 'Zone 2 – Central',    wages: 8600,  fuel: 12400, maintenance: 4600, services: 1600, tonnage: 149, households: 2610 },
  { id: 'Zone 3 – Eastern',    wages: 10100, fuel: 16200, maintenance: 6400, services: 2100, tonnage: 198, households: 3220 },
  { id: 'Zone 4 – Southern',   wages: 8300,  fuel: 11500, maintenance: 4200, services: 1400, tonnage: 138, households: 2480 },
  { id: 'Zone 5 – Western',    wages: 8800,  fuel: 14100, maintenance: 4900, services: 1700, tonnage: 171, households: 2950 },
  { id: 'Zone 6 – Coastal',    wages: 9700,  fuel: 16800, maintenance: 5800, services: 1900, tonnage: 205, households: 3400 },
  { id: 'Zone 7 – Hills',      wages: 8100,  fuel: 11100, maintenance: 4000, services: 1200, tonnage: 128, households: 2310 },
  { id: 'Zone 8 – Industrial', wages: 9000,  fuel: 15300, maintenance: 5400, services: 2000, tonnage: 187, households: 3050 },
  { id: 'Zone 9 – Suburban',   wages: 8400,  fuel: 12000, maintenance: 4500, services: 1500, tonnage: 144, households: 2560 },
  { id: 'Zone 10 – Riverside', wages: 8700,  fuel: 13000, maintenance: 5000, services: 1600, tonnage: 157, households: 2780 },
];

const SAMPLE_DATA = RAW_SAMPLE.map(r => ({
  ...r,
  total: r.wages + r.fuel + r.maintenance + r.services,
  costPerTonne: +((r.wages + r.fuel + r.maintenance + r.services) / r.tonnage).toFixed(2),
  costPerHousehold: +((r.wages + r.fuel + r.maintenance + r.services) / r.households).toFixed(2),
}));

const MONTHLY_TREND: MonthlyPoint[] = [
  { month: 'Jul', actual: 89400, budget: 92000, prevYear: 84200 },
  { month: 'Aug', actual: 91200, budget: 92000, prevYear: 85100 },
  { month: 'Sep', actual: 88600, budget: 90000, prevYear: 83400 },
  { month: 'Oct', actual: 93800, budget: 92000, prevYear: 88600 },
  { month: 'Nov', actual: 90100, budget: 92000, prevYear: 85900 },
  { month: 'Dec', actual: 94300, budget: 95000, prevYear: 89200 },
  { month: 'Jan', actual: 87900, budget: 90000, prevYear: 82700 },
  { month: 'Feb', actual: 89200, budget: 90000, prevYear: 84100 },
  { month: 'Mar', actual: 92400, budget: 92000, prevYear: 87300 },
  { month: 'Apr', actual: 90800, budget: 92000, prevYear: 86000 },
];

const TONNAGE_MONTHLY = [
  { month: 'Jul', waste: 1420, recycling: 680, organics: 340, hardWaste: 120 },
  { month: 'Aug', waste: 1480, recycling: 710, organics: 360, hardWaste: 95 },
  { month: 'Sep', waste: 1390, recycling: 695, organics: 330, hardWaste: 110 },
  { month: 'Oct', waste: 1510, recycling: 740, organics: 380, hardWaste: 140 },
  { month: 'Nov', waste: 1460, recycling: 720, organics: 355, hardWaste: 100 },
  { month: 'Dec', waste: 1540, recycling: 760, organics: 395, hardWaste: 185 },
  { month: 'Jan', waste: 1380, recycling: 670, organics: 325, hardWaste: 90 },
  { month: 'Feb', waste: 1400, recycling: 685, organics: 335, hardWaste: 85 },
  { month: 'Mar', waste: 1470, recycling: 715, organics: 360, hardWaste: 115 },
  { month: 'Apr', waste: 1440, recycling: 700, organics: 345, hardWaste: 105 },
];

const CONTAMINATION_DATA = [
  { zone: 'Zone 1 – Northern', rate: 8.2,  educationActions: 3, improvement: -1.2 },
  { zone: 'Zone 3 – Eastern',  rate: 14.8, educationActions: 7, improvement: -2.1 },
  { zone: 'Zone 6 – Coastal',  rate: 6.1,  educationActions: 1, improvement: -0.4 },
  { zone: 'Zone 8 – Industrial',rate: 22.4, educationActions: 12, improvement: 1.2 },
  { zone: 'Zone 9 – Suburban', rate: 10.6, educationActions: 4, improvement: -1.8 },
];

const COST_ACCOUNTS: CostAccount[] = [
  { account: 'Wages & Labour',    dept: 'Operations',  budget: 88000,  actual: 90700 },
  { account: 'Fuel',              dept: 'Fleet',        budget: 140000, actual: 145800 },
  { account: 'Maintenance',       dept: 'Workshop',     budget: 50000,  actual: 53200 },
  { account: 'Contract Services', dept: 'Operations',   budget: 18000,  actual: 17400 },
  { account: 'Disposal Levies',   dept: 'Compliance',   budget: 62000,  actual: 64100 },
  { account: 'Administration',    dept: 'Admin',        budget: 14000,  actual: 13800 },
];

const SLA_TARGETS: SLATarget[] = [
  { kpi: 'On-time collection rate', target: '≥ 97%', actual: '94.8%', status: 'At Risk', note: 'Vehicle breakdown in Zone 3' },
  { kpi: 'Missed bin response time', target: '< 24h', actual: '18h', status: 'Met' },
  { kpi: 'Contamination rate (recycling)', target: '< 10%', actual: '12.4%', status: 'Missed', note: 'Zone 8 Industrial high risk' },
  { kpi: 'Diversion rate', target: '≥ 60%', actual: '57.2%', status: 'At Risk', note: 'Below FY target' },
  { kpi: 'Customer complaint resolution', target: '< 48h', actual: '31h', status: 'Met' },
  { kpi: 'Fleet downtime', target: '< 5%', actual: '3.2%', status: 'Met' },
];

const DEFAULT_ACTIONS: Action[] = [
  { id: '1', title: 'Investigate Zone 8 contamination — education campaign', assignee: 'Waste Coordinator', dueDate: '2026-05-15', status: 'In progress', priority: 'High' },
  { id: '2', title: 'Route optimisation review — Zone 3 & 6', assignee: 'Fleet Manager', dueDate: '2026-05-30', status: 'Not started', priority: 'Medium' },
  { id: '3', title: 'Tender renewal for Recycling contract — Zone 1-5', assignee: 'Procurement', dueDate: '2026-06-30', status: 'Not started', priority: 'High' },
];

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

// ─── Dark design tokens ───────────────────────────────────────────────────────

const DC: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 };
const DTT = { background: '#0d0f14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 };
const T1 = '#F5F7FA';
const T2 = 'rgba(230,237,243,0.55)';
const T3 = 'rgba(230,237,243,0.35)';
const BORDER = 'rgba(255,255,255,0.07)';
const ROW_BDR = 'rgba(255,255,255,0.05)';
const ROW_HEAD = 'rgba(255,255,255,0.04)';
const GRID = 'rgba(255,255,255,0.05)';
const TICK = 'rgba(255,255,255,0.4)';

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.07)`, borderRadius: 16, padding: 20, borderLeft: `4px solid ${accent}` }}>
      <p style={{ fontSize: 10, color: T3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: T1, marginBottom: 4, margin: '0 0 4px' }}>{value}</p>
      <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>
    </div>
  );
}

function Insight({ icon, color, title, body }: { icon: string; color: string; title: string; body: string }) {
  const c = { red: '#ef4444', amber: '#f59e0b', green: '#4ade80' }[color as 'red' | 'amber' | 'green'] ?? 'rgba(255,255,255,0.4)';
  return (
    <div style={{ background: `${c}0d`, border: `1px solid ${c}30`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: T1, marginBottom: 4, margin: '0 0 4px' }}>{title}</p>
          <p style={{ fontSize: 12, color: T2, lineHeight: 1.5, margin: 0 }}>{body}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WasteDashboard() {
  const [data] = useState(SAMPLE_DATA);

  const total = data.reduce((s, r) => s + r.total, 0);
  const totalTonnage = data.reduce((s, r) => s + r.tonnage, 0);
  const totalHouseholds = data.reduce((s, r) => s + r.households, 0);
  const avgCPT = totalTonnage > 0 ? total / totalTonnage : 0;
  const avgCPH = totalHouseholds > 0 ? total / totalHouseholds : 0;
  const sorted = [...data].sort((a, b) => a.costPerTonne - b.costPerTonne);
  const mostEfficient = sorted[0];
  const leastEfficient = sorted[sorted.length - 1];
  const peakZone = data.reduce((max, r) => r.total > max.total ? r : max, data[0]);
  const avgTotal = total / data.length;
  const peakPct = Math.round(((peakZone.total - avgTotal) / avgTotal) * 100);
  const totalFuel = data.reduce((s, r) => s + r.fuel, 0);
  const fuelPct = Math.round((totalFuel / total) * 100);
  const effGap = ((leastEfficient.costPerTonne - mostEfficient.costPerTonne) / mostEfficient.costPerTonne * 100).toFixed(0);
  const composition = [
    { name: 'Wages', value: data.reduce((s, r) => s + r.wages, 0) },
    { name: 'Fuel', value: totalFuel },
    { name: 'Maintenance', value: data.reduce((s, r) => s + r.maintenance, 0) },
    { name: 'Services', value: data.reduce((s, r) => s + r.services, 0) },
  ];

  const kpis: KPI[] = [
    { label: 'Total Operating Cost', value: `$${total.toLocaleString()}`,              sub: 'All zones',           icon: '💰', status: 'normal' },
    { label: 'Total Tonnage',        value: `${totalTonnage.toLocaleString()} t`,      sub: `${data.length} zones`, icon: '🗑', status: 'normal' },
    { label: 'Cost per Tonne',       value: `$${avgCPT.toFixed(2)}`,                  sub: 'Fleet-wide avg',      icon: '📊', status: 'normal' },
    { label: 'Cost per Household',   value: `$${avgCPH.toFixed(2)}`,                  sub: `${totalHouseholds.toLocaleString()} HH`, icon: '🏠', status: 'normal' },
    { label: 'Fuel % of Cost',       value: `${fuelPct}%`,                            sub: `$${totalFuel.toLocaleString()}`, icon: '⛽', status: Number(fuelPct) > 35 ? 'watch' : 'normal' },
    { label: 'Efficiency Gap',       value: `${effGap}%`,                             sub: 'Best vs worst zone',  icon: '⚡', alert: Number(effGap) > 30, status: Number(effGap) > 30 ? 'risk' : Number(effGap) > 20 ? 'watch' : 'normal' },
  ];

  // ─── Overview content ─────────────────────────────────────────────────────

  const overviewContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <KpiCard label="Total Operating Cost" value={`$${total.toLocaleString()}`} sub="All zones this period" accent="#3b82f6" />
        <KpiCard label="Total Tonnage Collected" value={`${totalTonnage.toLocaleString()} t`} sub={`${data.length} active zones`} accent="#10b981" />
        <KpiCard label="Cost per Tonne" value={`$${avgCPT.toFixed(2)}`} sub="Fleet-wide average" accent="#f59e0b" />
        <KpiCard label="Cost per Household" value={`$${avgCPH.toFixed(2)}`} sub={`${totalHouseholds.toLocaleString()} HH served`} accent="#8b5cf6" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        <Insight icon="⚠" color="red" title={`${peakZone.id.split('–')[0].trim()} highest cost`} body={`At $${peakZone.total.toLocaleString()}, this zone runs ${peakPct}% above average. Review route density and overtime.`} />
        <Insight icon="⛽" color="amber" title={`Fuel is ${fuelPct}% of all costs`} body={`$${totalFuel.toLocaleString()} on fuel. A 10% reduction through routing saves ~$${Math.round(totalFuel * 0.1).toLocaleString()}.`} />
        <Insight icon="✓" color="green" title={`${mostEfficient.id.split('–')[0].trim()} most efficient`} body={`$${mostEfficient.costPerTonne}/t vs $${leastEfficient.costPerTonne}/t — ${effGap}% gap. Share practices across zones.`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ ...DC, padding: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost Breakdown by Zone</h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Wages, fuel, maintenance and services per zone</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.map(r => ({ ...r, shortId: r.id.split('–')[0].trim() }))} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend formatter={v => v.charAt(0).toUpperCase() + v.slice(1)} wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="wages" name="Wages" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fuel" name="Fuel" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="maintenance" name="Maintenance" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="services" name="Services" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...DC, padding: 24, display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost Composition</h2>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Across all zones</p>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={composition} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {composition.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {composition.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: PIE_COLORS[i] }} />
                  <span style={{ color: T2 }}>{c.name}</span>
                </div>
                <span style={{ fontWeight: 600, color: T1 }}>{Math.round((c.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}` }}>
          <h2 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, color: T1 }}>Zone Cost Summary</h2>
          <p style={{ margin: 0, fontSize: 12, color: T3 }}>Full breakdown including efficiency metrics</p>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {['Zone', 'Wages', 'Fuel', 'Maintenance', 'Services', 'Tonnage', 'Households', 'Total', '$/Tonne', '$/HH'].map(h => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 10, color: T3, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: h === 'Zone' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: row.id === peakZone?.id ? 'rgba(239,68,68,0.06)' : row.id === mostEfficient?.id ? 'rgba(74,222,128,0.06)' : 'transparent' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: T1 }}>
                  {row.id}
                  {row.id === peakZone?.id && <span style={{ marginLeft: 8, fontSize: 11, color: '#ef4444', fontWeight: 700 }}>▲ Highest</span>}
                  {row.id === mostEfficient?.id && <span style={{ marginLeft: 8, fontSize: 11, color: '#4ade80', fontWeight: 700 }}>✓ Best</span>}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.wages.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.fuel.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.maintenance.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.services.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T3 }}>{row.tonnage.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T3 }}>{row.households.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: T1 }}>${row.total.toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.costPerTonne}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: T2 }}>${row.costPerHousehold}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid rgba(255,255,255,0.1)`, background: ROW_HEAD, fontWeight: 700 }}>
              <td style={{ padding: '10px 14px', color: T1 }}>Total / Average</td>
              {[data.reduce((s, r) => s + r.wages, 0), data.reduce((s, r) => s + r.fuel, 0), data.reduce((s, r) => s + r.maintenance, 0), data.reduce((s, r) => s + r.services, 0)].map((v, i) => <td key={i} style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${v.toLocaleString()}</td>)}
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>{totalTonnage.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>{totalHouseholds.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${total.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${avgCPT.toFixed(2)}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: T1 }}>${avgCPH.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  // ─── Industry tabs ────────────────────────────────────────────────────────

  const industryTabs = [
    {
      label: 'Tonnage Analysis',
      content: (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Monthly Tonnage by Stream</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={TONNAGE_MONTHLY}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} />
                <YAxis tick={{ fill: TICK, fontSize: 11 }} />
                <Tooltip contentStyle={DTT} />
                <Legend wrapperStyle={{ color: T2, fontSize: 12 }} />
                <Bar dataKey="waste" fill="#64748b" name="General Waste" radius={[3, 3, 0, 0]} />
                <Bar dataKey="recycling" fill="#3b82f6" name="Recycling" radius={[3, 3, 0, 0]} />
                <Bar dataKey="organics" fill="#10b981" name="Organics" radius={[3, 3, 0, 0]} />
                <Bar dataKey="hardWaste" fill="#f59e0b" name="Hard Waste" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Diversion Rate & Cost per Tonne</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {[['Diversion Rate', '57.2%', '#10b981'], ['Avg Cost/Tonne', `$${avgCPT.toFixed(2)}`, '#3b82f6'], ['Total Tonnes (YTD)', `${(TONNAGE_MONTHLY.reduce((s, m) => s + m.waste + m.recycling + m.organics + m.hardWaste, 0)).toLocaleString()}`, '#f59e0b'], ['Recycling Rate', '31.4%', '#8b5cf6']].map(([l, v, c]) => (
                <div key={l} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: T3, marginBottom: 6 }}>{l}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 14, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 12, marginBottom: 8, fontWeight: 600, color: T1 }}>Stream Mix (YTD)</div>
              {[{ name: 'General Waste', pct: 57, color: '#64748b' }, { name: 'Recycling', pct: 31, color: '#3b82f6' }, { name: 'Organics', pct: 15, color: '#10b981' }, { name: 'Hard Waste', pct: 6, color: '#f59e0b' }].map(s => (
                <div key={s.name} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}><span style={{ color: T2 }}>{s.name}</span><span style={{ color: s.color, fontWeight: 600 }}>{s.pct}%</span></div>
                  <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}><div style={{ width: `${s.pct}%`, height: '100%', background: s.color, borderRadius: 3 }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...DC, gridColumn: '1 / -1' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost per Tonne by Zone</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sorted} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={v => `$${v}/t`} tick={{ fill: TICK, fontSize: 11 }} />
                <YAxis type="category" dataKey="id" tick={{ fill: TICK, fontSize: 10 }} width={140} />
                <Tooltip formatter={(v: any) => [`$${v}/t`, 'Cost per Tonne']} contentStyle={DTT} />
                <Bar dataKey="costPerTonne" radius={[0, 4, 4, 0]}>
                  {sorted.map((_, i) => <Cell key={i} fill={i === 0 ? '#10b981' : i === sorted.length - 1 ? '#ef4444' : '#3b82f6'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ),
    },
    {
      label: 'Zone Benchmarking',
      content: (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: ROW_HEAD }}>{['Zone', 'Cost/HH', 'Cost/Tonne', 'Tonnage', 'HH Served', 'Contamination %', 'Missed Services', 'Rank'].map(h => <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, color: T3, fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{data.map((z, i) => {
              const contam = CONTAMINATION_DATA.find(c => c.zone === z.id);
              return (
                <tr key={z.id} style={{ borderBottom: `1px solid ${ROW_BDR}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: T1 }}>{z.id}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>${z.costPerHousehold}</td>
                  <td style={{ padding: '12px 16px', color: z.costPerTonne > avgCPT * 1.1 ? '#ef4444' : z.costPerTonne < avgCPT * 0.9 ? '#4ade80' : T1, fontWeight: 600 }}>${z.costPerTonne}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.tonnage}t</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{z.households.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: contam && contam.rate > 10 ? '#ef4444' : '#4ade80', fontWeight: 600 }}>{contam ? `${contam.rate}%` : '< 5%'}</td>
                  <td style={{ padding: '12px 16px', color: T2 }}>{Math.round(z.tonnage * 0.02)}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: i === 0 ? '#4ade80' : i >= sorted.length - 2 ? '#ef4444' : T1 }}>#{sorted.indexOf(z) + 1}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ),
    },
    {
      label: 'Contract Performance',
      content: (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            { contractor: 'CleanCity Pty Ltd', zones: 'Zone 1–5', services: 'General waste + recycling', score: 87, onTime: 94.2, missed: 12, complaints: 8, contract: '2024–2027' },
            { contractor: 'EcoHaul Solutions', zones: 'Zone 6–10', services: 'General waste + organics', score: 79, onTime: 91.8, missed: 22, complaints: 14, contract: '2023–2026' },
            { contractor: 'GreenCycle Organics', zones: 'All zones', services: 'Green organics processing', score: 94, onTime: 98.1, missed: 3, complaints: 2, contract: '2025–2028' },
            { contractor: 'Reclaim MRF', zones: 'All zones', services: 'Recycling sorting & processing', score: 81, onTime: 93.4, missed: 9, complaints: 6, contract: '2024–2027' },
          ].map(c => (
            <div key={c.contractor} style={DC}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div><div style={{ fontWeight: 700, fontSize: 15, color: T1 }}>{c.contractor}</div><div style={{ fontSize: 12, color: T2, marginTop: 2 }}>{c.zones} · {c.services}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 800, color: c.score >= 90 ? '#4ade80' : c.score >= 80 ? '#f59e0b' : '#ef4444' }}>{c.score}</div><div style={{ fontSize: 10, color: T3 }}>Score</div></div>
              </div>
              {[['On-Time Delivery', `${c.onTime}%`, c.onTime >= 95], ['Missed Services', String(c.missed), c.missed <= 10], ['Complaints', String(c.complaints), c.complaints <= 5], ['Contract Term', c.contract, true]].map(([l, v, ok]) => (
                <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${ROW_BDR}`, fontSize: 13 }}>
                  <span style={{ color: T2 }}>{l}</span>
                  <span style={{ fontWeight: 600, color: typeof ok === 'boolean' && l !== 'Contract Term' ? (ok ? '#4ade80' : '#ef4444') : T1 }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ),
    },
    {
      label: 'Household Entitlements',
      content: (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Service Entitlements</h3>
            {[{ service: '140L General Waste (weekly)', entitled: totalHouseholds, active: totalHouseholds, included: true }, { service: '240L Recycling (fortnightly)', entitled: totalHouseholds, active: totalHouseholds - 84, included: true }, { service: '120L Organics (weekly)', entitled: Math.round(totalHouseholds * 0.72), active: Math.round(totalHouseholds * 0.68), included: false }, { service: 'Hard Waste (2× per year)', entitled: totalHouseholds, active: totalHouseholds, included: true }, { service: 'Additional 240L bin', entitled: totalHouseholds, active: 1842, included: false }].map(e => (
              <div key={e.service} style={{ padding: '10px 0', borderBottom: `1px solid ${ROW_BDR}`, fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: T1 }}>{e.service}</div>
                <div style={{ display: 'flex', gap: 16, color: T2 }}>
                  <span>Entitled: {e.entitled.toLocaleString()}</span>
                  <span>Active: <span style={{ color: '#4ade80', fontWeight: 600 }}>{e.active.toLocaleString()}</span></span>
                  <span style={{ color: e.included ? '#4ade80' : '#f59e0b', fontWeight: 600 }}>{e.included ? 'Included' : 'User-pays'}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Cost per Household Analysis</h3>
            {[['Annual cost per HH', `$${(avgCPH * 52).toFixed(2)}`], ['Monthly cost per HH', `$${(avgCPH * 4.33).toFixed(2)}`], ['Council rate contribution', '~$0.14/day'], ['Growth (new HH this FY)', '+184 properties'], ['HH with additional bins', '1,842 (6.5%)'], ['Revenue from extra bins', '$221,040']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${ROW_BDR}`, fontSize: 13 }}>
                <span style={{ color: T2 }}>{l}</span>
                <span style={{ fontWeight: 600, color: '#4ade80' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      label: 'Contamination',
      content: (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Contamination Rate by Zone</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={CONTAMINATION_DATA} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} />
                <YAxis type="category" dataKey="zone" tick={{ fill: TICK, fontSize: 10 }} width={140} />
                <Tooltip formatter={(v: any) => `${v}%`} contentStyle={DTT} />
                <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                  {CONTAMINATION_DATA.map((d, i) => <Cell key={i} fill={d.rate > 15 ? '#ef4444' : d.rate > 10 ? '#f59e0b' : '#4ade80'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={DC}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: T1 }}>Education Actions & Trend</h3>
            {CONTAMINATION_DATA.map(z => (
              <div key={z.zone} style={{ padding: '10px 0', borderBottom: `1px solid ${ROW_BDR}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: T1 }}>{z.zone.split('–')[0].trim()}</span>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ color: z.rate > 10 ? '#ef4444' : '#4ade80', fontWeight: 600 }}>{z.rate}%</span>
                    <span style={{ color: z.improvement < 0 ? '#4ade80' : '#ef4444', fontSize: 12 }}>{z.improvement > 0 ? '+' : ''}{z.improvement}%</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: T3 }}>{z.educationActions} education actions completed this period</div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <DashboardShell
      theme="dark"
      title="Waste & Recycling"
      subtitle="Zone cost analysis · Tonnage tracking · Diversion rates · Contract compliance"
      headerColor="#064e3b"
      accentColor="#10b981"
      breadcrumbLabel="Waste & Recycling"
      kpis={kpis}
      recommendedActions={[
        {title:"Enforce Zone 8 contamination audit (avoid $48k processing surcharge)",explanation:"Zone 8 contamination at 22.4% — 2.2× the 10% target. 12 education actions completed with minimal improvement. Bin audit and mandatory reporting are the next escalation.",impact:"$48,000 processing surcharge avoided",priority:"High"},
        {title:"Rebalance Zones 3 & 6 collection routes (save $32k annually in fuel and wages)",explanation:"Zones 3 and 6 are the highest cost-per-tonne outside Zone 8. Overlapping routes identified with 14% mileage reduction potential and overtime labour inflating cost.",impact:"Est. $32,000 annual fuel and wage saving",priority:"High"},
        {title:"Retender $180k recycling contract for Zones 1–5 before June 30",explanation:"Current contract expires FY26. Proactive retender avoids sole-source risk and locks in competitive pricing on the network's largest contract.",impact:"Competitive pricing on $180,000+ annual contract",priority:"Medium"},
        {title:"Expand organics service to close 2.8% diversion gap (avoid ESG breach)",explanation:"15% of households not participating in organics — the highest-potential diversion stream. Adding ~200t/year would close the gap and meet the 60% target.",impact:"$48,000 processing surcharge reduction + ESG compliance",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"Zone 8 contamination at 22.4% — 2.2× the 10% target, costing $48k in annual processing surcharges",cause:"Commercial and industrial bins commingled without signage, audit enforcement, or mandatory reporting requirements",recommendation:"Commission bin audit and introduce mandatory contamination reporting for industrial properties — recover $48k surcharge cost",severity:"High"},
        {problem:"Cost per tonne in Zones 3 and 6 is 25% above FY budget — $32k annual overspend",cause:"14% mileage redundancy from overlapping collection routes, compounded by overtime labour inflating cost per service",recommendation:"Rebalance collection routes and trial consolidated Friday run — target $32k annual saving within 2 months",severity:"Medium"},
        {problem:"Diversion rate stagnant at 57.2% — 2.8% below the 60% target for 2 consecutive quarters",cause:"15% of households not participating in organics — the highest-potential diversion stream — remain untapped",recommendation:"Expand organics service to 28% of non-participating households this FY; report progress monthly to close gap by June 30",severity:"Medium"},
      ]}
      overviewContent={overviewContent}
      industryTabs={industryTabs}
      sampleData={{ 'Waste Data': RAW_SAMPLE, 'Monthly Trend': MONTHLY_TREND }}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="This is a waste and recycling operations dashboard for a local council. Key concerns are contamination in Zone 8 and below-target diversion rate."
      executiveSummary="Zone 8 contamination at 22.4% is driving a $48k processing surcharge while the diversion rate stagnates 2.8% below the 60% target — route rebalancing and contract retender offer $80k+ in combined savings."
      snapshotPanel={{ topCostDriver: 'Processing surcharges — Zone 8 contamination at 22.4%', biggestRisk: 'Diversion rate stagnant at 57.2% — ESG reporting breach risk by EOFY', savingsIdentified: 80000, confidence: 82, lastUpdated: 'Apr 2026' }}
    />
  );
}
