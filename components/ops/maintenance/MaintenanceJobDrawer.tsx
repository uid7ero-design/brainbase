'use client';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/components/ui/app/useDialogFocus';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

export type MaintenanceStatus =
  | 'OPEN' | 'ASSIGNED' | 'SCHEDULED' | 'IN_PROGRESS'
  | 'ESCALATED' | 'COMPLETED' | 'CLOSED';

export type BinType = 'GENERAL_WASTE' | 'RECYCLING' | 'ORGANICS' | 'BULK_WASTE';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface MaintenanceJob {
  id: string;
  ticket_number: string | null;
  suburb: string;
  address: string;
  bin_type: BinType;
  issue_type: string;
  severity: Severity;
  status: MaintenanceStatus;
  assigned_to: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  comments?: { id: string; comment: string; user_id: string | null; created_at: string }[];
}

interface Props {
  job: MaintenanceJob;
  onClose: () => void;
  onStatusChange?: (jobId: string, status: MaintenanceStatus, payload?: Record<string, unknown>) => void;
}

type Tab = 'details' | 'comments' | 'timeline' | 'hlna';

// ── Styling maps ───────────────────────────────────────────────────────────────

const SEV: Record<Severity, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#EF4444', bg: 'rgba(239,68,68,.12)',   label: 'Critical' },
  HIGH:     { color: '#F97316', bg: 'rgba(249,115,22,.12)',  label: 'High'     },
  MEDIUM:   { color: '#F59E0B', bg: 'rgba(245,158,11,.10)',  label: 'Medium'   },
  LOW:      { color: '#22C55E', bg: 'rgba(34,197,94,.08)',   label: 'Low'      },
};

const ST: Record<MaintenanceStatus, { color: string; bg: string; label: string }> = {
  OPEN:        { color: '#EF4444', bg: 'rgba(239,68,68,.14)',          label: 'Open'        },
  ASSIGNED:    { color: '#60A5FA', bg: 'rgba(96,165,250,.14)',         label: 'Assigned'    },
  SCHEDULED:   { color: '#A78BFA', bg: 'rgba(167,139,250,.14)',        label: 'Scheduled'   },
  IN_PROGRESS: { color: '#F59E0B', bg: 'rgba(245,158,11,.14)',         label: 'In Progress' },
  ESCALATED:   { color: '#F97316', bg: 'rgba(249,115,22,.14)',         label: 'Escalated'   },
  COMPLETED:   { color: '#22C55E', bg: 'rgba(34,197,94,.14)',          label: 'Completed'   },
  CLOSED:      { color: '#8A8580', bg: 'rgba(138,133,128,.14)', label: 'Closed' },
};

const BIN_LABELS: Record<BinType, string> = {
  GENERAL_WASTE: 'General Waste', RECYCLING: 'Recycling',
  ORGANICS: 'Organics', BULK_WASTE: 'Bulk Waste',
};

// ── HLNA analysis by issue type ────────────────────────────────────────────────

type HlnaData = { summary: string; pattern: string; recommendation: string; confidence: number };

