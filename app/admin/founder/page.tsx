'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage     = 'lead' | 'contacted' | 'demo' | 'trial' | 'proposal' | 'paid' | 'lost';
type Prio      = 'high' | 'medium' | 'low';
type Severity  = 'critical' | 'high' | 'medium' | 'low';
type FeedType  = 'sales' | 'product' | 'system' | 'client';

type QueueItem = {
  id: number; severity: Severity; type: FeedType;
  title: string; why: string; action: string; due: string; cta: string;
};

type RecoItem = {
  impact: string; urgency: string; effort: string;
  action: string; detail: string;
};

type FounderIntel = {
  summary?: string;
  opportunities?: string[];
  risks?: string[];
  recommended_actions?: Array<{ impact?: string; urgency?: string; effort?: string; action: string; detail?: string }>;
  attention_queue?: Array<{ id?: number; severity?: string; type?: string; title: string; why?: string; action?: string; due?: string; cta?: string }>;
  system_alerts?: string[];
  confidence?: number;
  generated_at?: string;
};

function toSeverity(s?: string): Severity {
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  return 'medium';
}
function toFeedType(t?: string): FeedType {
  if (t === 'sales' || t === 'product' || t === 'system' || t === 'client') return t;
  return 'sales';
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const KPI_TILES = [
  { label: 'MRR',             value: '$12,480', delta: '+18%', sub: 'vs April',      pos: true  as const, accent: '#8B5CF6' },
  { label: 'Active clients',  value: '14',      delta: '+2',   sub: 'this month',    pos: true  as const, accent: '#22C55E' },
  { label: 'Active trials',   value: '3',       delta: '—',    sub: 'unchanged',     pos: null,           accent: '#52525B' },
  { label: 'Demos this week', value: '2',       delta: '+1',   sub: 'vs last week',  pos: true  as const, accent: '#22C55E' },
  { label: 'Follow-ups due',  value: '3',       delta: '!',    sub: 'action needed', pos: false as const, accent: '#EF4444' },
  { label: 'Failed analyses', value: '1',       delta: '−2',   sub: 'vs yesterday',  pos: true  as const, accent: '#22C55E' },
];

const QUEUE: QueueItem[] = [
  { id: 1, severity: 'critical', type: 'sales',   title: 'Port Adelaide — no follow-up for 5 days',          why: 'Trial expires in 2 days. No contact since initial demo. High churn risk.',    action: 'Send personalised HLNA waste briefing now',      due: 'Today 5pm',    cta: 'Send Briefing'    },
  { id: 2, severity: 'high',     type: 'sales',   title: 'Campbelltown proposal — highest-value open deal',   why: '$3,200/mo at risk. Mark Okafor is expecting a response by end of day.',      action: 'Send revised pricing proposal',                  due: 'Today EOD',    cta: 'Create Proposal'  },
  { id: 3, severity: 'high',     type: 'system',  title: 'ElevenLabs quota at 94% — voice at risk',          why: 'Voice analysis will fail for all organisations if limit is exceeded.',       action: 'Upgrade plan or reduce voice usage this week',   due: 'This week',    cta: 'Review Usage'     },
  { id: 4, severity: 'medium',   type: 'product', title: 'City of Unley — failed upload needs review',       why: '"financial_year" column unmapped. waste_sample.csv rejected at intake.',     action: 'Review and remap columns (5 min fix)',            due: 'Today',        cta: 'Review Upload'    },
  { id: 5, severity: 'medium',   type: 'sales',   title: '2 demos not confirmed — Mitcham & Tea Tree Gully', why: 'No reply to calendar invite. Risk of no-show if not confirmed by tomorrow.',  action: 'Send confirmation message to both contacts',     due: 'Tomorrow 9am', cta: 'Confirm Demos'    },
];

type Client = {
  id: number; org: string; contact: string; email: string; value: number;
  stage: Stage; action: string; daysAgo: number;
  notes: string;
  usage: { uploads: number; analyses: number; lastActive: string; topModule: string };
  uploads: string[];
  insights: string[];
};

const PIPELINE: Client[] = [
  {
    id: 1, org: 'Port Adelaide Council', contact: 'Sarah Chen', email: 's.chen@portadelaide.sa.gov.au', value: 2400, stage: 'trial', action: 'Follow up — day 5, no response', daysAgo: 5,
    notes: 'Strong interest from Sarah Chen. IT manager involved in decision. Budget confirmed. Trial extended once already. Needs a personalised HLNA output to justify renewal.',
    usage: { uploads: 4, analyses: 12, lastActive: '2 days ago', topModule: 'Waste & Recycling' },
    uploads: ['waste_sample.csv — today 09:14', 'recycling_q1.csv — May 2', 'fleet_report.xlsx — Apr 28'],
    insights: ['Norwood contamination rate 11.2% — above 8% threshold', 'Cost per tonne 18% above benchmark', 'General Waste driving 62% of total cost'],
  },
  {
    id: 2, org: 'Campbelltown City Council', contact: 'Mark Okafor', email: 'm.okafor@campbelltown.sa.gov.au', value: 3200, stage: 'proposal', action: 'Send revised pricing by EOD', daysAgo: 1,
    notes: 'High-value account. Mark is the decision maker. Original proposal at $2,800 — pushed back on price. Revised offer at $3,200 includes fleet module. He has opened the proposal email 3 times today.',
    usage: { uploads: 1, analyses: 3, lastActive: '1 day ago', topModule: 'Fleet Management' },
    uploads: ['fleet_q1.xlsx — May 1'],
    insights: ['Fleet fuel costs 22% above SA council average', 'Vehicle WS-04 accounts for 31% of defects'],
  },
  {
    id: 3, org: 'City of Mitcham', contact: 'Lisa Park', email: 'l.park@mitcham.sa.gov.au', value: 1800, stage: 'demo', action: 'Book HLNA walkthrough call', daysAgo: 0,
    notes: 'Lisa is excited about HLNA voice briefings. Wants to see a live demo with real council data before committing to a trial.',
    usage: { uploads: 0, analyses: 0, lastActive: 'Never', topModule: '—' },
    uploads: [], insights: [],
  },
  {
    id: 4, org: 'Tea Tree Gully Council', contact: 'James Whitford', email: 'j.whitford@ttg.sa.gov.au', value: 2400, stage: 'contacted', action: 'Send product overview deck', daysAgo: 3,
    notes: 'Initial outreach went well. James asked for a product overview before committing to a demo. 3 days since last message — needs follow-up.',
    usage: { uploads: 0, analyses: 0, lastActive: 'Never', topModule: '—' },
    uploads: [], insights: [],
  },
  {
    id: 5, org: 'Mount Barker Council', contact: 'Priya Nair', email: 'p.nair@mountbarker.sa.gov.au', value: 1800, stage: 'paid', action: 'Onboarding check-in call', daysAgo: 0,
    notes: 'Converted 3 weeks ago. Very happy with waste module. Potential upsell to fleet module in Q3. Priya is the primary user and internal champion.',
    usage: { uploads: 9, analyses: 31, lastActive: 'Today', topModule: 'Waste & Recycling' },
    uploads: ['waste_may.csv — May 6', 'recycling_apr.csv — Apr 30', 'contamination_report.csv — Apr 22'],
    insights: ['Recycling rate up 8% month-over-month', 'Kingsford contamination hotspot identified', 'HLNA actions attributed $4,200 in savings'],
  },
  {
    id: 6, org: 'City of Burnside', contact: 'Tom Reeves', email: 't.reeves@burnside.sa.gov.au', value: 2400, stage: 'lead', action: 'Initial outreach — no contact yet', daysAgo: 5,
    notes: 'Found via LG Association SA event. Tom is the Ops Manager. No contact made yet. Cold outreach needed this week.',
    usage: { uploads: 0, analyses: 0, lastActive: 'Never', topModule: '—' },
    uploads: [], insights: [],
  },
  {
    id: 7, org: 'City of Unley', contact: 'Angela Torres', email: 'a.torres@unley.sa.gov.au', value: 3200, stage: 'trial', action: 'Check trial activation status', daysAgo: 1,
    notes: 'Trial started but upload failed on first attempt due to column mapping. Angela is tech-savvy but frustrated. Needs manual support to get first analysis working.',
    usage: { uploads: 1, analyses: 0, lastActive: '1 day ago', topModule: '—' },
    uploads: ['waste_sample.csv — FAILED May 6'],
    insights: [],
  },
];

const TASKS: Array<{ id: number; title: string; priority: Prio; due: string; client: string | null; done: boolean }> = [
  { id: 1, title: 'Follow up Port Adelaide trial — day 5, no response', priority: 'high',   due: 'Today',     client: 'Port Adelaide Council', done: false },
  { id: 2, title: 'Send Campbelltown revised proposal',                  priority: 'high',   due: 'Today',     client: 'Campbelltown City',     done: false },
  { id: 3, title: 'Prepare Mitcham HLNA walkthrough deck',               priority: 'medium', due: 'Tomorrow',  client: 'City of Mitcham',       done: false },
  { id: 4, title: 'Q2 pricing review with advisor',                      priority: 'medium', due: 'Thu 8 May', client: null,                    done: false },
  { id: 5, title: 'Write onboarding sequence for trial accounts',        priority: 'low',    due: 'Fri 9 May', client: null,                    done: true  },
  { id: 6, title: 'Update pitch deck — slide 12 screenshots',            priority: 'low',    due: 'Fri 9 May', client: null,                    done: false },
];

const MRR_POINTS = [
  { m: 'Nov', v: 7400 }, { m: 'Dec', v: 8200 }, { m: 'Jan', v: 9400 },
  { m: 'Feb', v: 10100 }, { m: 'Mar', v: 11200 }, { m: 'Apr', v: 10800 }, { m: 'May', v: 12480 },
];

const SERVICES = [
  { name: 'Frontend',   host: 'Vercel',       status: 'ok'   as const, ms: 0   },
  { name: 'Backend',    host: 'DigitalOcean', status: 'ok'   as const, ms: 142 },
  { name: 'Database',   host: 'Neon',         status: 'ok'   as const, ms: 18  },
  { name: 'OpenAI',     host: 'gpt-4o-mini',  status: 'ok'   as const, ms: 840 },
  { name: 'ElevenLabs', host: 'Turbo v2.5',   status: 'warn' as const, ms: 0   },
];

const USAGE = { uploads: 7, analyses: 23, orgs: 8, failed: 1, api: 142, avgMs: 4200 };
const DEMOS = [
  { org: 'City of Mitcham', time: 'Thu 8 May · 10:00am', who: 'Lisa Park' },
  { org: 'Tea Tree Gully',  time: 'Fri 9 May · 2:00pm',  who: 'James Whitford' },
];

const ACTIVITY: Array<{ ts: string; event: string; type: FeedType; client: string | null }> = [
  { ts: '10:02', event: 'Campbelltown proposal email opened ×3',      type: 'sales',   client: 'Campbelltown' },
  { ts: '09:41', event: 'Failed analysis auto-recovered',              type: 'system',  client: null },
  { ts: '09:24', event: 'Executive report generated',                  type: 'product', client: 'Port Adelaide' },
  { ts: '09:18', event: 'HLNA detected contamination risk — Norwood',  type: 'product', client: 'Port Adelaide' },
  { ts: '09:14', event: 'waste_sample.csv uploaded',                   type: 'product', client: 'Port Adelaide' },
  { ts: '08:52', event: 'City of Unley logged in',                     type: 'client',  client: 'City of Unley' },
  { ts: '08:31', event: 'Mount Barker onboarding call scheduled',      type: 'sales',   client: 'Mount Barker' },
  { ts: '08:15', event: 'HLNA Daily Briefing generated',               type: 'product', client: null },
  { ts: '07:44', event: 'Port Adelaide active session — 23 min',       type: 'client',  client: 'Port Adelaide' },
];

const RECOMMENDATIONS: RecoItem[] = [
  { impact: 'high', urgency: 'high', effort: 'low',    action: 'Send Port Adelaide a personalised contamination briefing',    detail: 'Norwood at 11.2% — use as re-engagement hook before trial expires.' },
  { impact: 'high', urgency: 'high', effort: 'medium', action: 'Finalise Campbelltown proposal before end of business',       detail: 'Mark Okafor has opened the email 3 times today — intent is high.' },
  { impact: 'med',  urgency: 'med',  effort: 'low',    action: 'Fix City of Unley upload column mapping',                     detail: '"financial_year" rejected. Manual remap takes 5 minutes.' },
  { impact: 'med',  urgency: 'low',  effort: 'medium', action: 'Prepare Mitcham HLNA demo with live waste data walkthrough',  detail: 'Lisa Park wants to see real data in action before committing.' },
];

const SIGNALS = [
  { t: 'ai', text: 'Anthropic Series E closes at $61.5B — May 2026'   },
  { t: 'ai', text: 'OpenAI GPT-5 structured outputs now GA'           },
  { t: 'lg', text: 'NSW AI procurement framework extended to councils' },
  { t: 'lg', text: 'LGASA: Digital grants open Q2 2026'               },
];

// ─── Tokens ───────────────────────────────────────────────────────────────────

const T = {
  bg:      '#07080B',
  s1:      '#0B0C12',
  s2:      '#0F1018',
  border:  'rgba(255,255,255,0.065)',
  borderB: 'rgba(255,255,255,0.04)',
  purple:  '#8B5CF6',
  purpleA: 'rgba(139,92,246,0.12)',
  purpleB: 'rgba(139,92,246,0.22)',
  text:    '#EEEEF0',
  sub:     '#9CA3AF',
  dim:     'rgba(255,255,255,0.30)',
  green:   '#22C55E',
  greenA:  'rgba(34,197,94,0.10)',
  yellow:  '#F59E0B',
  yellowA: 'rgba(245,158,11,0.10)',
  red:     '#EF4444',
  redA:    'rgba(239,68,68,0.10)',
  cyan:    '#22D3EE',
  mono:    '"GeistMono","Geist Mono","SF Mono","Fira Code",monospace',
} as const;

const SEV_COLOR: Record<Severity, string> = { critical: T.red, high: '#F97316', medium: T.yellow, low: T.dim };
const SEV_BG:    Record<Severity, string> = { critical: T.redA, high: 'rgba(249,115,22,0.10)', medium: T.yellowA, low: 'rgba(255,255,255,0.05)' };
const FEED_C:    Record<FeedType, string> = { sales: T.green, product: T.purple, system: T.yellow, client: T.cyan };
const STAGE_FG:  Record<Stage, string>   = { lead: '#94A3B8', contacted: '#60A5FA', demo: '#A78BFA', trial: '#FCD34D', proposal: '#FDE68A', paid: '#4ADE80', lost: '#F87171' };
const STAGE_BG:  Record<Stage, string>   = { lead: 'rgba(148,163,184,.09)', contacted: 'rgba(59,130,246,.10)', demo: 'rgba(139,92,246,.10)', trial: 'rgba(245,158,11,.10)', proposal: 'rgba(253,224,71,.09)', paid: 'rgba(34,197,94,.10)', lost: 'rgba(239,68,68,.07)' };
const PRIO_C:    Record<Prio, string>    = { high: T.red, medium: T.yellow, low: T.dim };

// ─── Atoms ────────────────────────────────────────────────────────────────────

function Lbl({ s, c }: { s: string; c?: string }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: c ?? T.dim, marginBottom: 7 }}>{s}</div>;
}

