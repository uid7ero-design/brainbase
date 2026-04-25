'use client';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from '@/components/dashboard/DashboardShell';

const SAMPLE_CARBON = [
  { month: 'Nov', scope1: 48.2, scope2: 18.4, scope3: 22.1, total: 88.7 },
  { month: 'Dec', scope1: 52.1, scope2: 19.8, scope3: 24.3, total: 96.2 },
  { month: 'Jan', scope1: 45.9, scope2: 17.2, scope3: 20.8, total: 83.9 },
  { month: 'Feb', scope1: 43.4, scope2: 16.9, scope3: 19.4, total: 79.7 },
  { month: 'Mar', scope1: 47.6, scope2: 18.1, scope3: 21.2, total: 86.9 },
  { month: 'Apr', scope1: 44.8, scope2: 17.5, scope3: 20.6, total: 82.9 },
];

const SAMPLE_ENERGY = [
  { site: 'Administration',   elec_kwh: 18400, solar_kwh: 4200, gas_mj: 8200,  cost: 4820 },
  { site: 'Depot & Workshop', elec_kwh: 42100, solar_kwh: 9800, gas_mj: 22400, cost: 11340 },
  { site: 'Rec Centre',       elec_kwh: 34800, solar_kwh: 6100, gas_mj: 44200, cost: 14200 },
  { site: 'Aquatic Centre',   elec_kwh: 58200, solar_kwh: 8400, gas_mj: 96000, cost: 22800 },
  { site: 'Library',          elec_kwh: 9800,  solar_kwh: 2200, gas_mj: 3400,  cost: 2640 },
];

const SAMPLE_WATER = [
  { month: 'Nov', potable: 18400, recycled: 2100, lost: 820 },
  { month: 'Dec', potable: 21200, recycled: 2400, lost: 940 },
  { month: 'Jan', potable: 24800, recycled: 2800, lost: 1100 },
  { month: 'Feb', potable: 22100, recycled: 2600, lost: 980 },
  { month: 'Mar', potable: 19800, recycled: 2300, lost: 860 },
  { month: 'Apr', potable: 17600, recycled: 2000, lost: 740 },
];

const SAMPLE_WASTE = [
  { stream: 'General Waste',   ytd_t: 182.4, recycled_pct: 0,   disposal: 'Landfill',   cost: 14592 },
  { stream: 'Commingled Rec.', ytd_t: 94.8,  recycled_pct: 100, disposal: 'MRF',         cost: 4740 },
  { stream: 'Green Waste',     ytd_t: 241.0, recycled_pct: 100, disposal: 'Composting',  cost: 8435 },
  { stream: 'Concrete/Rubble', ytd_t: 88.2,  recycled_pct: 80,  disposal: 'Recycler',   cost: 3090 },
  { stream: 'Hazardous',       ytd_t: 4.2,   recycled_pct: 0,   disposal: 'Licensed',    cost: 9240 },
  { stream: 'Electronic Waste',ytd_t: 0.8,   recycled_pct: 100, disposal: 'eCycle',      cost: 320 },
];

const ESG_TARGETS = [
  { target: 'Net Zero by 2040',         category: 'Climate', progress: 28, unit: '%', baseline: '2019 = 518 tCO₂e' },
  { target: '100% Renewables by 2030',  category: 'Energy',  progress: 34, unit: '%', baseline: '34% renewable electricity' },
  { target: '50% Waste Diversion 2026', category: 'Waste',   progress: 68, unit: '%', baseline: '68% diversion rate' },
  { target: '20% Water Reduction 2026', category: 'Water',   progress: 11, unit: '%', baseline: 'vs 2021 baseline' },
  { target: 'EV Fleet 40% by 2028',     category: 'Fleet',   progress: 12, unit: '%', baseline: '3 of 26 vehicles EV' },
];