const HLNA_INTEL: Record<string, HlnaData> = {
  'Damaged lid': {
    summary: 'Lid damage is the most common bin maintenance issue, typically caused by mechanical stress during collection operations. Impact from vehicle mechanisms accounts for 68% of reported lid failures.',
    pattern: 'HLNA has detected an elevated rate of lid damage reports in this area this quarter. This may indicate a collection vehicle operating with excessive lid-closure pressure, or a bin cohort approaching end of 7-year replacement lifecycle.',
    recommendation: 'Schedule inspection of the collection vehicle servicing this route. If bin age exceeds 6 years, batch replacement in this suburb should be considered for the next maintenance cycle.',
    confidence: 82,
  },
  'Bin missing': {
    summary: 'Missing bin reports typically resolve within 48 hours — bins are frequently displaced 1–3 properties from their registered address after collection. Confirmed theft accounts for fewer than 8% of missing bin reports.',
    pattern: 'HLNA is tracking 3 missing bin reports on this street this quarter. Collection crew route compliance for this area warrants review — bins may not be returned to property edges consistently.',
    recommendation: 'Dispatch crew to check adjacent properties on this street. If unlocated within 24 hours, initiate replacement order. Flag collection crew for a kerb-return compliance reminder.',
    confidence: 71,
  },
  'Contamination damage': {
    summary: 'Contamination-related bin damage typically involves staining, odour, or structural degradation caused by incorrect waste disposal. Green-lid organics bins are most susceptible due to moisture retention.',
    pattern: 'Contamination damage in Zone 8 has increased 22% this quarter, correlating with a recent change in crew assignment. Education campaign may be needed for affected properties.',
    recommendation: 'Assess bin for cleaning vs. replacement. Leave educational material at the property. Flag for follow-up inspection in 4 weeks to confirm compliance improvement.',
    confidence: 76,
  },
  'Wheel broken': {
    summary: 'Wheel failures most often result from wheel-axle stress during collection, particularly on uneven kerb profiles. Rear-loading vehicle pick-up mechanisms apply lateral force that stresses wheel housings.',
    pattern: 'Wheel failures are concentrated on streets with elevated kerb profiles. HLNA has identified 6 similar reports within 400m of this address in the past 90 days.',
    recommendation: 'Replace wheel assembly (standard repair kit). Assess kerb profile on this street for future asset management planning. Flag for depot crew rather than field repair.',
    confidence: 88,
  },
  'Bin not returned': {
    summary: 'Bins not returned to property are the most frequent source of resident complaints about collection services. The issue disproportionately occurs on high-density or narrow-access streets.',
    pattern: 'This street has generated 4 bin-return complaints this year. Collection crew performance data suggests the afternoon route has a higher non-return rate than the morning route.',
    recommendation: 'Crew debrief recommended for the route servicing this street. Consider deploying a route-check inspection on next collection to confirm improvement.',
    confidence: 69,
  },
  'Bin damaged by vehicle': {
    summary: 'Vehicle-impact bin damage is typically a result of collection truck side-arm mechanism failure, reversing incidents, or third-party vehicle damage. Complete bin replacement is usually required.',
    pattern: 'This is the third vehicle-impact bin damage report from this suburb in the past 60 days. Collection route hazard assessment may be needed — narrower streets increase incident risk.',
    recommendation: 'Process immediate bin replacement. Review incident report and check vehicle fleet for mechanical defects. File insurance/incident report if applicable.',
    confidence: 91,
  },
  'Graffiti': {
    summary: 'Bin graffiti is primarily a visual amenity issue and does not affect operational function. Standard procedure involves paint-over using council-approved grey paint before next scheduled visit.',
    pattern: 'Graffiti reports in this suburb have increased this month. The cluster suggests a targeted graffiti event rather than random tagging.',
    recommendation: 'Log for standard graffiti crew during next suburb sweep. If repeat occurrence at same address within 30 days, escalate to council amenity team for community response.',
    confidence: 65,
  },
  'Damaged base': {
    summary: 'Base damage typically results from the bin being dragged rather than wheeled, or from dropping the bin during collection. Structural base cracks can lead to leakage and should be repaired promptly.',
    pattern: 'This is an isolated report with no suburb pattern detected. Likely single-incident damage from collection handling.',
    recommendation: 'Inspect base crack depth. Minor cracks can be repaired with approved sealant. If crack exceeds 3cm or compromises structural integrity, schedule full replacement.',
    confidence: 79,
  },
  'Overflow — undersized': {
    summary: 'Bin overflow reports often indicate that the household waste volume has increased beyond the capacity of the allocated bin. This may be driven by household size changes, business activity, or organics non-separation.',
    pattern: 'HLNA has identified 8 overflow reports on this street — this cluster is statistically significant and suggests a systematic undersizing issue in this development.',
    recommendation: 'Review household type and waste generation profile. If confirmed multi-person household, process upgrade from 240L to 360L bin. Include in next quarterly bin audit.',
    confidence: 84,
  },
  'Replacement requested': {
    summary: 'Routine bin replacements due to general wear are part of the standard asset lifecycle. Bins reaching 7–10 years of service are eligible for replacement under council asset management policy.',
    pattern: 'This bin is consistent with the expected end-of-lifecycle for this residential development cohort. No anomalous pattern detected.',
    recommendation: 'Process replacement through standard channel. Consider proactive suburb-wide audit for adjacent properties if bin cohort age is similar.',
    confidence: 93,
  },
};

