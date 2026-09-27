'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from '@/components/dashboard/DashboardShell';
import { useDashboardChart } from '@/components/dashboard/ui/chartTheme';

const SAMPLE_STAFF = [
  { id: 'EMP-001', name: 'J. Harrison', role: 'Heavy Vehicle Operator', dept: 'Operations', status: 'Active', fte: 1.0, award: 'HVIA',     hours: 38.5, overtime: 2.5 },
  { id: 'EMP-002', name: 'K. Nguyen',   role: 'Civil Labourer',         dept: 'Civil Works',status: 'Active', fte: 1.0, award: 'CFMEU',    hours: 40.0, overtime: 4.0 },
  { id: 'EMP-003', name: 'S. Patel',    role: 'Site Supervisor',        dept: 'Civil Works',status: 'Active', fte: 1.0, award: 'CFMEU',    hours: 42.5, overtime: 6.5 },
  { id: 'EMP-004', name: 'B. Kowalski', role: 'Admin Officer',          dept: 'Admin',       status: 'Leave',  fte: 1.0, award: 'LGEA',     hours: 0,    overtime: 0 },
  { id: 'EMP-005', name: 'M. Trung',    role: 'Mechanic',               dept: 'Workshop',    status: 'Active', fte: 1.0, award: 'MVRIA',    hours: 38.0, overtime: 0 },
  { id: 'EMP-006', name: 'A. Forbes',   role: 'Parks Officer',          dept: 'Parks',       status: 'Active', fte: 0.8, award: 'LGEA',     hours: 30.0, overtime: 0 },
  { id: 'EMP-007', name: 'C. Okafor',   role: 'Project Manager',        dept: 'Projects',    status: 'Active', fte: 1.0, award: 'EA-Mgmt', hours: 45.0, overtime: 9.0 },
  { id: 'EMP-008', name: 'D. Smith',    role: 'Water Operator',         dept: 'Water',       status: 'Active', fte: 1.0, award: 'LGEA',     hours: 38.5, overtime: 0 },
];

const SAMPLE_LEAVE = [
  { id: 'LV-001', employee: 'B. Kowalski', type: 'Annual Leave', start: '2026-04-21', end: '2026-04-30', days: 8,  status: 'Approved' },
  { id: 'LV-002', employee: 'K. Nguyen',   type: 'Sick Leave',   start: '2026-04-24', end: '2026-04-24', days: 1,  status: 'Approved' },
  { id: 'LV-003', employee: 'A. Forbes',   type: 'RDO',          start: '2026-04-25', end: '2026-04-25', days: 1,  status: 'Approved' },
  { id: 'LV-004', employee: 'J. Harrison', type: 'Annual Leave', start: '2026-05-12', end: '2026-05-16', days: 5,  status: 'Pending' },
  { id: 'LV-005', employee: 'C. Okafor',   type: 'Annual Leave', start: '2026-06-01', end: '2026-06-12', days: 10, status: 'Pending' },
];

const SAMPLE_COMPLIANCE = [
  { id: 'COMP-001', employee: 'J. Harrison', check: 'HC Licence',             expiry: '2027-03-14', status: 'Current',  daysLeft: 323 },
  { id: 'COMP-002', employee: 'K. Nguyen',   check: 'White Card',             expiry: '2028-06-01', status: 'Current',  daysLeft: 767 },
  { id: 'COMP-003', employee: 'S. Patel',    check: 'High Risk Work Licence', expiry: '2026-05-15', status: 'Expiring', daysLeft: 20 },
  { id: 'COMP-004', employee: 'M. Trung',    check: 'Trade Certificate',      expiry: '2029-01-01', status: 'Current',  daysLeft: 981 },
  { id: 'COMP-005', employee: 'D. Smith',    check: 'Confined Space',         expiry: '2026-04-30', status: 'Expiring', daysLeft: 5 },
  { id: 'COMP-006', employee: 'C. Okafor',   check: 'First Aid Cert',         expiry: '2025-12-01', status: 'Expired',  daysLeft: -145 },
];

const WEEKLY_HOURS = [
  { week: 'W14', ordinary: 302, overtime: 28 },
  { week: 'W15', ordinary: 315, overtime: 35 },
  { week: 'W16', ordinary: 298, overtime: 22 },
  { week: 'W17', ordinary: 320, overtime: 42 },
  { week: 'W18', ordinary: 311, overtime: 30 },
];

