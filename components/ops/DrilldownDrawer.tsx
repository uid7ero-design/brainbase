'use client';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/components/ui/app/useDialogFocus';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

export type DrawerAlertStatus = 'critical' | 'warning' | 'stable';

export interface DrawerAlert {
  id: string;
  title: string;
  status: DrawerAlertStatus;
  metric: string;
  metricLabel: string;
  description: string;
}

interface Props {
  alert: DrawerAlert;
  onClose: () => void;
  onAction?: (alertId: string, action: string, payload?: Record<string, unknown>) => void;
}

type WorkflowState = 'open' | 'investigating' | 'assigned' | 'escalated' | 'monitoring' | 'resolved' | 'closed';
type Tab = 'overview' | 'timeline' | 'actions' | 'assignment';

// ── Status colours ────────────────────────────────────────────────────────────

const SC = {
  critical: { dot: '#EF4444', label: 'Critical', text: '#EF4444' },
  warning:  { dot: '#F59E0B', label: 'Warning',  text: '#F59E0B' },
  stable:   { dot: '#22C55E', label: 'Stable',   text: '#22C55E' },
};

const WC: Record<WorkflowState, { label: string; color: string; bg: string }> = {
  open:          { label: 'Open',          color: '#EF4444', bg: 'rgba(239,68,68,.15)'    },
  investigating: { label: 'Investigating', color: '#F59E0B', bg: 'rgba(245,158,11,.15)'   },
  assigned:      { label: 'Assigned',      color: '#60A5FA', bg: 'rgba(96,165,250,.15)'   },
  escalated:     { label: 'Escalated',     color: '#F97316', bg: 'rgba(249,115,22,.15)'   },
  monitoring:    { label: 'Monitoring',    color: '#A78BFA', bg: 'rgba(167,139,250,.15)'  },
  resolved:      { label: 'Resolved',      color: '#22C55E', bg: 'rgba(34,197,94,.15)'    },
  closed:        { label: 'Closed',        color: '#8A8580', bg: 'rgba(138,133,128,.14)' },
};

const RISK_COLORS = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B', low: '#22C55E' };
const TL_COLORS: Record<string, string> = {
  alert: '#EF4444', ai: '#A78BFA', action: '#60A5FA', system: '#8A8580', weather: '#60A5FA',
};

// ── Operational intelligence per alert ────────────────────────────────────────

type Change = { label: string; current: string; baseline: string; dir: 'up'|'down'; bad: boolean };
type TLEntry = { time: string; type: string; actor: string; text: string };
type Intel = {
  summary: string; changes: Change[]; reasoning: string;
  risk: keyof typeof RISK_COLORS; affectedOps: string[]; confidence: number;
  timeline: TLEntry[];
};

