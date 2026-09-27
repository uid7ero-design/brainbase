'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import WorkspaceShell from '@/components/ops/WorkspaceShell';
import MaintenanceJobDrawer, { type MaintenanceJob, type MaintenanceStatus, type Severity } from '@/components/ops/maintenance/MaintenanceJobDrawer';
import CreateJobModal from '@/components/ops/maintenance/CreateJobModal';
import RequestsMap from '@/components/ops/maintenance/RequestsMap';
import { buttonProps } from '@/components/ui/app';
import type {
  BinMaintenanceDashboardHeader, BinMaintenanceScheduleStatus, BinMaintenanceStreamStats,
  BinMaintenanceRepeatProperties, BinMaintenanceCompletionTrend,
} from '@/modules/bin-maintenance/calculations';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';
const PAGE_SIZE = 2000;

const SEV: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  CRITICAL: { color:'#EF4444', bg:'rgba(239,68,68,.09)',  border:'rgba(239,68,68,.22)',  label:'Critical' },
  HIGH:     { color:'#F97316', bg:'rgba(249,115,22,.08)', border:'rgba(249,115,22,.20)', label:'High'     },
  MEDIUM:   { color:'#F59E0B', bg:'rgba(245,158,11,.07)', border:'rgba(245,158,11,.18)', label:'Medium'   },
  LOW:      { color:'#22C55E', bg:'rgba(34,197,94,.06)',  border:'rgba(34,197,94,.16)',  label:'Low'      },
};

const ST: Record<MaintenanceStatus, { color: string; bg: string; label: string }> = {
  OPEN:        { color:'#EF4444', bg:'rgba(239,68,68,.14)',               label:'Open'        },
  ASSIGNED:    { color:'#60A5FA', bg:'rgba(96,165,250,.14)',              label:'Assigned'    },
  SCHEDULED:   { color:'#A78BFA', bg:'rgba(167,139,250,.14)',             label:'Scheduled'   },
  IN_PROGRESS: { color:'#F59E0B', bg:'rgba(245,158,11,.14)',              label:'In Progress' },
  ESCALATED:   { color:'#F97316', bg:'rgba(249,115,22,.14)',              label:'Escalated'   },
  COMPLETED:   { color:'#22C55E', bg:'rgba(34,197,94,.14)',               label:'Completed'   },
  CLOSED:      { color:'#8A8580', bg:'rgba(138,133,128,.14)', label:'Closed'    },
};

const STREAM: Record<string, { color: string; bg: string; label: string }> = {
  GENERAL_WASTE: { color:'#6B7280', bg:'rgba(107,114,128,.15)', label:'General Waste' },
  RECYCLING:     { color:'#22C55E', bg:'rgba(34,197,94,.12)',   label:'Recycling'     },
  ORGANICS:      { color:'#F59E0B', bg:'rgba(245,158,11,.12)',  label:'Organics'      },
  BULK_WASTE:    { color:'#A78BFA', bg:'rgba(167,139,250,.12)', label:'Bulk Waste'    },
};

const STATUS_ORDER: MaintenanceStatus[] = ['OPEN','ASSIGNED','SCHEDULED','IN_PROGRESS','ESCALATED','COMPLETED','CLOSED'];
const STREAM_TYPES = ['GENERAL_WASTE','RECYCLING','ORGANICS','BULK_WASTE'] as const;

type DashboardKpiExtra = {
  dashboard_header:  BinMaintenanceDashboardHeader;
  schedule_status:   BinMaintenanceScheduleStatus;
  stream_stats:      BinMaintenanceStreamStats;
  repeat_properties: BinMaintenanceRepeatProperties;
  completion_trend:  BinMaintenanceCompletionTrend;
};
type DashboardKpiData = { hasData: false } | ({ hasData: true } & DashboardKpiExtra);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageStr(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? 'Today' : `${d}d`;
}

function isOverdue(job: MaintenanceJob) {
  if (!job.scheduled_date) return false;
  if (job.completed_date) return false;
  return new Date(job.scheduled_date) < new Date();
}

// ─── SVG Components ───────────────────────────────────────────────────────────

function RingChart({ pct, color, size = 72 }: { pct: number; color: string; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  const cx = size / 2;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border)" strokeWidth="7"/>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${c} ${c}`} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition:'stroke-dashoffset .8s ease' }}/>
      <text x={cx} y={cx+4} textAnchor="middle" fill={color}
        fontSize={Math.round(size * 0.19)} fontWeight="800" fontFamily={FONT}>{pct}%</text>
    </svg>
  );
}

function Sparkline({ data, color = '#8A8580', width = 100, height = 28 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (data.length < 2) return (
    <svg width={width} height={height}>
      <text x={4} y={height/2+4} fill="var(--text-subtle)" fontSize="9" fontFamily={FONT}>No trend data</text>
    </svg>
  );
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as [number, number];
  });
  const poly = pts.map(p => p.join(',')).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ overflow:'visible' }}>
      <polygon points={`0,${height} ${poly} ${width},${height}`} fill={`${color}18`}/>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color}/>
    </svg>
  );
}

// ─── Stock Drawer ─────────────────────────────────────────────────────────────

interface StockItem { id: string; name: string; qty: number; min: number; }

const DEFAULT_STOCK: StockItem[] = [
  { id:'body-140',  name:'Bin Bodies 140L',  qty:24,  min:10 },
  { id:'body-240',  name:'Bin Bodies 240L',  qty:18,  min:8  },
  { id:'body-360',  name:'Bin Bodies 360L',  qty:8,   min:5  },
  { id:'lid-140',   name:'Lids 140L',        qty:30,  min:10 },
  { id:'lid-240',   name:'Lids 240L',        qty:20,  min:10 },
  { id:'wheels',    name:'Wheels (pairs)',   qty:35,  min:15 },
  { id:'axles',     name:'Axles',            qty:18,  min:8  },
  { id:'pins',      name:'Hinge Pins',       qty:85,  min:30 },
  { id:'seals',     name:'Lid Seals',        qty:50,  min:20 },
  { id:'240-grn',   name:'240L Organics',    qty:6,   min:4  },
];