const DEPT_HEADCOUNT = [
  { name: 'Operations', value: 2 },
  { name: 'Civil Works', value: 2 },
  { name: 'Workshop',    value: 1 },
  { name: 'Parks',       value: 1 },
  { name: 'Projects',    value: 1 },
  { name: 'Admin',       value: 1 },
];


const LEAVE_LIABILITY = [
  { name: 'J. Harrison', dept: 'Operations', annual: 12.5, sick: 8,  rdo: 4, liability: 6250 },
  { name: 'K. Nguyen',   dept: 'Civil Works', annual: 6.0, sick: 15, rdo: 2, liability: 3120 },
  { name: 'S. Patel',    dept: 'Civil Works', annual: 18.5,sick: 12, rdo: 0, liability: 9620 },
  { name: 'B. Kowalski', dept: 'Admin',       annual: 22.0,sick: 5,  rdo: 3, liability: 10340 },
  { name: 'M. Trung',    dept: 'Workshop',    annual: 9.0, sick: 10, rdo: 5, liability: 4590 },
  { name: 'A. Forbes',   dept: 'Parks',       annual: 14.0,sick: 7,  rdo: 2, liability: 5740 },
  { name: 'C. Okafor',   dept: 'Projects',    annual: 8.0, sick: 6,  rdo: 0, liability: 5120 },
  { name: 'D. Smith',    dept: 'Water',       annual: 16.0,sick: 9,  rdo: 3, liability: 7680 },
];

const VACANCIES = [
  { id: 'VAC-001', title: 'Heavy Vehicle Operator', dept: 'Operations', grade: 'Level 3', posted: '2026-03-15', status: 'Shortlisting', apps: 12 },
  { id: 'VAC-002', title: 'Civil Labourer (×2)',     dept: 'Civil Works', grade: 'Level 2', posted: '2026-04-01', status: 'Advertising', apps: 5 },
  { id: 'VAC-003', title: 'Parks Officer',            dept: 'Parks',       grade: 'Level 3', posted: '2026-04-10', status: 'Advertising', apps: 8 },
];

const PRODUCTIVITY = [
  { dept: 'Operations', target: 38, actual: 38.5, efficiency: 98 },
  { dept: 'Civil Works', target: 38, actual: 41.2, efficiency: 92 },
  { dept: 'Workshop',    target: 38, actual: 38.0, efficiency: 97 },
  { dept: 'Parks',       target: 30, actual: 30.0, efficiency: 100 },
  { dept: 'Projects',    target: 38, actual: 45.0, efficiency: 88 },
  { dept: 'Water',       target: 38, actual: 38.5, efficiency: 96 },
];

const MONTHLY_TREND: MonthlyPoint[] = [
  { month: 'Jul', actual: 485, budget: 490 },
  { month: 'Aug', actual: 492, budget: 490 },
  { month: 'Sep', actual: 478, budget: 490 },
  { month: 'Oct', actual: 501, budget: 495 },
  { month: 'Nov', actual: 488, budget: 495 },
  { month: 'Dec', actual: 461, budget: 490 },
  { month: 'Jan', actual: 495, budget: 495 },
  { month: 'Feb', actual: 509, budget: 500 },
  { month: 'Mar', actual: 497, budget: 500 },
  { month: 'Apr', actual: 483, budget: 500 },
];

const COST_ACCOUNTS: CostAccount[] = [
  { account: 'Operations',  dept: 'Workforce', budget: 120000, actual: 118500 },
  { account: 'Civil Works', dept: 'Workforce', budget: 95000,  actual: 99200 },
  { account: 'Workshop',    dept: 'Workforce', budget: 68000,  actual: 67800 },
  { account: 'Parks',       dept: 'Workforce', budget: 45000,  actual: 44100 },
  { account: 'Projects',    dept: 'Workforce', budget: 85000,  actual: 88600 },
  { account: 'Admin',       dept: 'Workforce', budget: 52000,  actual: 50900 },
  { account: 'Water',       dept: 'Workforce', budget: 72000,  actual: 71400 },
];