const INTEL: Record<string, Intel> = {
  'route-delays': {
    summary: 'Southern routes are experiencing compounding delays due to road congestion, reduced crew availability, and wet road conditions. Average delay has increased 34 minutes above KPI threshold, affecting an estimated 847 household services across Zones 4 and 7.',
    changes: [
      { label: 'Avg Route Delay',    current: '+34 min', baseline: '≤ 5 min',    dir: 'up',   bad: true  },
      { label: 'On-Time Completion', current: '62%',     baseline: '88% target', dir: 'down', bad: true  },
      { label: 'Services Impacted',  current: '847',     baseline: '< 50',       dir: 'up',   bad: true  },
      { label: 'Fuel Consumption',   current: '+12%',    baseline: 'Baseline',   dir: 'up',   bad: true  },
    ],
    reasoning: 'Weather-related road slowdowns correlating with morning school traffic peaks on Route 4. The Route 4 driver assignment changed two days ago — reduced familiarity is adding 8–11 minutes per sub-route. Transfer station backlog is contributing approximately 12 minutes per truck per turnaround cycle.',
    risk: 'critical',
    affectedOps: ['Fleet Routing', 'Waste Collection', 'Customer Complaints', 'Schedule Adherence'],
    confidence: 87,
    timeline: [
      { time: '07:12', type: 'alert',   actor: 'System',  text: 'Route 4 delay threshold breached — 18 minutes over KPI.' },
      { time: '07:35', type: 'ai',      actor: 'HLNA',    text: 'Pattern match detected — correlating with weather event and driver change.' },
      { time: '08:02', type: 'alert',   actor: 'System',  text: 'Route 7 joins delay cluster. Combined impact elevated to CRITICAL.' },
      { time: '08:15', type: 'weather', actor: 'Weather', text: 'Road conditions downgraded — 4mm rain affecting southern zones.' },
      { time: '09:00', type: 'system',  actor: 'System',  text: 'Auto-escalation: 2 hours since initial threshold breach.' },
      { time: '09:14', type: 'ai',      actor: 'HLNA',    text: 'Transfer station delay contributing 12 min/truck. Secondary site diversion recommended.' },
    ],
  },
  'transfer-station': {
    summary: 'Northern transfer station is at 96% capacity and approaching overflow threshold. Incoming load rate exceeds outgoing by 23%. Diversion to the secondary site will increase haul time by 18 minutes per trip and add approximately 14% to daily fuel costs for affected fleet.',
    changes: [
      { label: 'Capacity Utilisation',  current: '96%',      baseline: '< 80% safe', dir: 'up',   bad: true },
      { label: 'Incoming Load Rate',    current: '+23%',     baseline: 'Balanced',   dir: 'up',   bad: true },
      { label: 'Processing Throughput', current: '−30%',     baseline: '100%',       dir: 'down', bad: true },
      { label: 'Truck Queue',           current: '7 trucks', baseline: '< 3',        dir: 'up',   bad: true },
    ],
    reasoning: 'Compactor Unit 2 experienced a mechanical fault at 09:00 which reduced processing throughput by 30%. Yesterday\'s weather event generated above-average organic waste volumes across Zones 4, 5 and 8. The secondary site has 40% available capacity and can absorb overflow immediately.',
    risk: 'critical',
    affectedOps: ['Waste Processing', 'Fleet Routing', 'Route Completion', 'Cost Budget'],
    confidence: 92,
    timeline: [
      { time: '09:04', type: 'alert',  actor: 'System', text: 'Compactor Unit 2 fault detected. Processing throughput reduced 30%.' },
      { time: '09:18', type: 'ai',     actor: 'HLNA',   text: 'Capacity trajectory modelled — overflow risk within 2.4 hours at current load rate.' },
      { time: '09:45', type: 'alert',  actor: 'System', text: 'Capacity exceeded 90% threshold. Alert escalated.' },
      { time: '10:02', type: 'ai',     actor: 'HLNA',   text: 'Secondary site has 40% capacity. Recommend immediate partial diversion for Routes 4 and 7.' },
      { time: '10:30', type: 'alert',  actor: 'System', text: 'Capacity at 96% — CRITICAL threshold reached.' },
    ],
  },
  'organics': {
    summary: 'Zone 8 organics collection is running 2 days behind schedule. Three crews have been reassigned from other zones, creating secondary delay risk in Zones 5 and 6. Wet weather is reducing route completion speed by approximately 15%.',
    changes: [
      { label: 'Zone 8 Schedule',   current: '−2 days', baseline: 'On-time',    dir: 'down', bad: true },
      { label: 'Completion Rate',   current: '64%',     baseline: '95% target', dir: 'down', bad: true },
      { label: 'Reassigned Crews',  current: '3',       baseline: '0',          dir: 'up',   bad: true },
      { label: 'Route Speed',       current: '−15%',    baseline: 'Baseline',   dir: 'down', bad: true },
    ],
    reasoning: 'Zone 8 has higher-than-average property density, making delays compound more quickly. Wet weather this week has reduced route completion speed. Crew reassignment has partially addressed Zone 8 but is now creating secondary risk in Zones 5 and 6 which were at minimal crew coverage.',
    risk: 'high',
    affectedOps: ['Organics Collection', 'Fleet Dispatch', 'Zones 5 & 6 Coverage', 'Crew Scheduling'],
    confidence: 78,
    timeline: [
      { time: 'Mon 06:30', type: 'weather', actor: 'Weather', text: 'Rain event forecast — all zones flagged for potential delay.' },
      { time: 'Mon 14:00', type: 'alert',   actor: 'System',  text: 'Zone 8 organics running 6 hours behind. Advisory raised.' },
      { time: 'Tue 08:00', type: 'action',  actor: 'Ops',     text: 'Two crews reassigned to Zone 8 from Zone 5.' },
      { time: 'Tue 15:00', type: 'alert',   actor: 'System',  text: 'Backlog grown to 1.5 days. Third crew reassigned.' },
      { time: 'Wed 09:00', type: 'alert',   actor: 'System',  text: 'Backlog now 2 days. Alert elevated to WARNING.' },
    ],
  },
  'fuel': {
    summary: 'Fleet fuel costs are trending 5.2% above monthly budget, primarily driven by TRK-008 which is showing abnormally high consumption since its last maintenance event. The vehicle\'s injector wear noted in the last service log appears to be worsening and warrants immediate action.',
    changes: [
      { label: 'Budget Variance',       current: '+5.2%',   baseline: '± 2%',      dir: 'up',   bad: true  },
      { label: 'TRK-008 Consumption',   current: '+31%',    baseline: 'Fleet avg',  dir: 'up',   bad: true  },
      { label: 'Fleet Average',         current: '+1.8%',   baseline: 'Budget',     dir: 'up',   bad: false },
      { label: 'Days to Budget Breach', current: '11 days', baseline: 'Month-end',  dir: 'down', bad: true  },
    ],
    reasoning: 'TRK-008 consumption anomaly is the primary driver. The last maintenance record flagged injector wear as "monitor and review at next service" — this appears to have worsened significantly. At current trajectory, TRK-008 alone will contribute +2.8% to monthly budget overage.',
    risk: 'medium',
    affectedOps: ['Fleet Budget', 'TRK-008 Operations', 'Maintenance Schedule'],
    confidence: 84,
    timeline: [
      { time: '3 days ago', type: 'system', actor: 'System', text: 'TRK-008 fuel consumption anomaly first detected — 18% above fleet average.' },
      { time: '2 days ago', type: 'ai',     actor: 'HLNA',   text: 'Pattern match: correlates with injector wear noted in last service.' },
      { time: 'Yesterday',  type: 'alert',  actor: 'System', text: 'TRK-008 consumption reached 28% above fleet average. Advisory raised.' },
      { time: 'Today',      type: 'alert',  actor: 'System', text: 'Monthly budget variance hits 5.2%. Warning threshold triggered.' },
    ],
  },
  'staff-shortage': {
    summary: 'Zone 3 has three scheduled drivers unavailable for the afternoon shift. Contractor cover has been arranged but contractor vehicles have smaller capacity, requiring approximately 4 additional trips and adding 40 minutes to shift completion time.',
    changes: [
      { label: 'Available Drivers',  current: '−3',       baseline: 'Full roster', dir: 'down', bad: true },
      { label: 'Additional Trips',   current: '+4',       baseline: '0',           dir: 'up',   bad: true },
      { label: 'Shift Completion',   current: '+40 min',  baseline: 'On-schedule', dir: 'up',   bad: true },
      { label: 'Organics Coverage',  current: '−12 prop', baseline: 'Full zone',   dir: 'down', bad: true },
    ],
    reasoning: 'Two drivers are on pre-approved leave and one called in sick at 06:00. Contractor vehicles cannot accommodate organic bins, meaning 12 properties with organics service require rescheduling. Afternoon contractor shift can absorb general waste collection for the zone.',
    risk: 'high',
    affectedOps: ['Zone 3 Crew', 'Organics Scheduling', 'Contractor Coordination'],
    confidence: 73,
    timeline: [
      { time: '06:02', type: 'alert',  actor: 'System',   text: 'Unplanned absence logged — Zone 3 driver unavailable.' },
      { time: '06:15', type: 'action', actor: 'Dispatch',  text: 'Contractor cover initiated. Vehicle compatibility check started.' },
      { time: '06:45', type: 'ai',     actor: 'HLNA',     text: 'Contractor fleet capacity identified — 12 organics properties require rescheduling.' },
      { time: '07:30', type: 'alert',  actor: 'System',   text: 'Shortage elevated to WARNING — 3 drivers now unavailable.' },
      { time: '07:45', type: 'action', actor: 'Dispatch',  text: 'Two contractors confirmed. Schedule adjusted for afternoon shift.' },
    ],
  },
  'recycling': {
    summary: 'Recycling diversion rate is performing above target at 64.2%, exceeding the 60% monthly KPI. Contamination rate has improved 1.4% this month, indicating positive community compliance trends. No action required — this is a positive operational signal.',
    changes: [
      { label: 'Diversion Rate',      current: '64.2%', baseline: '60% target', dir: 'up',   bad: false },
      { label: 'Contamination Rate',  current: '7.1%',  baseline: '8.5% avg',   dir: 'down', bad: false },
      { label: 'Zone 5 Compliance',   current: '+4.2%', baseline: 'Baseline',   dir: 'up',   bad: false },
      { label: 'Campaign Engagement', current: 'Active','baseline': 'Passive',   dir: 'up',   bad: false },
    ],
    reasoning: 'The recent community education campaign is showing measurable results. Zone 5 has the highest improvement, aligning with where campaign activity was concentrated. Contamination rate dropping below 8% for the first time this quarter is a meaningful milestone.',
    risk: 'low',
    affectedOps: ['Recycling Processing', 'Community Engagement', 'Cost Efficiency'],
    confidence: 91,
    timeline: [
      { time: '2 wks ago',  type: 'action', actor: 'Comms',  text: 'Community education campaign launched across Zones 4, 5, 6.' },
      { time: '1 wk ago',   type: 'system', actor: 'System', text: 'Early contamination rate improvement detected — 0.8% reduction.' },
      { time: '3 days ago', type: 'ai',     actor: 'HLNA',   text: 'Trend confirmed. Diversion rate on trajectory to exceed 64% monthly target.' },
      { time: 'Today',      type: 'alert',  actor: 'System', text: 'Diversion rate confirmed at 64.2% — above monthly KPI target.' },
    ],
  },
};