function StockDrawer({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<StockItem[]>(DEFAULT_STOCK);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('bin-stock-v1');
      if (saved) setItems(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('bin-stock-v1', JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const adj = (id: string, d: number) =>
    setItems(p => p.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + d) } : i));

  const lowCount = items.filter(i => i.qty < i.min).length;

  return (
    <div style={{ position:'fixed',bottom:0,left:0,right:0,zIndex:200,background:'var(--bg-overlay)',borderTop:'1px solid var(--border)',boxShadow:'var(--shadow-popover)' }}>
      <div style={{ maxWidth:1400,margin:'0 auto',padding:'14px 20px' }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--brand-brainbase-accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          <span style={{ fontSize:10.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-secondary)',textTransform:'uppercase' }}>Stock & Parts</span>
          {lowCount > 0 && <span style={{ fontSize:9,fontWeight:700,color:'var(--status-danger)',background:'var(--status-danger-muted)',border:'1px solid var(--status-danger-border)',padding:'2px 7px',borderRadius:10 }}>{lowCount} LOW</span>}
          <div style={{ flex:1 }} />
          <button type="button" onClick={() => setItems(DEFAULT_STOCK)} style={{ fontSize:9.5,color:'var(--text-muted)',background:'none',border:'none',cursor:'pointer',fontFamily:FONT }}>Reset</button>
          <button type="button" onClick={onClose} style={{ padding:'4px 12px',borderRadius:6,background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-secondary)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:FONT }}>Close</button>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(10,1fr)',gap:8 }}>
          {items.map(item => {
            const pct = Math.min((item.qty / (item.min * 2.5)) * 100, 100);
            const low = item.qty < item.min;
            const crit = item.qty < item.min * 0.5;
            const bar = crit ? '#EF4444' : low ? '#F59E0B' : '#22C55E';
            return (
              <div key={item.id} style={{ background:low?'var(--status-danger-muted)':'var(--bg-raised)',border:`1px solid ${low?'var(--status-danger-border)':'var(--border)'}`,borderRadius:9,padding:'10px 10px 8px' }}>
                <div style={{ fontSize:9,fontWeight:600,color:'var(--text-secondary)',marginBottom:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{item.name}</div>
                <div style={{ display:'flex',alignItems:'center',gap:4,marginBottom:6 }}>
                  <button type="button" aria-label={`Decrease ${item.name}`} onClick={() => adj(item.id, -1)} style={{ width:18,height:18,borderRadius:3,background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-primary)',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT,lineHeight:1,flexShrink:0 }}>−</button>
                  <span style={{ flex:1,textAlign:'center',fontSize:20,fontWeight:800,color:low?'var(--status-danger)':'var(--text-primary)',fontFamily:FONT }}>{item.qty}</span>
                  <button type="button" aria-label={`Increase ${item.name}`} onClick={() => adj(item.id, 1)}  style={{ width:18,height:18,borderRadius:3,background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-primary)',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT,lineHeight:1,flexShrink:0 }}>+</button>
                </div>
                <div style={{ height:3,background:'var(--border)',borderRadius:2,overflow:'hidden' }}>
                  <div style={{ height:'100%',width:`${pct}%`,background:bar,borderRadius:2,transition:'width .4s ease' }}/>
                </div>
                <div style={{ display:'flex',justifyContent:'space-between',marginTop:3 }}>
                  <span style={{ fontSize:8,color:'var(--text-muted)' }}>min {item.min}</span>
                  {low && <span style={{ fontSize:8,fontWeight:700,color:'var(--status-danger)' }}>LOW</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, active, color, count, onClick }: {
  label:string; active:boolean; color:string; count:number; onClick:()=>void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={{
      padding:'5px 11px',borderRadius:20,fontSize:10.5,fontWeight:600,
      background:active?`color-mix(in srgb, ${color} 10%, transparent)`:'var(--bg-raised)',
      border:`1px solid ${active?`color-mix(in srgb, ${color} 32%, transparent)`:'var(--border)'}`,
      color:active?'var(--text-primary)':'var(--text-secondary)',
      cursor:'pointer',fontFamily:FONT,transition:'all .14s',display:'flex',alignItems:'center',gap:5,
    }}>
      {label}<span style={{ fontSize:9,fontWeight:700,opacity:.7 }}>{count}</span>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BinMaintenancePage() {
  const [jobs,         setJobs]         = useState<MaintenanceJob[]>([]);
  const [total,        setTotal]        = useState(0);
  const [skip,         setSkip]         = useState(0);
  const [selectedJob,  setSelectedJob]  = useState<MaintenanceJob | null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('active');
  const [filterSev,    setFilterSev]    = useState<string>('all');
  const [search,       setSearch]       = useState('');
  const [sortBy,       setSortBy]       = useState<'severity'|'date'|'suburb'|'age'>('severity');
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [fetchError,   setFetchError]   = useState('');
  const [uploading,    setUploading]    = useState(false);
  const [uploadMsg,    setUploadMsg]    = useState('');
  const [stockOpen,    setStockOpen]    = useState(false);
  const [kpi,          setKpi]          = useState<DashboardKpiData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchKpi = useCallback(async () => {
    try {
      const res = await fetch('/api/bin-maintenance/kpi', { credentials: 'include' });
      setKpi(await res.json() as DashboardKpiData);
    } catch {
      setKpi({ hasData: false });
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchKpi(); }, [fetchKpi]);

  const fetchJobs = useCallback(async (newSkip: number, replace: boolean) => {
    if (newSkip === 0) setLoading(true); else setLoadingMore(true);
    setFetchError('');
    try {
      const res  = await fetch(`/api/bin-maintenance?skip=${newSkip}&take=${PAGE_SIZE}`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError((err as { error?: string }).error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json() as { jobs: MaintenanceJob[]; total: number };
      setTotal(data.total);
      setJobs(prev => replace ? data.jobs : [...prev, ...data.jobs]);
      setSkip(newSkip);
    } catch {
      setFetchError('Could not reach the server.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchJobs(0, true); }, [fetchJobs]);

  const hasMore = jobs.length < total;

  // ── Intelligence ─────────────────────────────────────────────────────────────

  const activeJobs = useMemo(() =>
    jobs.filter(j => !j.completed_date), [jobs]);

  // Stat tiles below are sourced from the full-dataset /api/bin-maintenance/kpi
  // aggregate (kpi state), NOT the paginated `jobs` array — the DB has 11k+ rows
  // while `jobs` only holds whatever pages have been loaded via "Load More".
  // Only the job list/table stays scoped to the paginated `jobs` array.

  const stats = useMemo(() => {
    const dh = kpi?.hasData ? kpi.dashboard_header : null;
    return {
      active:     dh?.active ?? 0,
      critical:   dh?.critical ?? 0,
      unassigned: dh?.unassigned ?? 0,
      overdue:    dh?.overdue ?? 0,
      completed:  dh?.completed ?? 0,
      compRate:   dh?.compRate ?? 0,
    };
  }, [kpi]);

  const slaStats = useMemo(() => {
    if (kpi?.hasData) return kpi.schedule_status;
    return { breached: 0, atRisk: 0, onTrack: 0, pct: 0, scheduled: 0, worstSuburbs: [] as [string, number][] };
  }, [kpi]);

  const streamStats = useMemo(() => {
    const source = kpi?.hasData
      ? kpi.stream_stats
      : STREAM_TYPES.map(type => ({ type, total: 0, active: 0, completed: 0, overdue: 0, compRate: 0, pct: 0 }));
    return source.map(s => ({ ...s, ...STREAM[s.type] }));
  }, [kpi]);

  const repeatProps = useMemo(() =>
    kpi?.hasData ? kpi.repeat_properties.slice(0, 15) : [],
    [kpi]);

  const issueFreq = useMemo(() => {
    const map = kpi?.hasData ? kpi.dashboard_header.by_issue_type_open : {};
    const mx = Math.max(...Object.values(map), 1);
    return Object.entries(map).sort(([,a],[,b]) => b-a).slice(0,7)
      .map(([issue, count]) => ({ issue, count, pct: Math.round((count/mx)*100) }));
  }, [kpi]);

  const productivity = useMemo(() => {
    const dh = kpi?.hasData ? kpi.dashboard_header : null;
    const ct = kpi?.hasData ? kpi.completion_trend : null;
    const unPct = dh && dh.active > 0 ? Math.round((dh.unassigned / dh.active) * 100) : 0;
    return { total: ct?.total ?? 0, rate: dh?.compRate ?? 0, avg: ct?.avg ?? 0, trend: ct?.trend ?? [], unPct };
  }, [kpi]);

  const hlna = useMemo(() => {
    if (!kpi?.hasData) return [];
    const lines: string[] = [];
    if (slaStats.breached > 0) lines.push(`${slaStats.breached} jobs have breached their scheduled dates — immediate escalation required.`);
    if (slaStats.atRisk > 0)   lines.push(`${slaStats.atRisk} jobs approaching SLA deadline within 48h — prioritise assignment now.`);
    if (repeatProps.length > 0) {
      const top = repeatProps[0];
      lines.push(`${top.address}, ${top.suburb} has ${top.count} maintenance events — pattern indicates structural asset failure.`);
    }
    const topStream = streamStats.reduce((a,b) => a.active > b.active ? a : b);
    if (topStream.active > 0) lines.push(`${topStream.label} stream carries highest active load: ${topStream.active} jobs at ${topStream.compRate}% resolution.`);
    if (productivity.unPct > 50) lines.push(`${productivity.unPct}% of active jobs are unassigned — workforce coverage gap detected.`);
    const repeat3 = repeatProps.filter(p => p.count >= 3).length;
    if (repeat3 > 0) lines.push(`${repeat3} properties with 3+ repeat events — recommend high-attention asset register.`);
    lines.push(`Overall completion rate: ${productivity.rate}% across ${kpi.dashboard_header.total.toLocaleString()} operational records.`);
    return lines.slice(0, 5);
  }, [kpi, slaStats, repeatProps, streamStats, productivity]);

  // ── Filtered view ──────────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    let out = [...jobs];
    if (filterStatus === 'active')   out = out.filter(j => !j.completed_date);
    else if (filterStatus !== 'all') out = out.filter(j => j.status === filterStatus);
    if (filterSev !== 'all') out = out.filter(j => j.severity === filterSev);
    if (search) {
      const t = search.toLowerCase();
      out = out.filter(j =>
        j.address.toLowerCase().includes(t) ||
        j.suburb.toLowerCase().includes(t) ||
        j.issue_type.toLowerCase().includes(t));
    }
    if (sortBy === 'severity') {
      const R: Record<string,number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };
      out.sort((a,b) => R[a.severity]-R[b.severity] || new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
    } else if (sortBy === 'date') {
      out.sort((a,b) => (a.scheduled_date??'9999') < (b.scheduled_date??'9999') ? -1 : 1);
    } else if (sortBy === 'suburb') {
      out.sort((a,b) => a.suburb.localeCompare(b.suburb));
    } else {
      out.sort((a,b) => new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
    }
    return out;
  }, [jobs, filterStatus, filterSev, search, sortBy]);

  const statusCounts = useMemo(() => {
    const dh = kpi?.hasData ? kpi.dashboard_header : null;
    const m: Record<string,number> = { all: dh?.total ?? 0, active: dh?.active ?? 0 };
    for (const s of STATUS_ORDER) m[s] = dh?.by_status[s] ?? 0;
    return m;
  }, [kpi]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleStatusChange(jobId: string, status: MaintenanceStatus, payload?: Record<string,unknown>) {
    setJobs(p => p.map(j => j.id === jobId ? {
      ...j, status,
      assigned_to: typeof payload?.assignedTo === 'string' ? payload.assignedTo : j.assigned_to,
      completed_date: ['COMPLETED','CLOSED'].includes(status) ? new Date().toISOString() : j.completed_date,
    } : j));
    if (selectedJob?.id === jobId) setSelectedJob(p => p ? { ...p, status } : null);
    fetch(`/api/bin-maintenance/${jobId}`, {
      method:'PATCH', headers:{ 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status, ...(payload?.assignedTo ? { assigned_to: payload.assignedTo } : {}) }),
    }).then(() => fetchKpi()).catch(() => {});
  }

  function handleCreated(job: MaintenanceJob) {
    setJobs(p => [job, ...p]);
    setTotal(t => t + 1);
    fetchKpi();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/files/upload', { method:'POST', credentials: 'include', body:fd });
      const data = await res.json() as { success?:boolean; recordsInserted?:number; department?:string; error?:string };
      if (!res.ok || !data.success) { setUploadMsg(data.error ?? 'Upload failed'); return; }
      if (data.department !== 'BinMaintenance') {
        setUploadMsg(`Detected as "${data.department}" — upload a bin maintenance file.`);
        return;
      }
      setUploadMsg(`Imported ${data.recordsInserted} records`);
      await Promise.all([fetchJobs(0, true), fetchKpi()]);
    } catch { setUploadMsg('Upload failed — check connection'); }
    finally { setUploading(false); setTimeout(() => setUploadMsg(''), 6000); }
  }

  const slaColor = slaStats.pct >= 80 ? 'var(--status-success)' : slaStats.pct >= 55 ? 'var(--status-warning)' : 'var(--status-danger)';

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <WorkspaceShell title="Bin Maintenance" alertCount={stats.critical}>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bm-fade  { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:none} }
        @keyframes bm-blink { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes bm-spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .bm-row:hover  { background:color-mix(in srgb, var(--text-primary) 4%, transparent)!important; }
        .bm-row        { cursor:pointer; transition:background .14s; }
        .bm-card:hover { border-color:var(--border-strong)!important; }
        .bm-card       { transition:border-color .2s; }
        .bm-row:focus-visible { outline:2px solid var(--brand-brainbase-accent); outline-offset:-2px; }
        .bm-upload:has(input:focus-visible) { outline:2px solid var(--brand-brainbase-accent); outline-offset:2px; }
        @media (prefers-reduced-motion: reduce) { .bm-row, .bm-card { animation:none!important; transition:none!important; } }
        .leaflet-container { background:#0a0d12; font-family:${FONT}; }
        .leaflet-control-zoom a { background:rgba(10,13,18,.85)!important; color:rgba(255,255,255,.7)!important; border-color:rgba(255,255,255,.12)!important; }
        .leaflet-control-zoom a:hover { background:rgba(139,92,246,.22)!important; color:#fff!important; }
        .leaflet-control-attribution { background:rgba(0,0,0,.45)!important; color:rgba(255,255,255,.35)!important; font-size:8px!important; }
        .leaflet-control-attribution a { color:rgba(255,255,255,.5)!important; }
        .bm-map-tip { background:rgba(10,13,18,.92)!important; border:1px solid rgba(255,255,255,.12)!important; color:rgba(255,255,255,.85)!important; font-family:${FONT}; font-size:10px!important; box-shadow:none!important; }
        .bm-map-tip::before { border-top-color:rgba(255,255,255,.12)!important; }
      `}} />

      {/* ── Toolbar ── */}
      <div style={{ height:36,display:'flex',alignItems:'center',gap:10,padding:'0 20px',flexShrink:0,borderBottom:'1px solid var(--border)',background:'var(--bg-surface)' }}>
        <div style={{ fontSize:10.5,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:5 }}>
          <span>Operations</span><span style={{ opacity:.35 }}>/</span>
          <span style={{ color:'var(--text-secondary)' }}>Waste</span><span style={{ opacity:.35 }}>/</span>
          <span style={{ color:'var(--text-primary)' }} aria-current="page">Bin Maintenance</span>
        </div>
        <div style={{ flex:1 }} />
        {loading && <span style={{ fontSize:9.5,color:'var(--text-muted)',animation:'bm-blink 1.5s ease-in-out infinite' }}>Syncing…</span>}
        {!loading && !fetchError && (
          <div style={{ display:'flex',alignItems:'center',gap:4 }}>
            <div aria-hidden="true" style={{ width:5,height:5,borderRadius:'50%',background:'var(--status-success)' }}/>
            <span style={{ fontSize:9.5,color:'var(--text-secondary)' }}>Live · {total.toLocaleString()} records</span>
            {uploadMsg && <span style={{ fontSize:9.5,color:uploadMsg.startsWith('Imported')?'var(--status-success)':'var(--status-warning)',marginLeft:6,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>· {uploadMsg}</span>}
          </div>
        )}
        {!loading && fetchError && (
          <div style={{ display:'flex',alignItems:'center',gap:5 }}>
            <div aria-hidden="true" style={{ width:5,height:5,borderRadius:'50%',background:'var(--status-danger)' }}/>
            <span role="alert" style={{ fontSize:9.5,color:'var(--status-danger)' }}>{fetchError}</span>
            <button type="button" onClick={()=>fetchJobs(0,true)} style={{ fontSize:9.5,color:'var(--brand-brainbase-accent)',background:'none',border:'none',cursor:'pointer',fontFamily:FONT,textDecoration:'underline',padding:0 }}>Retry</button>
          </div>
        )}
        <div style={{ width:1,height:12,background:'var(--border)' }}/>
        <Link href="/dashboard/bin-maintenance/insights" style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 11px',borderRadius:7,background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-secondary)',fontSize:10.5,fontWeight:600,fontFamily:FONT,textDecoration:'none' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          Insights
        </Link>
        <div style={{ width:1,height:12,background:'var(--border)' }}/>
        <button type="button" aria-pressed={stockOpen} onClick={() => setStockOpen(v=>!v)} style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 11px',borderRadius:7,background:stockOpen?'var(--brand-brainbase-accent-muted)':'var(--bg-raised)',border:`1px solid ${stockOpen?'var(--brand-brainbase-accent-border)':'var(--border)'}`,color:stockOpen?'var(--brand-brainbase-accent)':'var(--text-secondary)',fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:FONT }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          Stock
        </button>
        <div style={{ width:1,height:12,background:'var(--border)' }}/>
        <label className="bm-upload" style={{ display:'flex',alignItems:'center',gap:6,padding:'5px 13px',borderRadius:7,background:uploading?'var(--bg-raised)':'var(--bg-raised)',border:'1px solid var(--border)',color:uploading?'var(--text-subtle)':'var(--text-muted)',fontSize:11,fontWeight:600,cursor:uploading?'default':'pointer',fontFamily:FONT,letterSpacing:'.02em',userSelect:'none' }}>
          {uploading
            ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation:'bm-spin .8s linear infinite' }}><path d="M21 12a9 9 0 1 1-18 0"/></svg>Importing…</>
            : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Import CSV</>}
          <input type="file" accept=".csv,.xlsx,.xls" className="bb-visually-hidden" onChange={handleFileUpload} disabled={uploading}/>
        </label>
        <div style={{ width:1,height:12,background:'var(--border)' }}/>
        <button type="button" onClick={() => setCreateOpen(true)} {...buttonProps('primary', 'sm')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Job
        </button>
      </div>

      {/* ── Stats Strip ── */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(6,1fr)',borderBottom:'1px solid var(--border)',flexShrink:0 }}>
        {([
          { label:'Active Jobs',    val:stats.active,          color:'var(--brand-brainbase-accent)', sub:`${total.toLocaleString()} total`         },
          { label:'Critical',       val:stats.critical,        color:'#EF4444', sub:'need attention'                          },
          { label:'Unassigned',     val:stats.unassigned,      color:'#F59E0B', sub:'awaiting crew'                           },
          { label:'Overdue',        val:stats.overdue,         color:'#F97316', sub:'past scheduled date'                     },
          { label:'SLA Compliance', val:`${slaStats.pct}%`,    color:slaColor,  sub:`${slaStats.scheduled} scheduled`         },
          { label:'Completed',      val:stats.completed,       color:'#22C55E', sub:`${productivity.rate}% completion rate`   },
        ] as const).map((s, i) => (
          <div key={s.label} style={{ padding:'14px 18px',background:'var(--bg-surface)',borderRight:i<5?'1px solid var(--border)':'none',position:'relative',overflow:'hidden' }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:7 }}>
              <span aria-hidden="true" style={{ width:6,height:6,borderRadius:'50%',background:s.color,flexShrink:0 }}/>{s.label}
            </div>
            <div style={{ fontSize:28,fontWeight:800,letterSpacing:'-.04em',color:'var(--text-primary)',lineHeight:1 }}>
              {statsLoading ? <span style={{ fontSize:18,color:'var(--text-muted)' }}>—</span> : s.val}
            </div>
            <div style={{ fontSize:9.5,color:'var(--text-secondary)',marginTop:4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Intelligence Grid ── */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:'1px solid var(--border)',flexShrink:0 }}>

        {/* SLA Panel */}
        <div className="bm-card" style={{ padding:'14px 16px',background:'var(--bg-surface)',borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:10 }}>SLA Status</div>
          <div style={{ display:'flex',alignItems:'center',gap:14 }}>
            <RingChart pct={slaStats.pct} color={slaColor} size={68}/>
            <div style={{ flex:1,display:'flex',flexDirection:'column',gap:6 }}>
              {([
                { label:'On Track', val:slaStats.onTrack,  c:'var(--status-success)' },
                { label:'At Risk',  val:slaStats.atRisk,   c:'var(--status-warning)' },
                { label:'Breached', val:slaStats.breached, c:'var(--status-danger)' },
              ]).map(r => (
                <div key={r.label} style={{ display:'flex',alignItems:'center',gap:6 }}>
                  <div style={{ width:5,height:5,borderRadius:'50%',background:r.c,flexShrink:0 }}/>
                  <span style={{ fontSize:10,color:'var(--text-secondary)',flex:1 }}>{r.label}</span>
                  <span style={{ fontSize:11,fontWeight:700,color:r.c }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
          {slaStats.worstSuburbs.length > 0 && (
            <div style={{ marginTop:9,paddingTop:8,borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:8.5,fontWeight:700,letterSpacing:'.08em',color:'var(--status-danger)',textTransform:'uppercase',marginBottom:4 }}>Breach Hotspots</div>
              {slaStats.worstSuburbs.map(([sub, cnt]) => (
                <div key={sub} style={{ display:'flex',justifyContent:'space-between',marginBottom:3 }}>
                  <span style={{ fontSize:9.5,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }}>{sub}</span>
                  <span style={{ fontSize:9.5,fontWeight:700,color:'var(--status-danger)',marginLeft:6 }}>{cnt}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stream Analytics */}
        <div className="bm-card" style={{ padding:'14px 16px',background:'var(--bg-surface)',borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:10 }}>Stream Analytics</div>
          {streamStats.map(s => (
            <div key={s.type} style={{ marginBottom:9 }}>
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:3 }}>
                <div style={{ display:'flex',alignItems:'center',gap:5 }}>
                  <div style={{ width:5,height:5,borderRadius:'50%',background:s.color }}/>
                  <span style={{ fontSize:10,color:'var(--text-secondary)',fontWeight:600 }}>{s.label}</span>
                </div>
                <div style={{ display:'flex',gap:6 }}>
                  <span style={{ fontSize:9.5,color:'var(--text-muted)' }}>{s.total.toLocaleString()}</span>
                  <span style={{ fontSize:9.5,fontWeight:700,color:'var(--text-primary)' }}>{s.pct}%</span>
                </div>
              </div>
              <div style={{ height:3,background:'var(--border)',borderRadius:2,overflow:'hidden' }}>
                <div style={{ height:'100%',width:`${s.pct}%`,background:s.color,borderRadius:2,transition:'width .5s ease',opacity:.8 }}/>
              </div>
              <div style={{ display:'flex',gap:8,marginTop:2 }}>
                <span style={{ fontSize:8.5,color:'var(--text-muted)' }}>Active: {s.active}</span>
                <span style={{ fontSize:8.5,color:'var(--status-success)' }}>✓ {s.compRate}%</span>
                {s.overdue > 0 && <span style={{ fontSize:8.5,color:'var(--status-warning)' }}>⚠ {s.overdue}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Repeat Properties */}
        <div className="bm-card" style={{ padding:'14px 16px',background:'var(--bg-surface)',borderRight:'1px solid var(--border)',overflow:'hidden' }}>
          <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:10 }}>
            <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase' }}>Repeat Properties</div>
            <span style={{ fontSize:9,fontWeight:700,color:'var(--status-warning)',background:'var(--status-warning-muted)',border:'1px solid var(--status-warning-border)',padding:'1px 6px',borderRadius:8 }}>{repeatProps.length}</span>
          </div>
          {repeatProps.slice(0,5).map((p,i) => (
            <div key={i} style={{ display:'flex',alignItems:'center',gap:7,marginBottom:6,padding:'5px 7px',background:'var(--bg-raised)',border:'1px solid var(--border-light)',borderRadius:5 }}>
              <div style={{ width:20,height:20,borderRadius:4,background:p.count>=4?'var(--status-danger-muted)':'var(--status-warning-muted)',border:`1px solid ${p.count>=4?'var(--status-danger-border)':'var(--status-warning-border)'}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                <span style={{ fontSize:9,fontWeight:800,color:p.count>=4?'var(--status-danger)':'var(--status-warning)' }}>{p.count}</span>
              </div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:10,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{p.address}</div>
                <div style={{ fontSize:8.5,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{p.suburb} · {p.issues[0]}</div>
              </div>
              {p.active > 0 && <div aria-hidden="true" style={{ width:6,height:6,borderRadius:'50%',background:'var(--status-danger)',flexShrink:0 }}/>}
            </div>
          ))}
          {repeatProps.length > 5 && <div style={{ fontSize:9,color:'var(--text-muted)',textAlign:'center',marginTop:4 }}>+{repeatProps.length-5} more</div>}
          {repeatProps.length === 0 && !statsLoading && <div style={{ fontSize:9.5,color:'var(--text-muted)',marginTop:8 }}>No repeat properties detected.</div>}
        </div>

        {/* Issue Breakdown */}
        <div className="bm-card" style={{ padding:'14px 16px',background:'var(--bg-surface)' }}>
          <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:10 }}>Active Issue Types</div>
          {issueFreq.map(({ issue, count, pct }) => (
            <div key={issue} style={{ marginBottom:7 }}>
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:2 }}>
                <span style={{ fontSize:10,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,paddingRight:6 }}>{issue}</span>
                <span style={{ fontSize:10,fontWeight:700,color:'var(--text-primary)',flexShrink:0 }}>{count}</span>
              </div>
              <div style={{ height:2.5,background:'var(--border)',borderRadius:2,overflow:'hidden' }}>
                <div style={{ height:'100%',width:`${pct}%`,background:'var(--brand-brainbase-accent)',borderRadius:2,transition:'width .4s ease' }}/>
              </div>
            </div>
          ))}
          {issueFreq.length === 0 && !statsLoading && <div style={{ fontSize:10,color:'var(--text-muted)',marginTop:16,textAlign:'center' }}>No active jobs</div>}
        </div>
      </div>

      {/* ── Main Body ── */}
      <div style={{ flex:1,display:'flex',overflow:'hidden',alignItems:'flex-start' }}>

        {/* Left Rail — Map */}
        <div style={{ flex:'1 1 50%',minWidth:0,borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',background:'var(--bg-base)' }}>

          <div style={{ padding:'10px 12px 4px',flexShrink:0 }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:6 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              <span style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-secondary)',textTransform:'uppercase' }}>Operational Hotspots</span>
            </div>
          </div>
          <div style={{ flex:'1 1 auto',minHeight:320,padding:'0 12px',marginBottom:4,display:'flex' }}>
            <div style={{ flex:1,borderRadius:10,overflow:'hidden',border:'1px solid var(--border)' }}>
              <RequestsMap jobs={activeJobs} onSuburbClick={setSearch}/>
            </div>
          </div>

          <div style={{ flexShrink:0,height:260,overflowY:'auto' }}>
            <div style={{ padding:'6px 12px',flexShrink:0 }}>
              <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:6 }}>Active By Suburb</div>
              {Object.entries(
                activeJobs.reduce((acc,j) => { acc[j.suburb]=(acc[j.suburb]??0)+1; return acc; },{} as Record<string,number>)
              ).sort(([,a],[,b])=>b-a).slice(0,6).map(([sub,cnt]) => {
                const mx = Math.max(...Object.values(activeJobs.reduce((a,j)=>{ a[j.suburb]=(a[j.suburb]??0)+1; return a; },{} as Record<string,number>)),1);
                return (
                  <div key={sub} style={{ display:'flex',alignItems:'center',gap:7,marginBottom:5 }}>
                    <span style={{ fontSize:10,color:'var(--text-secondary)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{sub}</span>
                    <div style={{ width:50,height:3,background:'var(--border)',borderRadius:2,overflow:'hidden' }}>
                      <div style={{ height:'100%',width:`${Math.min((cnt/mx)*100,100)}%`,background:'var(--brand-brainbase-accent)',borderRadius:2 }}/>
                    </div>
                    <span style={{ fontSize:9.5,fontWeight:700,color:'var(--text-secondary)',width:18,textAlign:'right' }}>{cnt}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ padding:'6px 12px',flexShrink:0,borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',marginBottom:7 }}>Productivity</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:8 }}>
                <div style={{ padding:'8px',background:'var(--bg-raised)',borderRadius:7,border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:8.5,color:'var(--text-muted)',marginBottom:2 }}>Completed</div>
                  <div style={{ fontSize:18,fontWeight:800,color:'var(--status-success)',lineHeight:1 }}>{productivity.total.toLocaleString()}</div>
                  <div style={{ fontSize:8,color:'var(--text-muted)',marginTop:2 }}>{productivity.rate}% rate</div>
                </div>
                <div style={{ padding:'8px',background:'var(--bg-raised)',borderRadius:7,border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:8.5,color:'var(--text-muted)',marginBottom:2 }}>Avg / Week</div>
                  <div style={{ fontSize:18,fontWeight:800,color:'var(--text-primary)',lineHeight:1 }}>{productivity.avg}</div>
                  <div style={{ fontSize:8,color:'var(--text-muted)',marginTop:2 }}>historical</div>
                </div>
              </div>
              {productivity.trend.length > 1 && (
                <>
                  <div style={{ fontSize:8.5,color:'var(--text-muted)',marginBottom:3 }}>Weekly completion trend</div>
                  <Sparkline data={productivity.trend} color="#22C55E" width={265} height={28}/>
                </>
              )}
            </div>

            {/* HLNA Briefing */}
            <div style={{ padding:'8px 12px 12px',borderTop:'1px solid var(--border)' }}>
              <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:8 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--brand-brainbase-accent)" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span style={{ fontSize:9,fontWeight:700,letterSpacing:'.14em',color:'var(--text-secondary)',textTransform:'uppercase' }}>HLNA · Operational Brief</span>
              </div>
              {hlna.map((line, i) => (
                <div key={i} style={{ display:'flex',gap:7,marginBottom:7,animation:`bm-fade .3s ease ${i*.08}s both` }}>
                  <div style={{ width:3,height:3,borderRadius:'50%',background:'var(--brand-brainbase-accent)',flexShrink:0,marginTop:5 }}/>
                  <p style={{ fontSize:9.5,color:'var(--text-secondary)',margin:0,lineHeight:1.65,fontFamily:FONT }}>{line}</p>
                </div>
              ))}
              {hlna.length === 0 && !statsLoading && (
                <p style={{ fontSize:9.5,color:'var(--text-muted)',fontFamily:FONT,margin:0 }}>Awaiting data…</p>
              )}
            </div>
          </div>
        </div>

        {/* Operational Queue */}
        <div style={{ flex:'1 1 50%',display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0 }}>

          {/* Filter bar */}
          <div style={{ padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'var(--bg-surface)',flexShrink:0,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
            <FilterChip label="Active"      active={filterStatus==='active'}      color="var(--brand-brainbase-accent)" count={statusCounts.active??0}      onClick={()=>setFilterStatus('active')} />
            <FilterChip label="Open"        active={filterStatus==='OPEN'}        color="var(--status-danger)" count={statusCounts.OPEN??0}        onClick={()=>setFilterStatus(filterStatus==='OPEN'?'active':'OPEN')} />
            <FilterChip label="Escalated"   active={filterStatus==='ESCALATED'}   color="#F97316" count={statusCounts.ESCALATED??0}   onClick={()=>setFilterStatus(filterStatus==='ESCALATED'?'active':'ESCALATED')} />
            <FilterChip label="In Progress" active={filterStatus==='IN_PROGRESS'} color="var(--status-warning)" count={statusCounts.IN_PROGRESS??0} onClick={()=>setFilterStatus(filterStatus==='IN_PROGRESS'?'active':'IN_PROGRESS')} />
            <FilterChip label="Completed"   active={filterStatus==='COMPLETED'}   color="var(--status-success)" count={statusCounts.COMPLETED??0}   onClick={()=>setFilterStatus(filterStatus==='COMPLETED'?'active':'COMPLETED')} />
            <FilterChip label="All"         active={filterStatus==='all'}         color="var(--text-primary)" count={statusCounts.all??0} onClick={()=>setFilterStatus('all')} />
            <div style={{ flex:1 }}/>
            {(['all','CRITICAL','HIGH','MEDIUM','LOW'] as const).map(sev => (
              <button key={sev} type="button" aria-pressed={filterSev===sev} onClick={()=>setFilterSev(filterSev===sev?'all':sev)} style={{
                padding:'4px 9px',borderRadius:6,fontSize:9.5,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',fontFamily:FONT,transition:'all .14s',
                background:filterSev===sev?(sev==='all'?'var(--bg-raised)':SEV[sev as Severity]?.bg):'transparent',
                border:`1px solid ${filterSev===sev?(sev==='all'?'var(--border-strong)':SEV[sev as Severity]?.border):'var(--border)'}`,
                color:filterSev===sev?'var(--text-primary)':'var(--text-muted)',
              }}>{sev==='all'?'ALL SEV':sev[0]+sev.slice(1).toLowerCase()}</button>
            ))}
            <div style={{ position:'relative' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ position:'absolute',left:9,top:'50%',transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="search" aria-label="Search jobs" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
                style={{ background:'var(--bg-raised)',border:'1px solid var(--border-strong)',borderRadius:7,padding:'5px 10px 5px 28px',fontSize:11.5,color:'var(--text-primary)',fontFamily:FONT,width:140 }}/>
            </div>
            <select aria-label="Sort jobs" value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)} style={{ background:'var(--bg-raised)',border:'1px solid var(--border-strong)',borderRadius:7,padding:'5px 10px',fontSize:11,color:'var(--text-primary)',fontFamily:FONT,cursor:'pointer' }}>
              <option value="severity">Severity ↓</option>
              <option value="date">Scheduled date</option>
              <option value="suburb">Suburb A→Z</option>
              <option value="age">Newest first</option>
            </select>
          </div>

          {/* Table header */}
          <div style={{ display:'grid',gridTemplateColumns:'4px 1fr 160px 100px 100px 70px 44px',padding:'7px 16px',borderBottom:'1px solid var(--border)',background:'var(--bg-sunken)',flexShrink:0,alignItems:'center' }}>
            {['','Address / Issue','Bin Type','Status','Assigned','Due / Age',''].map((h,i)=>(
              <span key={i} style={{ fontSize:9,fontWeight:700,letterSpacing:'.12em',color:'var(--text-muted)',textTransform:'uppercase',paddingLeft:i===0?0:i===1?10:0 }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div style={{ flex:1,overflowY:'auto',overflowX:'hidden' }}>
            {loading && jobs.length === 0 && Array.from({length:8}).map((_,i) => (
              <div key={i} style={{ display:'grid',gridTemplateColumns:'4px 1fr 160px 100px 100px 70px 44px',padding:'11px 16px',borderBottom:'1px solid var(--border)',alignItems:'center',opacity:1-i*0.1 }}>
                <div style={{ width:3,height:28,borderRadius:2,background:'var(--border)' }}/>
                <div style={{ paddingLeft:12 }}>
                  <div style={{ height:10,width:'55%',background:'var(--border)',borderRadius:4,marginBottom:6,animation:'bm-blink 1.5s ease-in-out infinite' }}/>
                  <div style={{ height:8,width:'35%',background:'var(--border)',borderRadius:4,animation:'bm-blink 1.5s ease-in-out infinite' }}/>
                </div>
                {[120,70,80,50].map((w,j) => <div key={j} style={{ height:8,width:w,background:'var(--border)',borderRadius:4,animation:'bm-blink 1.5s ease-in-out infinite' }}/>)}
                <div/>
              </div>
            ))}

            {!loading && fetchError && jobs.length === 0 && (
              <div style={{ padding:'48px',textAlign:'center' }}>
                <div role="alert" style={{ fontSize:13,color:'var(--status-danger)',marginBottom:8 }}>{fetchError}</div>
                <button type="button" onClick={()=>fetchJobs(0,true)} {...buttonProps('secondary', 'sm')}>Retry</button>
              </div>
            )}

            {!loading && !fetchError && displayed.length === 0 && (
              <div style={{ padding:'48px',textAlign:'center',color:'var(--text-muted)',fontSize:13 }}>
                {jobs.length === 0 ? 'No maintenance jobs. Upload a spreadsheet or create a job.' : 'No jobs match the current filters.'}
              </div>
            )}

            {displayed.map((job, i) => {
              const s  = SEV[job.severity];
              const st = ST[job.status];
              const od = isOverdue(job);
              const av = job.assigned_to ? job.assigned_to.split(' ').map((w:string)=>w[0]).join('') : null;
              return (
                <div key={job.id} className="bm-row" role="button" tabIndex={0}
                  style={{ display:'grid',gridTemplateColumns:'4px 1fr 160px 100px 100px 70px 44px',padding:'11px 16px',borderBottom:'1px solid var(--border-light)',alignItems:'center',background:i%2===0?'var(--bg-surface)':'transparent',animation:'bm-fade .18s ease' }}
                  onClick={()=>setSelectedJob(job)}
                  onKeyDown={e=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setSelectedJob(job); } }}>
                  <div style={{ width:3,height:28,borderRadius:2,background:s.color,flexShrink:0 }}/>
                  <div style={{ paddingLeft:12,minWidth:0 }}>
                    <div style={{ display:'flex',alignItems:'baseline',gap:6 }}>
                      <div style={{ fontSize:12.5,fontWeight:600,color:'var(--text-primary)',lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{job.address}</div>
                      {job.ticket_number && (
                        <span style={{ fontSize:9,fontWeight:600,color:'var(--text-muted)',fontFamily:'monospace',flexShrink:0 }}>#{job.ticket_number}</span>
                      )}
                    </div>
                    <div style={{ display:'flex',alignItems:'center',gap:5,marginTop:2 }}>
                      <span style={{ fontSize:10,color:'var(--text-secondary)' }}>{job.suburb}</span>
                      <span style={{ opacity:.3 }}>·</span>
                      <span style={{ fontSize:10,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:160 }}>{job.issue_type}</span>
                    </div>
                  </div>
                  <div style={{ display:'flex',alignItems:'center',gap:5 }}>
                    <div style={{ width:5,height:5,borderRadius:'50%',background:STREAM[job.bin_type]?.color||'#6B7280',flexShrink:0 }}/>
                    <span style={{ fontSize:11,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {job.bin_type.replace(/_/g,' ').toLowerCase().replace(/(?:^|\s)\S/g,c=>c.toUpperCase())}
                    </span>
                  </div>
                  <div style={{ padding:'3px 9px',borderRadius:20,background:st.bg,border:`1px solid ${st.color}30`,display:'inline-flex',alignItems:'center',gap:5,width:'fit-content' }}>
                    <div aria-hidden="true" style={{ width:5,height:5,borderRadius:'50%',background:st.color,flexShrink:0 }}/>
                    <span style={{ fontSize:9.5,fontWeight:700,color:'var(--text-primary)',letterSpacing:'.05em',whiteSpace:'nowrap' }}>{st.label}</span>
                  </div>
                  <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                    {av ? (
                      <>
                        <div style={{ width:22,height:22,borderRadius:'50%',background:'var(--bg-sunken)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'var(--text-secondary)',flexShrink:0 }}>{av}</div>
                        <span style={{ fontSize:10.5,color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{job.assigned_to?.split(' ')[0]}</span>
                      </>
                    ) : (
                      <span style={{ fontSize:10.5,color:'var(--text-muted)',fontStyle:'italic' }}>Unassigned</span>
                    )}
                  </div>
                  <div style={{ textAlign:'right' }}>
                    {job.scheduled_date && (
                      <div style={{ fontSize:10.5,fontWeight:od?700:400,color:od?'var(--status-warning)':'var(--text-muted)',whiteSpace:'nowrap' }}>
                        {od?'⚠ ':''}{new Date(job.scheduled_date).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}
                      </div>
                    )}
                    <div style={{ fontSize:9.5,color:'var(--text-muted)',marginTop:1 }}>{ageStr(job.created_at)}</div>
                  </div>
                  <div style={{ display:'flex',justifyContent:'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>
              );
            })}

            {!loading && hasMore && displayed.length > 0 && (
              <div style={{ padding:'14px 16px',textAlign:'center' }}>
                <button type="button" onClick={()=>fetchJobs(skip+PAGE_SIZE, false)} disabled={loadingMore} {...buttonProps('secondary', 'sm')}>
                  {loadingMore ? 'Loading…' : `Load more · ${total-jobs.length} remaining`}
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding:'8px 16px',borderTop:'1px solid var(--border)',background:'var(--bg-sunken)',flexShrink:0,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:10,color:'var(--text-muted)' }}>{displayed.length} shown · {jobs.length.toLocaleString()} loaded · {total.toLocaleString()} total</span>
            <div style={{ flex:1 }}/>
            <div style={{ display:'flex',alignItems:'center',gap:6 }}>
              {Object.entries(STREAM).map(([k,v]) => (
                <div key={k} style={{ display:'flex',alignItems:'center',gap:3 }}>
                  <div style={{ width:5,height:5,borderRadius:'50%',background:v.color }}/>
                  <span style={{ fontSize:9,color:'var(--text-muted)' }}>{v.label.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Overlays ── */}
      {stockOpen    && <StockDrawer onClose={() => setStockOpen(false)}/>}
      {selectedJob  && <MaintenanceJobDrawer job={selectedJob} onClose={()=>setSelectedJob(null)} onStatusChange={handleStatusChange}/>}
      {createOpen   && <CreateJobModal onClose={()=>setCreateOpen(false)} onCreated={handleCreated}/>}

    </WorkspaceShell>
  );
}