function Card({ children, style, accent }: { children: React.ReactNode; style?: React.CSSProperties; accent?: string }) {
  return (
    <div style={{ background: T.s1, border: `1px solid ${T.border}`, borderRadius: 8, borderTop: accent ? `1px solid ${accent}` : undefined, ...style }}>
      {children}
    </div>
  );
}

function Dot({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const c = status === 'ok' ? T.green : status === 'warn' ? T.yellow : T.red;
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 6px ${c}`, display: 'inline-block', flexShrink: 0 }} />;
}

function StagePill({ s }: { s: Stage }) {
  return <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', background: STAGE_BG[s], color: STAGE_FG[s] }}>{s.toUpperCase()}</span>;
}

function Mono({ children, size, color }: { children: React.ReactNode; size?: number; color?: string }) {
  return <span style={{ fontFamily: T.mono, fontSize: size ?? 11, color: color ?? T.sub }}>{children}</span>;
}

function Btn({ label, onClick, color, small }: { label: string; onClick: () => void; color?: string; small?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? '3px 8px' : '4px 10px',
      borderRadius: 5,
      fontSize: small ? 10 : 11,
      fontWeight: 600,
      color: color ?? T.purple,
      background: color ? `${color}18` : T.purpleA,
      border: `1px solid ${color ? `${color}30` : T.purpleB}`,
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      fontFamily: 'inherit',
    }}>
      {label}
    </button>
  );
}

function ageColor(d: number) { return d < 2 ? T.dim : d < 4 ? T.yellow : T.red; }
function ageLabel(d: number) { return d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`; }

// ─── SVG area chart ───────────────────────────────────────────────────────────

function MrrArea({ data }: { data: typeof MRR_POINTS }) {
  const W = 100, H = 48, PAD = 4;
  const vals = data.map(d => d.v);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const px = (i: number) => (i / (data.length - 1)) * W;
  const py = (v: number) => H - PAD - ((v - mn) / rng) * (H - PAD * 2);
  const pts = data.map((d, i) => ({ x: px(i), y: py(d.v) }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="mrrg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={T.purple} stopOpacity="0.30" />
          <stop offset="100%" stopColor={T.purple} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={0} y1={H - f*(H-PAD*2)-PAD} x2={W} y2={H - f*(H-PAD*2)-PAD} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
      ))}
      <path d={area} fill="url(#mrrg)" />
      <path d={line} fill="none" stroke={T.purple} strokeWidth="1.2" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="2.5" fill={T.purple} stroke={T.s1} strokeWidth="1" />
    </svg>
  );
}

