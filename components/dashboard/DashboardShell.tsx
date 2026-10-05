'use client';

import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import ExecutiveSummaryBar from './ui/ExecutiveSummary';
import OpportunityCard     from './ui/OpportunityCard';
import InsightCardCmp      from './ui/InsightCard';
import ExecutivePanel      from './ui/ExecutivePanel';
import DashboardGrid       from './ui/DashboardGrid';
import { useDashboardChart } from './ui/chartTheme';
import { Badge, Metric, MetricStrip, buttonProps, type MetricTone } from '@/components/ui/app';
import styles              from './DashboardShell.module.css';
import { useAppStore }     from '../../lib/state/useAppStore';
import { useRouter, usePathname } from 'next/navigation';
import { DASHBOARDS }      from '../../lib/dashboard/registry';

// Authenticated visual-completion pass: the shell is token-driven and follows
// the app theme (<html data-theme>) in light AND dark. It no longer paints a
// forced-dark (or forced-light) palette:
//   - `theme` is still accepted on DashboardShellProps for compatibility but
//     no longer selects colours — consumers may omit it; passing either value
//     renders the same theme-following shell.
//   - `headerColor` is still accepted but no longer floods the header (the
//     header is a token surface); `accentColor` survives only as a small
//     module identity swatch beside the title. Active tab, pressed toggles
//     and the primary action use the product accent tokens.
//   - Recharts marks, axes, grid and tooltips read the theme-aware chart
//     palette (useDashboardChart → components/ui/app/chartPalette).
// Every route, handler, calculation, persisted key, fetch, export and tab
// is unchanged.

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
  /** Accepted for compatibility; no longer floods the header (token surface). */
  headerColor: string;
  /** Module identity swatch beside the title (never used as text colour). */
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
  /**
   * Accepted for compatibility only. The shell follows the app theme
   * (<html data-theme>); neither value forces a palette any more.
   */
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
// SLA status → semantic Badge state (written label + shape, not colour alone).
const STATUS_STATE = { Met: 'success', 'At Risk': 'warning', Missed: 'error' } as const;
const STATUS_TONE  = { Met: 'success', 'At Risk': 'warning', Missed: 'danger' } as const;
const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'success' } as const;
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
  title, subtitle, accentColor, breadcrumbLabel,
  kpis = [], recommendedActions = [], insightCards = [], overviewContent, industryTabs = [], sampleData = {},
  monthlyTrend = [], costAccounts = [], slaTargets = [],
  defaultActions = [], aiContext = '',
  executiveSummary, snapshotPanel, uploadServiceType,
}: DashboardShellProps) {

  // ─── Chart palette (theme-aware; SVG needs concrete colours) ───────────────
  const chart = useDashboardChart();
  const pal   = chart.palette;

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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
    name: a.account, value: a.actual, fill: chart.series[i % chart.series.length],
  }));

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

  // Tabs: arrow / Home / End move the selection (roving tabindex).
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = GLOBAL_TABS.indexOf(activeTab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % GLOBAL_TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + GLOBAL_TABS.length) % GLOBAL_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = GLOBAL_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setActiveTab(GLOBAL_TABS[next]);
    tabRefs.current[next]?.focus();
  }

  const kpiTone = (k: KPI): MetricTone | undefined =>
    k.alert || k.status === 'risk' ? 'danger' : k.status === 'watch' ? 'warning' : undefined;

  const barRadius: [number, number, number, number] = [3, 3, 0, 0];

  // ─── Render ──────────────────────────────────────────────────────────────────

  const industryContent = industryTabs.find(t => t.label === activeTab)?.content;
  const activeTabIndex  = GLOBAL_TABS.indexOf(activeTab);

  return (
    <DashboardDataContext.Provider value={{ dataset: activeDataset, activeFY, getSheet }}>
    <div className={styles.shell}>

      {/* ── Header ── */}
      <header className={styles.header}>
        <nav aria-label="Breadcrumb">
          <ol className={styles.breadcrumb}>
            <li><a href="/">Brainbase</a></li>
            <li aria-hidden="true" className={styles.breadcrumbSep}>›</li>
            <li><a href="/dashboard/overview">Overview</a></li>
            <li aria-hidden="true" className={styles.breadcrumbSep}>›</li>
            <li className={styles.breadcrumbCurrent} aria-current="page">{breadcrumbLabel}</li>
          </ol>
        </nav>
        <div className={styles.headerRow}>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.swatch} style={{ background: accentColor }} aria-hidden="true" />
              <h1 className={styles.title}>{title}</h1>
              <select
                aria-label="Switch dashboard"
                className={styles.select}
                value={pathname ?? ''}
                onChange={e => { if (e.target.value) router.push(e.target.value); }}
              >
                {Object.values(DASHBOARDS).map(d => (
                  <option key={d.route} value={d.route}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.subtitle}>{subtitle}</div>
            <button
              type="button"
              {...buttonProps('ghost', 'sm')}
              style={{ marginTop: 6, marginLeft: -10 }}
              onClick={() => useAppStore.getState().fireHelena(`Explain this ${title} dashboard to me — cover the key metrics, any risks or issues, and what I should focus on.`)}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zm0 6v4m0 4h.01"/></svg>
              Ask HLNA to explain
            </button>
          </div>
          <div className={styles.headerActions}>
            <select
              aria-label="Financial year"
              className={styles.select}
              value={activeFY}
              onChange={e => { setActiveFY(e.target.value); setActiveDatasetId(null); }}
            >
              {FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {fyDatasets.length > 0 && (
              <select
                aria-label="Dataset"
                className={styles.select}
                style={{ maxWidth: 200 }}
                value={activeDatasetId ?? ''}
                onChange={e => setActiveDatasetId(e.target.value || null)}
              >
                <option value="">Sample data</option>
                {fyDatasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <span className={styles.sourceChip} data-live={isLiveData}>
              {isLiveData ? '● Live' : '○ Sample'}
            </span>
            <button type="button" onClick={downloadSample} {...buttonProps('secondary', 'sm')}>↓ Sample</button>
            <button type="button" onClick={() => fileRef.current?.click()} {...buttonProps('secondary', 'sm')}>↑ Upload</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={handleUpload} style={{ display: 'none' }} aria-label="Upload dataset file" tabIndex={-1} />
            <button type="button" onClick={exportPDF} {...buttonProps('primary', 'sm')}>Export PDF</button>
          </div>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className={styles.tabs} role="tablist" aria-label={`${title} views`} onKeyDown={onTabKeyDown}>
        {GLOBAL_TABS.map((t, i) => (
          <button
            key={t}
            ref={el => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`shell-tab-${i}`}
            aria-selected={activeTab === t}
            aria-controls="shell-content"
            tabIndex={activeTab === t ? 0 : -1}
            onClick={() => setActiveTab(t)}
            className={styles.tab}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── KPI strip ── */}
      {kpis.length > 0 && (
        <div className={styles.kpis}>
          <MetricStrip>
            {kpis.map(k => (
              <Metric
                key={k.label}
                label={<>{k.icon && <span aria-hidden="true" className={styles.kpiIcon}>{k.icon}</span>}{k.label}</>}
                value={k.value}
                sub={k.sub}
                tone={kpiTone(k)}
              />
            ))}
          </MetricStrip>
        </div>
      )}

      {/* ── Executive Summary strip (Overview only) ── */}
      {executiveSummary && activeTab === 'Overview' && (
        <ExecutiveSummaryBar summary={executiveSummary} accentColor={accentColor} />
      )}

      {/* ── Tab content ── */}
      <div
        id="shell-content"
        role="tabpanel"
        aria-labelledby={`shell-tab-${activeTabIndex}`}
        className={styles.content}
        data-overview={activeTab === 'Overview'}
      >

        {activeTab === 'Overview' && (() => {
          const potentialSavings = recommendedActions.reduce((sum, ra) => {
            const m = ra.impact.match(/\$\s*([\d,]+)/);
            return sum + (m ? parseInt(m[1].replace(/,/g, '')) : 0);
          }, 0);
          const totalBudgetSnap = effectiveCosts.reduce((s, a) => s + a.budget, 0);
          const totalActualSnap = effectiveCosts.reduce((s, a) => s + a.actual, 0);
          const snapSavings     = snapshotPanel?.savingsIdentified ?? potentialSavings;
          const snapConf        = snapshotPanel?.confidence ?? 84;
          const snapTopCost     = snapshotPanel?.topCostDriver ?? (effectiveCosts.length ? effectiveCosts.reduce((a, b) => b.actual > a.actual ? b : a).account : '');
          const snapBigRisk     = snapshotPanel?.biggestRisk ?? (recommendedActions.find(r => r.priority === 'High')?.title ?? '');

          return (
            <>
              {/* ── 1. AI Insight grid (full-width) ── */}
              {insightCards.length > 0 && (
                <div className={`${styles.band} ${styles.insightGrid}`} style={{ gridTemplateColumns: `repeat(${Math.min(insightCards.length, 3)}, minmax(0, 1fr))` }}>
                  {insightCards.map((ic, i) => (
                    <InsightCardCmp
                      key={i}
                      severity={ic.severity}
                      problem={ic.problem}
                      cause={ic.cause}
                      recommendation={ic.recommendation}
                    />
                  ))}
                </div>
              )}

              {/* ── 2. Main charts / overview content ── */}
              <div className={styles.overviewBody}>
                {overviewContent}
              </div>

              {/* ── 3. AI Opportunities + Executive Snapshot (bottom) ── */}
              {recommendedActions.length > 0 && (
                <section className={styles.opportunities} aria-labelledby="shell-opportunities">
                  {/* Header row */}
                  <div className={styles.sectionHead}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h2 id="shell-opportunities" className={styles.sectionTitle}>AI Opportunities</h2>
                      <span className={styles.count}>{recommendedActions.length}</span>
                      {potentialSavings > 0 && (
                        <Badge state="success" dot={false}>${potentialSavings.toLocaleString()} identified</Badge>
                      )}
                    </div>
                    <button type="button" onClick={() => setActiveTab('AI Report')} {...buttonProps('primary', 'sm')}>
                      <span aria-hidden="true">✦</span> AI Report
                    </button>
                  </div>

                  <DashboardGrid
                    left={
                      <div className={styles.oppGrid}>
                        {recommendedActions.slice(0, 4).map((ra, i) => (
                          <OpportunityCard
                            key={i}
                            index={i}
                            priority={ra.priority}
                            title={ra.title}
                            impact={ra.impact}
                            accentColor={accentColor}
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
                      />
                    }
                  />
                </section>
              )}
            </>
          );
        })()}

        {industryContent && activeTab !== 'Overview' && industryContent}

        {/* ════ DATA UPLOAD ════ */}
        {activeTab === 'Data Upload' && (
          <div className={styles.grid2}>

            {activeDataset && (
              <div className={styles.activeDataset}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>● Active: {activeDataset.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12 }}>
                    {activeFY} · {Object.keys(activeDataset.sheets).length} sheets · {Object.values(activeDataset.sheets).reduce((s, r) => s + r.length, 0)} total rows · uploaded {new Date(activeDataset.uploadedAt).toLocaleDateString()}
                  </span>
                </div>
                <button type="button" onClick={() => setActiveDatasetId(null)} {...buttonProps('secondary', 'sm')}>Revert to sample</button>
              </div>
            )}

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Upload Dataset</h2>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="shell-upload-fy" className={styles.label}>Financial Year</label>
                <select id="shell-upload-fy" value={activeFY} onChange={e => setActiveFY(e.target.value)} className={styles.input}>
                  {FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => fileRef.current?.click()} className={styles.dropzone}>
                <div aria-hidden="true" style={{ fontSize: 30, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Drop XLSX or CSV, or click to browse</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>All sheets imported automatically</div>
              </button>
              <button type="button" onClick={downloadSample} {...buttonProps('secondary')} style={{ width: '100%' }}>↓ Download Sample Template</button>
              {validErrors.length > 0 && (
                <div className={styles.notice} data-tone="danger" role="alert">
                  {validErrors.map(e => <div key={e}><span aria-hidden="true">⚠ </span>{e}</div>)}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                {uploadPreview ? `${uploadPreview.name} — Preview` : 'Upload Preview'}
              </h2>
              {uploadPreview ? (
                <>
                  <div className={styles.sheetChips}>
                    {Object.entries(uploadPreview.sheets).map(([name, rows]) => (
                      <span key={name} className={styles.chip}>
                        <strong>{name}</strong>
                        <span>{rows.length}r</span>
                      </span>
                    ))}
                  </div>
                  {Object.entries(uploadPreview.sheets).slice(0, 1).map(([name, rows]) => (
                    <div key={name}>
                      <div className={styles.eyebrow}>{name}</div>
                      <div className={styles.tableWrap}>
                        <table className={`${styles.table} ${styles.tableCompact}`}>
                          <thead><tr>
                            {rows.length > 0 && Object.keys(rows[0]).slice(0, 6).map(col => (
                              <th key={col} scope="col">{col}</th>
                            ))}
                          </tr></thead>
                          <tbody>{rows.slice(0, 4).map((row: any, i) => (
                            <tr key={i}>
                              {Object.values(row as object).slice(0, 6).map((v: any, j) => (
                                <td key={j} style={{ color: 'var(--text-primary)' }}>{String(v)}</td>
                              ))}
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                      {rows.length > 4 && <div className={styles.muted} style={{ fontSize: 11, marginTop: 5 }}>+{rows.length - 4} more rows</div>}
                    </div>
                  ))}
                  {validErrors.length === 0 && (
                    <div className={styles.notice} data-tone="success" role="status">
                      ✓ Saved to {activeFY} — {Object.keys(uploadPreview.sheets).length} sheet{Object.keys(uploadPreview.sheets).length !== 1 ? 's' : ''} imported and active
                    </div>
                  )}
                </>
              ) : <p className={styles.muted}>Upload a file to preview all sheets.</p>}
            </div>

            <div className={`${styles.card} ${styles.span}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
                <h2 className={styles.cardTitle} style={{ margin: 0 }}>Dataset Manager — {activeFY}</h2>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fyDatasets.length} dataset{fyDatasets.length !== 1 ? 's' : ''}</span>
              </div>
              {fyDatasets.length === 0
                ? <p className={styles.muted}>No datasets for {activeFY} yet. Upload a file above.</p>
                : <div className={styles.tableWrap}><table className={styles.table}>
                    <thead><tr>
                      {['Name', 'Sheets', 'Total Rows', 'Uploaded', 'Status'].map(h => (
                        <th key={h} scope="col">{h}</th>
                      ))}
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr></thead>
                    <tbody>{fyDatasets.map(d => {
                      const totalRows = Object.values(d.sheets).reduce((s, r) => s + r.length, 0);
                      const isActive  = d.id === activeDatasetId;
                      return (
                        <tr key={d.id} data-active={isActive}>
                          <td className={styles.primary}>{d.name}</td>
                          <td style={{ fontSize: 12 }}>{Object.keys(d.sheets).join(', ')}</td>
                          <td className={styles.num}>{totalRows.toLocaleString()}</td>
                          <td style={{ fontSize: 12 }}>{new Date(d.uploadedAt).toLocaleDateString()}</td>
                          <td>
                            <Badge state={isActive ? 'active' : 'inactive'} dot={false}>{isActive ? '● Active' : '○ Standby'}</Badge>
                          </td>
                          <td>
                            <div className={styles.row}>
                              {!isActive && <button type="button" onClick={() => setActiveDatasetId(d.id)} {...buttonProps('secondary', 'sm')}>Activate</button>}
                              <button type="button" onClick={() => deleteDataset(d.id)} {...buttonProps('danger', 'sm')}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table></div>}
              <div className={styles.toggles} style={{ marginTop: 16 }} role="group" aria-label="Financial year">
                {FY_OPTIONS.map(f => (
                  <button key={f} type="button" aria-pressed={f === activeFY} className={styles.toggle} onClick={() => { setActiveFY(f); setActiveDatasetId(null); }}>
                    {f} <span style={{ color: 'var(--text-muted)' }}>({(dataStore[f] ?? []).length})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ FINANCIAL YEAR ════ */}
        {activeTab === 'Financial Year' && (
          <div className={styles.grid2}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Period Selection</h2>
              <div className={styles.field}>
                <label htmlFor="shell-period-fy" className={styles.label}>Financial Year</label>
                <select id="shell-period-fy" value={activeFY} onChange={e => { setActiveFY(e.target.value); setActiveDatasetId(null); }} className={styles.input}>{FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}</select>
              </div>
              <div className={styles.field} role="group" aria-labelledby="shell-period-month">
                <div id="shell-period-month" className={styles.label}>Month (YTD to)</div>
                <div className={styles.toggles}>
                  {MONTHS.map(m => (
                    <button key={m} type="button" aria-pressed={month === m} className={styles.toggle} onClick={() => setMonth(m)}>{m}</button>
                  ))}
                </div>
              </div>
              <div className={styles.field} style={{ marginBottom: 16 }}>
                <label htmlFor="shell-compare-fy" className={styles.label}>Compare Against</label>
                <select id="shell-compare-fy" value={compareFy} onChange={e => setCompareFy(e.target.value)} className={styles.input}>{FY_OPTIONS.filter(f => f !== activeFY).map(f => <option key={f} value={f}>{f}</option>)}</select>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div className={styles.eyebrow}>Data Available by FY</div>
                {FY_OPTIONS.map(f => (
                  <div key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: f === activeFY ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: f === activeFY ? 600 : 400 }}>{f}</span>
                    <span className={styles.toneText} data-tone={(dataStore[f] ?? []).length > 0 ? 'success' : 'muted'}>{(dataStore[f] ?? []).length} dataset{(dataStore[f] ?? []).length !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>{activeFY} vs {compareFy} — Key Metrics</h2>
              {kpis.slice(0, 5).map(k => (
                <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{k.label}</span>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{activeFY}</div>
                      <div className={styles.num} style={{ fontWeight: 600 }}>{k.value}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{compareFy}</div>
                      <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{(dataStore[compareFy] ?? []).length > 0 ? '…' : '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {effectiveTrend.length > 0 && (
              <div className={`${styles.card} ${styles.span}`}>
                <h2 className={styles.cardTitle}>Year-on-Year Comparison</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={yoyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="month" tick={chart.tick} />
                    <YAxis tick={chart.tick} />
                    <Tooltip {...chart.tooltip} />
                    <Bar dataKey="Current FY" fill={pal.primary} radius={barRadius} />
                    <Bar dataKey="Prior FY" fill={pal.secondary} radius={barRadius} />
                    <Bar dataKey="Budget" fill={pal.comparison} radius={barRadius} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ════ COST BREAKDOWN ════ */}
        {activeTab === 'Cost Breakdown' && (
          effectiveCosts.length === 0
            ? <div className={`${styles.card} ${styles.empty}`}><p className={styles.muted}>No cost data. Upload a file with a &quot;Cost Breakdown&quot; sheet, or add the costAccounts prop.</p></div>
            : <div className={styles.grid2}>
              <div className={styles.card}>
                <h2 className={styles.cardTitleTight} style={{ marginBottom: 6 }}>Natural Account Split</h2>
                <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 13, flexWrap: 'wrap' }}>
                  <span><span style={{ color: 'var(--text-secondary)' }}>Budget </span><strong className={styles.num}>${totalBudget.toLocaleString()}</strong></span>
                  <span><span style={{ color: 'var(--text-secondary)' }}>Actual </span><strong className={styles.toneText} data-tone={variance > 0 ? 'danger' : 'success'}>${totalActual.toLocaleString()}</strong></span>
                  <span><span style={{ color: 'var(--text-secondary)' }}>Var </span><strong className={styles.toneText} data-tone={variance > 0 ? 'danger' : 'success'}>{variance > 0 ? '+' : ''}${variance.toLocaleString()}</strong></span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={accountPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} stroke={pal.tooltipBg}>
                      {accountPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v) => typeof v === 'number' ? `$${v.toLocaleString()}` : v} {...chart.tooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Budget vs Actual by Account</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={effectiveCosts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ ...chart.tick, fontSize: 10 }} />
                    <YAxis type="category" dataKey="account" tick={{ ...chart.tick, fontSize: 10 }} width={95} />
                    <Tooltip formatter={(v) => typeof v === 'number' ? `$${v.toLocaleString()}` : v} {...chart.tooltip} />
                    <Bar dataKey="budget" fill={pal.comparison} name="Budget" radius={[0,3,3,0]} />
                    <Bar dataKey="actual" fill={pal.primary} name="Actual" radius={[0,3,3,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className={`${styles.card} ${styles.span}`}>
                <h2 className={styles.cardTitle}>Account Detail</h2>
                <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr>{['Account','Dept / Zone','Budget','Actual','Variance','Status'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                  <tbody>{effectiveCosts.map((a, i) => {
                    const v = a.actual - a.budget;
                    return (
                      <tr key={i}>
                        <td className={styles.primary}>{a.account}</td>
                        <td>{a.dept || a.zone || '—'}</td>
                        <td className={styles.num}>${a.budget.toLocaleString()}</td>
                        <td className={styles.num}>${a.actual.toLocaleString()}</td>
                        <td className={styles.toneText} data-tone={v > 0 ? 'danger' : 'success'} style={{ fontVariantNumeric: 'tabular-nums' }}>{v > 0 ? '+' : ''}${v.toLocaleString()}</td>
                        <td><Badge state={v > 0 ? 'error' : 'success'}>{v > 0 ? 'Over budget' : 'Under budget'}</Badge></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                </div>
              </div>
            </div>
        )}

        {/* ════ TRENDS ════ */}
        {activeTab === 'Trends' && (
          effectiveTrend.length === 0
            ? <div className={`${styles.card} ${styles.empty}`}><p className={styles.muted}>No trend data. Upload a file with a &quot;Monthly Trend&quot; sheet, or add the monthlyTrend prop.</p></div>
            : <div className={styles.grid2}>
              <div className={styles.card}>
                <h2 className={styles.cardTitleTight}>Monthly Trend</h2>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-secondary)' }}>Actual vs budget · {isLiveData ? activeDataset?.name : 'sample data'}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={effectiveTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="month" tick={chart.tick} />
                    <YAxis tick={chart.tick} />
                    <Tooltip {...chart.tooltip} />
                    <Area type="monotone" dataKey="actual" stroke={pal.primary} fill={pal.primary} fillOpacity={0.16} name="Actual" />
                    {effectiveTrend[0]?.budget !== undefined && <Area type="monotone" dataKey="budget" stroke={pal.comparison} fill={pal.comparison} fillOpacity={0.05} name="Budget" strokeDasharray="4 4" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitleTight}>Forecast to EOFY</h2>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-secondary)' }}>Linear extrapolation from current run rate</p>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
                  {([
                    ['YTD Actual',   `$${ytdActual.toLocaleString()}`,    undefined],
                    ['EOFY Forecast',`$${eofyForecast.toLocaleString()}`, 'warning'],
                    ...(totalBudget ? [['Annual Budget', `$${totalBudget.toLocaleString()}`, 'muted']] : []),
                  ] as [string, string, string | undefined][]).map(([l, v, tone]) => (
                    <div key={l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{l}</div>
                      <div className={`${styles.bigStat} ${styles.toneText}`} data-tone={tone} style={tone ? undefined : { color: 'var(--text-primary)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {totalBudget > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Forecast vs Budget: {eofyForecast > totalBudget ? `+$${(eofyForecast - totalBudget).toLocaleString()} over` : `-$${(totalBudget - eofyForecast).toLocaleString()} under`}</div>
                    <div className={styles.meter} aria-hidden="true">
                      <div className={styles.meterFill} style={{ width: `${Math.min(eofyForecast / totalBudget * 100, 100)}%`, background: eofyForecast > totalBudget ? 'var(--status-danger)' : 'var(--brand-brainbase-accent)' }} />
                    </div>
                  </>
                )}
              </div>
              <div className={`${styles.card} ${styles.span}`}>
                <h2 className={styles.cardTitle}>Year-on-Year & Budget Variance</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={yoyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="month" tick={chart.tick} />
                    <YAxis tick={chart.tick} />
                    <Tooltip {...chart.tooltip} />
                    <Bar dataKey="Current FY" fill={pal.primary} radius={barRadius} />
                    <Bar dataKey="Prior FY" fill={pal.secondary} radius={barRadius} />
                    <Bar dataKey="Budget" fill={pal.comparison} radius={barRadius} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
        )}

        {/* ════ COMPLIANCE ════ */}
        {activeTab === 'Compliance' && (
          <div className={styles.grid2to1}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>SLA Targets & Performance</h2>
              {effectiveSLA.length === 0
                ? <p className={styles.muted}>No SLA targets. Upload a file with a &quot;Compliance&quot; sheet, or add the slaTargets prop.</p>
                : <div className={styles.tableWrap}><table className={styles.table}>
                    <thead><tr>{['KPI','Target','Actual','Status','Note'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                    <tbody>{effectiveSLA.map((s, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{s.kpi}</td>
                          <td>{s.target}</td>
                          <td className={styles.primary}>{s.actual}</td>
                          <td><Badge state={STATUS_STATE[s.status]}>{s.status}</Badge></td>
                          <td style={{ fontSize: 12 }}>{s.note || '—'}</td>
                        </tr>
                    ))}</tbody>
                  </table></div>}
            </div>
            <div className={styles.stack}>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 14 }}>Compliance Score</h2>
                {effectiveSLA.length > 0 ? (() => {
                  const pct = Math.round(effectiveSLA.filter(s => s.status === 'Met').length / effectiveSLA.length * 100);
                  return (
                    <>
                      <div className={`${styles.score} ${styles.toneText}`} data-tone={pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'danger'}>{pct}%</div>
                      <div style={{ fontSize: 12, textAlign: 'center', color: 'var(--text-secondary)', marginTop: 4 }}>{effectiveSLA.filter(s => s.status === 'Met').length} of {effectiveSLA.length} targets met</div>
                      {(['Met', 'At Risk', 'Missed'] as const).map(st => (
                        <div key={st} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, marginTop: 12 }}>
                          <span className={styles.toneText} data-tone={STATUS_TONE[st]}>● {st}</span>
                          <span className={styles.num} style={{ fontWeight: 600 }}>{effectiveSLA.filter(s => s.status === st).length}</span>
                        </div>
                      ))}
                    </>
                  );
                })() : <p className={styles.muted}>No data</p>}
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 12 }}>Exception Report</h2>
                {effectiveSLA.filter(s => s.status !== 'Met').length === 0
                  ? <p className={styles.toneText} data-tone="success" style={{ fontSize: 13 }}>✓ No current exceptions</p>
                  : effectiveSLA.filter(s => s.status !== 'Met').map((s, i) => (
                    <div key={i} className={styles.exception} data-tone={STATUS_TONE[s.status]}>
                      <div className={styles.toneText} data-tone={STATUS_TONE[s.status]} style={{ fontWeight: 600 }}>{s.kpi}</div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>Actual {s.actual} vs target {s.target}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ AI REPORT ════ */}
        {activeTab === 'AI Report' && (
          <div className={styles.gridSide320}>
            <div className={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <h2 className={styles.cardTitle} style={{ margin: 0 }}>AI Executive Report</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Brainbase AI · {activeFY} · {isLiveData ? `Live: ${activeDataset?.name}` : 'Sample data'}</p>
                </div>
                <button type="button" onClick={generateAIReport} disabled={aiLoading} aria-busy={aiLoading || undefined} {...buttonProps('primary')}>
                  {aiLoading ? '⏳ Generating…' : '✦ Generate Report'}
                </button>
              </div>
              {aiReport
                ? <div className={styles.report} aria-live="polite">
                    <pre>{aiReport}</pre>
                  </div>
                : <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <div aria-hidden="true" style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
                    <div style={{ fontSize: 14 }}>Generate an AI-written executive summary with cost analysis, risks, and recommended actions from {isLiveData ? 'your live data' : 'sample data'}.</div>
                  </div>}
            </div>
            <div className={styles.stack}>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 10, fontSize: 14 }}>Data Source</h2>
                <div style={{ padding: '10px 12px', background: isLiveData ? 'var(--status-info-muted)' : 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', border: `1px solid ${isLiveData ? 'var(--status-info-border)' : 'var(--border)'}`, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: isLiveData ? 'var(--status-info)' : 'var(--text-secondary)', marginBottom: isLiveData ? 4 : 0 }}>{isLiveData ? '● Live Data' : '○ Sample Data'}</div>
                  {isLiveData && <>
                    <div style={{ color: 'var(--text-secondary)' }}>{activeDataset?.name} · {activeFY}</div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{Object.keys(activeDataset?.sheets ?? {}).length} sheets · {Object.values(activeDataset?.sheets ?? {}).reduce((s, r) => s + r.length, 0)} rows</div>
                  </>}
                </div>
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 10, fontSize: 14 }}>Export</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button type="button" onClick={exportPDF}          {...buttonProps('secondary')} style={{ justifyContent: 'flex-start' }}><span aria-hidden="true">📄</span> PDF Report</button>
                  <button type="button" onClick={exportBoardSummary} {...buttonProps('secondary')} style={{ justifyContent: 'flex-start' }}><span aria-hidden="true">📋</span> Board Summary (.txt)</button>
                  <button type="button" onClick={exportExcel}        {...buttonProps('secondary')} style={{ justifyContent: 'flex-start' }}><span aria-hidden="true">📊</span> Excel Workbook</button>
                </div>
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 8, fontSize: 14 }}>KPI Snapshot</h2>
                {kpis.slice(0, 5).map(k => (
                  <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12, gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{k.label}</span>
                    <span className={styles.num} style={{ fontWeight: 600 }}>{k.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ ACTIONS ════ */}
        {activeTab === 'Actions' && (
          <div className={styles.gridSide300}>
            <div className={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8 }}>
                <h2 className={styles.cardTitle} style={{ margin: 0 }}>Actions & Tasks</h2>
                <button type="button" onClick={() => setShowAdd(s => !s)} aria-expanded={showAdd} {...buttonProps('primary', 'sm')}>+ Add Action</button>
              </div>
              {showAdd && (
                <div className={styles.addForm}>
                  <div className={styles.addGrid}>
                    <div className={styles.span}><input aria-label="Action title" placeholder="Action title…" value={newAction.title} onChange={e => setNewAction(a => ({ ...a, title: e.target.value }))} className={styles.input} /></div>
                    <input aria-label="Assigned to" placeholder="Assigned to…" value={newAction.assignee} onChange={e => setNewAction(a => ({ ...a, assignee: e.target.value }))} className={styles.input} />
                    <input aria-label="Due date" type="date" value={newAction.dueDate} onChange={e => setNewAction(a => ({ ...a, dueDate: e.target.value }))} className={styles.input} />
                    <select aria-label="Priority" value={newAction.priority} onChange={e => setNewAction(a => ({ ...a, priority: e.target.value as Action['priority'] }))} className={styles.input}>
                      <option value="High">High Priority</option>
                      <option value="Medium">Medium Priority</option>
                      <option value="Low">Low Priority</option>
                    </select>
                  </div>
                  <div className={styles.row}>
                    <button type="button" onClick={addAction} {...buttonProps('primary', 'sm')}>Save</button>
                    <button type="button" onClick={() => setShowAdd(false)} {...buttonProps('ghost', 'sm')}>Cancel</button>
                  </div>
                </div>
              )}
              <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr>{['Action','Assignee','Due','Priority','Status'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {actions.length === 0
                    ? <tr><td colSpan={5} style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-muted)' }}>No actions yet. Add one above or generate via AI Report.</td></tr>
                    : actions.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 500, color: a.status === 'Complete' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: a.status === 'Complete' ? 'line-through' : 'none' }}>{a.title}</td>
                        <td>{a.assignee}</td>
                        <td style={{ fontSize: 12 }}>{a.dueDate}</td>
                        <td><span className={styles.toneText} data-tone={PRIORITY_TONE[a.priority]} style={{ fontSize: 12, fontWeight: 600 }}>● {a.priority}</span></td>
                        <td>
                          <select aria-label={`Status for ${a.title}`} value={a.status} onChange={e => setActions(p => p.map(x => x.id === a.id ? { ...x, status: e.target.value as Action['status'] } : x))} className={`${styles.input} ${styles.inputSm}`}>
                            {ACTION_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
            <div className={styles.stack}>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 12, fontSize: 14 }}>Status Summary</h2>
                <div className={styles.rowList}>
                {ACTION_STATUS.map(s => {
                  const count = actions.filter(a => a.status === s).length;
                  return <div key={s}>
                    <span style={{ color: 'var(--text-secondary)' }}>{s}</span>
                    <span className={styles.toneText} data-tone={s === 'Complete' ? 'success' : s === 'In progress' ? 'warning' : 'muted'} style={{ fontWeight: 700 }}>{count}</span>
                  </div>;
                })}
                </div>
              </div>
              <div className={styles.card}>
                <h2 className={styles.cardTitle} style={{ marginBottom: 12, fontSize: 14 }}>Overdue</h2>
                {actions.filter(a => a.status !== 'Complete' && a.dueDate && new Date(a.dueDate) < new Date()).length === 0
                  ? <p className={styles.toneText} data-tone="success" style={{ fontSize: 13 }}>✓ No overdue actions</p>
                  : actions.filter(a => a.status !== 'Complete' && a.dueDate && new Date(a.dueDate) < new Date()).map(a => (
                    <div key={a.id} className={styles.exception} data-tone="danger">
                      <div className={styles.toneText} data-tone="danger" style={{ fontWeight: 600 }}>{a.title}</div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{a.assignee} · Due {a.dueDate}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ EXPORT ════ */}
        {activeTab === 'Export' && (
          <div className={styles.gridAuto}>
            {[
              { icon: '📄', title: 'PDF Report',     desc: 'Full dashboard as a formatted PDF, ready for email or print.',                          action: exportPDF,          label: 'Export PDF' },
              { icon: '📊', title: 'Excel Workbook',  desc: 'All data tables, cost breakdowns, trends, and compliance KPIs in a multi-sheet workbook.', action: exportExcel,        label: 'Export to Excel' },
              { icon: '📋', title: 'Board Summary',   desc: 'One-page executive summary with key metrics, risks, and outstanding actions as plain text.', action: exportBoardSummary, label: 'Download Summary' },
              { icon: '💾', title: 'Raw Data',        desc: 'Underlying data sheets as an Excel file — ready for external analysis.',                  action: downloadSample,     label: 'Export Raw Data' },
            ].map(e => (
              <div key={e.title} className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div aria-hidden="true" className={styles.exportIcon}>{e.icon}</div>
                <h2 className={styles.cardTitle} style={{ margin: 0, fontSize: 16 }}>{e.title}</h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, flex: 1 }}>{e.desc}</p>
                <button type="button" onClick={e.action} {...buttonProps('secondary')} style={{ width: '100%' }}>{e.label}</button>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
    </DashboardDataContext.Provider>
  );
}