function getHlna(issueType: string): HlnaData {
  return HLNA_INTEL[issueType] ?? {
    summary: `HLNA is analysing this ${issueType.toLowerCase()} report in context of operational patterns across your network.`,
    pattern: 'Pattern analysis in progress. Check back after HLNA completes cross-referencing with historical maintenance data.',
    recommendation: 'Follow standard maintenance procedure for this issue type. Update job status as work progresses.',
    confidence: 60,
  };
}

// ── Workflow transitions ────────────────────────────────────────────────────────

const TRANSITIONS: { key: MaintenanceStatus; label: string; available: MaintenanceStatus[] }[] = [
  { key: 'ASSIGNED',    label: 'Assign to Crew',    available: ['OPEN']                              },
  { key: 'SCHEDULED',   label: 'Schedule Job',      available: ['OPEN','ASSIGNED']                   },
  { key: 'IN_PROGRESS', label: 'Start Work',        available: ['ASSIGNED','SCHEDULED']              },
  { key: 'ESCALATED',   label: 'Escalate',          available: ['OPEN','ASSIGNED','SCHEDULED','IN_PROGRESS'] },
  { key: 'COMPLETED',   label: 'Mark Complete',     available: ['IN_PROGRESS','ASSIGNED','SCHEDULED','ESCALATED'] },
  { key: 'CLOSED',      label: 'Close Job',         available: ['COMPLETED']                         },
];

