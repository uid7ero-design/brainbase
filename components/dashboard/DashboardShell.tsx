'use client';

import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import KpiCard             from './ui/KpiCard';
import ExecutiveSummaryBar from './ui/ExecutiveSummary';
import OpportunityCard     from './ui/OpportunityCard';
import InsightCardCmp      from './ui/InsightCard';
import ExecutivePanel      from './ui/ExecutivePanel';
import Section             from './ui/Section';
import DashboardGrid       from './ui/DashboardGrid';
import { useAppStore }     from '../../lib/state/useAppStore';
import { useRouter, usePathname } from 'next/navigation';
import { DASHBOARDS }      from '../../lib/dashboard/registry';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SheetData = Record<string, any[]>;

export interface Dataset {
  id: string;
  name: string;
  financialYear: string;
  uploadedAt: string;
  sheets: SheetData;
}

export interface KPI {
  label: string; value: string | number; sub?: string; alert?: boolean;
  status?: 'risk' | 'watch' | 'normal';
  icon?: string;
}
export interface SnapshotPanel {
  topCostDriver?: string;
  biggestRisk?: string;
  savingsIdentified?: number;
  confidence?: number;
  lastUpdated?: string;
}
export interface MonthlyPoint {
  month: string; actual: number; budget?: number; prevYear?: number;
}
export interface CostAccount {
  account: string; budget: number; actual: number; dept?: string; zone?: string;
}
export interface SLATarget {
  kpi: string; target: string; actual: string;
  status: 'Met' | 'At Risk' | 'Missed'; note?: string;
}
export interface Action {
  id: string; title: string; assignee: string; dueDate: string;
  status: 'Not started' | 'In progress' | 'Complete';
  priority: 'High' | 'Medium' | 'Low';
}
export interface IndustryTab {
  label: string; content: React.ReactNode;
}
export interface RecommendedAction {
  title: string;
  explanation: string;
  impact: string;
  priority: 'High' | 'Medium' | 'Low';
}
export interface InsightCard {
  problem: string;
  cause: string;
  recommendation: string;
  severity: 'High' | 'Medium' | 'Low';
}
export interface DashboardShellProps {
  title: string;
  subtitle: string;
  headerColor: string;
  accentColor: string;
  breadcrumbLabel: string;
  kpis?: KPI[];
  recommendedActions?: RecommendedAction[];
  insightCards?: InsightCard[];
  overviewContent: React.ReactNode;
  industryTabs?: IndustryTab[];
  sampleData?: Record<string, object[]>;
  monthlyTrend?: MonthlyPoint[];
  costAccounts?: CostAccount[];
  slaTargets?: SLATarget[];
  defaultActions?: Action[];
  aiContext?: string;
  theme?: 'light' | 'dark';
  executiveSummary?: string;
  snapshotPanel?: SnapshotPanel;
  uploadServiceType?: string;
}

// ─── Data Context ─────────────────────────────────────────────────────────────

export interface DataContextValue {
  dataset: Dataset | null;
  activeFY: string;
  getSheet: (name: string) => any[];
}
export const DashboardDataContext = createContext<DataContextValue>({
  dataset: null,
  activeFY: 'FY2025-26',
  getSheet: () => [],
});
export function useDashboardData() { return useContext(DashboardDataContext); }

// ─── Constants ────────────────────────────────────────────────────────────────