const FLEET_EMISSIONS = [
  { vehicle: 'Light Truck 001', type: 'Diesel',   fuel_l: 420,  co2_kg: 1113, km: 3800 },
  { vehicle: 'HV Truck 002',    type: 'Diesel',   fuel_l: 1840, co2_kg: 4878, km: 6200 },
  { vehicle: 'Excavator 003',   type: 'Diesel',   fuel_l: 960,  co2_kg: 2544, km: 0 },
  { vehicle: 'Van 004',         type: 'Petrol',   fuel_l: 280,  co2_kg: 644,  km: 4100 },
  { vehicle: 'EV Ute 005',      type: 'Electric', fuel_l: 0,    co2_kg: 0,    km: 2200 },
  { vehicle: 'EV Van 006',      type: 'Electric', fuel_l: 0,    co2_kg: 0,    km: 3100 },
  { vehicle: 'EV Car 007',      type: 'Electric', fuel_l: 0,    co2_kg: 0,    km: 5800 },
];

const FLEET_BY_TYPE = [
  { name: 'Diesel', value: 2 },
  { name: 'Petrol', value: 1 },
  { name: 'Electric', value: 3 },
  { name: 'Other', value: 20 },
];

const PIE_COLORS = ['#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534'];
const FLEET_COLORS = ['#f87171', '#fbbf24', '#4ade80', '#94a3b8'];

const totalCarbon = SAMPLE_CARBON.reduce((s, m) => s + m.total, 0).toFixed(1);
const totalElec = SAMPLE_ENERGY.reduce((s, e) => s + e.elec_kwh, 0);
const totalSolar = SAMPLE_ENERGY.reduce((s, e) => s + e.solar_kwh, 0);
const solarPct = Math.round(totalSolar / totalElec * 100);
const diversionRate = Math.round(
  SAMPLE_WASTE.filter(w => w.recycled_pct > 0).reduce((s, w) => s + w.ytd_t, 0) /
  SAMPLE_WASTE.reduce((s, w) => s + w.ytd_t, 0) * 100
);

const MONTHLY_TREND: MonthlyPoint[] = [
  { month: 'Jul', actual: 58200, budget: 62000 },
  { month: 'Aug', actual: 61400, budget: 62000 },
  { month: 'Sep', actual: 54800, budget: 60000 },
  { month: 'Oct', actual: 59100, budget: 60000 },
  { month: 'Nov', actual: 56300, budget: 60000 },
  { month: 'Dec', actual: 63400, budget: 62000 },
  { month: 'Jan', actual: 55700, budget: 60000 },
  { month: 'Feb', actual: 52100, budget: 58000 },
  { month: 'Mar', actual: 57800, budget: 60000 },
  { month: 'Apr', actual: 55200, budget: 60000 },
];

const COST_ACCOUNTS: CostAccount[] = [
  { account: 'Energy (Electricity)', dept: 'Environment', budget: 220000, actual: 214300 },
  { account: 'Energy (Gas)',         dept: 'Environment', budget: 95000,  actual: 102400 },
  { account: 'Waste Management',     dept: 'Environment', budget: 140000, actual: 144700 },
  { account: 'Fleet Fuel',           dept: 'Environment', budget: 85000,  actual: 88200 },
  { account: 'Carbon Offsets',       dept: 'Environment', budget: 42000,  actual: 38900 },
  { account: 'Environmental Programs', dept: 'Environment', budget: 68000, actual: 64100 },
];

const SLA_TARGETS: SLATarget[] = [
  { kpi: 'Emissions Reduction Rate',  target: '>5% YoY',         actual: '3.2%',  status: 'At Risk', note: 'Below annual reduction milestone' },
  { kpi: 'Waste Diversion Rate',      target: '>65% diverted',   actual: '68%',   status: 'Met',     note: 'Ahead of 2026 target' },
  { kpi: 'Renewable Energy Share',    target: '>30% electricity', actual: '34%',   status: 'Met',     note: 'On track for 2030' },
  { kpi: 'Water Reduction vs Baseline', target: '>10% reduction', actual: '11%',  status: 'Met',     note: 'Slight improvement vs 2021' },
  { kpi: 'EV Fleet Transition',       target: '>15% EV by 2026',  actual: '12%',  status: 'At Risk', note: '1 more EV needed this FY' },
];