const SLA_TARGETS: SLATarget[] = [
  { kpi: 'Overtime Rate',          target: '<5% of hours', actual: '6.7%',  status: 'At Risk', note: 'Projects team driving excess' },
  { kpi: 'Compliance Rate',        target: '>95% current', actual: '66.7%', status: 'Missed',  note: '2 of 6 non-compliant' },
  { kpi: 'Leave Pending Approval', target: '<3 records',   actual: '2',     status: 'Met',     note: 'Within threshold' },
  { kpi: 'Average Weekly Hours',   target: '38–42h',       actual: '38.9h', status: 'Met',     note: 'On target' },
];

const DEFAULT_ACTIONS: Action[] = [
  { id: 'ACT-001', title: 'Renew C. Okafor First Aid Cert',        assignee: 'HR Manager',      dueDate: '2026-05-01', status: 'In progress', priority: 'High' },
  { id: 'ACT-002', title: 'Book D. Smith Confined Space refresher', assignee: 'Operations Mgr', dueDate: '2026-04-28', status: 'Not started', priority: 'High' },
  { id: 'ACT-003', title: 'Review S. Patel overtime levels',        assignee: 'Civil Works Mgr', dueDate: '2026-05-09', status: 'Not started', priority: 'Medium' },
  { id: 'ACT-004', title: 'Update FTE allocation — Parks team',     assignee: 'HR Manager',      dueDate: '2026-05-23', status: 'Not started', priority: 'Low' },
];

const KPI_DATA: KPI[] = [
  { label: 'Total Headcount',      value: 8,       sub: 'All employees', icon: '👥', status: 'normal' },
  { label: 'Active Today',         value: 7,       sub: 'On site or working', icon: '✅', status: 'normal' },
  { label: 'On Leave',             value: 1,       sub: 'Annual, sick, RDO', icon: '🏖', status: 'normal' },
  { label: 'Total Overtime',       value: '22h',   sub: 'This week', icon: '⏰', status: 'watch' },
  { label: 'Avg Hours / Employee', value: '38.9h', sub: 'This week (active)', icon: '📊', status: 'normal' },
  { label: 'Compliance Issues',    value: 2,       sub: 'Expiring or expired', alert: true, icon: '⚠', status: 'risk' },
];

// Authenticated visual-completion pass: theme tokens for HTML (status tokens
// are AA as text in both themes); charts read the theme-aware chart palette.
const dc = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 } as const;
const wrap: React.CSSProperties = { color: 'var(--text-primary)', padding: 24, minHeight: '100%' };

const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 };
const tdBase: React.CSSProperties = { padding: '12px 16px' };

function badge(label: string, bg: string, color: string) {
  return <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: bg, color }}>{label}</span>;
}