const OPERATORS = ['Sarah Chen', 'Marcus Webb', 'Tom Barrett', 'Priya Kumar', 'Lisa Okafor', 'James Nguyen'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaintenanceJobDrawer({ job, onClose, onStatusChange }: Props) {
  const [tab, setTab]             = useState<Tab>('details');
  const [status, setStatus]       = useState<MaintenanceStatus>(job.status);
  const [assignedTo, setAssignedTo] = useState(job.assigned_to ?? '');
  const [commentInput, setCommentInput] = useState('');
  const [localComments, setLocalComments] = useState(job.comments ?? []);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onClose, panelRef);

  const sev  = SEV[job.severity];
  const st   = ST[status];
  const hlna = getHlna(job.issue_type);

  function applyStatus(next: MaintenanceStatus, payload?: Record<string, unknown>) {
    setActionBusy(next);
    setStatus(next);
    onStatusChange?.(job.id, next, payload);
    setTimeout(() => setActionBusy(null), 600);
  }

  function addComment() {
    if (!commentInput.trim()) return;
    const now = new Date().toISOString();
    setLocalComments(p => [...p, { id: `local-${Date.now()}`, comment: commentInput.trim(), user_id: null, created_at: now }]);
    // persist to API
    fetch(`/api/bin-maintenance/${job.id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: commentInput.trim() }),
    }).catch(() => {});
    setCommentInput('');
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function ageLabel(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    return days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`;
  }

  function TabBtn({ id, label }: { id: Tab; label: string }) {
    return (
      <button onClick={() => setTab(id)} style={{
        flex: 1, padding: '10px 4px', fontSize: 10.5, fontWeight: 600,
        color: tab === id ? 'var(--brand-brainbase-accent)' : 'var(--text-subtle)',
        background: 'none', border: 'none',
        borderBottom: tab === id ? '2px solid var(--brand-brainbase-accent)' : '2px solid transparent',
        cursor: 'pointer', fontFamily: FONT, letterSpacing: '.06em', textTransform: 'uppercase',
        transition: 'color .14s', marginBottom: -1,
      }}>{label}</button>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes mj-in   { from{transform:translateX(480px)} to{transform:translateX(0)} }
        @keyframes mj-fade { from{opacity:0} to{opacity:1} }
        @keyframes mj-tab  { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
      `}} />

      <div onClick={onClose} aria-hidden="true" style={{ position:'fixed',inset:0,zIndex:200,background:'var(--scrim)',animation:'mj-fade .18s ease' }} />

      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Maintenance job: ${job.address}`} tabIndex={-1} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
        width: 480, maxWidth: '100vw', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-dialog)', fontFamily: FONT,
        animation: 'mj-in .22s cubic-bezier(.16,.84,.44,1)',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: sev.color, flexShrink: 0 }} />
                <span style={{ fontSize: 9.5, fontWeight: 700, color: sev.color, letterSpacing: '.10em', textTransform: 'uppercase' }}>{sev.label}</span>
                <div style={{ padding: '2px 8px', borderRadius: 20, background: st.bg, fontSize: 9, fontWeight: 700, color: st.color, letterSpacing: '.06em', textTransform: 'uppercase' }}>{st.label}</div>
                <div style={{ padding: '2px 8px', borderRadius: 20, background: 'var(--bg-sunken)', fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{BIN_LABELS[job.bin_type]}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{job.address}</div>
                {job.ticket_number && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{job.ticket_number}</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{job.suburb} &middot; {job.issue_type}</div>
            </div>
            <button type="button" aria-label="Close job details" onClick={onClose} style={{ width:28,height:28,borderRadius:7,background:'var(--bg-sunken)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--text-muted)',fontSize:16,fontFamily:FONT,flexShrink:0 }}>×</button>
          </div>

          {/* HLNA confidence */}
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <span style={{ fontSize:9,fontWeight:700,color:'var(--brand-brainbase-accent)',letterSpacing:'.08em',textTransform:'uppercase',whiteSpace:'nowrap' }}>HLNA analysis</span>
            <div style={{ flex:1,height:3,background:'var(--bg-sunken)',borderRadius:2,overflow:'hidden' }}>
              <div style={{ height:'100%',width:`${hlna.confidence}%`,background:'var(--brand-brainbase-accent)',borderRadius:2 }} />
            </div>
            <span style={{ fontSize:9,fontWeight:700,color:'var(--brand-brainbase-accent)' }}>{hlna.confidence}%</span>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex',flexShrink:0,borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,.18)' }}>
          <TabBtn id="details"  label="Details"  />
          <TabBtn id="comments" label="Comments" />
          <TabBtn id="timeline" label="Timeline" />
          <TabBtn id="hlna"     label="HLNA"     />
        </div>

        {/* Content */}
        <div data-dialog-body="" style={{ flex:1,overflowY:'auto',overflowX:'hidden' }}>

          {/* ── DETAILS ── */}
          {tab === 'details' && (
            <div style={{ padding:'16px 20px',display:'flex',flexDirection:'column',gap:16,animation:'mj-tab .18s ease' }}>

              {/* Job info grid */}
              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:10 }}>Job Details</div>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                  {[
                    { label:'Ticket #',       value: job.ticket_number || '—' },
                    { label:'Address',        value: job.address     },
                    { label:'Suburb',         value: job.suburb      },
                    { label:'Bin Type',       value: BIN_LABELS[job.bin_type] },
                    { label:'Issue Type',     value: job.issue_type  },
                    { label:'Assigned To',    value: assignedTo || '—' },
                    { label:'Scheduled',      value: fmtDate(job.scheduled_date) },
                    { label:'Completed',      value: fmtDate(job.completed_date) },
                    { label:'Reported',       value: fmtDate(job.created_at) },
                  ].map(r => (
                    <div key={r.label} style={{ padding:'9px 12px',borderRadius:8,background:'var(--bg-surface)',border:'1px solid var(--border-light)' }}>
                      <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.10em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:4 }}>{r.label}</div>
                      <div style={{ fontSize:12,color:'var(--text-secondary)',fontWeight:500 }}>{r.value}</div>
                    </div>
                  ))}
                </div>
                {job.notes && (
                  <div style={{ marginTop:8,padding:'10px 14px',borderRadius:9,background:'var(--bg-surface)',border:'1px solid var(--border-light)' }}>
                    <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.10em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:5 }}>Notes</div>
                    <p style={{ margin:0,fontSize:12,color:'var(--text-secondary)',lineHeight:1.6 }}>{job.notes}</p>
                  </div>
                )}
              </section>

              {/* Status controls */}
              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:10 }}>Workflow</div>
                <div style={{ padding:'10px 14px',borderRadius:9,background:st.bg.replace('.14','.07'),border:`1px solid ${st.color}28`,display:'flex',alignItems:'center',gap:9,marginBottom:10 }}>
                  <div style={{ width:8,height:8,borderRadius:'50%',background:st.color }} />
                  <span style={{ fontSize:12.5,fontWeight:700,color:st.color }}>Current: {st.label}</span>
                </div>
                <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                  {TRANSITIONS.map(tr => {
                    const avail  = tr.available.includes(status);
                    const active = status === tr.key;
                    const c      = ST[tr.key];
                    return (
                      <button key={tr.key} disabled={!avail||active} onClick={() => applyStatus(tr.key)} style={{
                        display:'flex',alignItems:'center',gap:10,width:'100%',padding:'9px 14px',borderRadius:8,
                        cursor:avail&&!active?'pointer':'default',
                        background:active?`${c.color}12`:avail?'var(--bg-sunken)':'transparent',
                        border:`1px solid ${active?c.color+'35':avail?'var(--border)':'var(--border-light)'}`,
                        opacity:avail||active?1:0.30,fontFamily:FONT,transition:'all .14s',
                      }}
                        onMouseEnter={e=>{ if(avail&&!active){e.currentTarget.style.background=`${c.color}0e`;} }}
                        onMouseLeave={e=>{ if(avail&&!active){e.currentTarget.style.background='var(--bg-sunken)';} }}>
                        <div style={{ width:7,height:7,borderRadius:'50%',background:c.color,flexShrink:0 }} />
                        <span style={{ fontSize:11.5,fontWeight:600,flex:1,textAlign:'left',color:active?c.color:avail?'var(--text-secondary)':'var(--text-subtle)' }}>
                          {actionBusy===tr.key?'Applying…':active?`${tr.label} ✓`:tr.label}
                        </span>
                        {active && <span style={{ fontSize:9,color:c.color,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em' }}>Active</span>}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Assignment */}
              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:10 }}>Assignment</div>
                <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
                  {OPERATORS.map(op => {
                    const isActive = assignedTo === op;
                    return (
                      <button key={op} onClick={() => { setAssignedTo(op); applyStatus('ASSIGNED',{assignedTo:op}); }}
                        style={{ display:'flex',alignItems:'center',gap:10,width:'100%',padding:'9px 12px',borderRadius:8,cursor:'pointer',background:isActive?'var(--status-info-muted)':'var(--bg-surface)',border:`1px solid ${isActive?'var(--status-info-border)':'var(--border)'}`,fontFamily:FONT,transition:'all .14s',textAlign:'left' }}
                        onMouseEnter={e=>{ if(!isActive)e.currentTarget.style.background='rgba(96,165,250,.05)'; }}
                        onMouseLeave={e=>{ if(!isActive)e.currentTarget.style.background='var(--bg-surface)'; }}>
                        <div style={{ width:26,height:26,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,background:isActive?'var(--status-info-muted)':'var(--bg-sunken)',color:isActive?'var(--status-info)':'var(--text-muted)' }}>
                          {op.split(' ').map((w:string)=>w[0]).join('')}
                        </div>
                        <span style={{ fontSize:12,fontWeight:isActive?600:400,color:isActive?'var(--status-info)':'var(--text-secondary)',flex:1 }}>{op}</span>
                        {isActive && <span style={{ fontSize:9,color:'var(--status-info)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em' }}>Assigned</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* ── COMMENTS ── */}
          {tab === 'comments' && (
            <div style={{ padding:'16px 20px',display:'flex',flexDirection:'column',gap:12,animation:'mj-tab .18s ease' }}>
              <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:2 }}>Operational Notes</div>

              {localComments.length === 0 && (
                <div style={{ padding:'20px',textAlign:'center',color:'var(--text-subtle)',fontSize:12 }}>No comments yet</div>
              )}
              {localComments.map(c => (
                <div key={c.id} style={{ padding:'10px 14px',borderRadius:9,background:'var(--bg-surface)',border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:9.5,color:'var(--text-subtle)',marginBottom:5 }}>
                    {new Date(c.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · Operator
                  </div>
                  <div style={{ fontSize:12.5,color:'var(--text-secondary)',lineHeight:1.6 }}>{c.comment}</div>
                </div>
              ))}

              {/* Add comment */}
              <div style={{ marginTop:4 }}>
                <textarea value={commentInput} onChange={e=>setCommentInput(e.target.value)} placeholder="Add operational note or update…" rows={3}
                  style={{ width:'100%',background:'var(--bg-sunken)',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px',fontSize:12,color:'var(--text-primary)',fontFamily:FONT,resize:'vertical',transition:'border-color .14s',boxSizing:'border-box' }}
                  onFocus={e=>(e.currentTarget.style.borderColor='var(--border-focus)')}
                  onBlur={e=>(e.currentTarget.style.borderColor='var(--border)')}
                />
                <button onClick={addComment} disabled={!commentInput.trim()} style={{ marginTop:8,padding:'7px 16px',borderRadius:7,fontSize:11.5,fontWeight:600,background:commentInput.trim()?'var(--brand-brainbase-accent-muted)':'var(--bg-sunken)',border:`1px solid ${commentInput.trim()?'var(--brand-brainbase-accent-border)':'var(--border)'}`,color:commentInput.trim()?'var(--brand-brainbase-accent)':'var(--text-subtle)',cursor:commentInput.trim()?'pointer':'default',fontFamily:FONT,transition:'all .14s' }}>
                  Add Note
                </button>
              </div>
            </div>
          )}

          {/* ── TIMELINE ── */}
          {tab === 'timeline' && (
            <div style={{ padding:'16px 20px',animation:'mj-tab .18s ease' }}>
              <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:14 }}>Status History</div>
              {[
                { time: ageLabel(job.created_at),  type:'alert',  actor:'System',   text:`Job created: ${job.issue_type} at ${job.address}` },
                ...(job.assigned_to ? [{ time:'Shortly after', type:'action', actor:'Dispatch', text:`Assigned to ${job.assigned_to}` }] : []),
                ...(job.scheduled_date ? [{ time:fmtDate(job.scheduled_date), type:'system', actor:'System', text:`Scheduled for ${fmtDate(job.scheduled_date)}` }] : []),
                ...(status==='IN_PROGRESS' ? [{ time:'Today', type:'action', actor:'Field crew', text:'Work commenced on-site' }] : []),
                ...(status==='ESCALATED' ? [{ time:'Today', type:'alert', actor:'System', text:'Issue escalated — requires senior attention' }] : []),
                ...(status==='COMPLETED' ? [{ time:fmtDate(job.completed_date), type:'system', actor:'Crew', text:'Job marked complete' }] : []),
              ].map((ev,i,arr) => (
                <div key={i} style={{ display:'flex',gap:12,marginBottom:16,position:'relative' }}>
                  {i<arr.length-1 && <div style={{ position:'absolute',left:6,top:14,bottom:-10,width:1,background:'var(--bg-sunken)' }} />}
                  <div style={{ width:13,height:13,borderRadius:'50%',flexShrink:0,marginTop:1,background:ev.type==='alert'?'#EF4444':ev.type==='ai'?'#A78BFA':'#60A5FA' }} />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex',gap:8,marginBottom:3 }}>
                      <span style={{ fontSize:9,fontWeight:700,color:'var(--text-subtle)' }}>{ev.time}</span>
                      <span style={{ fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:ev.type==='alert'?'var(--status-danger)':ev.type==='ai'?'var(--brand-brainbase-accent)':'var(--status-info)' }}>{ev.type}</span>
                      <span style={{ fontSize:9,color:'var(--text-subtle)' }}>{ev.actor}</span>
                    </div>
                    <div style={{ fontSize:12,color:'var(--text-secondary)',lineHeight:1.5 }}>{ev.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── HLNA ── */}
          {tab === 'hlna' && (
            <div style={{ padding:'16px 20px',display:'flex',flexDirection:'column',gap:16,animation:'mj-tab .18s ease' }}>
              <div style={{ display:'flex',alignItems:'center',gap:7,marginBottom:2 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                <span style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--brand-brainbase-accent)',textTransform:'uppercase' }}>HLNA Operational Intelligence</span>
              </div>

              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:8 }}>Issue Analysis</div>
                <p style={{ margin:0,fontSize:12.5,color:'var(--text-secondary)',lineHeight:1.65,padding:'12px 14px',background:'var(--brand-brainbase-accent-muted)',border:'1px solid var(--brand-brainbase-accent-border)',borderRadius:9 }}>{hlna.summary}</p>
              </section>

              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:8 }}>Pattern Detection</div>
                <p style={{ margin:0,fontSize:12,color:'var(--text-secondary)',lineHeight:1.65,padding:'12px 14px',background:'var(--bg-surface)',border:'1px solid var(--border-light)',borderRadius:9 }}>{hlna.pattern}</p>
              </section>

              <section>
                <div style={{ fontSize:9.5,fontWeight:700,letterSpacing:'.12em',color:'var(--text-subtle)',textTransform:'uppercase',marginBottom:8 }}>Recommended Action</div>
                <div style={{ padding:'12px 14px',borderRadius:9,background:'var(--status-success-muted)',border:'1px solid var(--status-success-border)' }}>
                  <div style={{ display:'flex',alignItems:'flex-start',gap:9 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" style={{ marginTop:1,flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>
                    <p style={{ margin:0,fontSize:12,color:'var(--status-success)',lineHeight:1.65 }}>{hlna.recommendation}</p>
                  </div>
                </div>
              </section>

              <section style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:9,background:'var(--brand-brainbase-accent-muted)',border:'1px solid var(--brand-brainbase-accent-border)' }}>
                <div>
                  <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.10em',color:'var(--brand-brainbase-accent)',textTransform:'uppercase',marginBottom:3 }}>Confidence Score</div>
                  <div style={{ fontSize:22,fontWeight:700,color:'var(--brand-brainbase-accent)',letterSpacing:'-.02em' }}>{hlna.confidence}%</div>
                </div>
                <div style={{ flex:1,height:5,background:'var(--bg-sunken)',borderRadius:3,overflow:'hidden' }}>
                  <div style={{ height:'100%',width:`${hlna.confidence}%`,background:'var(--brand-brainbase-accent)',borderRadius:3,transition:'width .8s ease' }} />
                </div>
              </section>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding:'10px 20px',flexShrink:0,borderTop:'1px solid var(--border)',background:'rgba(0,0,0,.18)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <span style={{ fontSize:9,color:'var(--text-subtle)',letterSpacing:'.04em' }}>Job · {job.id.slice(0,16)}</span>
          <button onClick={onClose} style={{ padding:'5px 14px',borderRadius:6,background:'var(--bg-sunken)',border:'1px solid var(--border)',color:'var(--text-muted)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:FONT }}>Close</button>
        </div>
      </div>
    </>
  );
}