const DEFAULT_ACTIONS: Action[] = [
  { id: 'ACT-001', title: 'Renew solar PV maintenance contract — Aquatic Centre', assignee: 'Facilities Mgr', dueDate: '2026-05-30', status: 'In progress', priority: 'High' },
  { id: 'ACT-002', title: 'Submit annual greenhouse gas inventory to council',     assignee: 'ESG Officer',   dueDate: '2026-06-30', status: 'Not started', priority: 'High' },
  { id: 'ACT-003', title: 'Evaluate EV ute to replace Light Truck 001 (2027)',    assignee: 'Fleet Mgr',    dueDate: '2026-07-15', status: 'Not started', priority: 'Medium' },
  { id: 'ACT-004', title: 'Install sub-metering at Recreation Centre',            assignee: 'Capital Works', dueDate: '2026-08-01', status: 'Not started', priority: 'Low' },
];

const KPI_DATA: KPI[] = [
  { label: 'Total Emissions (YTD)', value: `${totalCarbon} tCO₂e`, sub: 'Scopes 1, 2 & 3', icon: '🌿', status: 'watch' },
  { label: 'Solar Generation',      value: `${solarPct}%`,          sub: 'Of grid electricity', icon: '☀️', status: 'normal' },
  { label: 'Waste Diversion Rate',  value: `${diversionRate}%`,     sub: 'Away from landfill', icon: '♻️', status: 'normal' },
  { label: 'Recycled Water Use',    value: '12%',                   sub: 'Of total water use', icon: '💧', status: 'normal' },
  { label: 'EV Fleet Share',        value: '12%',                   sub: '3 of 26 vehicles', icon: '⚡', status: 'watch' },
  { label: 'ESG Targets On Track',  value: `${ESG_TARGETS.filter(t => t.progress >= 25).length}/${ESG_TARGETS.length}`, sub: 'Meeting milestones', icon: '🎯', status: 'normal' },
];

const dc = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 } as const;
const darkWrap: React.CSSProperties = { background: '#0f0f0f', color: '#e5e7eb', padding: 24, minHeight: '100%' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 };
const tdBase: React.CSSProperties = { padding: '12px 16px' };

function badge(label: string, bg: string, color: string) {
  return <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: bg, color }}>{label}</span>;
}