export default function LabourPage() {
  const chart = useDashboardChart();
  const pal = chart.palette;
  const overviewContent = (
    <div style={wrap}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={dc}>
          <h2 style={{ margin: '0 0 16px', fontSize: 14 }}>Weekly Ordinary vs Overtime Hours</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={WEEKLY_HOURS}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="week" tick={{ ...chart.tick, fontSize: 11 }} />
              <YAxis tick={{ ...chart.tick, fontSize: 11 }} />
              <Tooltip {...chart.tooltip} />
              <Bar dataKey="ordinary" fill={pal.primary} radius={[4,4,0,0]} name="Ordinary" />
              <Bar dataKey="overtime" fill={pal.warning} radius={[4,4,0,0]} name="Overtime" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={dc}>
          <h2 style={{ margin: '0 0 16px', fontSize: 14 }}>Headcount by Department</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={DEPT_HEADCOUNT} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(p: any) => p.name}>
                {DEPT_HEADCOUNT.map((_, i) => <Cell key={i} fill={chart.series[i % chart.series.length]} stroke={pal.tooltipBg} />)}
              </Pie>
              <Tooltip {...chart.tooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...dc, gridColumn: '1 / -1' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>Compliance Alerts</h2>
          {SAMPLE_COMPLIANCE.filter(c => c.status !== 'Current').map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div><span style={{ fontWeight: 600 }}>{c.employee}</span> — {c.check}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{c.expiry}</span>
                {badge(c.status, c.status === 'Expired' ? 'var(--status-danger-muted)' : 'var(--status-warning-muted)', c.status === 'Expired' ? 'var(--status-danger)' : 'var(--status-warning)')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const industryTabs: IndustryTab[] = [
    {
      label: 'Headcount',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['ID','Name','Role','Department','FTE','Award','Hours (wk)','Overtime (h)','Status'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_STAFF.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                  <td style={{ ...tdBase, color: 'var(--text-secondary)' }}>{e.id}</td>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{e.name}</td>
                  <td style={tdBase}>{e.role}</td>
                  <td style={tdBase}>{e.dept}</td>
                  <td style={tdBase}>{e.fte}</td>
                  <td style={{ ...tdBase, color: 'var(--text-secondary)' }}>{e.award}</td>
                  <td style={tdBase}>{e.hours || '—'}</td>
                  <td style={{ ...tdBase, color: e.overtime > 4 ? 'var(--status-warning)' : 'var(--text-primary)' }}>{e.overtime || '—'}</td>
                  <td style={tdBase}>{badge(e.status, e.status === 'Active' ? 'var(--status-success-muted)' : 'var(--status-warning-muted)', e.status === 'Active' ? 'var(--status-success)' : 'var(--status-warning)')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Leave Register',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['ID','Employee','Type','Start','End','Days','Status'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_LEAVE.map((l, i) => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                  <td style={{ ...tdBase, color: 'var(--text-secondary)' }}>{l.id}</td>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{l.employee}</td>
                  <td style={tdBase}>{l.type}</td>
                  <td style={tdBase}>{l.start}</td>
                  <td style={tdBase}>{l.end}</td>
                  <td style={tdBase}>{l.days}</td>
                  <td style={tdBase}>{badge(l.status, l.status === 'Approved' ? 'var(--status-success-muted)' : 'var(--status-warning-muted)', l.status === 'Approved' ? 'var(--status-success)' : 'var(--status-warning)')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Compliance',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['ID','Employee','Requirement','Expiry','Days Remaining','Status'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{SAMPLE_COMPLIANCE.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', background: c.status === 'Expired' ? 'var(--status-danger-muted)' : c.status === 'Expiring' ? 'var(--status-warning-muted)' : i%2===0?'transparent':'var(--bg-sunken)' }}>
                  <td style={{ ...tdBase, color: 'var(--text-secondary)' }}>{c.id}</td>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{c.employee}</td>
                  <td style={tdBase}>{c.check}</td>
                  <td style={tdBase}>{c.expiry}</td>
                  <td style={{ ...tdBase, color: c.daysLeft < 0 ? 'var(--status-danger)' : c.daysLeft < 30 ? 'var(--status-warning)' : 'var(--status-success)' }}>{c.daysLeft < 0 ? `${Math.abs(c.daysLeft)} days overdue` : c.daysLeft}</td>
                  <td style={tdBase}>{badge(c.status, c.status === 'Expired' ? 'var(--status-danger-muted)' : c.status === 'Expiring' ? 'var(--status-warning-muted)' : 'var(--status-success-muted)', c.status === 'Expired' ? 'var(--status-danger)' : c.status === 'Expiring' ? 'var(--status-warning)' : 'var(--status-success)')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Leave Liability',
      content: (
        <div style={wrap}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={dc}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Total Liability</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>${LEAVE_LIABILITY.reduce((s, e) => s + e.liability, 0).toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>All employees combined</div>
            </div>
            <div style={dc}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Highest Individual</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--status-warning)' }}>$10,340</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>B. Kowalski — Admin</div>
            </div>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['Employee','Department','Annual (days)','Sick (days)','RDO (days)','Est. Liability'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{[...LEAVE_LIABILITY].sort((a, b) => b.liability - a.liability).map((e, i) => (
                <tr key={e.name} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{e.name}</td>
                  <td style={tdBase}>{e.dept}</td>
                  <td style={tdBase}>{e.annual}</td>
                  <td style={tdBase}>{e.sick}</td>
                  <td style={tdBase}>{e.rdo}</td>
                  <td style={{ ...tdBase, fontWeight: 600, color: e.liability > 8000 ? 'var(--status-danger)' : e.liability > 5000 ? 'var(--status-warning)' : 'var(--status-success)' }}>${e.liability.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Roster Coverage',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14 }}>Ordinary vs Overtime Hours by Week</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={WEEKLY_HOURS}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="week" tick={{ ...chart.tick, fontSize: 11 }} />
                <YAxis tick={{ ...chart.tick, fontSize: 11 }} />
                <Tooltip {...chart.tooltip} />
                <Bar dataKey="ordinary" fill={pal.primary} radius={[4,4,0,0]} name="Ordinary Hours" />
                <Bar dataKey="overtime" fill={pal.warning} radius={[4,4,0,0]} name="Overtime Hours" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={dc}>
            <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>Active Leave Gaps</h2>
            {SAMPLE_LEAVE.map(l => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <div><span style={{ fontWeight: 600 }}>{l.employee}</span> — {l.type}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{l.start} → {l.end} ({l.days}d)</span>
                  {badge(l.status, l.status === 'Approved' ? 'var(--status-success-muted)' : 'var(--status-warning-muted)', l.status === 'Approved' ? 'var(--status-success)' : 'var(--status-warning)')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      label: 'Labour Cost by Team',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14 }}>Budget vs Actual Labour Cost by Department ($)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={COST_ACCOUNTS} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis type="number" tick={{ ...chart.tick, fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="account" width={90} tick={{ ...chart.tick, fontSize: 11 }} />
                <Tooltip {...chart.tooltip} formatter={(v) => typeof v === 'number' ? `$${v.toLocaleString()}` : v} />
                <Bar dataKey="budget" fill={pal.comparison} radius={[0,4,4,0]} name="Budget" />
                <Bar dataKey="actual" fill={pal.primary} radius={[0,4,4,0]} name="Actual" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['Department','Budget','Actual','Variance','Var %'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{COST_ACCOUNTS.map((ca, i) => {
                const variance = ca.actual - ca.budget;
                const pct = ((variance / ca.budget) * 100).toFixed(1);
                return (
                  <tr key={ca.account} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{ca.account}</td>
                    <td style={tdBase}>${ca.budget.toLocaleString()}</td>
                    <td style={tdBase}>${ca.actual.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: variance > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{variance > 0 ? '+' : ''}{variance.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: variance > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{variance > 0 ? '+' : ''}{pct}%</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Vacancies',
      content: (
        <div style={wrap}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Open Positions',    value: '3',  color: 'var(--text-primary)' },
              { label: 'Total Applications', value: '25', color: 'var(--text-primary)' },
              { label: 'In Shortlisting',   value: '1',  color: 'var(--status-warning)' },
            ].map(k => (
              <div key={k.label} style={dc}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{k.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['ID','Position','Department','Grade','Date Posted','Applications','Status'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{VACANCIES.map((v, i) => (
                <tr key={v.id} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                  <td style={{ ...tdBase, color: 'var(--text-secondary)' }}>{v.id}</td>
                  <td style={{ ...tdBase, fontWeight: 600 }}>{v.title}</td>
                  <td style={tdBase}>{v.dept}</td>
                  <td style={tdBase}>{v.grade}</td>
                  <td style={tdBase}>{v.posted}</td>
                  <td style={{ ...tdBase, textAlign: 'center' }}>{v.apps}</td>
                  <td style={tdBase}>{badge(v.status, v.status === 'Shortlisting' ? 'var(--status-info-muted)' : 'var(--status-warning-muted)', v.status === 'Shortlisting' ? 'var(--status-info)' : 'var(--status-warning)')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      label: 'Productivity Metrics',
      content: (
        <div style={wrap}>
          <div style={{ ...dc, marginBottom: 20 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 14 }}>Efficiency Score by Department (%)</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={PRODUCTIVITY}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="dept" tick={{ ...chart.tick, fontSize: 11 }} />
                <YAxis domain={[80, 105]} tick={{ ...chart.tick, fontSize: 11 }} />
                <Tooltip {...chart.tooltip} formatter={(v) => typeof v === 'number' ? `${v}%` : v} />
                <Bar dataKey="efficiency" fill={pal.primary} radius={[4,4,0,0]} name="Efficiency %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...dc, padding: 0, overflow: 'hidden' }}>
            <table style={tbl}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>
                {['Department','Target Hours','Actual Hours','Variance','Efficiency'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{PRODUCTIVITY.map((p, i) => {
                const variance = p.actual - p.target;
                return (
                  <tr key={p.dept} style={{ borderBottom: '1px solid var(--border)', background: i%2===0?'transparent':'var(--bg-sunken)' }}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{p.dept}</td>
                    <td style={tdBase}>{p.target}h</td>
                    <td style={tdBase}>{p.actual}h</td>
                    <td style={{ ...tdBase, color: variance > 4 ? 'var(--status-danger)' : variance > 0 ? 'var(--status-warning)' : 'var(--status-success)' }}>{variance > 0 ? '+' : ''}{variance.toFixed(1)}h</td>
                    <td style={tdBase}>{badge(`${p.efficiency}%`, p.efficiency >= 95 ? 'var(--status-success-muted)' : p.efficiency >= 90 ? 'var(--status-warning-muted)' : 'var(--status-danger-muted)', p.efficiency >= 95 ? 'var(--status-success)' : p.efficiency >= 90 ? 'var(--status-warning)' : 'var(--status-danger)')}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
  ];

  return (
    <DashboardShell
      title="Labour & Workforce"
      subtitle="Headcount, overtime, leave, and award compliance"
      headerColor="#0c4a6e"
      accentColor="#38bdf8"
      breadcrumbLabel="Labour & Workforce"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Renew C. Okafor First Aid — WHS breach active, -145 days expired",explanation:"First Aid expired 145 days ago with no renewal action taken. Operating in breach of the WHS Act — individual and organisational liability is live if any incident occurs.",impact:"Eliminate active WHS Act breach, prevent personal liability",priority:"High"},
        {title:"Enrol D. Smith in Confined Space training (avoid $3.2k fine in 5 days)",explanation:"Confined Space certification expires in 5 days. No enrolment confirmed. Regulatory fine risk plus operational impact if certificate lapses during active confined space works.",impact:"Maintain operational capacity, avoid $3,200 regulatory fine",priority:"High"},
        {title:"Investigate Projects overtime spike (reduce $12k–$18k quarterly cost)",explanation:"Projects team driving overall overtime to 6.7% — 34% above the 5% target. Root cause is likely under-resourcing or schedule compression — not isolated incidents.",impact:"$12,000–$18,000 overtime reduction per quarter",priority:"Medium"},
        {title:"Direct leave for high-liability employees (reduce $14k balance sheet exposure)",explanation:"Total leave liability $52,460. 3 employees above the 8-week threshold. Direction-of-leave before EOFY reduces the balance sheet figure and removes future payout risk.",impact:"Est. $14,000 leave liability reduction before June 30",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"First Aid qualifications expired for 4 field staff — active WHS compliance breach",cause:"Annual training calendar not linked to licence management; renewals missed with no automated alert at 60 days",recommendation:"Schedule refresher training this week and integrate licence expiry tracking with 60-day auto-alerts in HR system",severity:"High"},
        {problem:"Overtime at 31% above FY budget for 3 consecutive months — $12k–$18k quarterly overspend",cause:"Chronic leave liability and roster gaps in field teams driving unplanned overtime to maintain minimum staffing",recommendation:"Review FTE adequacy and convert highest-hour casuals to permanent roles — reduce overtime dependency structurally",severity:"Medium"},
        {problem:"Heavy equipment operator turnover at 24% — 2× the 12% industry benchmark",cause:"Remuneration 3 years without a market review — pay has fallen below competitive rate for trades classifications",recommendation:"Commission market remuneration review and present retention strategy to Council this quarter",severity:"Medium"},
      ]}      overviewContent={overviewContent}
      industryTabs={industryTabs}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      sampleData={{ Staff: SAMPLE_STAFF as object[], Leave: SAMPLE_LEAVE as object[], Compliance: SAMPLE_COMPLIANCE as object[], Hours: WEEKLY_HOURS as object[] }}
      aiContext="Labour and workforce management dashboard for local government. 8 employees across Operations, Civil Works, Workshop, Parks, Projects, Admin, and Water. Current compliance issues: C. Okafor First Aid expired (-145 days), D. Smith Confined Space expiring in 5 days. Overtime at 6.7% above 5% target, driven by Projects team. Total leave liability $52,460."
      executiveSummary="Two active WHS certification breaches require immediate action — First Aid expired 145 days ago and Confined Space expires in 5 days — while overtime is running $12k–$18k above budget per quarter and leave liability stands at $52,460."
      snapshotPanel={{ topCostDriver: 'Overtime — Projects team at 6.7% vs 5% target for 3 consecutive months', biggestRisk: 'C. Okafor First Aid expired -145 days — active WHS Act breach', savingsIdentified: 26000, confidence: 90, lastUpdated: 'Apr 2026' }}
    />
  );
}