function LatBar({ ms }: { ms: number }) {
  const pct = Math.min(ms / 1000, 1) * 100;
  const c   = ms < 200 ? T.green : ms < 700 ? T.yellow : T.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 44, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 2 }} />
      </div>
      <Mono size={9} color={c}>{ms}ms</Mono>
    </div>
  );
}

function StageFunnel() {
  const counts: Partial<Record<Stage, number>> = {};
  PIPELINE.forEach(c => { counts[c.stage] = (counts[c.stage] ?? 0) + 1; });
  const stages: Stage[] = ['lead', 'contacted', 'demo', 'trial', 'proposal', 'paid'];
  const mx = Math.max(...stages.map(s => counts[s] ?? 0), 1);
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 22 }}>
      {stages.map(s => {
        const n = counts[s] ?? 0;
        return (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ width: '100%', height: Math.max(n === 0 ? 2 : (n/mx)*20, 2), background: n === 0 ? T.borderB : STAGE_BG[s], border: `1px solid ${n === 0 ? 'transparent' : STAGE_FG[s]}22`, borderRadius: 2 }} />
            <span style={{ fontSize: 7, color: T.dim, letterSpacing: '0.04em' }}>{s.slice(0,3).toUpperCase()}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Attention Queue ──────────────────────────────────────────────────────────

function AttentionQueue({ items, onAction }: { items: QueueItem[]; onAction: (msg: string) => void }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [actioned,  setActioned]  = useState<Set<number>>(new Set());

  const visible = items.filter(q => !dismissed.has(q.id));
  if (visible.length === 0) return (
    <Card style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lbl s="Attention queue" />
        <span style={{ fontSize: 10, color: T.green, marginBottom: 7 }}>✓ All clear</span>
      </div>
    </Card>
  );

  const critical = visible.filter(q => q.severity === 'critical').length;

  return (
    <Card accent={critical > 0 ? T.red : T.yellow} style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.red, boxShadow: `0 0 7px ${T.red}`, display: 'inline-block' }} />
        <Lbl s="Attention queue" c={T.text} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.red, background: T.redA, padding: '2px 6px', borderRadius: 3, marginBottom: 7 }}>
          {visible.length} item{visible.length !== 1 ? 's' : ''} need action
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(q => {
          const done = actioned.has(q.id);
          const sc   = SEV_COLOR[q.severity];
          return (
            <div key={q.id} style={{
              borderRadius: 6, overflow: 'hidden',
              border: `1px solid rgba(255,255,255,0.05)`,
              borderLeft: `3px solid ${sc}`,
              background: done ? 'rgba(34,197,94,0.04)' : SEV_BG[q.severity],
              opacity: done ? 0.55 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 4px' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: sc, background: `${sc}18`, padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                  {q.severity}
                </span>
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: FEED_C[q.type], background: `${FEED_C[q.type]}18`, padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                  {q.type}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: done ? T.sub : T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</span>
                {q.due && <Mono size={9} color={T.dim}>{q.due}</Mono>}
                {done ? (
                  <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>✓ Done</span>
                ) : (
                  <Btn small label={`→ ${q.cta}`} color={sc} onClick={() => { setActioned(p => new Set([...p, q.id])); onAction(`${q.cta}: ${q.title}`); }} />
                )}
                <button onClick={() => setDismissed(p => new Set([...p, q.id]))} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
              {q.why && (
                <div style={{ padding: '0 10px 7px 10px' }}>
                  <span style={{ fontSize: 11, color: T.sub, lineHeight: 1.45 }}>{q.why}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── HLNA Briefing ────────────────────────────────────────────────────────────

const MOCK_QUADS = [
  { k: '↗ Opportunity',        c: '#22C55E', text: 'Trial conversions up 22% this week. Campbelltown proposal is the highest-value open deal at $3,200/mo — close this week.' },
  { k: '⚠ Risk',               c: '#F59E0B', text: '3 council demos with no follow-up beyond 5 days. Port Adelaide trial at risk of expiry — no contact in 5 days.' },
  { k: "◎ Today's focus",      c: '#8B5CF6', text: 'Reactivate Port Adelaide with personalised briefing. Finalise Campbelltown proposal. Confirm Mitcham demo attendance.' },
  { k: '→ Recommended action', c: '#22D3EE', text: 'Send Port Adelaide their contamination hotspot analysis now — Norwood at 11.2% is a clear hook for re-engagement.' },
];

function HlnaBriefing({ intel, initialLoading }: { intel: FounderIntel | null; initialLoading: boolean }) {
  const [genState, setGenState] = useState<'done' | 'generating'>('done');
  const [regenTs,  setRegenTs]  = useState<string | null>(null);

  const generate = () => {
    setGenState('generating');
    setTimeout(() => {
      setGenState('done');
      const now = new Date();
      setRegenTs(`${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')} today`);
    }, 2400);
  };

  const quads = intel ? [
    { k: '↗ Opportunity',        c: '#22C55E', text: intel.opportunities?.slice(0, 2).join(' ') || MOCK_QUADS[0].text },
    { k: '⚠ Risk',               c: '#F59E0B', text: intel.risks?.slice(0, 2).join(' ') || MOCK_QUADS[1].text },
    { k: "◎ Today's focus",      c: '#8B5CF6', text: intel.summary || MOCK_QUADS[2].text },
    { k: '→ Recommended action', c: '#22D3EE', text: intel.recommended_actions?.[0]?.action || MOCK_QUADS[3].text },
  ] : MOCK_QUADS;

  const conf = intel?.confidence != null
    ? (intel.confidence > 1 ? Math.round(intel.confidence) : Math.round(intel.confidence * 100))
    : 82;

  const displayTs = regenTs
    ?? (intel?.generated_at
      ? (() => { const d = new Date(intel.generated_at!); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} today`; })()
      : '07:32 today');

  const isLoading = initialLoading || genState === 'generating';

  return (
    <Card accent={T.purple} style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isLoading ? T.yellow : T.green, boxShadow: `0 0 6px ${isLoading ? T.yellow : T.green}`, display: 'inline-block' }} />
          <Lbl s="HLNΛ Chief of Staff" c={T.text} />
          {!isLoading && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.red, background: T.redA, padding: '2px 6px', borderRadius: 3, marginBottom: 7 }}>HIGH URGENCY</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isLoading && <Mono size={9} color={T.dim}>Generated {displayTs} · {conf}% confidence</Mono>}
          <Btn small label={isLoading ? '⟳ Generating…' : '↺ Regenerate'} onClick={generate} />
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '18px 4px' }}>
          <div style={{ fontSize: 11, color: T.dim, marginBottom: 10 }}>
            {initialLoading ? 'HLNΛ is preparing your founder briefing…' : 'HLNΛ is analysing your pipeline, revenue, and system state…'}
          </div>
          <div style={{ height: 2, background: T.borderB, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: T.purple, borderRadius: 2, width: '45%', opacity: 0.7 }} />
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ padding: '9px 11px', borderRadius: 6, background: 'rgba(255,255,255,0.016)', border: `1px solid rgba(255,255,255,0.05)`, height: 52, opacity: 0.3 + i * 0.05 }} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {quads.map(q => (
            <div key={q.k} style={{ padding: '9px 11px', borderRadius: 6, background: 'rgba(255,255,255,0.016)', border: `1px solid rgba(255,255,255,0.05)`, borderLeft: `2px solid ${q.c}` }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: q.c, marginBottom: 4 }}>{q.k}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(238,238,240,0.75)', lineHeight: 1.58 }}>{q.text}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Client pipeline ──────────────────────────────────────────────────────────

function ClientPipeline({ onSelect, onAction }: {
  onSelect: (c: Client) => void;
  onAction: (msg: string) => void;
}) {
  const pipelineVal = PIPELINE.filter(c => c.stage !== 'lost').reduce((a, c) => a + c.value, 0);
  const colTpl = '2fr 1fr 0.6fr 0.8fr 2fr 0.65fr 72px';

  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <Lbl s="Client pipeline" />
            <Mono size={10} color={T.dim}>{PIPELINE.length} accounts · ${pipelineVal.toLocaleString()} open</Mono>
          </div>
          <StageFunnel />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: colTpl, gap: 6, padding: '3px 5px', marginBottom: 2 }}>
        {['Organisation', 'Contact', 'Value', 'Stage', 'Next action', 'Activity', ''].map(h => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.dim }}>{h}</span>
        ))}
      </div>

      {PIPELINE.map((c, i) => {
        const stale = c.daysAgo >= 4;
        return (
          <div key={c.id}
            onClick={() => onSelect(c)}
            style={{
              display: 'grid', gridTemplateColumns: colTpl, gap: 6,
              padding: '5px 5px', borderRadius: 5, cursor: 'pointer',
              background: i % 2 === 0 ? 'rgba(255,255,255,0.010)' : 'transparent',
              borderLeft: stale ? `2px solid ${T.red}` : '2px solid transparent',
              alignItems: 'center', transition: 'background .1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.010)' : 'transparent')}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.org}</span>
            <span style={{ fontSize: 11, color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contact}</span>
            <Mono size={11} color={T.text}>${(c.value/1000).toFixed(1)}k</Mono>
            <StagePill s={c.stage} />
            <span style={{ fontSize: 11, color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.action}</span>
            <Mono size={10} color={ageColor(c.daysAgo)}>{ageLabel(c.daysAgo)}</Mono>
            <div onClick={e => { e.stopPropagation(); onAction(`Follow up: ${c.org}`); }}>
              <Btn small label="Follow up" color={stale ? T.red : undefined} onClick={() => {}} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ─── Revenue intel ────────────────────────────────────────────────────────────

function RevenueIntel() {
  const latest = MRR_POINTS[MRR_POINTS.length - 1].v;
  const prev   = MRR_POINTS[MRR_POINTS.length - 2].v;
  const mom    = (((latest - prev) / prev) * 100).toFixed(1);
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 172px', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <Lbl s="MRR trend — 7 months" />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <Mono size={20} color={T.text}>$12,480</Mono>
              <Mono size={11} color={T.green}>+{mom}%</Mono>
            </div>
          </div>
          <div style={{ height: 50, marginBottom: 5 }}><MrrArea data={MRR_POINTS} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {MRR_POINTS.map(p => <Mono key={p.m} size={9} color={T.dim}>{p.m}</Mono>)}
          </div>
          <div style={{ marginTop: 8, padding: '6px 9px', borderRadius: 6, background: T.purpleA, border: `1px solid ${T.purpleB}` }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.purple }}>Top opportunity </span>
            <span style={{ fontSize: 11, color: T.sub }}>Campbelltown — $3,200/mo, proposal pending</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { l: 'Trial → paid',    v: '62%',    c: T.green  },
            { l: 'Avg deal value',  v: '$2,280',  c: T.text   },
            { l: 'Churn risk',      v: '1 acct',  c: T.yellow },
            { l: 'Conversion rate', v: '28%',     c: T.text   },
            { l: 'ARR run rate',    v: '$149.8k', c: T.purple },
          ].map(s => (
            <div key={s.l} style={{ padding: '5px 9px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: T.sub }}>{s.l}</span>
              <Mono size={12} color={s.c}>{s.v}</Mono>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Founder tasks ────────────────────────────────────────────────────────────

function FounderTasks({ done, toggle }: { done: Set<number>; toggle: (id: number) => void }) {
  const open   = TASKS.filter(t => !done.has(t.id));
  const closed = TASKS.filter(t =>  done.has(t.id));
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl s="Founder tasks" />
        <Mono size={10} color={T.dim}>{closed.length}/{TASKS.length}</Mono>
      </div>
      {open.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.borderB}` }}>
          <button onClick={() => toggle(t.id)} style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid rgba(255,255,255,0.18)`, background: 'transparent', cursor: 'pointer', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
            {t.client && <Mono size={9} color={T.dim}>{t.client}</Mono>}
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: PRIO_C[t.priority], textTransform: 'uppercase', flexShrink: 0 }}>{t.priority}</span>
          <Mono size={10} color={T.dim}>{t.due}</Mono>
        </div>
      ))}
      {closed.length > 0 && (
        <div style={{ marginTop: 5 }}>
          {closed.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: 0.35 }}>
              <button onClick={() => toggle(t.id)} style={{ width: 13, height: 13, borderRadius: 3, background: T.purple, border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 8 }}>✓</span>
              </button>
              <span style={{ fontSize: 11, color: T.dim, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── AI Recommendations ───────────────────────────────────────────────────────

function AiRecommendations({ items, onAction }: { items: RecoItem[]; onAction: (msg: string) => void }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const IMP_C: Record<string, string> = { high: T.red, med: T.yellow, low: T.dim };

  if (items.length === 0) return (
    <Card style={{ padding: '11px 12px' }}>
      <Lbl s="HLNΛ recommendations" />
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>No recommendations available</div>
      </div>
    </Card>
  );

  return (
    <Card style={{ padding: '11px 12px' }}>
      <Lbl s="HLNΛ recommendations" />
      {items.map((r, i) => {
        const isDone = done.has(i);
        return (
          <div key={i} style={{ padding: '7px 0', borderBottom: i < items.length - 1 ? `1px solid ${T.borderB}` : 'none', opacity: isDone ? 0.4 : 1 }}>
            <div style={{ fontSize: 11.5, color: isDone ? T.dim : T.text, fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>{r.action}</div>
            {r.detail && <div style={{ fontSize: 10.5, color: T.dim, marginBottom: 5, lineHeight: 1.4 }}>{r.detail}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[['Impact', r.impact, IMP_C[r.impact] ?? T.dim], ['Urgency', r.urgency, IMP_C[r.urgency] ?? T.dim], ['Effort', r.effort, T.dim]].map(([k, v, c]) => (
                <span key={String(k)} style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: String(c), background: `${String(c)}18`, padding: '1px 5px', borderRadius: 3 }}>
                  {String(k)}: {String(v)}
                </span>
              ))}
              {!isDone && (
                <button onClick={() => { setDone(p => new Set([...p, i])); onAction(`Action: ${r.action}`); }} style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: T.purple, background: T.purpleA, border: `1px solid ${T.purpleB}`, borderRadius: 3, padding: '2px 6px', cursor: 'pointer' }}>
                  Done
                </button>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

function ActivityFeed() {
  return (
    <Card style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.green, boxShadow: `0 0 5px ${T.green}`, display: 'inline-block' }} />
        <Lbl s="Live activity" />
      </div>
      {ACTIVITY.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: i < ACTIVITY.length - 1 ? `1px solid ${T.borderB}` : 'none' }}>
          <Mono size={9} color={T.dim}>{a.ts}</Mono>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.4 }}>{a.event}</div>
            {a.client && <Mono size={9} color={FEED_C[a.type]}>{a.client}</Mono>}
          </div>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: FEED_C[a.type], flexShrink: 0, marginTop: 4 }} />
        </div>
      ))}
    </Card>
  );
}

// ─── System health ────────────────────────────────────────────────────────────

function SystemHealth({ alerts }: { alerts?: string[] }) {
  const allOk = SERVICES.every(s => s.status === 'ok');
  const hasAlerts = alerts && alerts.length > 0;
  return (
    <Card accent={allOk && !hasAlerts ? T.green : T.yellow} style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl s="System health" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Dot status={allOk && !hasAlerts ? 'ok' : 'warn'} />
          <Mono size={9} color={allOk && !hasAlerts ? T.green : T.yellow}>{allOk && !hasAlerts ? 'All OK' : 'Degraded'}</Mono>
        </div>
      </div>
      {SERVICES.map(s => (
        <div key={s.name} style={{ padding: '4px 0', borderBottom: `1px solid ${T.borderB}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.ms > 0 ? 3 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot status={s.status} />
              <span style={{ fontSize: 11.5, color: T.sub }}>{s.name}</span>
            </div>
            <Mono size={9} color={T.dim}>{s.host}</Mono>
          </div>
          {s.ms > 0 && <LatBar ms={s.ms} />}
          {s.status === 'warn' && <div style={{ fontSize: 9, color: T.yellow, marginTop: 1 }}>94% quota used</div>}
        </div>
      ))}
      {hasAlerts && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
          <Lbl s="System alerts" c={T.yellow} />
          {alerts.map((a, i) => (
            <div key={i} style={{ fontSize: 10, color: T.yellow, marginBottom: 3, lineHeight: 1.4 }}>⚠ {a}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Product usage ────────────────────────────────────────────────────────────

function ProductUsage() {
  const rows = [
    { l: 'Uploads',      v: `${USAGE.uploads}`,              c: T.text   },
    { l: 'Analyses',     v: `${USAGE.analyses}`,             c: T.text   },
    { l: 'Active orgs',  v: `${USAGE.orgs}`,                 c: T.text   },
    { l: 'Failed',       v: `${USAGE.failed}`,               c: T.yellow },
    { l: 'API calls',    v: `${USAGE.api}`,                  c: T.text   },
    { l: 'Avg time',     v: `${(USAGE.avgMs/1000).toFixed(1)}s`, c: T.text },
  ];
  return (
    <Card style={{ padding: '11px 12px' }}>
      <Lbl s="Product usage · today" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 7 }}>
        {rows.map(r => (
          <div key={r.l} style={{ padding: '6px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 9, color: T.dim, marginBottom: 3 }}>{r.l}</div>
            <Mono size={15} color={r.c}>{r.v}</Mono>
          </div>
        ))}
      </div>
      <div style={{ padding: '5px 8px', borderRadius: 5, background: T.purpleA, border: `1px solid ${T.purpleB}` }}>
        <span style={{ fontSize: 9, color: T.dim }}>Top module  </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.purple }}>Waste &amp; Recycling</span>
      </div>
    </Card>
  );
}

// ─── Context (demos + signals) ────────────────────────────────────────────────

function LiveContext() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Card style={{ padding: '9px 11px' }}>
        <Lbl s="Upcoming demos" />
        {DEMOS.map((d, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: i < DEMOS.length - 1 ? `1px solid ${T.borderB}` : 'none' }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: T.text }}>{d.org}</div>
            <Mono size={9} color={T.dim}>{d.time} · {d.who}</Mono>
          </div>
        ))}
      </Card>
      <Card style={{ padding: '9px 11px' }}>
        <Lbl s="Signals" />
        {SIGNALS.map((s, i) => (
          <div key={i} style={{ padding: '3px 0 3px 7px', borderLeft: `2px solid ${s.t === 'ai' ? T.purple : T.cyan}`, marginBottom: 4, fontSize: 10.5, color: T.sub, lineHeight: 1.45 }}>
            {s.text}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── Client drawer ────────────────────────────────────────────────────────────

function ClientDrawer({ client, onClose, onAction, onModal }: {
  client: Client; onClose: () => void; onAction: (msg: string) => void;
  onModal: (m: 'book-demo' | 'proposal') => void;
}) {
  const router = useRouter();
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'fixed', top: 52, right: 0, width: 360,
        height: 'calc(100vh - 52px)', zIndex: 200,
        background: T.s2, borderLeft: `1px solid ${T.border}`,
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}>
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: T.s2, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 3 }}>{client.org}</div>
              <div style={{ fontSize: 12, color: T.sub }}>{client.contact}</div>
              <Mono size={10} color={T.dim}>{client.email}</Mono>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.dim, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <StagePill s={client.stage} />
            <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: T.mono }}>${client.value.toLocaleString()}/mo</span>
            <span style={{ fontSize: 10, color: ageColor(client.daysAgo) }}>Last active: {ageLabel(client.daysAgo)}</span>
          </div>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          <div style={{ padding: '9px 11px', borderRadius: 7, background: T.purpleA, border: `1px solid ${T.purpleB}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.purple, marginBottom: 4 }}>Next action</div>
            <div style={{ fontSize: 12, color: T.text, marginBottom: 8 }}>{client.action}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn small label="→ CRM"             onClick={() => router.push('/crm/contacts')} />
              <Btn small label="Generate Briefing" onClick={() => { onClose(); router.push('/command'); }} />
              <Btn small label="Create Proposal"   onClick={() => { onClose(); onModal('proposal'); }} />
            </div>
          </div>

          <div>
            <Lbl s="Notes" />
            <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 10px' }}>
              {client.notes}
            </div>
          </div>

          <div>
            <Lbl s="Usage summary" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {[
                { l: 'Uploads',      v: client.usage.uploads   },
                { l: 'Analyses run', v: client.usage.analyses  },
                { l: 'Last active',  v: client.usage.lastActive },
                { l: 'Top module',   v: client.usage.topModule  },
              ].map(r => (
                <div key={r.l} style={{ padding: '6px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 9, color: T.dim, marginBottom: 2 }}>{r.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{r.v}</div>
                </div>
              ))}
            </div>
          </div>

          {client.uploads.length > 0 && (
            <div>
              <Lbl s="Recent uploads" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {client.uploads.map((u, i) => (
                  <div key={i} style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}` }}>
                    <Mono size={10} color={u.includes('FAILED') ? T.red : T.sub}>{u}</Mono>
                  </div>
                ))}
              </div>
            </div>
          )}

          {client.insights.length > 0 && (
            <div>
              <Lbl s="Recent HLNΛ insights" />
              {client.insights.map((ins, i) => (
                <div key={i} style={{ padding: '5px 0 5px 8px', borderLeft: `2px solid ${T.purple}`, marginBottom: 5, fontSize: 11, color: T.sub, lineHeight: 1.45 }}>
                  {ins}
                </div>
              ))}
            </div>
          )}

          {client.insights.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', borderRadius: 7, border: `1px dashed ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.dim }}>No HLNΛ insights yet</div>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>Upload data to generate analysis</div>
              <div style={{ marginTop: 8 }}>
                <Btn small label="Upload Dataset" onClick={() => onAction(`Upload: ${client.org}`)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Left sidebar ─────────────────────────────────────────────────────────────

function LeftSidebar({ onModal }: { onModal: (m: 'book-demo' | 'proposal') => void }) {
  const router = useRouter();

  const NAV: Array<{ label: string; href: string | null }> = [
    { label: 'Command', href: '/admin/founder' },
    { label: 'Clients', href: '/crm'           },
    { label: 'Revenue', href: null             },
    { label: 'Product', href: '/data'          },
    { label: 'System',  href: '/admin'         },
  ];

  const ACTS = [
    { icon: '＋', l: 'Add lead',       fn: () => router.push('/crm/contacts') },
    { icon: '◆',  l: 'Book demo',      fn: () => onModal('book-demo')          },
    { icon: '↗',  l: 'Gen proposal',   fn: () => onModal('proposal')           },
    { icon: '▷',  l: 'Run analysis',   fn: () => router.push('/command')       },
    { icon: '↑',  l: 'Upload dataset', fn: () => router.push('/data')          },
    { icon: '⊞',  l: 'Open CRM',       fn: () => router.push('/crm')           },
  ];

  return (
    <div style={{ width: 148, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.s1, display: 'flex', flexDirection: 'column', padding: '13px 0', overflowY: 'auto' }}>
      <div style={{ padding: '0 10px', marginBottom: 16 }}>
        <Lbl s="Navigate" />
        {NAV.map((n, i) => (
          <div
            key={n.label}
            onClick={() => n.href && router.push(n.href)}
            style={{
              padding: '5px 8px', borderRadius: 5, fontSize: 12, marginBottom: 1,
              cursor: n.href ? 'pointer' : 'default',
              fontWeight: i === 0 ? 600 : 400,
              color: i === 0 ? T.purple : n.href ? T.sub : T.dim,
              background: i === 0 ? T.purpleA : 'transparent',
              borderLeft: i === 0 ? `2px solid ${T.purple}` : '2px solid transparent',
            }}
          >
            {n.label}
          </div>
        ))}
      </div>

      <div style={{ width: '100%', height: 1, background: T.border, marginBottom: 14 }} />

      <div style={{ padding: '0 10px', marginBottom: 16 }}>
        <Lbl s="Actions" />
        {ACTS.map(a => (
          <button key={a.l} onClick={a.fn} style={{ width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 5, fontSize: 11, color: T.sub, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, marginBottom: 1, fontFamily: 'inherit' }}>
            <span style={{ color: T.purple, fontSize: 11, width: 12, flexShrink: 0, textAlign: 'center' }}>{a.icon}</span>
            {a.l}
          </button>
        ))}
      </div>

      <div style={{ width: '100%', height: 1, background: T.border, marginBottom: 14 }} />

      <div style={{ padding: '0 10px', marginTop: 'auto' }}>
        <Lbl s="Context" />
        <div style={{ fontSize: 10, lineHeight: 1.7 }}>
          <div style={{ color: T.dim }}>Week 19 · Q2</div>
          <div style={{ color: T.dim }}>FY 2025–26</div>
          <div style={{ marginTop: 5 }}>
            <div style={{ fontSize: 9, color: T.dim }}>Open pipeline</div>
            <Mono size={13} color={T.text}>$19,600</Mono>
          </div>
          <div style={{ marginTop: 5 }}>
            <div style={{ fontSize: 9, color: T.dim }}>Overdue actions</div>
            <Mono size={13} color={T.red}>3</Mono>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg }: { msg: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: T.s2, border: `1px solid ${T.purpleB}`, borderRadius: 8,
      padding: '9px 16px', zIndex: 300, fontSize: 12, color: T.text,
      boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${T.purpleB}`,
      display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
    }}>
      <span style={{ color: T.green }}>✓</span>
      {msg}
    </div>
  );
}

// ─── Shared modal input style ─────────────────────────────────────────────────

const INPUT_S: React.CSSProperties = {
  width: '100%', padding: '7px 9px', background: '#0B0C12',
  border: '1px solid rgba(255,255,255,0.065)', borderRadius: 5,
  color: '#EEEEF0', fontSize: 12, fontFamily: 'var(--font-inter), Inter, sans-serif',
  boxSizing: 'border-box',
};

// ─── Book Demo modal ──────────────────────────────────────────────────────────

function BookDemoModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (msg: string) => void }) {
  const [org,  setOrg]  = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const ready = !!org && !!date;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.55)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 380, zIndex: 300, background: T.s2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 22px', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Book Demo</div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>Schedule a product walkthrough with a prospect</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.dim, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <Lbl s="Client" />
          <select value={org} onChange={e => setOrg(e.target.value)} style={{ ...INPUT_S, color: org ? T.text : T.sub }}>
            <option value="">Select a client or prospect…</option>
            {PIPELINE.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div>
            <Lbl s="Date" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INPUT_S} />
          </div>
          <div>
            <Lbl s="Time (optional)" />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={INPUT_S} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => ready && onConfirm(`Demo booked: ${org} · ${date}${time ? ' at ' + time : ''}`)}
            style={{ flex: 1, padding: '8px', borderRadius: 6, background: ready ? T.purple : 'rgba(139,92,246,0.3)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
          >
            Confirm Demo
          </button>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', border: `1px solid ${T.border}`, color: T.sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Generate Proposal modal ──────────────────────────────────────────────────

function ProposalModal({ preselect, onClose, onConfirm }: { preselect?: Client | null; onClose: () => void; onConfirm: (msg: string) => void }) {
  const [org,   setOrg]   = useState(preselect?.org ?? '');
  const [price, setPrice] = useState(preselect ? String(preselect.value) : '');
  const [mod,   setMod]   = useState(preselect?.usage.topModule ?? 'Waste & Recycling');
  const MODS = ['Waste & Recycling', 'Fleet Management', 'Roads & Infrastructure', 'Full Platform'];
  const ready = !!org;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.55)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 380, zIndex: 300, background: T.s2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 22px', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Generate Proposal</div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>Draft a pricing proposal for a client or prospect</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.dim, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <Lbl s="Client" />
          <select value={org} onChange={e => setOrg(e.target.value)} style={{ ...INPUT_S, color: org ? T.text : T.sub }}>
            <option value="">Select a client…</option>
            {PIPELINE.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <Lbl s="Monthly value ($)" />
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 2400" style={INPUT_S} />
          </div>
          <div>
            <Lbl s="Primary module" />
            <select value={mod} onChange={e => setMod(e.target.value)} style={INPUT_S}>
              {MODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16, padding: '7px 10px', borderRadius: 5, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)' }}>
          <span style={{ fontSize: 10, color: 'rgba(245,158,11,0.8)' }}>Full proposal generation will be wired to the reporting module in the next sprint.</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => ready && onConfirm(`Proposal drafted for ${org}${price ? ' · $' + price + '/mo' : ''}`)}
            style={{ flex: 1, padding: '8px', borderRadius: 6, background: ready ? T.purple : 'rgba(139,92,246,0.3)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
          >
            Create Proposal
          </button>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', border: `1px solid ${T.border}`, color: T.sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ─── KPI hero ─────────────────────────────────────────────────────────────────

function SnapshotHero() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
      {KPI_TILES.map(t => {
        const dc = t.pos === null ? T.dim : t.pos ? T.green : T.red;
        const arrow = t.pos === null ? '' : t.pos ? '↑ ' : '↓ ';
        return (
          <div key={t.label} style={{ background: T.s1, border: `1px solid ${T.border}`, borderTop: `2px solid ${t.accent}`, borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.dim, marginBottom: 5 }}>{t.label}</div>
            <div style={{ fontFamily: T.mono, fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em', color: T.text, marginBottom: 3 }}>{t.value}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: dc }}>{arrow}{t.delta}</span>
              <span style={{ fontSize: 9, color: T.dim }}>{t.sub}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function FounderPage() {
  const [tasksDone,      setTasksDone]      = useState<Set<number>>(() => new Set(TASKS.filter(t => t.done).map(t => t.id)));
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [toast,          setToast]          = useState<string | null>(null);
  const [modal,          setModal]          = useState<'book-demo' | 'proposal' | null>(null);

  // ─── Founder intelligence ────────────────────────────────────────────────
  const [intel,        setIntel]        = useState<FounderIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const [intelError,   setIntelError]   = useState(false);

  useEffect(() => {
    fetch('/api/admin/founder-intelligence')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: FounderIntel) => { setIntel(data); setIntelLoading(false); })
      .catch(() => { setIntelError(true); setIntelLoading(false); });
  }, []);

  // ─── Derive queue items (live → fallback to mock) ────────────────────────
  const queueItems: QueueItem[] = (intel?.attention_queue?.length)
    ? intel.attention_queue.map((item, i) => ({
        id:       item.id ?? (1000 + i),
        severity: toSeverity(item.severity),
        type:     toFeedType(item.type),
        title:    item.title,
        why:      item.why    ?? '',
        action:   item.action ?? '',
        due:      item.due    ?? '',
        cta:      item.cta    ?? 'Take Action',
      }))
    : QUEUE;

  // ─── Derive recommendation items (live → fallback to mock) ──────────────
  const recoItems: RecoItem[] = (intel?.recommended_actions?.length)
    ? intel.recommended_actions.map(r => ({
        impact:  r.impact  ?? 'med',
        urgency: r.urgency ?? 'med',
        effort:  r.effort  ?? 'med',
        action:  r.action,
        detail:  r.detail  ?? '',
      }))
    : RECOMMENDATIONS;

  const toggleTask = (id: number) => setTasksDone(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div style={{ margin: '-40px', height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: 'var(--font-inter), Inter, -apple-system, sans-serif', fontSize: 12, overflow: 'hidden' }}>

      {/* Status bar */}
      <div style={{ height: 36, flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.s1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: T.text }}>BRAINBASE</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.purple, background: T.purpleA, border: `1px solid ${T.purpleB}`, padding: '2px 7px', borderRadius: 3 }}>FOUNDER OS</span>
          <span style={{ fontSize: 10, color: T.dim }}>Thu 8 May 2026</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Dot status="ok" />
            <span style={{ color: T.green }}>All systems operational</span>
          </div>
          <span style={{ color: T.dim }}>|</span>
          <Mono size={10} color={T.sub}>MRR $12,480</Mono>
          <span style={{ color: T.dim }}>|</span>
          <a href="/admin" style={{ color: T.dim, textDecoration: 'none', fontSize: 10 }}>← Admin</a>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <LeftSidebar onModal={setModal} />

        {/* Center column */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '11px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Error banner — shown only when API failed */}
          {intelError && (
            <div style={{ padding: '6px 11px', borderRadius: 5, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: T.yellow }}>⚠</span>
              <span style={{ fontSize: 10, color: 'rgba(245,158,11,0.75)' }}>Founder intelligence unavailable — displaying local operating data.</span>
            </div>
          )}

          <SnapshotHero />
          <AttentionQueue items={queueItems} onAction={showToast} />
          <HlnaBriefing intel={intel} initialLoading={intelLoading} />
          <ClientPipeline onSelect={setSelectedClient} onAction={showToast} />
          <RevenueIntel />
          <FounderTasks done={tasksDone} toggle={toggleTask} />
        </div>

        {/* Right column */}
        <div style={{ width: 252, flexShrink: 0, borderLeft: `1px solid ${T.border}`, background: T.s1, overflowY: 'auto', padding: '11px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AiRecommendations items={recoItems} onAction={showToast} />
          <ActivityFeed />
          <SystemHealth alerts={intel?.system_alerts} />
          <ProductUsage />
          <LiveContext />
        </div>
      </div>

      {/* Client drawer */}
      {selectedClient && (
        <ClientDrawer client={selectedClient} onClose={() => setSelectedClient(null)} onAction={showToast} onModal={m => { setSelectedClient(null); setModal(m); }} />
      )}

      {/* Modals */}
      {modal === 'book-demo' && (
        <BookDemoModal
          onClose={() => setModal(null)}
          onConfirm={msg => { setModal(null); showToast(msg); }}
        />
      )}
      {modal === 'proposal' && (
        <ProposalModal
          preselect={selectedClient}
          onClose={() => setModal(null)}
          onConfirm={msg => { setModal(null); showToast(msg); }}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} />}
    </div>
  );
}