export default function EnvironmentPage() {
  const overviewContent = (
    <div style={darkWrap}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={dc}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Monthly Carbon Emissions (tCO₂e)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={SAMPLE_CARBON}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
              <Area type="monotone" dataKey="scope1" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.6} name="Scope 1" />
              <Area type="monotone" dataKey="scope2" stackId="1" stroke="#4ade80" fill="#4ade80" fillOpacity={0.6} name="Scope 2" />
              <Area type="monotone" dataKey="scope3" stackId="1" stroke="#86efac" fill="#86efac" fillOpacity={0.6} name="Scope 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={dc}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Waste Diversion by Stream</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={SAMPLE_WASTE} dataKey="ytd_t" nameKey="stream" cx="50%" cy="50%" outerRadius={80} label={(p: any) => String(p.stream ?? '').split(' ')[0]}>
                {SAMPLE_WASTE.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => typeof v === 'number' ? `${v}t` : v} contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...dc, gridColumn: '1 / -1' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>ESG Target Progress</h3>
          {ESG_TARGETS.map(t => (
            <div key={t.target} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                <span><strong>{t.target}</strong> <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>({t.baseline})</span></span>
                <span style={{ color: '#4ade80', fontWeight: 600 }}>{t.progress}{t.unit}</span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                <div style={{ width: `${t.progress}%`, height: '100%', background: t.progress >= 50 ? '#4ade80' : t.progress >= 25 ? '#fbbf24' : '#f87171', borderRadius: 3, transition: 'width 0.6s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const industryTabs: IndustryTab[] = [
    {
      label: 'Carbon Emissions',
      content: (
        <div style={darkWrap}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={dc}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Scope 1 — Direct Emissions</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={SAMPLE_CARBON}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                  <Bar dataKey="scope1" fill="#16a34a" radius={[4,4,0,0]} name="Scope 1 (tCO₂e)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={dc}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Total Monthly Emissions</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={SAMPLE_CARBON}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                  <Line type="monotone" dataKey="total" stroke="#4ade80" strokeWidth={2} dot={{ fill: '#16a34a' }} name="Total (tCO₂e)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ ...dc, gridColumn: '1 / -1', padding: 0, overflow: 'hidden' }}>
              <table style={tbl}>
                <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {['Month','Scope 1','Scope 2','Scope 3','Total (tCO₂e)'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>{SAMPLE_CARBON.map((m, i) => (
                  <tr key={m.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{m.month}</td>
                    <td style={tdBase}>{m.scope1}</td>
                    <td style={tdBase}>{m.scope2}</td>
                    <td style={tdBase}>{m.scope3}</td>
                    <td style={{ ...tdBase, fontWeight: 600, color: '#4ade80' }}>{m.total}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      ),
    },
    {
      label: 'Energy',
      content: (
        <div style={darkWrap}>
          <div style={{ ...dc, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Electricity vs Solar Generation by Site (kWh)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={SAMPLE_ENERGY} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="site" width={130} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} formatter={(v) => typeof v === 'number' ? `${v.toLocaleString()} kWh` : v} />
                <Bar dataKey="elec_kwh" fill="rgba(56,189,248,0.3)" radius={[0,4,4,0]} name="Grid Electricity" />
                <Bar dataKey="solar_kwh" fill="#4ade80" radius={[0,4,4,0]} name="Solar" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>
                {['Site','Electricity (kWh)','Solar (kWh)','Gas (MJ)','Cost ($)','Solar %'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_ENERGY.map((e, i) => {
                const pct = Math.round(e.solar_kwh / e.elec_kwh * 100);
                return (
                  <tr key={e.site} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{e.site}</td>
                    <td style={tdBase}>{e.elec_kwh.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: '#4ade80' }}>{e.solar_kwh.toLocaleString()}</td>
                    <td style={tdBase}>{e.gas_mj.toLocaleString()}</td>
                    <td style={tdBase}>${e.cost.toLocaleString()}</td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#4ade80', borderRadius: 3 }} />
                        </div>
                        <span>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Water',
      content: (
        <div style={darkWrap}>
          <div style={{ ...dc, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Monthly Water Consumption (kL)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={SAMPLE_WATER}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                <Bar dataKey="potable"  fill="#0ea5e9" radius={[4,4,0,0]} name="Potable (kL)" />
                <Bar dataKey="recycled" fill="#4ade80" radius={[4,4,0,0]} name="Recycled (kL)" />
                <Bar dataKey="lost"     fill="#f87171" radius={[4,4,0,0]} name="Losses (kL)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>
                {['Month','Potable (kL)','Recycled (kL)','Losses (kL)','Recycled %'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_WATER.map((w, i) => {
                const total = w.potable + w.recycled;
                const rPct = Math.round(w.recycled / total * 100);
                return (
                  <tr key={w.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{w.month}</td>
                    <td style={tdBase}>{w.potable.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: '#4ade80' }}>{w.recycled.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: '#f87171' }}>{w.lost.toLocaleString()}</td>
                    <td style={tdBase}>{rPct}%</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Waste & Recycling',
      content: (
        <div style={darkWrap}>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>
                {['Stream','YTD Volume (t)','Recycled','Disposal Method','Cost ($)','Diversion'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_WASTE.map((w, i) => (
                <tr key={w.stream} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{w.stream}</td>
                  <td style={tdBase}>{w.ytd_t}</td>
                  <td style={tdBase}>{w.recycled_pct}%</td>
                  <td style={{ ...tdBase, color: 'rgba(255,255,255,0.6)' }}>{w.disposal}</td>
                  <td style={tdBase}>${w.cost.toLocaleString()}</td>
                  <td style={tdBase}>{badge(w.recycled_pct === 100 ? 'Diverted' : w.recycled_pct > 0 ? 'Partial' : 'Landfill', w.recycled_pct === 100 ? 'rgba(74,222,128,0.15)' : w.recycled_pct > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)', w.recycled_pct === 100 ? '#4ade80' : w.recycled_pct > 0 ? '#fbbf24' : '#f87171')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Fleet Emissions',
      content: (
        <div style={darkWrap}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div style={dc}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Fleet by Fuel Type</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={FLEET_BY_TYPE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={(p: any) => `${p.name} (${p.value})`}>
                    {FLEET_BY_TYPE.map((_, i) => <Cell key={i} fill={FLEET_COLORS[i % FLEET_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={dc}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>CO₂ by Vehicle (kg) — YTD</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={FLEET_EMISSIONS.filter(v => v.co2_kg > 0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="vehicle" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                  <Bar dataKey="co2_kg" fill="#f87171" radius={[4,4,0,0]} name="CO₂ (kg)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>
                {['Vehicle','Fuel Type','Fuel Used (L)','CO₂ (kg)','Distance (km)','Intensity (kg/km)'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{FLEET_EMISSIONS.map((v, i) => {
                const intensity = v.km > 0 ? (v.co2_kg / v.km).toFixed(2) : '—';
                return (
                  <tr key={v.vehicle} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{v.vehicle}</td>
                    <td style={tdBase}>{badge(v.type, v.type === 'Electric' ? 'rgba(74,222,128,0.15)' : v.type === 'Petrol' ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)', v.type === 'Electric' ? '#4ade80' : v.type === 'Petrol' ? '#fbbf24' : '#f87171')}</td>
                    <td style={tdBase}>{v.fuel_l || '—'}</td>
                    <td style={{ ...tdBase, color: v.co2_kg > 0 ? '#f87171' : '#4ade80' }}>{v.co2_kg || '0'}</td>
                    <td style={tdBase}>{v.km.toLocaleString()}</td>
                    <td style={tdBase}>{intensity}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'ESG Scorecard',
      content: (
        <div style={darkWrap}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Targets On Track',  value: `${ESG_TARGETS.filter(t => t.progress >= 25).length}/${ESG_TARGETS.length}`, color: '#4ade80' },
              { label: 'Total YTD Emissions', value: `${totalCarbon} tCO₂e`, color: '#fbbf24' },
              { label: 'Diversion Rate',    value: `${diversionRate}%`,  color: '#4ade80' },
            ].map(k => (
              <div key={k.label} style={dc}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
          <div style={dc}>
            <h3 style={{ margin: '0 0 20px', fontSize: 14 }}>ESG Target Progress — Detailed Scorecard</h3>
            {ESG_TARGETS.map(t => (
              <div key={t.target} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t.target}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Category: {t.category} · Baseline: {t.baseline}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: t.progress >= 50 ? '#4ade80' : t.progress >= 25 ? '#fbbf24' : '#f87171' }}>{t.progress}{t.unit}</span>
                    {badge(t.progress >= 50 ? 'On Track' : t.progress >= 25 ? 'In Progress' : 'Behind', t.progress >= 50 ? 'rgba(74,222,128,0.15)' : t.progress >= 25 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)', t.progress >= 50 ? '#4ade80' : t.progress >= 25 ? '#fbbf24' : '#f87171')}
                  </div>
                </div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4 }}>
                  <div style={{ width: `${t.progress}%`, height: '100%', background: t.progress >= 50 ? '#4ade80' : t.progress >= 25 ? '#fbbf24' : '#f87171', borderRadius: 4, transition: 'width 0.6s' }} />
                </div>
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
      title="Environmental & ESG"
      subtitle="Carbon, energy, water and waste metrics aligned to ESG targets"
      headerColor="#052e16"
      accentColor="#4ade80"
      breadcrumbLabel="Environmental & ESG"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Approve 12-unit EV procurement (close 3% ESG gap, 18 tCO₂e annually)",explanation:"EV fleet at 12% — 3 vehicles short of the 2026 milestone. Light vehicle procurement is accessible now; Q1 FY26 replacement cycle is the window.",impact:"18 tCO₂e annual Scope 1 reduction, 3% ESG target gap closed",priority:"High"},
        {title:"Install building automation to close $28k carbon reduction gap",explanation:"Emissions reduction tracking at 3.2% vs 5% annual target. Building automation and LED upgrade are the highest-value remaining levers.",impact:"Est. 28 tCO₂e additional annual reduction",priority:"High"},
        {title:"Add 80kW solar capacity (save $28k annually, avoid 42 tCO₂e)",explanation:"Solar already offsets 34% of electricity. Depot and Workshop rooftops have confirmed capacity for 80kW addition — delivering ~22% additional electricity offset.",impact:"Est. $28,000 annual energy saving, 42 tCO₂e avoided",priority:"Medium"},
        {title:"Publish diversion milestone report to strengthen ESG scorecard",explanation:"Waste diversion at 68% — ahead of the 2026 target. Publishing a milestone report locks in the ESG disclosure credit and builds community trust.",impact:"Strengthen ESG scorecard, support community trust",priority:"Low"},
      ]}
      insightCards={[
        {problem:"Carbon emissions 7.4% above net-zero trajectory — fleet electrification 18 months behind schedule",cause:"EV procurement stalled by budget freeze; heavy vehicle lead times exceed 12 months, compressing the action window",recommendation:"Approve light vehicle EV procurement immediately — 12-unit programme closes trajectory gap before FY26 reporting deadline",severity:"High"},
        {problem:"Waste diversion stagnant at 58% — 7 points below the 65% target for 2 consecutive years",cause:"Contamination rate limiting recyclable stream processing; prior education campaigns did not shift community behaviour",recommendation:"Launch targeted contamination audits in top 3 offending zones — aim for 3% diversion improvement by Q4",severity:"Medium"},
        {problem:"Solar generation 18% below target — est. $12k annual energy value foregone from inverter failures",cause:"6 inverters past recommended replacement cycle; deferred from capital renewal for 2 consecutive years",recommendation:"Prioritise inverter replacement in this year's capital programme — restore full solar output by Q3",severity:"Medium"},
      ]}      overviewContent={overviewContent}
      industryTabs={industryTabs}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      sampleData={{ Carbon: SAMPLE_CARBON as object[], Energy: SAMPLE_ENERGY as object[], Water: SAMPLE_WATER as object[], Waste: SAMPLE_WASTE as object[] }}
      aiContext="Environmental and ESG dashboard for local government. Tracks carbon emissions (Scopes 1/2/3), energy across 5 sites, water consumption, waste streams, and ESG target progress. Current YTD emissions: 518.3 tCO₂e. Solar covers 34% of electricity. Waste diversion at 68%, ahead of 2026 target. EV fleet at 12% (3 of 26 vehicles), below 15% 2026 milestone. Emissions reduction rate 3.2% YoY, behind 5% target."
      executiveSummary="Carbon emissions are 7.4% above the net-zero trajectory with EV transition 18 months behind schedule — approving the 12-unit EV procurement and solar inverter replacements closes the gap and delivers $40k in annual energy savings."
      snapshotPanel={{ topCostDriver: 'Fleet Scope 1 emissions from ICE vehicles — 3 assets behind EV schedule', biggestRisk: 'EV fleet at 12% vs 15% target — FY26 ESG reporting milestone at risk', savingsIdentified: 40000, confidence: 80, lastUpdated: 'Apr 2026' }}
    />
  );
}