const FY_OPTIONS = ['FY2022-23', 'FY2023-24', 'FY2024-25', 'FY2025-26'];
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const PIE_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#4f46e5'];
const STATUS_C = {
  Met:      { bg: 'rgba(74,222,128,0.15)',  text: '#4ade80' },
  'At Risk':{ bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24' },
  Missed:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
} as const;
const PRIORITY_C = { High: '#f87171', Medium: '#fbbf24', Low: '#4ade80' } as const;
const ACTION_STATUS = ['Not started', 'In progress', 'Complete'] as const;

// ─── Smart Data Derivation ────────────────────────────────────────────────────

function deriveTrend(ds: Dataset | null, fallback: MonthlyPoint[]): MonthlyPoint[] {
  if (!ds) return fallback;
  const NAMES = ['Monthly Trend', 'Trend', 'Monthly', 'Actuals', 'monthly_trend'];
  for (const name of NAMES) {
    const rows = ds.sheets[name];
    if (!rows?.length) continue;
    const k = Object.keys(rows[0]);
    const mKey = k.find(x => /^month$/i.test(x));
    const aKey = k.find(x => /^actual/i.test(x));
    if (mKey && aKey) {
      const bKey = k.find(x => /^budget/i.test(x));
      const pKey = k.find(x => /^prev/i.test(x));
      return rows.map(r => ({
        month: String(r[mKey]),
        actual: Number(r[aKey]) || 0,
        budget: bKey ? Number(r[bKey]) || undefined : undefined,
        prevYear: pKey ? Number(r[pKey]) || undefined : undefined,
      }));
    }
  }
  for (const rows of Object.values(ds.sheets)) {
    if (!rows?.length) continue;
    const k = Object.keys(rows[0]);
    const mKey = k.find(x => /month/i.test(x));
    const aKey = k.find(x => /actual|value|amount|cost/i.test(x));
    if (mKey && aKey) {
      const bKey = k.find(x => /budget/i.test(x));
      return rows.map(r => ({
        month: String(r[mKey]),
        actual: Number(r[aKey]) || 0,
        budget: bKey ? Number(r[bKey]) || undefined : undefined,
      }));
    }
  }
  return fallback;
}

function deriveCosts(ds: Dataset | null, fallback: CostAccount[]): CostAccount[] {
  if (!ds) return fallback;
  const NAMES = ['Cost Breakdown', 'Costs', 'Cost Accounts', 'Accounts', 'cost_breakdown'];
  for (const name of NAMES) {
    const rows = ds.sheets[name];
    if (!rows?.length) continue;
    const k = Object.keys(rows[0]);
    const aKey = k.find(x => /account|name|category|dept/i.test(x));
    const bKey = k.find(x => /budget/i.test(x));
    const vKey = k.find(x => /actual|spend|cost/i.test(x));
    if (aKey && (bKey || vKey)) {
      return rows.map(r => ({
        account: String(r[aKey]),
        budget: Number(r[bKey ?? ''] ?? 0),
        actual: Number(r[vKey ?? ''] ?? 0),
        dept: r.dept ? String(r.dept) : r.department ? String(r.department) : undefined,
      }));
    }
  }
  return fallback;
}

function deriveSLA(ds: Dataset | null, fallback: SLATarget[]): SLATarget[] {
  if (!ds) return fallback;
  const NAMES = ['Compliance', 'SLA', 'KPI', 'Targets', 'sla_targets'];
  for (const name of NAMES) {
    const rows = ds.sheets[name];
    if (!rows?.length) continue;
    const k = Object.keys(rows[0]);
    const kKey = k.find(x => /kpi|name|metric|indicator/i.test(x));
    const sKey = k.find(x => /status/i.test(x));
    if (kKey && sKey) {
      return rows.map(r => ({
        kpi: String(r[kKey]),
        target: String(r.target ?? r.Target ?? ''),
        actual: String(r.actual ?? r.Actual ?? ''),
        status: (['Met', 'At Risk', 'Missed'] as const).find(s => s === r[sKey]) ?? 'Met',
        note: r.note ?? r.Note ?? undefined,
      }));
    }
  }
  return fallback;
}

// ─── Shell Component ──────────────────────────────────────────────────────────

export default function DashboardShell({
  title, subtitle, headerColor, accentColor, breadcrumbLabel,
  kpis = [], recommendedActions = [], insightCards = [], overviewContent, industryTabs = [], sampleData = {},
  monthlyTrend = [], costAccounts = [], slaTargets = [],
  defaultActions = [], aiContext = '', theme = 'dark',
  executiveSummary, snapshotPanel, uploadServiceType,
}: DashboardShellProps) {

  const L = theme === 'light';

  // ─── Theme tokens ───────────────────────────────────────────────────────────
  const th = L ? {
    bg:        '#f1f5f9',
    card:      { background: '#fff',         border: '1.5px solid #d1d5db' } as React.CSSProperties,
    t1:        '#0f172a',
    t2:        '#475569',
    t3:        '#94a3b8',
    bdr:       '#d1d5db',
    rbdr:      '#e2e8f0',
    ralt:      '#f8fafc',
    rhead:     '#f1f5f9',
    grid:      '#f1f5f9',
    tick:      '#94a3b8',
    tip:       { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 } as React.CSSProperties,
    sub:       '#f1f5f9',
    inp:       '#fff',
    barMuted:  '#e2e8f0',
    priorFy:   '#cbd5e1',
    budgetLine:'#94a3b8',
  } : {
    bg:        '#0f0f0f',
    card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' } as React.CSSProperties,
    t1:        '#e5e7eb',
    t2:        'rgba(255,255,255,0.5)',
    t3:        'rgba(255,255,255,0.35)',
    bdr:       'rgba(255,255,255,0.08)',
    rbdr:      'rgba(255,255,255,0.05)',
    ralt:      'rgba(255,255,255,0.02)',
    rhead:     'rgba(255,255,255,0.06)',
    grid:      'rgba(255,255,255,0.05)',
    tick:      'rgba(255,255,255,0.4)',
    tip:       { background: '#1a1a2e', border: 'none', borderRadius: 8 } as React.CSSProperties,
    sub:       'rgba(255,255,255,0.04)',
    inp:       'rgba(255,255,255,0.06)',
    barMuted:  'rgba(255,255,255,0.15)',
    priorFy:   'rgba(255,255,255,0.2)',
    budgetLine:'rgba(255,255,255,0.3)',
  };

  const router   = useRouter();
  const pathname = usePathname();
  const storageKey = `bb_${title.replace(/\W+/g, '_').toLowerCase()}`;

  // ── State ──
  const [activeTab,      setActiveTab]      = useState('Overview');
  const [activeFY,       setActiveFY]       = useState('FY2025-26');
  const [month,          setMonth]          = useState('Apr');
  const [compareFy,      setCompareFy]      = useState('FY2024-25');
  const [dataStore,      setDataStore]      = useState<Record<string, Dataset[]>>({});
  const [activeDatasetId,setActiveDatasetId]= useState<string | null>(null);
  const [uploadPreview,  setUploadPreview]  = useState<{ name: string; sheets: SheetData } | null>(null);
  const [validErrors,    setValidErrors]    = useState<string[]>([]);
  const [actions,        setActions]        = useState<Action[]>(defaultActions);
  const [newAction,      setNewAction]      = useState({ title: '', assignee: '', dueDate: '', priority: 'Medium' as Action['priority'] });
  const [showAdd,        setShowAdd]        = useState(false);
  const [aiReport,       setAiReport]       = useState('');
  const [aiLoading,      setAiLoading]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Persistence ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const p = JSON.parse(saved);
        setDataStore(p.store ?? {});
        setActiveFY(p.activeFY ?? 'FY2025-26');
        setActiveDatasetId(p.activeDatasetId ?? null);
      }
    } catch { /* ignore corrupt storage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ store: dataStore, activeFY, activeDatasetId }));
    } catch { /* storage quota exceeded */ }
  }, [dataStore, activeFY, activeDatasetId, storageKey]);

  // Publish this dashboard's AI context to Helena whenever it changes
  useEffect(() => {
    if (!aiContext) return;
    useAppStore.getState().setDashboardAiContext(aiContext);
    return () => useAppStore.getState().setDashboardAiContext('');
  }, [aiContext]);

  // ── Derived data ──
  const fyDatasets    = dataStore[activeFY] ?? [];
  const activeDataset = fyDatasets.find(d => d.id === activeDatasetId) ?? null;
  const getSheet      = (name: string) => activeDataset?.sheets[name] ?? [];
  const isLiveData    = activeDataset !== null;

  const effectiveTrend = useMemo(() => deriveTrend(activeDataset, monthlyTrend),  [activeDataset, monthlyTrend]);
  const effectiveCosts = useMemo(() => deriveCosts(activeDataset, costAccounts),  [activeDataset, costAccounts]);
  const effectiveSLA   = useMemo(() => deriveSLA(activeDataset, slaTargets),      [activeDataset, slaTargets]);

  const industryLabels = industryTabs.map(t => t.label);
  const GLOBAL_TABS    = ['Overview', ...industryLabels, 'Data Upload', 'Financial Year', 'Cost Breakdown', 'Trends', 'Compliance', 'AI Report', 'Actions', 'Export'];

  const totalBudget  = effectiveCosts.reduce((s, a) => s + a.budget, 0);
  const totalActual  = effectiveCosts.reduce((s, a) => s + a.actual, 0);
  const variance     = totalActual - totalBudget;
  const ytdActual    = effectiveTrend.reduce((s, m) => s + m.actual, 0);
  const avgMonthly   = effectiveTrend.length ? ytdActual / effectiveTrend.length : 0;
  const eofyForecast = Math.round(avgMonthly * 12);

  const yoyData    = effectiveTrend.map(m => ({
    month: m.month,
    'Current FY': m.actual,
    'Prior FY':   m.prevYear ?? Math.round(m.actual * 0.93),
    'Budget':     m.budget   ?? Math.round(m.actual * 1.04),
  }));
  const accountPie = effectiveCosts.slice(0, 6).map((a, i) => ({
    name: a.account, value: a.actual, fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  // ── Styles ──
  const S = {
    card: { ...th.card, borderRadius: 12, padding: 20 } as React.CSSProperties,
    input: { width: '100%', padding: '8px 12px', background: th.inp, border: `1px solid ${th.bdr}`, borderRadius: 8, color: th.t1, fontSize: 13, outline: 'none', boxSizing: 'border-box' } as React.CSSProperties,
    tab: (t: string): React.CSSProperties => ({
      padding: '11px 16px', background: 'none', border: 'none',
      borderBottom: activeTab === t ? `2px solid ${accentColor}` : '2px solid transparent',
      color: activeTab === t ? accentColor : th.t2,
      cursor: 'pointer', fontSize: 13, fontWeight: activeTab === t ? 600 : 400, whiteSpace: 'nowrap', transition: 'all 0.15s',
    }),
    btn: (v: 'primary' | 'secondary' | 'ghost' = 'ghost'): React.CSSProperties => ({
      padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
      border: v === 'secondary' ? `1px solid ${accentColor}` : v === 'ghost' ? `1px solid ${th.bdr}` : 'none',
      background: v === 'primary' ? accentColor : v === 'secondary' ? 'transparent' : th.sub,
      color: v === 'primary' ? '#fff' : v === 'secondary' ? accentColor : th.t1,
    }),
  };

  // ── Handlers ──
  async function downloadSample() {
    if (!Object.keys(sampleData).length) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    Object.entries(sampleData).forEach(([name, rows]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31))
    );
    XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '_')}_sample.xlsx`);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const XLSX = await import('xlsx');
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf);
    const sheets: SheetData = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n]) as any[]; });

    const errors: string[] = [];
    const totalRows = Object.values(sheets).reduce((s, r) => s + r.length, 0);
    if (totalRows === 0)       errors.push('File appears empty — no data rows found');
    if (wb.SheetNames.length === 0) errors.push('No sheets detected — check file format');

    setValidErrors(errors);
    setUploadPreview({ name: file.name.replace(/\.[^.]+$/, ''), sheets });

    if (!errors.length) {
      const ds: Dataset = {
        id: Date.now().toString(),
        name: file.name.replace(/\.[^.]+$/, ''),
        financialYear: activeFY,
        uploadedAt: new Date().toISOString(),
        sheets,
      };
      setDataStore(prev => ({ ...prev, [activeFY]: [...(prev[activeFY] ?? []), ds] }));
      setActiveDatasetId(ds.id);

      // Persist to DB and refresh server data when a serviceType is configured
      if (uploadServiceType) {
        const form = new FormData();
        form.append('file', file);
        form.append('serviceType', uploadServiceType);
        fetch('/api/upload', { method: 'POST', body: form })
          .then(() => router.refresh())
          .catch(() => {});
      }
    }
    e.target.value = '';
  }

  function deleteDataset(id: string) {
    setDataStore(prev => ({ ...prev, [activeFY]: (prev[activeFY] ?? []).filter(d => d.id !== id) }));
    if (activeDatasetId === id) setActiveDatasetId(null);
  }

  async function generateAIReport() {
    setAiLoading(true); setAiReport('');
    const kpiText = kpis.map(k => `${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ''}`).join(', ');
    const prompt  = `You are an executive analyst. Generate a concise operational report for the ${title} dashboard (${activeFY}). ${aiContext} KPIs: ${kpiText}. ${effectiveSLA.length ? `SLA: ${effectiveSLA.map(s => `${s.kpi} — ${s.status}`).join(', ')}.` : ''} ${variance ? `Budget variance: ${variance > 0 ? 'over' : 'under'} by $${Math.abs(variance).toLocaleString()}.` : ''} Write: 1) Executive summary (2-3 sentences), 2) Key cost drivers and movements, 3) Top 3 risks, 4) Recommended actions. Professional tone, concise.`;
    try {
      const res  = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
      const data = await res.json();
      setAiReport(data.message || data.content || data.text || 'Report generated.');
    } catch { setAiReport('Could not connect to AI. Check your API configuration.'); }
    setAiLoading(false);
  }

  async function exportPDF() {
    const html2canvas = (await import('html2canvas')).default;
    const jsPDF       = (await import('jspdf')).default;
    const el = document.getElementById('shell-content'); if (!el) return;
    const canvas = await html2canvas(el, { scale: 1.5, useCORS: true });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w   = pdf.internal.pageSize.getWidth();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, (canvas.height / canvas.width) * w);
    pdf.save(`${title.toLowerCase().replace(/\s+/g, '_')}_report.pdf`);
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const wb   = XLSX.utils.book_new();
    if (kpis.length)           XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpis), 'KPIs');
    if (effectiveCosts.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(effectiveCosts), 'Cost Breakdown');
    if (effectiveTrend.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(effectiveTrend), 'Monthly Trend');
    if (effectiveSLA.length)   XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(effectiveSLA), 'Compliance');
    if (actions.length)        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actions), 'Actions');
    const exportSheets = activeDataset ? activeDataset.sheets : sampleData;
    Object.entries(exportSheets).forEach(([n, rows]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows as any[]), n.slice(0, 31))
    );
    XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '_')}_export.xlsx`);
  }

  function exportBoardSummary() {
    const lines = [
      'BOARD EXECUTIVE SUMMARY', `${title} — ${activeFY}`, '='.repeat(50), '',
      'KEY METRICS', ...kpis.map(k => `• ${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ''}`), '',
      'COMPLIANCE & RISKS', ...(effectiveSLA.filter(s => s.status !== 'Met').map(s => `• ${s.kpi}: ${s.actual} (target ${s.target}) — ${s.status}`) || ['No current issues']), '',
      'OUTSTANDING ACTIONS', ...(actions.filter(a => a.status !== 'Complete').slice(0, 5).map(a => `• [${a.priority}] ${a.title} — ${a.assignee} by ${a.dueDate}`) || ['None']), '',
      ...(aiReport ? ['AI ANALYSIS', aiReport] : []),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_board_summary.txt`; a.click();
  }

  function addAction() {
    if (!newAction.title.trim()) return;
    setActions(p => [...p, { id: Date.now().toString(), ...newAction, status: 'Not started' }]);
    setNewAction({ title: '', assignee: '', dueDate: '', priority: 'Medium' });
    setShowAdd(false);
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const industryContent = industryTabs.find(t => t.label === activeTab)?.content;

  return (
    <DashboardDataContext.Provider value={{ dataset: activeDataset, activeFY, getSheet }}>
    <div style={{ minHeight: '100vh', background: th.bg, color: th.t1, fontFamily: 'system-ui,sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background: headerColor, padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', marginBottom: 5 }}>
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Brainbase</a>
          {' › '}<a href="/dashboard/overview" style={{ color: 'inherit', textDecoration: 'none' }}>Overview</a>
          {' › '}<span style={{ color: accentColor }}>{breadcrumbLabel}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h1>
              <select
                value={pathname ?? ''}
                onChange={e => { if (e.target.value) router.push(e.target.value); }}
                style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${accentColor}50`, borderRadius: 20, color: '#e5e7eb', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                {Object.values(DASHBOARDS).map(d => (
                  <option key={d.route} value={d.route}>{d.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginTop: 1 }}>{subtitle}</div>
            <button
              onClick={() => useAppStore.getState().fireHelena(`Explain this ${title} dashboard to me — cover the key metrics, any risks or issues, and what I should focus on.`)}
              style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(0,0,0,0.25)', border: `1px solid ${accentColor}50`, color: 'rgba(255,255,255,0.65)', letterSpacing: '.02em' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zm0 6v4m0 4h.01"/></svg>
              Ask HLNA to explain
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={activeFY}
              onChange={e => { setActiveFY(e.target.value); setActiveDatasetId(null); }}
              style={{ padding: '5px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, color: '#e5e7eb', fontSize: 12, cursor: 'pointer' }}
            >
              {FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {fyDatasets.length > 0 && (
              <select
                value={activeDatasetId ?? ''}
                onChange={e => setActiveDatasetId(e.target.value || null)}
                style={{ padding: '5px 10px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${accentColor}60`, borderRadius: 20, color: '#e5e7eb', fontSize: 12, cursor: 'pointer', maxWidth: 200 }}
              >
                <option value="">Sample data</option>
                {fyDatasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, fontWeight: 600, background: isLiveData ? `${accentColor}20` : 'rgba(255,255,255,0.08)', color: isLiveData ? accentColor : 'rgba(255,255,255,0.4)', border: `1px solid ${isLiveData ? accentColor + '40' : 'rgba(255,255,255,0.1)'}` }}>
              {isLiveData ? '● Live' : '○ Sample'}
            </span>
            <button onClick={downloadSample} style={S.btn('ghost')}>↓ Sample</button>
            <button onClick={() => fileRef.current?.click()} style={S.btn('ghost')}>↑ Upload</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={handleUpload} style={{ display: 'none' }} />
            <button onClick={exportPDF} style={{ ...S.btn('primary'), background: accentColor }}>Export PDF</button>
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ borderBottom: `1px solid ${th.bdr}`, padding: '0 20px', display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', background: th.bg }}>
        {GLOBAL_TABS.map(t => <button key={t} onClick={() => setActiveTab(t)} style={S.tab(t)}>{t}</button>)}
      </div>

      {/* ── KPI strip ── */}
      {kpis.length > 0 && (
        <div style={{ padding: '8px 20px', display: 'flex', gap: 8, overflowX: 'auto', borderBottom: `1px solid ${th.bdr}`, scrollbarWidth: 'none', background: th.bg }}>
          {kpis.map(k => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              icon={k.icon}
              sub={k.sub}
              status={k.status}
              alert={k.alert}
              accentColor={accentColor}
              theme={theme}
            />
          ))}
        </div>
      )}

      {/* ── Executive Summary strip (Overview only) ── */}
      {executiveSummary && activeTab === 'Overview' && (
        <ExecutiveSummaryBar summary={executiveSummary} accentColor={accentColor} theme={theme} />
      )}

      {/* ── Tab content ── */}
      <div id="shell-content" style={{ padding: activeTab === 'Overview' ? 0 : 24 }}>

        {activeTab === 'Overview' && (() => {
          const potentialSavings = recommendedActions.reduce((sum, ra) => {
            const m = ra.impact.match(/\$\s*([\d,]+)/);
            return sum + (m ? parseInt(m[1].replace(/,/g, '')) : 0);
          }, 0);
          const totalBudgetSnap = effectiveCosts.reduce((s, a) => s + a.budget, 0);
          const totalActualSnap = effectiveCosts.reduce((s, a) => s + a.actual, 0);
          const varianceSnap    = totalActualSnap - totalBudgetSnap;
          const snapSavings     = snapshotPanel?.savingsIdentified ?? potentialSavings;
          const snapConf        = snapshotPanel?.confidence ?? 84;
          const snapTopCost     = snapshotPanel?.topCostDriver ?? (effectiveCosts.length ? effectiveCosts.reduce((a, b) => b.actual > a.actual ? b : a).account : '');
          const snapBigRisk     = snapshotPanel?.biggestRisk ?? (recommendedActions.find(r => r.priority === 'High')?.title ?? '');
          const snapVariancePct = totalBudgetSnap > 0 ? Math.round((varianceSnap / totalBudgetSnap) * 100) : 0;
          const snapVarianceColor = varianceSnap > 0 ? '#ef4444' : '#10b981';

          return (
            <>
              {/* ── 1. AI Insight grid (full-width) ── */}
              {insightCards.length > 0 && (
                <div style={{ padding: '10px 20px 12px', borderBottom: `1px solid ${th.rbdr}`, display: 'grid', gridTemplateColumns: `repeat(${Math.min(insightCards.length, 3)}, 1fr)`, gap: 10 }}>
                  {insightCards.map((ic, i) => {
                    const sevCol = ic.severity === 'High' ? '#ef4444' : ic.severity === 'Medium' ? '#f59e0b' : '#10b981';
                    const shdw   = L
                      ? `0 1px 2px rgba(0,0,0,0.05), 0 4px 14px ${sevCol}18, 0 0 0 1px ${sevCol}15`
                      : `0 2px 10px rgba(0,0,0,0.3), 0 4px 16px ${sevCol}20`;
                    return (
                      <div
                        key={i}
                        style={{
                          background: L
                            ? `linear-gradient(135deg, ${sevCol}06 0%, #ffffff 60%)`
                            : `linear-gradient(135deg, ${sevCol}10 0%, rgba(255,255,255,0.04) 70%)`,
                          border: `1.5px solid ${L ? sevCol + '30' : sevCol + '25'}`,
                          borderLeft: `4px solid ${sevCol}`,
                          borderRadius: '0 10px 10px 0',
                          padding: '11px 13px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                          boxShadow: shdw,
                          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                          (e.currentTarget as HTMLDivElement).style.boxShadow = L
                            ? `0 2px 4px rgba(0,0,0,0.07), 0 8px 24px ${sevCol}25, 0 0 0 1px ${sevCol}20`
                            : `0 4px 20px rgba(0,0,0,0.4), 0 6px 24px ${sevCol}30`;
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.transform = 'none';
                          (e.currentTarget as HTMLDivElement).style.boxShadow = shdw;
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: sevCol, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>{ic.severity}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: th.t1, lineHeight: 1.3 }}>{ic.problem}</span>
                        </div>
                        {ic.cause && (
                          <div style={{ fontSize: 10.5, color: th.t2, lineHeight: 1.45, paddingLeft: 2 }}>
                            <span style={{ fontWeight: 700, color: th.t3, textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.06em' }}>Why · </span>{ic.cause}
                          </div>
                        )}
                        <div style={{ fontSize: 10.5, color: accentColor, lineHeight: 1.45, fontWeight: 600, paddingLeft: 2, marginTop: 1 }}>
                          <span style={{ fontWeight: 700 }}>→ </span>{ic.recommendation}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── 2. Main charts / overview content ── */}
              <div style={{ padding: '14px 20px 16px' }}>
                {overviewContent}
              </div>

              {/* ── 3. AI Opportunities + Executive Snapshot (bottom) ── */}
              {recommendedActions.length > 0 && (
                <div style={{ padding: '12px 20px 16px', borderTop: `1px solid ${th.rbdr}` }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: th.t3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>AI Opportunities</span>
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: th.sub, color: th.t3, border: `1px solid ${th.bdr}` }}>{recommendedActions.length}</span>
                      {potentialSavings > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}35` }}>
                          ${potentialSavings.toLocaleString()} identified
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setActiveTab('AI Report')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: accentColor, border: 'none', color: '#fff', letterSpacing: '-0.01em', boxShadow: `0 2px 10px ${accentColor}50` }}
                    >
                      <span>✦</span> AI Report
                    </button>
                  </div>

                  <DashboardGrid
                    left={
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                        {recommendedActions.slice(0, 4).map((ra, i) => (
                          <OpportunityCard
                            key={i}
                            index={i}
                            priority={ra.priority}
                            title={ra.title}
                            impact={ra.impact}
                            accentColor={accentColor}
                            theme={theme}
                          />
                        ))}
                      </div>
                    }
                    right={
                      <ExecutivePanel
                        budgetVsActual={totalBudgetSnap > 0 ? { budget: totalBudgetSnap, actual: totalActualSnap } : undefined}
                        topCostDriver={snapTopCost || undefined}
                        biggestRisk={snapBigRisk || undefined}
                        savingsIdentified={snapSavings > 0 ? snapSavings : undefined}
                        confidence={snapConf}
                        lastUpdated={snapshotPanel?.lastUpdated}
                        accentColor={accentColor}
                        theme={theme}
                      />
                    }
                  />
                </div>
              )}
            </>
          );
        })()}

        {industryContent && activeTab !== 'Overview' && industryContent}

        {/* ════ DATA UPLOAD ════ */}
        {activeTab === 'Data Upload' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {activeDataset && (
              <div style={{ gridColumn: '1 / -1', padding: '12px 16px', background: `${accentColor}12`, border: `1px solid ${accentColor}30`, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: accentColor }}>● Active: {activeDataset.name}</span>
                  <span style={{ fontSize: 12, color: th.t2, marginLeft: 12 }}>
                    {activeFY} · {Object.keys(activeDataset.sheets).length} sheets · {Object.values(activeDataset.sheets).reduce((s, r) => s + r.length, 0)} total rows · uploaded {new Date(activeDataset.uploadedAt).toLocaleDateString()}
                  </span>
                </div>
                <button onClick={() => setActiveDatasetId(null)} style={S.btn('ghost')}>Revert to sample</button>
              </div>
            )}

            <div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Upload Dataset</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: th.t2, display: 'block', marginBottom: 6 }}>Financial Year</label>
                <select value={activeFY} onChange={e => setActiveFY(e.target.value)} style={S.input}>
                  {FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${th.bdr}`, borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 12 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, color: th.t2 }}>Drop XLSX or CSV, or click to browse</div>
                <div style={{ fontSize: 12, color: th.t3, marginTop: 4 }}>All sheets imported automatically</div>
              </div>
              <button onClick={downloadSample} style={{ ...S.btn('ghost'), width: '100%', display: 'flex', justifyContent: 'center' }}>↓ Download Sample Template</button>
              {validErrors.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(248,113,113,0.1)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.3)' }}>
                  {validErrors.map(e => <div key={e} style={{ fontSize: 12, color: '#f87171' }}>⚠ {e}</div>)}
                </div>
              )}
            </div>

            <div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>
                {uploadPreview ? `${uploadPreview.name} — Preview` : 'Upload Preview'}
              </h3>
              {uploadPreview ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                    {Object.entries(uploadPreview.sheets).map(([name, rows]) => (
                      <span key={name} style={{ padding: '4px 10px', borderRadius: 8, background: `${accentColor}20`, border: `1px solid ${accentColor}50`, fontSize: 11 }}>
                        <span style={{ fontWeight: 600, color: accentColor }}>{name}</span>
                        <span style={{ color: th.t3, marginLeft: 5 }}>{rows.length}r</span>
                      </span>
                    ))}
                  </div>
                  {Object.entries(uploadPreview.sheets).slice(0, 1).map(([name, rows]) => (
                    <div key={name}>
                      <div style={{ fontSize: 10, color: th.t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{name}</div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead><tr style={{ background: th.rhead }}>
                            {rows.length > 0 && Object.keys(rows[0]).slice(0, 6).map(col => (
                              <th key={col} style={{ padding: '5px 8px', textAlign: 'left', color: th.t2, fontWeight: 600, whiteSpace: 'nowrap' }}>{col}</th>
                            ))}
                          </tr></thead>
                          <tbody>{rows.slice(0, 4).map((row: any, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${th.rbdr}` }}>
                              {Object.values(row as object).slice(0, 6).map((v: any, j) => (
                                <td key={j} style={{ padding: '4px 8px', color: th.t1, whiteSpace: 'nowrap' }}>{String(v)}</td>
                              ))}
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                      {rows.length > 4 && <div style={{ fontSize: 11, color: th.t3, marginTop: 5 }}>+{rows.length - 4} more rows</div>}
                    </div>
                  ))}
                  {validErrors.length === 0 && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(74,222,128,0.1)', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', fontSize: 12, color: '#4ade80' }}>
                      ✓ Saved to {activeFY} — {Object.keys(uploadPreview.sheets).length} sheet{Object.keys(uploadPreview.sheets).length !== 1 ? 's' : ''} imported and active
                    </div>
                  )}
                </>
              ) : <p style={{ fontSize: 13, color: th.t3 }}>Upload a file to preview all sheets.</p>}
            </div>

            <div style={{ ...S.card, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: th.t1 }}>Dataset Manager — {activeFY}</h3>
                <span style={{ fontSize: 12, color: th.t2 }}>{fyDatasets.length} dataset{fyDatasets.length !== 1 ? 's' : ''}</span>
              </div>
              {fyDatasets.length === 0
                ? <p style={{ fontSize: 13, color: th.t3 }}>No datasets for {activeFY} yet. Upload a file above.</p>
                : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ background: th.rhead }}>
                      {['Name', 'Sheets', 'Total Rows', 'Uploaded', 'Status', ''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, color: th.t3, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{fyDatasets.map(d => {
                      const totalRows = Object.values(d.sheets).reduce((s, r) => s + r.length, 0);
                      const isActive  = d.id === activeDatasetId;
                      return (
                        <tr key={d.id} style={{ borderTop: `1px solid ${th.rbdr}`, background: isActive ? `${accentColor}08` : 'transparent' }}>
                          <td style={{ padding: '9px 14px', fontWeight: 600, color: th.t1 }}>{d.name}</td>
                          <td style={{ padding: '9px 14px', color: th.t2, fontSize: 12 }}>{Object.keys(d.sheets).join(', ')}</td>
                          <td style={{ padding: '9px 14px', color: th.t1 }}>{totalRows.toLocaleString()}</td>
                          <td style={{ padding: '9px 14px', color: th.t2, fontSize: 12 }}>{new Date(d.uploadedAt).toLocaleDateString()}</td>
                          <td style={{ padding: '9px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: isActive ? `${accentColor}20` : th.sub, color: isActive ? accentColor : th.t2, border: `1px solid ${isActive ? accentColor + '40' : th.bdr}` }}>
                              {isActive ? '● Active' : '○ Standby'}
                            </span>
                          </td>
                          <td style={{ padding: '9px 14px' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {!isActive && <button onClick={() => setActiveDatasetId(d.id)} style={{ ...S.btn('secondary'), padding: '4px 10px', fontSize: 11 }}>Activate</button>}
                              <button onClick={() => deleteDataset(d.id)} style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>}
              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {FY_OPTIONS.map(f => (
                  <button key={f} onClick={() => { setActiveFY(f); setActiveDatasetId(null); }}
                    style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: f === activeFY ? `1px solid ${accentColor}` : `1px solid ${th.bdr}`, background: f === activeFY ? `${accentColor}15` : 'transparent', color: f === activeFY ? accentColor : th.t2, fontWeight: f === activeFY ? 600 : 400 }}>
                    {f} <span style={{ opacity: 0.6 }}>({(dataStore[f] ?? []).length})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ FINANCIAL YEAR ════ */}
        {activeTab === 'Financial Year' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Period Selection</h3>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: th.t2, display: 'block', marginBottom: 6 }}>Financial Year</label>
                <select value={activeFY} onChange={e => { setActiveFY(e.target.value); setActiveDatasetId(null); }} style={S.input}>{FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}</select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: th.t2, display: 'block', marginBottom: 6 }}>Month (YTD to)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {MONTHS.map(m => (
                    <button key={m} onClick={() => setMonth(m)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: month === m ? `1px solid ${accentColor}` : `1px solid ${th.bdr}`, background: month === m ? `${accentColor}20` : 'transparent', color: month === m ? accentColor : th.t2, fontWeight: month === m ? 600 : 400 }}>{m}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: th.t2, display: 'block', marginBottom: 6 }}>Compare Against</label>
                <select value={compareFy} onChange={e => setCompareFy(e.target.value)} style={S.input}>{FY_OPTIONS.filter(f => f !== activeFY).map(f => <option key={f} value={f}>{f}</option>)}</select>
              </div>
              <div style={{ padding: '12px', background: th.sub, borderRadius: 8, border: `1px solid ${th.rbdr}` }}>
                <div style={{ fontSize: 10, color: th.t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Data Available by FY</div>
                {FY_OPTIONS.map(f => (
                  <div key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: f === activeFY ? accentColor : th.t2, fontWeight: f === activeFY ? 600 : 400 }}>{f}</span>
                    <span style={{ color: (dataStore[f] ?? []).length > 0 ? '#4ade80' : th.t3 }}>{(dataStore[f] ?? []).length} dataset{(dataStore[f] ?? []).length !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>{activeFY} vs {compareFy} — Key Metrics</h3>
              {kpis.slice(0, 5).map(k => (
                <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${th.rbdr}`, fontSize: 13 }}>
                  <span style={{ color: th.t2 }}>{k.label}</span>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: th.t3, marginBottom: 2 }}>{activeFY}</div>
                      <div style={{ fontWeight: 600, color: accentColor }}>{k.value}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: th.t3, marginBottom: 2 }}>{compareFy}</div>
                      <div style={{ fontWeight: 600, color: th.t3 }}>{(dataStore[compareFy] ?? []).length > 0 ? '…' : '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {effectiveTrend.length > 0 && (
              <div style={{ ...S.card, gridColumn: '1 / -1' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Year-on-Year Comparison</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={yoyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={th.grid} />
                    <XAxis dataKey="month" tick={{ fill: th.tick, fontSize: 11 }} />
                    <YAxis tick={{ fill: th.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={th.tip} />
                    <Bar dataKey="Current FY" fill={accentColor} radius={[3,3,0,0]} />
                    <Bar dataKey="Prior FY" fill={th.priorFy} radius={[3,3,0,0]} />
                    <Bar dataKey="Budget" fill={th.barMuted} radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ════ COST BREAKDOWN ════ */}
        {activeTab === 'Cost Breakdown' && (
          effectiveCosts.length === 0
            ? <div style={{ ...S.card, textAlign: 'center', padding: 60 }}><p style={{ color: th.t3 }}>No cost data. Upload a file with a "Cost Breakdown" sheet, or add the costAccounts prop.</p></div>
            : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Natural Account Split</h3>
                <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 13 }}>
                  <span><span style={{ color: th.t2 }}>Budget </span><strong style={{ color: th.t1 }}>${totalBudget.toLocaleString()}</strong></span>
                  <span><span style={{ color: th.t2 }}>Actual </span><strong style={{ color: variance > 0 ? '#f87171' : '#4ade80' }}>${totalActual.toLocaleString()}</strong></span>
                  <span><span style={{ color: th.t2 }}>Var </span><strong style={{ color: variance > 0 ? '#f87171' : '#4ade80' }}>{variance > 0 ? '+' : ''}${variance.toLocaleString()}</strong></span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={accountPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                      {accountPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v) => typeof v === 'number' ? `$${v.toLocaleString()}` : v} contentStyle={th.tip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Budget vs Actual by Account</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={effectiveCosts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={th.grid} />
                    <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: th.tick, fontSize: 10 }} />
                    <YAxis type="category" dataKey="account" tick={{ fill: th.tick, fontSize: 10 }} width={95} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? `$${v.toLocaleString()}` : v} contentStyle={th.tip} />
                    <Bar dataKey="budget" fill={th.barMuted} name="Budget" radius={[0,3,3,0]} />
                    <Bar dataKey="actual" fill={accentColor} name="Actual" radius={[0,3,3,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ ...S.card, gridColumn: '1 / -1' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Account Detail</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: th.rhead }}>{['Account','Dept / Zone','Budget','Actual','Variance','Status'].map(h => <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, color: th.t3, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                  <tbody>{effectiveCosts.map((a, i) => {
                    const v = a.actual - a.budget;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${th.rbdr}` }}>
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: th.t1 }}>{a.account}</td>
                        <td style={{ padding: '9px 14px', color: th.t2 }}>{a.dept || a.zone || '—'}</td>
                        <td style={{ padding: '9px 14px', color: th.t1 }}>${a.budget.toLocaleString()}</td>
                        <td style={{ padding: '9px 14px', color: th.t1 }}>${a.actual.toLocaleString()}</td>
                        <td style={{ padding: '9px 14px', color: v > 0 ? '#f87171' : '#4ade80' }}>{v > 0 ? '+' : ''}${v.toLocaleString()}</td>
                        <td style={{ padding: '9px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: v > 0 ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)', color: v > 0 ? '#f87171' : '#4ade80' }}>{v > 0 ? 'Over budget' : 'Under budget'}</span></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
        )}

        {/* ════ TRENDS ════ */}
        {activeTab === 'Trends' && (
          effectiveTrend.length === 0
            ? <div style={{ ...S.card, textAlign: 'center', padding: 60 }}><p style={{ color: th.t3 }}>No trend data. Upload a file with a "Monthly Trend" sheet, or add the monthlyTrend prop.</p></div>
            : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Monthly Trend</h3>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: th.t2 }}>Actual vs budget · {isLiveData ? activeDataset?.name : 'sample data'}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={effectiveTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={th.grid} />
                    <XAxis dataKey="month" tick={{ fill: th.tick, fontSize: 11 }} />
                    <YAxis tick={{ fill: th.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={th.tip} />
                    <Area type="monotone" dataKey="actual" stroke={accentColor} fill={`${accentColor}30`} name="Actual" />
                    {effectiveTrend[0]?.budget !== undefined && <Area type="monotone" dataKey="budget" stroke={th.budgetLine} fill={L ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)'} name="Budget" strokeDasharray="4 4" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Forecast to EOFY</h3>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: th.t2 }}>Linear extrapolation from current run rate</p>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
                  {([
                    ['YTD Actual',   `$${ytdActual.toLocaleString()}`,    accentColor],
                    ['EOFY Forecast',`$${eofyForecast.toLocaleString()}`, '#fbbf24'],
                    ...(totalBudget ? [['Annual Budget', `$${totalBudget.toLocaleString()}`, th.t2]] : []),
                  ] as [string, string, string][]).map(([l, v, c]) => (
                    <div key={l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: th.t2, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
                {totalBudget > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: th.t2, marginBottom: 6 }}>Forecast vs Budget: {eofyForecast > totalBudget ? `+$${(eofyForecast - totalBudget).toLocaleString()} over` : `-$${(totalBudget - eofyForecast).toLocaleString()} under`}</div>
                    <div style={{ height: 8, background: th.sub, borderRadius: 4 }}>
                      <div style={{ width: `${Math.min(eofyForecast / totalBudget * 100, 100)}%`, height: '100%', background: eofyForecast > totalBudget ? '#f87171' : accentColor, borderRadius: 4 }} />
                    </div>
                  </>
                )}
              </div>
              <div style={{ ...S.card, gridColumn: '1 / -1' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Year-on-Year & Budget Variance</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={yoyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={th.grid} />
                    <XAxis dataKey="month" tick={{ fill: th.tick, fontSize: 11 }} />
                    <YAxis tick={{ fill: th.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={th.tip} />
                    <Bar dataKey="Current FY" fill={accentColor} radius={[3,3,0,0]} />
                    <Bar dataKey="Prior FY" fill={th.priorFy} radius={[3,3,0,0]} />
                    <Bar dataKey="Budget" fill={th.barMuted} radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
        )}

        {/* ════ COMPLIANCE ════ */}
        {activeTab === 'Compliance' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
            <div style={S.card}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: th.t1 }}>SLA Targets & Performance</h3>
              {effectiveSLA.length === 0
                ? <p style={{ fontSize: 13, color: th.t3 }}>No SLA targets. Upload a file with a "Compliance" sheet, or add the slaTargets prop.</p>
                : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ background: th.rhead }}>{['KPI','Target','Actual','Status','Note'].map(h => <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, color: th.t3, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                    <tbody>{effectiveSLA.map((s, i) => {
                      const sc = STATUS_C[s.status];
                      return (
                        <tr key={i} style={{ borderTop: `1px solid ${th.rbdr}` }}>
                          <td style={{ padding: '9px 14px', fontWeight: 500, color: th.t1 }}>{s.kpi}</td>
                          <td style={{ padding: '9px 14px', color: th.t2 }}>{s.target}</td>
                          <td style={{ padding: '9px 14px', fontWeight: 600, color: th.t1 }}>{s.actual}</td>
                          <td style={{ padding: '9px 14px' }}><span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>{s.status}</span></td>
                          <td style={{ padding: '9px 14px', color: th.t2, fontSize: 12 }}>{s.note || '—'}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Compliance Score</h3>
                {effectiveSLA.length > 0 ? (() => {
                  const pct = Math.round(effectiveSLA.filter(s => s.status === 'Met').length / effectiveSLA.length * 100);
                  return (
                    <>
                      <div style={{ fontSize: 44, fontWeight: 800, textAlign: 'center', color: pct >= 80 ? '#4ade80' : pct >= 60 ? '#fbbf24' : '#f87171' }}>{pct}%</div>
                      <div style={{ fontSize: 12, textAlign: 'center', color: th.t2, marginTop: 4 }}>{effectiveSLA.filter(s => s.status === 'Met').length} of {effectiveSLA.length} targets met</div>
                      {(['Met', 'At Risk', 'Missed'] as const).map(st => (
                        <div key={st} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${th.rbdr}`, fontSize: 13, marginTop: 12 }}>
                          <span style={{ color: STATUS_C[st].text }}>● {st}</span>
                          <span style={{ fontWeight: 600, color: th.t1 }}>{effectiveSLA.filter(s => s.status === st).length}</span>
                        </div>
                      ))}
                    </>
                  );
                })() : <p style={{ fontSize: 13, color: th.t3 }}>No data</p>}
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: th.t1 }}>Exception Report</h3>
                {effectiveSLA.filter(s => s.status !== 'Met').length === 0
                  ? <p style={{ fontSize: 13, color: '#4ade80' }}>✓ No current exceptions</p>
                  : effectiveSLA.filter(s => s.status !== 'Met').map((s, i) => (
                    <div key={i} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 8, background: STATUS_C[s.status].bg, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: STATUS_C[s.status].text }}>{s.kpi}</div>
                      <div style={{ color: th.t2, marginTop: 2 }}>Actual {s.actual} vs target {s.target}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ AI REPORT ════ */}
        {activeTab === 'AI Report' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: th.t1 }}>AI Executive Report</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: th.t2 }}>Brainbase AI · {activeFY} · {isLiveData ? `Live: ${activeDataset?.name}` : 'Sample data'}</p>
                </div>
                <button onClick={generateAIReport} disabled={aiLoading} style={{ ...S.btn('primary'), background: accentColor, opacity: aiLoading ? 0.7 : 1 }}>
                  {aiLoading ? '⏳ Generating…' : '✦ Generate Report'}
                </button>
              </div>
              {aiReport
                ? <div style={{ background: th.sub, border: `1px solid ${th.rbdr}`, borderRadius: 10, padding: 20 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.75, color: th.t1, fontFamily: 'inherit', margin: 0 }}>{aiReport}</pre>
                  </div>
                : <div style={{ textAlign: 'center', padding: '60px 20px', color: th.t3 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
                    <div style={{ fontSize: 14 }}>Generate an AI-written executive summary with cost analysis, risks, and recommended actions from {isLiveData ? 'your live data' : 'sample data'}.</div>
                  </div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: th.t1 }}>Data Source</h3>
                <div style={{ padding: '10px 12px', background: isLiveData ? `${accentColor}10` : th.sub, borderRadius: 8, border: `1px solid ${isLiveData ? accentColor + '30' : th.bdr}`, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: isLiveData ? accentColor : th.t2, marginBottom: isLiveData ? 4 : 0 }}>{isLiveData ? '● Live Data' : '○ Sample Data'}</div>
                  {isLiveData && <>
                    <div style={{ color: th.t2 }}>{activeDataset?.name} · {activeFY}</div>
                    <div style={{ color: th.t3, marginTop: 2 }}>{Object.keys(activeDataset?.sheets ?? {}).length} sheets · {Object.values(activeDataset?.sheets ?? {}).reduce((s, r) => s + r.length, 0)} rows</div>
                  </>}
                </div>
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: th.t1 }}>Export</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={exportPDF}          style={{ ...S.btn('ghost'), textAlign: 'left' }}>📄 PDF Report</button>
                  <button onClick={exportBoardSummary} style={{ ...S.btn('ghost'), textAlign: 'left' }}>📋 Board Summary (.txt)</button>
                  <button onClick={exportExcel}        style={{ ...S.btn('ghost'), textAlign: 'left' }}>📊 Excel Workbook</button>
                </div>
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: th.t1 }}>KPI Snapshot</h3>
                {kpis.slice(0, 5).map(k => (
                  <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${th.rbdr}`, fontSize: 12 }}>
                    <span style={{ color: th.t2 }}>{k.label}</span>
                    <span style={{ fontWeight: 600, color: accentColor }}>{k.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ ACTIONS ════ */}
        {activeTab === 'Actions' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: th.t1 }}>Actions & Tasks</h3>
                <button onClick={() => setShowAdd(s => !s)} style={{ ...S.btn('primary'), background: accentColor }}>+ Add Action</button>
              </div>
              {showAdd && (
                <div style={{ background: th.sub, border: `1px solid ${accentColor}40`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div style={{ gridColumn: '1 / -1' }}><input placeholder="Action title…" value={newAction.title} onChange={e => setNewAction(a => ({ ...a, title: e.target.value }))} style={S.input} /></div>
                    <input placeholder="Assigned to…" value={newAction.assignee} onChange={e => setNewAction(a => ({ ...a, assignee: e.target.value }))} style={S.input} />
                    <input type="date" value={newAction.dueDate} onChange={e => setNewAction(a => ({ ...a, dueDate: e.target.value }))} style={S.input} />
                    <select value={newAction.priority} onChange={e => setNewAction(a => ({ ...a, priority: e.target.value as Action['priority'] }))} style={S.input}>
                      <option value="High">High Priority</option>
                      <option value="Medium">Medium Priority</option>
                      <option value="Low">Low Priority</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={addAction} style={{ ...S.btn('primary'), background: accentColor }}>Save</button>
                    <button onClick={() => setShowAdd(false)} style={S.btn('ghost')}>Cancel</button>
                  </div>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: th.rhead }}>{['Action','Assignee','Due','Priority','Status'].map(h => <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, color: th.t3, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {actions.length === 0
                    ? <tr><td colSpan={5} style={{ padding: '24px 14px', textAlign: 'center', color: th.t3, fontSize: 13 }}>No actions yet. Add one above or generate via AI Report.</td></tr>
                    : actions.map(a => (
                      <tr key={a.id} style={{ borderTop: `1px solid ${th.rbdr}`, opacity: a.status === 'Complete' ? 0.5 : 1 }}>
                        <td style={{ padding: '9px 14px', fontWeight: 500, color: th.t1, textDecoration: a.status === 'Complete' ? 'line-through' : 'none' }}>{a.title}</td>
                        <td style={{ padding: '9px 14px', color: th.t2 }}>{a.assignee}</td>
                        <td style={{ padding: '9px 14px', color: th.t2, fontSize: 12 }}>{a.dueDate}</td>
                        <td style={{ padding: '9px 14px' }}><span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_C[a.priority] }}>● {a.priority}</span></td>
                        <td style={{ padding: '9px 14px' }}>
                          <select value={a.status} onChange={e => setActions(p => p.map(x => x.id === a.id ? { ...x, status: e.target.value as Action['status'] } : x))} style={{ ...S.input, padding: '4px 8px', fontSize: 11 }}>
                            {ACTION_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: th.t1 }}>Status Summary</h3>
                {ACTION_STATUS.map(s => {
                  const count = actions.filter(a => a.status === s).length;
                  return <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${th.rbdr}`, fontSize: 13 }}>
                    <span style={{ color: th.t2 }}>{s}</span>
                    <span style={{ fontWeight: 700, color: s === 'Complete' ? '#4ade80' : s === 'In progress' ? '#fbbf24' : th.t2 }}>{count}</span>
                  </div>;
                })}
              </div>
              <div style={S.card}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: th.t1 }}>Overdue</h3>
                {actions.filter(a => a.status !== 'Complete' && a.dueDate && new Date(a.dueDate) < new Date()).length === 0
                  ? <p style={{ fontSize: 13, color: '#4ade80' }}>✓ No overdue actions</p>
                  : actions.filter(a => a.status !== 'Complete' && a.dueDate && new Date(a.dueDate) < new Date()).map(a => (
                    <div key={a.id} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: '#f87171' }}>{a.title}</div>
                      <div style={{ color: th.t2, marginTop: 2 }}>{a.assignee} · Due {a.dueDate}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ EXPORT ════ */}
        {activeTab === 'Export' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
            {[
              { icon: '📄', title: 'PDF Report',     desc: 'Full dashboard as a formatted PDF, ready for email or print.',                          action: exportPDF,          label: 'Export PDF' },
              { icon: '📊', title: 'Excel Workbook',  desc: 'All data tables, cost breakdowns, trends, and compliance KPIs in a multi-sheet workbook.', action: exportExcel,        label: 'Export to Excel' },
              { icon: '📋', title: 'Board Summary',   desc: 'One-page executive summary with key metrics, risks, and outstanding actions as plain text.', action: exportBoardSummary, label: 'Download Summary' },
              { icon: '💾', title: 'Raw Data',        desc: 'Underlying data sheets as an Excel file — ready for external analysis.',                  action: downloadSample,     label: 'Export Raw Data' },
            ].map(e => (
              <div key={e.title} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 32 }}>{e.icon}</div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: th.t1 }}>{e.title}</h3>
                <p style={{ margin: 0, fontSize: 13, color: th.t2, lineHeight: 1.6, flex: 1 }}>{e.desc}</p>
                <button onClick={e.action} style={{ ...S.btn('secondary'), borderColor: accentColor, color: accentColor, width: '100%' }}>{e.label}</button>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
    </DashboardDataContext.Provider>
  );
}