function buildFallback(alert: DrawerAlert): Intel {
  return {
    summary: alert.description,
    changes: [{ label: alert.metricLabel || 'Key Metric', current: alert.metric, baseline: 'Baseline', dir: 'up', bad: alert.status !== 'stable' }],
    reasoning: 'Automated analysis in progress. HLNA is correlating this event with related operational data.',
    risk: alert.status === 'critical' ? 'critical' : alert.status === 'warning' ? 'high' : 'low',
    affectedOps: ['Operations'],
    confidence: 65,
    timeline: [
      { time: 'Now', type: 'alert', actor: 'System', text: `Alert triggered: ${alert.title}` },
      { time: 'Now', type: 'ai',   actor: 'HLNA',   text: 'Analysis initiated. Full intelligence report pending.' },
    ],
  };
}

const OPERATORS = ['Sarah Chen', 'Marcus Webb', 'Priya Kumar', 'Tom Barrett', 'Lisa Okafor'];

const WORKFLOW_STEPS: { key: WorkflowState; label: string; available: WorkflowState[] }[] = [
  { key: 'investigating', label: 'Mark Investigating',  available: ['open']                            },
  { key: 'assigned',      label: 'Assign to Operator',  available: ['open','investigating','escalated'] },
  { key: 'escalated',     label: 'Escalate',            available: ['open','investigating','assigned']  },
  { key: 'monitoring',    label: 'Move to Monitoring',  available: ['investigating','assigned','escalated'] },
  { key: 'resolved',      label: 'Mark Resolved',       available: ['investigating','assigned','escalated','monitoring'] },
  { key: 'closed',        label: 'Close Alert',         available: ['resolved']                        },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function DrilldownDrawer({ alert, onClose, onAction }: Props) {
  const [tab, setTab]                   = useState<Tab>('overview');
  const [wfState, setWfState]           = useState<WorkflowState>(alert.status === 'stable' ? 'monitoring' : 'open');
  const [notes, setNotes]               = useState<{ id: number; text: string; time: string }[]>([]);
  const [noteInput, setNoteInput]       = useState('');
  const [assignedTo, setAssignedTo]     = useState('');
  const [assignedDue, setAssignedDue]   = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, onClose, panelRef);
  const [selPriority, setSelPriority]   = useState(alert.status === 'critical' ? 'URGENT' : alert.status === 'warning' ? 'HIGH' : 'MEDIUM');
  const [actionBusy, setActionBusy]     = useState<string | null>(null);

  const intel = INTEL[alert.id] ?? buildFallback(alert);
  const sc = SC[alert.status];
  const wc = WC[wfState];

  function applyWorkflow(next: WorkflowState, payload?: Record<string, unknown>) {
    setActionBusy(next);
    setWfState(next);
    onAction?.(alert.id, next, payload);
    setTimeout(() => setActionBusy(null), 700);
  }

  function addNote() {
    if (!noteInput.trim()) return;
    const time = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const id = Date.now();
    setNotes(p => [...p, { id, text: noteInput.trim(), time }]);
    onAction?.(alert.id, 'note', { text: noteInput.trim() });
    setNoteInput('');
  }

  // ── Tab button helper ────────────────────────────────────────────────────────

  function TabBtn({ id, label }: { id: Tab; label: string }) {
    return (
      <button onClick={() => setTab(id)} style={{
        flex: 1, padding: '10px 4px', fontSize: 10.5, fontWeight: 600,
        color: tab === id ? 'var(--brand-brainbase-accent)' : 'var(--text-subtle)',
        background: 'none', border: 'none',
        borderBottom: tab === id ? '2px solid var(--brand-brainbase-accent)' : '2px solid transparent',
        cursor: 'pointer', fontFamily: FONT, letterSpacing: '.06em', textTransform: 'uppercase',
        transition: 'color .14s', marginBottom: -1,
      }}>
        {label}
      </button>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes dd-in   { from{transform:translateX(480px)} to{transform:translateX(0)} }
        @keyframes dd-fade { from{opacity:0} to{opacity:1} }
        @keyframes dd-tab  { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
      `}} />

      {/* Backdrop */}
      <div onClick={onClose} aria-hidden="true" style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--scrim)',
        animation: 'dd-fade .2s ease',
      }} />

      {/* Panel */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Alert: ${alert.title}`} tabIndex={-1} style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
        width: 480, maxWidth: '100vw', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-dialog)',
        fontFamily: FONT,
        animation: 'dd-in .22s cubic-bezier(.16,.84,.44,1)',
      }}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 20px', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 9.5, fontWeight: 700, color: sc.text, letterSpacing: '.10em', textTransform: 'uppercase' }}>{sc.label}</span>
                <div style={{ padding: '2px 8px', borderRadius: 20, background: wc.bg, fontSize: 9, fontWeight: 700, color: wc.color, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {wc.label}
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{alert.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{alert.metric} &middot; {alert.metricLabel}</div>
            </div>
            <button type="button" aria-label="Close alert details" onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              background: 'var(--bg-sunken)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, fontFamily: FONT,
            }}>×</button>
          </div>

          {/* HLNA confidence */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brand-brainbase-accent)', letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>HLNA confidence</span>
            <div style={{ flex: 1, height: 3, background: 'var(--bg-sunken)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${intel.confidence}%`, background: 'var(--brand-brainbase-accent)', borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brand-brainbase-accent)' }}>{intel.confidence}%</span>
          </div>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,.18)' }}>
          <TabBtn id="overview"   label="Overview"   />
          <TabBtn id="timeline"   label="Timeline"   />
          <TabBtn id="actions"    label="Actions"    />
          <TabBtn id="assignment" label="Assignment" />
        </div>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <div data-dialog-body="" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18, animation: 'dd-tab .18s ease' }}>

              {/* AI summary */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--brand-brainbase-accent)', textTransform: 'uppercase' }}>HLNA Intelligence Summary</span>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65, padding: '12px 14px', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', borderRadius: 9 }}>
                  {intel.summary}
                </p>
              </section>

              {/* What changed */}
              <section>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 8 }}>What Changed</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {intel.changes.map((c, i) => {
                    const col = c.bad ? (c.dir === 'up' ? '#EF4444' : '#F59E0B') : '#22C55E';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-light)' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>{c.label}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{c.baseline}</span>
                        <span style={{ fontSize: 11.5, color: col, fontWeight: 700 }}>{c.dir === 'up' ? '↑' : '↓'} {c.current}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Causal analysis */}
              <section>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 8 }}>Causal Analysis</div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 9 }}>
                  {intel.reasoning}
                </p>
              </section>

              {/* Risk + Affected */}
              <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: '12px 14px', borderRadius: 9, background: 'var(--bg-surface)', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 8 }}>Risk Level</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: RISK_COLORS[intel.risk] }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: RISK_COLORS[intel.risk], textTransform: 'capitalize' }}>{intel.risk}</span>
                  </div>
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 9, background: 'var(--bg-surface)', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 8 }}>Affected Ops</div>
                  {intel.affectedOps.map(op => (
                    <div key={op} style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 2 }}>· {op}</div>
                  ))}
                </div>
              </section>

            </div>
          )}

          {/* ── TIMELINE ── */}
          {tab === 'timeline' && (
            <div style={{ padding: '16px 20px', animation: 'dd-tab .18s ease' }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 14 }}>Event Timeline</div>

              {intel.timeline.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16, position: 'relative' }}>
                  {i < intel.timeline.length - 1 && (
                    <div style={{ position: 'absolute', left: 6, top: 14, bottom: -10, width: 1, background: 'var(--bg-sunken)' }} />
                  )}
                  <div style={{ width: 13, height: 13, borderRadius: '50%', flexShrink: 0, marginTop: 1, background: TL_COLORS[ev.type] ?? 'var(--bg-sunken)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{ev.time}</span>
                      <span style={{ fontSize: 9, color: TL_COLORS[ev.type] ?? 'var(--text-subtle)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{ev.type}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-subtle)' }}>{ev.actor}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ev.text}</div>
                  </div>
                </div>
              ))}

              {notes.map(n => (
                <div key={n.id} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#60A5FA', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-subtle)' }}>{n.time}</span>
                      <span style={{ fontSize: 9, color: 'var(--status-info)', fontWeight: 700, textTransform: 'uppercase' }}>NOTE</span>
                      <span style={{ fontSize: 9, color: 'var(--text-subtle)' }}>You</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{n.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── ACTIONS ── */}
          {tab === 'actions' && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, animation: 'dd-tab .18s ease' }}>

              {/* Current state indicator */}
              <div style={{ padding: '11px 14px', borderRadius: 9, background: wc.bg.replace('.15', '.08'), border: `1px solid ${wc.color}28`, display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: wc.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: wc.color }}>Current State: {wc.label}</span>
              </div>

              {/* Workflow buttons */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 10 }}>Workflow Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {WORKFLOW_STEPS.map(ws => {
                    const avail  = ws.available.includes(wfState);
                    const active = wfState === ws.key;
                    const busy   = actionBusy === ws.key;
                    const c      = WC[ws.key];
                    return (
                      <button key={ws.key}
                        disabled={!avail || active}
                        onClick={() => applyWorkflow(ws.key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '10px 14px', borderRadius: 8, cursor: avail && !active ? 'pointer' : 'default',
                          background: active ? `${c.color}14` : avail ? 'var(--bg-sunken)' : 'transparent',
                          border: `1px solid ${active ? c.color + '38' : avail ? 'var(--border)' : 'var(--border-light)'}`,
                          opacity: avail || active ? 1 : 0.30, fontFamily: FONT, transition: 'all .14s',
                        }}
                        onMouseEnter={e => { if (avail && !active) { e.currentTarget.style.background = `${c.color}10`; e.currentTarget.style.borderColor = `${c.color}28`; }}}
                        onMouseLeave={e => { if (avail && !active) { e.currentTarget.style.background = 'var(--bg-sunken)'; e.currentTarget.style.borderColor = 'var(--border)'; }}}
                      >
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, textAlign: 'left', color: active ? c.color : avail ? 'var(--text-secondary)' : 'var(--text-subtle)' }}>
                          {busy ? 'Applying…' : active ? `${ws.label} ✓` : ws.label}
                        </span>
                        {active && <span style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '.06em' }}>Active</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Note input */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 10 }}>Operational Note</div>
                <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)}
                  placeholder="Enter operational note, context, or update…"
                  rows={3}
                  style={{ width: '100%', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--text-primary)', fontFamily: FONT, resize: 'vertical', transition: 'border-color .14s', boxSizing: 'border-box' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <button onClick={addNote} disabled={!noteInput.trim()} style={{
                  marginTop: 8, padding: '7px 16px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                  background: noteInput.trim() ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
                  border: `1px solid ${noteInput.trim() ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                  color: noteInput.trim() ? 'var(--brand-brainbase-accent)' : 'var(--text-subtle)',
                  cursor: noteInput.trim() ? 'pointer' : 'default', fontFamily: FONT, transition: 'all .14s',
                }}>
                  Add Note
                </button>

                {notes.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {notes.map(n => (
                      <div key={n.id} style={{ padding: '8px 12px', borderRadius: 7, background: 'var(--status-info-muted)', border: '1px solid var(--status-info-border)' }}>
                        <div style={{ fontSize: 9, color: 'var(--text-subtle)', marginBottom: 3 }}>{n.time} — You</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{n.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ASSIGNMENT ── */}
          {tab === 'assignment' && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, animation: 'dd-tab .18s ease' }}>

              {/* Current */}
              <div style={{ padding: '12px 14px', borderRadius: 9, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 6 }}>Current Assignment</div>
                {assignedTo
                  ? <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-info)' }}>{assignedTo}</div>
                  : <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Unassigned</div>
                }
                {assignedDue && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                    Due {new Date(assignedDue).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>

              {/* Operator list */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 10 }}>Assign to Operator</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {OPERATORS.map(op => {
                    const active = assignedTo === op;
                    return (
                      <button key={op}
                        onClick={() => { setAssignedTo(op); applyWorkflow('assigned', { assignedTo: op }); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                          background: active ? 'var(--status-info-muted)' : 'var(--bg-surface)',
                          border: `1px solid ${active ? 'var(--status-info-border)' : 'var(--border)'}`,
                          fontFamily: FONT, transition: 'all .14s', textAlign: 'left',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(96,165,250,.05)'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                      >
                        <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, background: active ? 'var(--status-info-muted)' : 'var(--bg-sunken)', color: active ? 'var(--status-info)' : 'var(--text-muted)' }}>
                          {op.split(' ').map(w => w[0]).join('')}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? 'var(--status-info)' : 'var(--text-secondary)', flex: 1 }}>{op}</span>
                        {active && <span style={{ fontSize: 9, color: 'var(--status-info)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Assigned</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Due date */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 10 }}>Due Date</div>
                <input type="date" value={assignedDue} onChange={e => setAssignedDue(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: 'var(--text-primary)', fontFamily: FONT, transition: 'border-color .14s', boxSizing: 'border-box' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Priority */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-subtle)', textTransform: 'uppercase', marginBottom: 10 }}>Escalation Priority</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                  {[
                    { key: 'URGENT', color: '#EF4444' },
                    { key: 'HIGH',   color: '#F97316' },
                    { key: 'MEDIUM', color: '#F59E0B' },
                    { key: 'LOW',    color: '#22C55E' },
                  ].map(p => (
                    <button key={p.key} onClick={() => setSelPriority(p.key)} style={{
                      padding: '8px 4px', borderRadius: 7, fontSize: 9.5, fontWeight: 700,
                      letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                      background: selPriority === p.key ? `${p.color}16` : 'var(--bg-surface)',
                      border: `1px solid ${selPriority === p.key ? p.color + '38' : 'var(--border)'}`,
                      color: selPriority === p.key ? p.color : 'var(--text-subtle)',
                      fontFamily: FONT, transition: 'all .14s',
                    }}>
                      {p.key}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div style={{
          padding: '10px 20px', flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'rgba(0,0,0,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-subtle)', letterSpacing: '.04em' }}>
            Alert · {alert.id}
          </span>
          <button onClick={onClose} style={{
            padding: '5px 14px', borderRadius: 6, background: 'var(--bg-sunken)',
            border: '1px solid var(--border)', color: 'var(--text-muted)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
          }}>
            Close
          </button>
        </div>

      </div>
    </>
  );
}
