'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import InstagramFeedPanel from '@/components/instagram/InstagramFeedPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage     = 'lead' | 'contacted' | 'demo' | 'trial' | 'proposal' | 'paid' | 'lost';
type Severity  = 'critical' | 'high' | 'medium' | 'low';
type FeedType  = 'sales' | 'product' | 'system' | 'client';
type Section   = 'overview' | 'clients' | 'revenue' | 'tasks' | 'system' | 'instagram';

type QueueItem = {
  id: number; severity: Severity; type: FeedType;
  title: string; why: string; action: string; due: string; cta: string;
  client_id?: number | string;
  analysis_id?: string;
};

// FounderIntel (the founder-intelligence response shape) removed — Phase B
// hardening cut the fetch entirely; nothing in this file reads that
// backend's response anymore.

type LinkedOrg = {
  id: string;
  name: string;
  slug: string;
  status?: string | null;
  created_at?: string | null;
};

type LinkedUser = {
  id: string;
  name: string;
  email?: string | null;
  username?: string | null;
};

type FounderClientRaw = {
  id?: number | string;
  organisation_name?: string;
  contact_name?: string;
  stage?: string;
  estimated_value?: number | null;
  last_contacted_at?: string | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
  probability?: number | null;
  status?: string | null;
  organisation_id?: string | null;
  primary_contact_id?: string | null;
  linked_organisation?: LinkedOrg | null;
  linked_primary_user?: LinkedUser | null;
};

function toSeverity(s?: string): Severity {
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  return 'medium';
}
function toStage(s?: string | null): Stage {
  const valid: Stage[] = ['lead', 'contacted', 'demo', 'trial', 'proposal', 'paid', 'lost'];
  return valid.includes(s as Stage) ? (s as Stage) : 'lead';
}
function daysAgoFrom(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
function mapRawClient(raw: FounderClientRaw, idx: number): Client {
  return {
    id:      typeof raw.id === 'number' ? raw.id : idx + 1,
    org:     raw.organisation_name ?? `Client ${idx + 1}`,
    contact: raw.contact_name ?? '—',
    email:   '',
    value:   raw.estimated_value ?? 0,
    stage:   toStage(raw.stage),
    action:  raw.next_action ?? '—',
    daysAgo: daysAgoFrom(raw.last_contacted_at),
    notes:   '',
    usage:   { uploads: 0, analyses: 0, lastActive: '—', topModule: '—' },
    uploads:  [],
    insights: [],
    organisation_id:      raw.organisation_id    ?? null,
    primary_contact_id:   raw.primary_contact_id ?? null,
    linked_organisation:  raw.linked_organisation  ?? null,
    linked_primary_user:  raw.linked_primary_user  ?? null,
  };
}

type ClientOverride = {
  daysAgo?: number;
  action?: string;
  followedUp?: boolean;
  stage?: Stage;
  highlighted?: boolean;
};
type SessionEvent = { ts: string; event: string; type: FeedType; client: string | null };

// ─── Mock data ────────────────────────────────────────────────────────────────
//
// Founder OS Phase B — data-authority audit. Every KPI/panel below that had
// no authoritative Production source (see the Phase B report for the full
// per-metric authority map) has had its mock fixture removed and its
// component rewritten to show an honest "Not connected" state instead of
// fabricated values. Only fixtures with a real, wired replacement remain.

// MRR, Active clients, Active trials, Demos this week, Follow-ups due, and
// Failed analyses each need only a label/accent — SnapshotHero decides
// real-vs-unavailable per tile from real `metrics` data (MRR only; the
// other five have no authoritative source anywhere in the schema).
const SNAPSHOT_TILE_META: Array<{ label: string; accent: string; real: boolean }> = [
  { label: 'MRR',             accent: '#8B5CF6', real: true  },
  { label: 'Active clients',  accent: '#52525B', real: false },
  { label: 'Active trials',   accent: '#52525B', real: false },
  { label: 'Demos this week', accent: '#52525B', real: false },
  { label: 'Follow-ups due',  accent: '#52525B', real: false },
  { label: 'Failed analyses', accent: '#52525B', real: false },
];

type Client = {
  id: number; org: string; contact: string; email: string; value: number;
  stage: Stage; action: string; daysAgo: number;
  notes: string;
  usage: { uploads: number; analyses: number; lastActive: string; topModule: string };
  uploads: string[];
  insights: string[];
  organisation_id?: string | null;
  primary_contact_id?: string | null;
  linked_organisation?: LinkedOrg | null;
  linked_primary_user?: LinkedUser | null;
};

// PIPELINE (7 fake council clients), TASKS, MRR_POINTS, SERVICES, USAGE,
// DEMOS, ACTIVITY, RECOMMENDATIONS, and SIGNALS were removed here — none had
// an authoritative Production source (see the Phase B report's KPI/data
// authority map). ClientPipeline, RevenueIntel, SystemHealth, ProductUsage,
// LiveContext, AiRecommendations, and ActivityFeed now render an honest
// "Not connected" state in their place, or (ClientPipeline) an empty state
// driven by the existing real founder-clients fetch. Founder tasks
// (FounderTaskSummary/FounderTasksPanel) were reconnected in Phase D to the
// real, authoritative Organiser board — see lib/founder/tasksBoard.ts.

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
// PRIO_C (task-priority color map) removed with FounderTasks' fake TASKS —
// no longer referenced anywhere.

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

// Dot (status indicator) removed with the fake "Demo status" bar and
// SERVICES list — no longer referenced anywhere.

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

// MrrArea (fake 7-month MRR trend SVG chart) removed — no historical
// revenue table exists to back a real trend line (Phase B).

// LatBar (fake per-service latency bar) removed with SystemHealth's fake
// SERVICES list — no longer referenced anywhere.

function StageFunnel({ clients }: { clients: Client[] }) {
  const counts: Partial<Record<Stage, number>> = {};
  clients.forEach(c => { counts[c.stage] = (counts[c.stage] ?? 0) + 1; });
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

// ─── Section tabs ─────────────────────────────────────────────────────────────

const SECTION_TABS: Array<{ id: Section; label: string }> = [
  { id: 'overview',   label: 'Overview'   },
  { id: 'clients',    label: 'Clients'    },
  { id: 'revenue',    label: 'Revenue'    },
  { id: 'tasks',      label: 'Tasks'      },
  { id: 'system',     label: 'System'     },
  { id: 'instagram',  label: 'Instagram'  },
];

function SectionTabs({ section, setSection }: { section: Section; setSection: (s: Section) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
      {SECTION_TABS.map(t => (
        <button
          key={t.id}
          onClick={() => setSection(t.id)}
          style={{
            padding: '4px 11px', borderRadius: 5, fontSize: 11,
            fontWeight: section === t.id ? 700 : 400,
            background: section === t.id ? T.purpleA : 'transparent',
            color: section === t.id ? T.purple : T.dim,
            border: `1px solid ${section === t.id ? T.purpleB : 'transparent'}`,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
          }}
        >{t.label}</button>
      ))}
    </div>
  );
}

// ─── Attention Queue ──────────────────────────────────────────────────────────

function AttentionQueue({ items, onAction, onFollowUp, onMarkReviewed }: {
  items: QueueItem[];
  onAction: (msg: string) => void;
  onFollowUp?: (clientId: number | string, org: string) => void;
  onMarkReviewed?: (analysisId: string | undefined, org: string, clientId?: number) => void;
}) {
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
                  <Btn small label={`→ ${q.cta}`} color={sc} onClick={() => {
                    setActioned(p => new Set([...p, q.id]));
                    if (q.analysis_id !== undefined && onMarkReviewed) {
                      onMarkReviewed(q.analysis_id, q.title, typeof q.client_id === 'number' ? q.client_id : undefined);
                    } else if (q.client_id !== undefined && onFollowUp) {
                      onFollowUp(q.client_id, q.title);
                    } else {
                      onAction(`${q.cta}: ${q.title}`);
                    }
                  }} />
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

// ─── Founder OS Phase A — real, cross-organisation Attention Queue ──────────
// Sourced from GET /api/founder/attention-queue (alerts, client_pipeline
// Requests, web_service_leads, client_onboarding launches) — no mock data,
// no external backend proxy. This replaces the QUEUE mock / founder-
// intelligence fallback as the Overview tab's primary Attention Queue; the
// Clients-tab mini-queue (still backed by queueItems/QUEUE) is unchanged —
// out of scope for Phase A.

type AttnItemType =
  | 'alert' | 'client_request' | 'web_lead' | 'upcoming_launch' | 'overdue_deployment'
  | 'implementation_blocked' | 'implementation_at_risk'
  | 'implementation_overdue_launch' | 'implementation_upcoming_launch';
type AttnItem = {
  id: string; type: AttnItemType; severity: Severity; title: string; description: string;
  organisationId: string | null; organisationName: string | null; createdAt: string | null;
  href: string; metadata: Record<string, unknown>;
};
type AttnMetrics = {
  leadsByStage: Record<string, number>;
  openAlerts: number; openRequests: number; onboardingInProgress: number;
  activeManagedServices: number; activeMrr: number;
  // Founder OS Phase C — Client Implementations intelligence. Distinct from
  // onboardingInProgress above (that's Web Systems' client_onboarding — a
  // different table/vertical). Optional so older cached responses (before
  // this field existed) still type-check safely.
  implementationsTotal?: number;
  implementationsByStage?: Record<string, number>;
  implementationsAtRisk?: number;
  implementationsBlocked?: number;
  implementationsApproachingLaunch?: number;
};
type ImplementationNextAction = {
  id: string; organisationName: string | null; name: string; nextAction: string; href: string;
};

const ATTN_TYPE_LABEL: Record<AttnItemType, string> = {
  alert:              'Alert',
  client_request:     'Client Request',
  web_lead:           'Web Lead',
  upcoming_launch:    'Upcoming Launch',
  overdue_deployment: 'Overdue Deployment',
  implementation_blocked:         'Implementation Blocked',
  implementation_at_risk:         'Implementation At Risk',
  implementation_overdue_launch:  'Implementation Overdue',
  implementation_upcoming_launch: 'Implementation Launch',
};
const ATTN_TYPE_COLOR: Record<AttnItemType, string> = {
  alert:              T.red,
  client_request:     T.cyan,
  web_lead:           T.green,
  upcoming_launch:    '#60A5FA',
  overdue_deployment: '#F97316',
  implementation_blocked:         T.red,
  implementation_at_risk:         '#F59E0B',
  implementation_overdue_launch:  '#F97316',
  implementation_upcoming_launch: '#60A5FA',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function SnapshotTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{value}</div>
    </div>
  );
}

function RealFounderOperations() {
  const [items, setItems] = useState<AttnItem[]>([]);
  const [metrics, setMetrics] = useState<AttnMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/founder/attention-queue')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: AttnItem[]; metrics?: AttnMetrics }) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setMetrics(d.metrics ?? null);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const critical = items.some(i => i.severity === 'critical');

  return (
    <>
      <Card accent={critical ? T.red : T.purpleB} style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, boxShadow: `0 0 7px ${T.green}`, display: 'inline-block' }} />
          <Lbl s="Attention queue" c={T.text} />
          {!loading && !loadError && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: items.length ? T.red : T.green, background: items.length ? T.redA : T.greenA,
              padding: '2px 6px', borderRadius: 3, marginBottom: 7,
            }}>
              {items.length ? `${items.length} item${items.length !== 1 ? 's' : ''} need action` : '✓ All clear'}
            </span>
          )}
        </div>

        {loading && <div style={{ fontSize: 11, color: T.dim, padding: '4px 2px 2px' }}>Loading…</div>}
        {!loading && loadError && (
          <div style={{ fontSize: 11, color: T.red, padding: '4px 2px 2px' }}>Couldn&apos;t load the attention queue.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(item => {
            const sc = SEV_COLOR[item.severity];
            const tc = ATTN_TYPE_COLOR[item.type];
            return (
              <a key={item.id} href={item.href} style={{
                display: 'block', textDecoration: 'none', borderRadius: 6, overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${sc}`,
                background: SEV_BG[item.severity],
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 4px' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: sc, background: `${sc}18`, padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                    {item.severity}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: tc, background: `${tc}18`, padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                    {ATTN_TYPE_LABEL[item.type]}
                  </span>
                  {item.organisationName && <Mono size={9} color={T.dim}>{item.organisationName}</Mono>}
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                  {item.createdAt && <Mono size={9} color={T.dim}>{timeAgo(item.createdAt)}</Mono>}
                </div>
                {item.description && (
                  <div style={{ padding: '0 10px 7px 10px' }}>
                    <span style={{ fontSize: 11, color: T.sub, lineHeight: 1.45 }}>{item.description}</span>
                  </div>
                )}
              </a>
            );
          })}
        </div>
      </Card>

      <Card style={{ padding: '12px 14px' }}>
        <Lbl s="Real operational snapshot" />
        {(loading || !metrics) ? (
          <div style={{ fontSize: 11, color: T.dim }}>{loadError ? 'Unavailable.' : 'Loading…'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <SnapshotTile label="Active MRR"               value={`$${Math.round(metrics.activeMrr).toLocaleString()}`} />
            <SnapshotTile label="Active managed services"  value={String(metrics.activeManagedServices)} />
            <SnapshotTile label="In implementation"        value={String(metrics.onboardingInProgress)} />
            <SnapshotTile label="Open requests"             value={String(metrics.openRequests)} />
            <SnapshotTile label="Open alerts"               value={String(metrics.openAlerts)} />
            <SnapshotTile label="New Web Systems leads"     value={String(metrics.leadsByStage['new'] ?? 0)} />
          </div>
        )}
      </Card>
    </>
  );
}

// ─── HLNA Briefing ────────────────────────────────────────────────────────────
// Phase B hardening: this panel used to show content from the external,
// unverified founder-intelligence backend whenever that backend reported
// itself live. Founder OS's trust boundary is now strict — NO data from
// that legacy backend may be presented as authoritative operational
// information, regardless of whether it claims to be live. This is now a
// permanent, unconditional shell: no fetch, no props, no external content
// ever shown, ever. (MOCK_QUADS, the fake "HIGH URGENCY" badge, and the
// fake local "regenerating" animation were already removed in the prior
// Phase B round — see git history for that diff.)
function HlnaBriefing() {
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.dim, display: 'inline-block' }} />
        <Lbl s="HLNΛ Chief of Staff" c={T.text} />
      </div>
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Intelligence briefing not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No authoritative briefing source is wired up yet.</div>
      </div>
    </Card>
  );
}

// ─── Client pipeline ──────────────────────────────────────────────────────────
// Phase B: PIPELINE (7 fake council clients) was a hardcoded fixture — the
// existing real fetch from /api/admin/founder-clients is unchanged (still
// the authoritative source when that backend is reachable and returns
// rows), but silently falling back to the mock is gone: an empty/
// unreachable result now shows an honest "Not connected" state instead of
// fabricated accounts.

function ClientPipeline({ onSelect, onFollowUp, overrides, clients, loading }: {
  onSelect: (c: Client) => void;
  onFollowUp: (clientId: number, org: string) => void;
  overrides: Record<number, ClientOverride>;
  clients: Client[];
  loading: boolean;
}) {
  const pipelineVal = clients.filter(c => c.stage !== 'lost').reduce((a, c) => a + c.value, 0);
  const colTpl = '2fr 1fr 0.6fr 0.8fr 2fr 0.65fr 72px';

  if (!loading && clients.length === 0) return (
    <Card style={{ padding: '13px 15px' }}>
      <Lbl s="Client pipeline" />
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No authoritative sales-pipeline source is wired up yet.</div>
      </div>
    </Card>
  );

  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <Lbl s="Client pipeline" />
            <Mono size={10} color={T.dim}>{clients.length} accounts · ${pipelineVal.toLocaleString()} open</Mono>
          </div>
          <StageFunnel clients={clients} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: colTpl, gap: 6, padding: '3px 5px', marginBottom: 2 }}>
        {['Organisation', 'Contact', 'Value', 'Stage', 'Next action', 'Activity', ''].map(h => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.dim }}>{h}</span>
        ))}
      </div>

      {clients.map((base, i) => {
        const ov       = overrides[base.id] ?? {};
        const effDays  = ov.daysAgo  ?? base.daysAgo;
        const effStage = ov.stage    ?? base.stage;
        const effAct   = ov.action   ?? base.action;
        const stale    = !ov.followedUp && effDays >= 4;
        const bgBase   = ov.highlighted
          ? 'rgba(34,197,94,0.09)'
          : i % 2 === 0 ? 'rgba(255,255,255,0.010)' : 'transparent';
        const merged: Client = { ...base, daysAgo: effDays, stage: effStage, action: effAct };
        return (
          <div key={base.id}
            onClick={() => onSelect(merged)}
            style={{
              display: 'grid', gridTemplateColumns: colTpl, gap: 6,
              padding: '5px 5px', borderRadius: 5, cursor: 'pointer',
              background: bgBase,
              borderLeft: stale ? `2px solid ${T.red}` : ov.highlighted ? `2px solid ${T.green}` : '2px solid transparent',
              alignItems: 'center', transition: 'background 0.6s, border-left 0.6s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = bgBase)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base.org}</span>
              {base.linked_organisation && (
                <span title={`Linked: ${base.linked_organisation.name}`} style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'rgba(34,211,238,0.12)', color: T.cyan, border: '1px solid rgba(34,211,238,0.22)', flexShrink: 0, letterSpacing: '0.04em', fontWeight: 700 }}>LINKED</span>
              )}
            </div>
            <span style={{ fontSize: 11, color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base.contact}</span>
            <Mono size={11} color={T.text}>${(base.value/1000).toFixed(1)}k</Mono>
            <StagePill s={effStage} />
            <span style={{ fontSize: 11, color: ov.followedUp ? T.green : T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{effAct}</span>
            <Mono size={10} color={ov.followedUp ? T.green : ageColor(effDays)}>{ov.followedUp ? 'just now' : ageLabel(effDays)}</Mono>
            <div onClick={e => e.stopPropagation()}>
              {ov.followedUp ? (
                <span style={{ fontSize: 10, color: T.green, fontWeight: 600, fontFamily: T.mono }}>✓ Sent</span>
              ) : (
                <div onClick={() => onFollowUp(base.id, base.org)}>
                  <Btn small label="Follow up" color={stale ? T.red : undefined} onClick={() => {}} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ─── Revenue intel ────────────────────────────────────────────────────────────
// Phase B: the MRR trend chart, "Top opportunity" line, and all five stat
// rows were fabricated (no historical revenue table, no deal/trial/churn
// tracking exists anywhere in the schema). Active MRR and its derived ARR
// run rate ARE real — same authoritative source as Phase A/SnapshotHero
// (managed_services.monthly_value, status = 'active') — everything else
// below is honestly marked "Not connected" rather than removed outright,
// so the shape of the panel (and the fact that revenue tracking is a real,
// if partial, capability) stays visible.

const REVENUE_UNAVAILABLE_STATS = ['Trial → paid', 'Avg deal value', 'Churn risk', 'Conversion rate'];

function RevenueIntel({ metrics, loading }: { metrics: AttnMetrics | null; loading: boolean }) {
  const mrr = metrics?.activeMrr ?? null;
  const arr = mrr != null ? mrr * 12 : null;
  const mrrDisplay = loading ? '…' : mrr != null ? `$${Math.round(mrr).toLocaleString()}` : '—';
  const arrDisplay = loading ? '…' : arr != null ? `$${Math.round(arr).toLocaleString()}` : '—';

  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 172px', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <Lbl s="Active MRR" />
            <Mono size={20} color={mrr != null ? T.text : T.dim}>{mrrDisplay}</Mono>
          </div>
          <div style={{ padding: '14px 11px', borderRadius: 7, border: `1px dashed ${T.border}`, textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, color: T.dim }}>Historical MRR trend not available</div>
            <div style={{ fontSize: 9, color: T.dim, marginTop: 2 }}>No revenue history is tracked yet — this shows current active recurring revenue only.</div>
          </div>
          <div style={{ marginTop: 8, padding: '6px 9px', borderRadius: 6, background: T.purpleA, border: `1px solid ${T.purpleB}` }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.purple }}>Source </span>
            <span style={{ fontSize: 11, color: T.sub }}>managed_services · active subscriptions</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ padding: '5px 9px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: T.sub }}>ARR run rate</span>
            <Mono size={12} color={arr != null ? T.purple : T.dim}>{arrDisplay}</Mono>
          </div>
          {REVENUE_UNAVAILABLE_STATS.map(l => (
            <div key={l} style={{ padding: '5px 9px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: T.dim }}>{l}</span>
              <Mono size={11} color={T.dim}>Not connected</Mono>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Client Implementations summary ──────────────────────────────────────────
// Founder OS Phase C. Every value here comes from GET /api/founder/
// attention-queue's metrics/implementationNextActions (shared with
// SnapshotHero/RevenueIntel — no duplicate fetch), which is itself derived
// directly from the real `implementations` table. Deliberately separate
// from the existing "Active Clients"/"In implementation" (Web Systems
// client_onboarding) metrics — never conflated with them.
const IMPL_STAGE_LABEL: Record<string, string> = {
  planning: 'Planning', discovery: 'Discovery', setup: 'Setup', build: 'Build',
  client_review: 'Client Review', testing: 'Testing', ready_to_launch: 'Ready to Launch',
  live: 'Live', on_hold: 'On Hold',
};

function ImplementationSummary({ metrics, loading, nextActions }: {
  metrics: AttnMetrics | null; loading: boolean; nextActions: ImplementationNextAction[];
}) {
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Lbl s="Client implementations" />
        <Link href="/admin/implementations" style={{ fontSize: 10, color: T.purple, textDecoration: 'none' }}>View all →</Link>
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: T.dim }}>Loading…</div>
      ) : !metrics || metrics.implementationsTotal === undefined ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        </div>
      ) : metrics.implementationsTotal === 0 ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>No implementations yet</div>
          <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>Create one from the Client Implementations workspace.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 12 }}>
            <SnapshotTile label="Total (active)"       value={String(metrics.implementationsTotal)} />
            <SnapshotTile label="At risk"               value={String(metrics.implementationsAtRisk ?? 0)} />
            <SnapshotTile label="Blocked"                value={String(metrics.implementationsBlocked ?? 0)} />
            <SnapshotTile label="Approaching launch"     value={String(metrics.implementationsApproachingLaunch ?? 0)} />
          </div>

          {metrics.implementationsByStage && Object.keys(metrics.implementationsByStage).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: nextActions.length > 0 ? 12 : 0 }}>
              {Object.entries(metrics.implementationsByStage).map(([stage, count]) => (
                <span key={stage} style={{ fontSize: 10, color: T.sub, background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`, borderRadius: 4, padding: '3px 8px' }}>
                  {IMPL_STAGE_LABEL[stage] ?? stage}: <Mono size={10} color={T.text}>{count}</Mono>
                </span>
              ))}
            </div>
          )}

          {nextActions.length > 0 && (
            <div>
              <Lbl s="Next actions" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {nextActions.map(n => (
                  <a key={n.id} href={n.href} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, textDecoration: 'none', padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}` }}>
                    <span style={{ fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.organisationName ? `${n.organisationName} — ` : ''}{n.name}
                    </span>
                    <span style={{ fontSize: 10.5, color: T.sub, flexShrink: 0 }}>{n.nextAction}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Client Implementations by client ────────────────────────────────────────
// Founder OS Clients tab (Phase C). Independent fetch — needs full row
// detail the attention-queue summary above doesn't carry. Reuses the
// existing, already-authorised GET /api/implementations endpoint verbatim
// (no new API route). Grouped by organisation_id using the API's own
// organisation_name — no parallel client-identity logic, no duplication of
// the organisations table.
type FullImplementation = {
  id: string; organisation_id: string; organisation_name: string | null;
  name: string; service_type: string | null; stage: string; health: string;
  owner_name: string | null; target_launch_date: string | null; next_action: string | null;
};

function ImplementationsByClient() {
  const [rows, setRows] = useState<FullImplementation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/implementations')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { implementations?: FullImplementation[] }) => setRows(Array.isArray(d.implementations) ? d.implementations : []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const groups = new Map<string, { name: string; items: FullImplementation[] }>();
  for (const row of rows) {
    const key = row.organisation_id;
    if (!groups.has(key)) groups.set(key, { name: row.organisation_name ?? 'Unknown organisation', items: [] });
    groups.get(key)!.items.push(row);
  }

  return (
    <Card style={{ padding: '13px 15px' }}>
      <Lbl s="Client implementations" />
      {loading ? (
        <div style={{ fontSize: 11, color: T.dim }}>Loading…</div>
      ) : loadError ? (
        <div style={{ fontSize: 11, color: T.red }}>Couldn&apos;t load implementations.</div>
      ) : groups.size === 0 ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>No implementations yet</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[...groups.entries()].map(([orgId, group]) => (
            <div key={orgId}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 5 }}>{group.name}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {group.items.map(impl => {
                  const health = HEALTH_META[impl.health] ?? HEALTH_META.on_track;
                  return (
                    <a key={impl.id} href={`/admin/implementations/${impl.id}`} style={{
                      display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr auto 1fr 1.5fr', gap: 8, alignItems: 'center',
                      textDecoration: 'none', padding: '6px 8px', borderRadius: 5,
                      background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}`,
                    }}>
                      <span style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{impl.name}</span>
                      <span style={{ fontSize: 10.5, color: T.sub }}>{impl.service_type ?? '—'}</span>
                      <span style={{ fontSize: 10.5, color: T.sub }}>{IMPL_STAGE_LABEL[impl.stage] ?? impl.stage}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: health.color, background: `${health.color}18`, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{health.label}</span>
                      <span style={{ fontSize: 10.5, color: T.sub }}>{impl.owner_name ?? 'Unassigned'}</span>
                      <span style={{ fontSize: 10.5, color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {impl.target_launch_date ? new Date(impl.target_launch_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                        {impl.next_action ? ` · ${impl.next_action}` : ''}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const HEALTH_META: Record<string, { label: string; color: string }> = {
  on_track: { label: 'On Track', color: '#34d399' },
  at_risk:  { label: 'At Risk',  color: '#f59e0b' },
  blocked:  { label: 'Blocked',  color: '#f87171' },
};

// ─── Founder tasks ────────────────────────────────────────────────────────────
// Founder OS Phase D. Real, persisted tasks — no mock, no "not connected"
// placeholder. Backed by the existing, authoritative Organiser system
// (organiser_boards/organiser_items — the exact tables the canonical
// Organiser app at /organiser itself uses), scoped server-side to
// BrainBase's own board via the GET/POST/PATCH /api/founder/tasks*
// adapter (see lib/founder/tasksBoard.ts and app/api/founder/tasks/**).
// Founder OS does not own a second task database; Organiser remains the
// sole persistence layer. status/priority options below are copied
// verbatim from app/organiser/page.tsx's own STATUS_OPTIONS/
// PRIORITY_OPTIONS — not a parallel vocabulary, so a
// task created here looks identical when viewed in the canonical Organiser
// UI. owner remains free text, matching organiser_items.owner's real
// column type — not redesigned into a user picker in this phase.

type FounderTaskItem = {
  id: string; title: string; status: string; priority: string | null;
  owner: string | null; dueDate: string | null; notes: string | null;
  createdAt: string; updatedAt: string;
};
type FounderTaskGroups = {
  overdue: FounderTaskItem[]; today: FounderTaskItem[]; upcoming: FounderTaskItem[];
  noDueDate: FounderTaskItem[]; completed: FounderTaskItem[];
};
const TASK_STATUS_OPTIONS = ['Not Started', 'Working on it', 'Stuck', 'Done'];
const TASK_PRIORITY_OPTIONS = ['', 'Low', 'Medium', 'High', 'Critical'];
const TASK_PRIORITY_COLOR: Record<string, string> = {
  Critical: '#f87171', High: '#fb923c', Medium: '#fbbf24', Low: T.dim,
};
const EMPTY_TASK_GROUPS: FounderTaskGroups = { overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] };

function useFounderTasks() {
  const [board, setBoard] = useState<{ id: string; name: string } | null>(null);
  const [groups, setGroups] = useState<FounderTaskGroups>(EMPTY_TASK_GROUPS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);

  const load = () => {
    fetch('/api/founder/tasks')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { board?: { id: string; name: string } | null; groups?: FounderTaskGroups }) => {
        setBoard(d.board ?? null);
        setGroups(d.groups ?? EMPTY_TASK_GROUPS);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const createBoard = async () => {
    setCreatingBoard(true);
    try {
      const res = await fetch('/api/founder/tasks/board', { method: 'POST' });
      if (res.ok || res.status === 409) load();
    } finally {
      setCreatingBoard(false);
    }
  };

  // Optimistic local patch, applied to every group (a status change can
  // move a task between buckets, so the caller follows up with reload()
  // once the request settles to re-derive correct grouping).
  const patchLocalTask = (id: string, patch: Partial<FounderTaskItem>) => {
    setGroups(prev => {
      const next: FounderTaskGroups = { overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] };
      for (const key of Object.keys(prev) as (keyof FounderTaskGroups)[]) {
        next[key] = prev[key].map(t => (t.id === id ? { ...t, ...patch } : t));
      }
      return next;
    });
  };

  return { board, groups, loading, loadError, createBoard, creatingBoard, reload: load, patchLocalTask };
}

function taskCount(groups: FounderTaskGroups): number {
  return groups.overdue.length + groups.today.length + groups.upcoming.length + groups.noDueDate.length;
}

// ── Overview: compact summary only — deliberately not the full list, and
// deliberately not folded into the existing Attention Queue endpoint (see
// the Phase D report for why: avoiding coupling this new, independent
// adapter to the established, protected attention-queue aggregation).
function FounderTaskSummary() {
  const { board, groups, loading, loadError } = useFounderTasks();

  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl s="Founder tasks" />
      </div>
      {loading ? (
        <div style={{ fontSize: 11, color: T.dim }}>Loading…</div>
      ) : loadError ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        </div>
      ) : !board ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>No task board yet</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <SnapshotTile label="Overdue" value={String(groups.overdue.length)} />
          <SnapshotTile label="Due today" value={String(groups.today.length)} />
        </div>
      )}
    </Card>
  );
}

function TaskRow({ task, onUpdate }: { task: FounderTaskItem; onUpdate: (id: string, patch: Record<string, unknown>) => void }) {
  const done = task.status === 'Done';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 2fr 110px 100px 1fr 90px', gap: 8, alignItems: 'center',
      padding: '6px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}`,
      opacity: done ? 0.55 : 1,
    }}>
      <button
        onClick={() => onUpdate(task.id, { status: done ? 'Not Started' : 'Done' })}
        title={done ? 'Reopen' : 'Mark complete'}
        style={{
          width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
          border: `1.5px solid ${done ? T.green : 'rgba(255,255,255,0.25)'}`,
          background: done ? T.green : 'transparent', color: '#fff', fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >{done ? '✓' : ''}</button>
      <span style={{ fontSize: 12, color: done ? T.sub : T.text, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
      <select
        value={task.priority ?? ''}
        onChange={e => onUpdate(task.id, { priority: e.target.value || null })}
        style={{ fontSize: 10, background: 'transparent', color: task.priority ? (TASK_PRIORITY_COLOR[task.priority] ?? T.sub) : T.dim, border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 4px' }}
      >
        {TASK_PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p || 'No priority'}</option>)}
      </select>
      <input
        type="date"
        value={task.dueDate ?? ''}
        onChange={e => onUpdate(task.id, { due_date: e.target.value || null })}
        style={{ fontSize: 10, background: 'transparent', color: T.sub, border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 4px', colorScheme: 'dark' }}
      />
      <input
        type="text"
        defaultValue={task.owner ?? ''}
        placeholder="Owner"
        onBlur={e => { if (e.target.value.trim() !== (task.owner ?? '')) onUpdate(task.id, { owner: e.target.value.trim() || null }); }}
        style={{ fontSize: 10, background: 'transparent', color: T.sub, border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 4px' }}
      />
      <select
        value={task.status}
        onChange={e => onUpdate(task.id, { status: e.target.value })}
        style={{ fontSize: 10, background: 'transparent', color: T.sub, border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 4px' }}
      >
        {TASK_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function TaskGroupSection({ label, tasks, onUpdate, defaultOpen = true }: {
  label: string; tasks: FounderTaskItem[]; onUpdate: (id: string, patch: Record<string, unknown>) => void; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tasks.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <button onClick={() => setOpen(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: T.dim }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.dim }}>{label}</span>
        <span style={{ fontSize: 10, color: T.dim }}>({tasks.length})</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(t => <TaskRow key={t.id} task={t} onUpdate={onUpdate} />)}
        </div>
      )}
    </div>
  );
}

// ── Tasks tab: the full board. Organiser (/organiser) remains the
// canonical, detailed work-management surface — this stays a focused
// founder workflow: list, create, and the handful of updates a founder
// actually needs (status/priority/due date/owner/complete/reopen), not a
// second full item editor.
function FounderTasksPanel() {
  const { board, groups, loading, loadError, createBoard, creatingBoard, reload, patchLocalTask } = useFounderTasks();

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const updateTask = async (id: string, patch: Record<string, unknown>) => {
    // Optimistic local update across every group (the item's own bucket
    // membership may change — e.g. marking Done moves it to Completed —
    // so a full reload after the request settles keeps grouping correct).
    patchLocalTask(id, patch as Partial<FounderTaskItem>);
    try {
      const res = await fetch(`/api/founder/tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
    } finally {
      reload();
    }
  };

  const submitCreate = async () => {
    setCreateError(null);
    if (!title.trim()) { setCreateError('Title is required.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/founder/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          priority: priority || undefined,
          due_date: dueDate || undefined,
          owner: owner.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? 'Could not create task.'); return; }
      setShowCreate(false);
      setTitle(''); setPriority(''); setDueDate(''); setOwner(''); setNotes('');
      reload();
    } catch {
      setCreateError('Could not create task.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lbl s="Founder tasks" />
          {board && <Mono size={9} color={T.dim}>{board.name}</Mono>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Deep-links straight to the resolved Founder Tasks board
              (?board=<id>) once one exists — never WORK/Tafe, never
              whichever board Organiser would otherwise default to (see
              app/organiser/page.tsx's board-selection fix). Falls back to
              the plain, still-real canonical Organiser URL (no board
              preselected) when no Founder Tasks board has been created
              yet — never broken, never a Command-overview link. Targets
              /organiser directly (Phase D.2) — the legacy /command/
              organiser path still works via a redirect (next.config.ts)
              but this link goes straight to the canonical route. */}
          <Link
            href={board ? `/organiser?board=${encodeURIComponent(board.id)}` : '/organiser'}
            style={{ fontSize: 10, color: T.purple, textDecoration: 'none' }}
          >
            Open in Organiser →
          </Link>
          {board && <Btn small label={showCreate ? '✕ Cancel' : '+ New Task'} onClick={() => setShowCreate(p => !p)} />}
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: T.dim }}>Loading…</div>
      ) : loadError ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        </div>
      ) : !board ? (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim, marginBottom: 8 }}>No task board yet</div>
          <Btn small label={creatingBoard ? 'Creating…' : 'Create Founder Tasks board'} onClick={createBoard} />
        </div>
      ) : (
        <>
          {showCreate && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.014)' }}>
              {createError && <div style={{ fontSize: 10, color: T.red, marginBottom: 6 }}>{createError}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" style={INPUT_S} />
                <select value={priority} onChange={e => setPriority(e.target.value)} style={INPUT_S}>
                  {TASK_PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p || 'No priority'}</option>)}
                </select>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ ...INPUT_S, colorScheme: 'dark' }} />
                <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Owner" style={INPUT_S} />
              </div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} style={{ ...INPUT_S, resize: 'vertical', marginBottom: 8 }} />
              <Btn small label={creating ? 'Creating…' : 'Create Task'} onClick={submitCreate} />
            </div>
          )}

          {taskCount(groups) === 0 && groups.completed.length === 0 ? (
            <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.dim }}>No tasks yet</div>
            </div>
          ) : (
            <>
              <TaskGroupSection label="Overdue" tasks={groups.overdue} onUpdate={updateTask} />
              <TaskGroupSection label="Today" tasks={groups.today} onUpdate={updateTask} />
              <TaskGroupSection label="Upcoming" tasks={groups.upcoming} onUpdate={updateTask} />
              <TaskGroupSection label="No due date" tasks={groups.noDueDate} onUpdate={updateTask} />
              <TaskGroupSection label="Completed" tasks={groups.completed} onUpdate={updateTask} defaultOpen={false} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

// ─── AI Recommendations ───────────────────────────────────────────────────────
// Phase B: no authoritative recommendation/insight source exists locally —
// the previous RECOMMENDATIONS mock and the intel.recommended_actions
// fallback (from the legacy, unverified external founder-intelligence
// backend) are both gone. Per the Phase B brief: don't fabricate cards, and
// don't duplicate the Attention Queue just to look busy — a plain
// not-connected state is the honest option here.

function AiRecommendations() {
  return (
    <Card style={{ padding: '11px 12px' }}>
      <Lbl s="HLNΛ recommendations" />
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Recommendations not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No authoritative recommendation source is wired up yet.</div>
      </div>
    </Card>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────
// Phase B: the ACTIVITY mock (fabricated historical events with fake
// timestamps/orgs) is gone. sessionEvents are genuinely real — they're
// logged locally when the founder actually triggers an action this session
// (see addSessionEvent below) — so they're kept as-is, merged with nothing.
// A true persisted, cross-session activity/audit feed would need a real
// audit-log source; wiring one up is a new architecture (deferred, per the
// Phase B brief, to a later milestone) rather than something to build here.

function ActivityFeed({ sessionEvents }: { sessionEvents: SessionEvent[] }) {
  if (sessionEvents.length === 0) return (
    <Card style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Lbl s="Live activity" />
      </div>
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>No activity yet this session</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>Actions you take will appear here as they happen.</div>
      </div>
    </Card>
  );

  return (
    <Card style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.green, boxShadow: `0 0 5px ${T.green}`, display: 'inline-block' }} />
        <Lbl s="Live activity" />
        <span style={{ fontSize: 9, fontWeight: 700, color: T.green, background: T.greenA, padding: '1px 5px', borderRadius: 3, marginBottom: 7, letterSpacing: '0.05em' }}>
          {sessionEvents.length} this session
        </span>
      </div>
      {sessionEvents.map((a, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, padding: '4px 0',
          borderBottom: i < sessionEvents.length - 1 ? `1px solid ${T.borderB}` : 'none',
        }}>
          <Mono size={9} color={T.green}>{a.ts}</Mono>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: T.text, lineHeight: 1.4 }}>{a.event}</div>
            {a.client && <Mono size={9} color={FEED_C[a.type]}>{a.client}</Mono>}
          </div>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: FEED_C[a.type], flexShrink: 0, marginTop: 4 }} />
        </div>
      ))}
    </Card>
  );
}

// ─── System health ────────────────────────────────────────────────────────────
// Phase E.1: replaces the Phase B "Not connected" placeholder with real
// data from GET /api/founder/system. Deliberately narrow — application
// identity (Vercel runtime env vars), one live DB check, and BrainBase's
// own Gmail/Google Calendar/Instagram connection state. A Phase E.0 audit
// plus a read-only Production check found integrations/sync_jobs/
// agent_runs don't exist in Production and users.last_login_at is
// unpopulated — none of those are used here or anywhere in
// lib/founder/systemSignals.ts. Wording is deliberately literal:
// "Connected" never means "Healthy", a known commit is identity not a
// health claim, and database.ok reflects this one request's live check,
// never an uptime/SLA claim.

type FounderConnectionState = 'connected' | 'not_connected' | 'connected_issue' | 'unknown';
type FounderSystemData = {
  application: { environment: string; commitSha: string | null; commitShaShort: string | null; commitMessage: string | null };
  database: { ok: boolean; latencyMs: number | null };
  services: {
    gmail: { state: FounderConnectionState };
    googleCalendar: { state: FounderConnectionState };
    instagram: { state: FounderConnectionState };
  };
};
const SERVICE_STATE_LABEL: Record<FounderConnectionState, string> = {
  connected: 'Connected', not_connected: 'Not connected',
  connected_issue: 'Connection issue', unknown: 'Unknown',
};
const SERVICE_STATE_COLOR: Record<FounderConnectionState, string> = {
  connected: T.green, not_connected: T.dim, connected_issue: T.yellow, unknown: T.dim,
};

function SystemHealth() {
  const [data, setData] = useState<FounderSystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/founder/system')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: FounderSystemData) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="System status" />
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>Loading…</div>
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="System status" />
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}`, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
          <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>Could not load system status.</div>
        </div>
      </Card>
    );
  }

  const { application, database, services } = data;
  const dbLabel = database.ok ? 'Operational' : 'Unavailable';
  const dbColor = database.ok ? T.green : T.red;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="System status" />
        {/* minWidth: 0 on both grid items is the actual fix here — CSS grid
            items default to min-width: auto, so without it a long,
            unbroken commit message (no wrap points) forces this column to
            grow to its full intrinsic text width, which both overflows the
            card/page AND squeezes/pushes the Database column out of the
            visible area in the same row (confirmed live on the Vercel
            preview — the Database tile was never missing from the API
            response or un-rendered, just pushed off-screen by this). The
            commit message itself now wraps (overflowWrap/wordBreak) and is
            clamped to 2 lines instead of forcing a single unbroken line,
            so it tolerates an arbitrarily long message, including one with
            no spaces at all, without ever escaping this tile. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, minWidth: 0 }}>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Application</div>
            <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{application.environment}</div>
            {application.commitShaShort ? (
              <>
                <Mono size={10} color={T.sub}>{application.commitShaShort}</Mono>
                {application.commitMessage && (
                  <div style={{
                    fontSize: 10, color: T.dim, marginTop: 3,
                    overflowWrap: 'anywhere', wordBreak: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{application.commitMessage}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>Commit: Unknown</div>
            )}
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Database</div>
            <div style={{ fontSize: 12, color: dbColor, fontWeight: 600 }}>{dbLabel}</div>
            <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>
              {database.ok && database.latencyMs != null ? `${database.latencyMs} ms this request · live check` : 'Live check'}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="Service connections" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {([
            ['Gmail', services.gmail.state],
            ['Google Calendar', services.googleCalendar.state],
            ['Instagram', services.instagram.state],
          ] as const).map(([label, state]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.018)', border: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 11, color: T.sub }}>{label}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: SERVICE_STATE_COLOR[state] }}>{SERVICE_STATE_LABEL[state]}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: T.dim, marginTop: 8 }}>
          Gmail/Google Calendar show whether an OAuth connection is stored, not a live API check.
        </div>
      </Card>
    </div>
  );
}

// ─── Product usage ────────────────────────────────────────────────────────────
// Phase E.3: replaces the Phase B "Not connected" placeholder with real
// 30-day aggregates from GET /api/founder/usage. Pre-merge correction:
// a read-only Neon introspection query proved social_insights and
// saved_briefings do not exist in the real deployed database (their
// CREATE TABLE statements never succeeded there — see lib/founder/
// usageSignals.ts for the full explanation) — both were removed rather
// than shipped against tables that aren't really there, with no
// substitute metric added in their place. Scoped to the two sources
// confirmed to actually exist with a TEXT organisation_id: uploaded_files
// (excluding the known demo-seed.csv row and BrainBase's own org) and
// organiser_item_updates (never organiser_items — bulk CSV import has no
// distinguishing marker, and BrainBase's own org is excluded here too).
// Deliberately does NOT include active organisations/users, general AI
// usage, task completions, bookings, or any trend/percentage — those
// were classified AMBER/RED/out of scope in the Phase E.2 audit. Grid
// items carry minWidth: 0 (the Phase E.1 fix, applied here from the
// start rather than re-discovered).

type FounderUsageData = {
  windowDays: number;
  uploads: number;
  organiserUpdates: number;
};

function ProductUsage() {
  const [data, setData] = useState<FounderUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/founder/usage')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: FounderUsageData) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="Product usage" />
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>Loading…</div>
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card style={{ padding: '11px 12px' }}>
        <Lbl s="Product usage" />
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}`, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
          <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>Could not load product usage.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, minWidth: 0 }}>
        <Lbl s="Product usage" />
        <span style={{ fontSize: 9, color: T.dim, flexShrink: 0 }}>Last {data.windowDays} days</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 0 }}>
        {([
          ['Uploads', data.uploads],
          ['Organiser updates', data.organiserUpdates],
        ] as const).map(([label, value]) => (
          <div key={label} style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Context (demos + signals) ────────────────────────────────────────────────
// Phase B: DEMOS (fake upcoming sales demos) and SIGNALS (fake, staled-dated
// "AI/local-government news" items) were both fabricated with no
// authoritative source. Both panels now show a truthful not-connected state.

function LiveContext() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Card style={{ padding: '9px 11px' }}>
        <Lbl s="Upcoming demos" />
        <div style={{ padding: '10px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.dim }}>Not connected</div>
        </div>
      </Card>
      <Card style={{ padding: '9px 11px' }}>
        <Lbl s="Signals" />
        <div style={{ padding: '10px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.dim }}>Not connected</div>
        </div>
      </Card>
    </div>
  );
}

// ─── Client drawer ────────────────────────────────────────────────────────────

function ClientDrawer({ client, onClose, onAction, onModal, onAdvanceStage, drawerActivity }: {
  client: Client; onClose: () => void; onAction: (msg: string) => void;
  onModal: (m: 'book-demo' | 'proposal') => void;
  onAdvanceStage: (clientId: number, org: string, stage: Stage) => void;
  drawerActivity: Array<{ ts: string; event: string }>;
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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn small label="← Back"             onClick={onClose} />
              <Btn small label="Generate Briefing" onClick={() => { onClose(); router.push('/command'); }} />
              <Btn small label="Create Proposal"   onClick={() => { onClose(); onModal('proposal'); }} />
              {client.stage !== 'paid' && client.stage !== 'lost' && (
                <Btn small label="Advance →" color={T.green} onClick={() => onAdvanceStage(client.id, client.org, client.stage)} />
              )}
            </div>
          </div>

          {drawerActivity.length > 0 && (
            <div>
              <Lbl s="Session activity" c={T.green} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {drawerActivity.map((ev, i) => (
                  <div key={i} style={{
                    padding: '5px 8px 5px 10px', borderRadius: 5,
                    background: 'rgba(34,197,94,0.05)', border: `1px solid rgba(34,197,94,0.15)`,
                    borderLeft: `2px solid ${T.green}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
                  }}>
                    <span style={{ fontSize: 11, color: T.sub, flex: 1 }}>{ev.event}</span>
                    <Mono size={9} color={T.green}>now</Mono>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Linked Tenant panel ── */}
          {client.linked_organisation ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Lbl s="Linked tenant" c={T.cyan} />
                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(34,211,238,0.12)', color: T.cyan, border: '1px solid rgba(34,211,238,0.22)', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 6 }}>LINKED</span>
              </div>
              <div style={{ padding: '9px 11px', background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.15)', borderRadius: 7 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 2 }}>{client.linked_organisation.name}</div>
                <Mono size={10} color={T.dim}>{client.linked_organisation.slug}</Mono>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 7 }}>
                  {client.linked_organisation.status && (
                    <div style={{ padding: '4px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 8, color: T.dim, marginBottom: 1 }}>Status</div>
                      <div style={{ fontSize: 11, color: T.sub }}>{client.linked_organisation.status}</div>
                    </div>
                  )}
                  {client.linked_organisation.created_at && (
                    <div style={{ padding: '4px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 8, color: T.dim, marginBottom: 1 }}>Created</div>
                      <div style={{ fontSize: 11, color: T.sub }}>{new Date(client.linked_organisation.created_at).toLocaleDateString()}</div>
                    </div>
                  )}
                </div>
                {client.linked_primary_user && (
                  <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid rgba(255,255,255,0.05)` }}>
                    <div style={{ fontSize: 9, color: T.dim, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Primary contact</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{client.linked_primary_user.name}</div>
                    {client.linked_primary_user.email && <Mono size={10} color={T.dim}>{client.linked_primary_user.email}</Mono>}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Btn small label="Open Organisation Admin" color={T.cyan} onClick={() => router.push('/admin/orgs')} />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <Lbl s="Tenant link" />
              <div style={{ padding: '10px 11px', borderRadius: 7, border: `1px dashed ${T.border}`, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: T.dim, marginBottom: 6 }}>Not linked to a tenant organisation</div>
                <Btn small label="Link to existing org" color={T.cyan} onClick={() => router.push('/admin/orgs')} />
              </div>
            </div>
          )}

          <div>
            <Lbl s="Notes" />
            <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 10px' }}>
              {client.notes || <span style={{ color: T.dim, fontStyle: 'italic' }}>No notes</span>}
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

type NavItem = { label: string; section?: Section; href?: string; dim?: boolean };

function LeftSidebar({ onModal, section, setSection }: {
  onModal: (m: 'book-demo' | 'proposal' | 'add-lead') => void;
  section: Section;
  setSection: (s: Section) => void;
}) {
  const router = useRouter();

  const NAV: NavItem[] = [
    { label: 'Overview', section: 'overview' },
    { label: 'Clients',  section: 'clients'  },
    { label: 'Revenue',  section: 'revenue'  },
    { label: 'Tasks',    section: 'tasks'    },
    { label: 'System',     section: 'system'     },
    { label: 'Instagram',  section: 'instagram'  },
    // Organiser's canonical home (Phase D.2) — a real BrainBase capability
    // with its own top-level route, not nested under /command. Rendered at
    // normal (non-dim) weight like the in-app sections above: it's a
    // first-class destination, not a peripheral utility link. See
    // app/organiser/page.tsx's board deep-link support for the
    // board-specific version of this link inside the Tasks tab itself.
    { label: 'Organiser',  href: '/organiser' },
    { label: 'Product',    href: '/data', dim: true },
    { label: 'Admin',    href: '/admin', dim: true },
  ];

  const ACTS = [
    { icon: '＋', l: 'Add lead',       fn: () => onModal('add-lead')              },
    { icon: '◆',  l: 'Book demo',      fn: () => onModal('book-demo')             },
    { icon: '↗',  l: 'Gen proposal',   fn: () => onModal('proposal')              },
    { icon: '⊞',  l: 'Clients',        fn: () => setSection('clients')            },
    { icon: '▷',  l: 'Run analysis',   fn: () => router.push('/command')          },
    { icon: '↑',  l: 'Upload dataset', fn: () => router.push('/data')             },
  ];

  return (
    <div style={{ width: 148, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.s1, display: 'flex', flexDirection: 'column', padding: '13px 0', overflowY: 'auto' }}>
      <div style={{ padding: '0 10px', marginBottom: 16 }}>
        <Lbl s="Navigate" />
        {NAV.map(n => {
          const active = n.section ? n.section === section : false;
          return (
            <div
              key={n.label}
              onClick={() => n.section ? setSection(n.section) : n.href && router.push(n.href)}
              style={{
                padding: '5px 8px', borderRadius: 5, fontSize: 12, marginBottom: 1,
                cursor: 'pointer',
                fontWeight: active ? 600 : 400,
                color: active ? T.purple : n.dim ? T.dim : T.sub,
                background: active ? T.purpleA : 'transparent',
                borderLeft: active ? `2px solid ${T.purple}` : '2px solid transparent',
              }}
            >
              {n.label}
            </div>
          );
        })}
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
        {/* Phase B: "Open pipeline $19,600" / "Overdue actions 3" were
            fabricated with no backing source (and duplicated the same
            ambiguity as the removed ClientPipeline mock) — removed rather
            than wired to a misleading proxy. */}
        <div style={{ fontSize: 10, lineHeight: 1.7 }}>
          <div style={{ color: T.dim }}>{new Date().toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, isError }: { msg: string; isError?: boolean }) {
  const bc = isError ? 'rgba(239,68,68,0.22)' : T.purpleB;
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: T.s2, border: `1px solid ${bc}`, borderRadius: 8,
      padding: '9px 16px', zIndex: 300, fontSize: 12, color: isError ? T.sub : T.text,
      boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${bc}`,
      display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
    }}>
      <span style={{ color: isError ? T.red : T.green }}>{isError ? '⚠' : '✓'}</span>
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

// ─── Add Lead modal ───────────────────────────────────────────────────────────

const STAGE_OPTIONS: Stage[] = ['lead', 'contacted', 'demo', 'trial', 'proposal'];

function AddLeadModal({ onClose, onAdded, clients }: {
  onClose: () => void;
  onAdded: (msg: string) => void;
  clients: Client[];
}) {
  const [mode,       setMode]       = useState<'existing' | 'new'>('existing');
  const [orgFilter,  setOrgFilter]  = useState('');
  const [selId,      setSelId]      = useState<number | null>(null);
  const [org,        setOrg]        = useState('');
  const [contact,    setContact]    = useState('');
  const [email,      setEmail]      = useState('');
  const [stage,      setStage]      = useState<Stage>('lead');
  const [valStr,     setValStr]     = useState('');
  const [nextAction, setNextAction] = useState('');
  const [note,       setNote]       = useState('');
  const [loading,    setLoading]    = useState(false);

  // ── Tenant linking state ─────────────────────────────────────────────────
  type TenantOrg  = { id: string; name: string; slug: string };
  type TenantUser = { id: string; name: string; email: string; organisation_id: string };

  const [tenantOpen,     setTenantOpen]     = useState(false);
  const [tenantOrgs,     setTenantOrgs]     = useState<TenantOrg[]>([]);
  const [tenantUsers,    setTenantUsers]    = useState<TenantUser[]>([]);
  const [tenantOrgId,    setTenantOrgId]    = useState('');
  const [tenantContactId, setTenantContactId] = useState('');
  const [tenantFilter,   setTenantFilter]   = useState('');
  const [tenantLoading,  setTenantLoading]  = useState(false);

  const openTenantSection = () => {
    setTenantOpen(true);
    if (tenantOrgs.length > 0) return;
    setTenantLoading(true);
    Promise.all([
      fetch('/api/admin/orgs').then(r => r.ok ? r.json() : { orgs: [] }),
      fetch('/api/admin/users').then(r => r.ok ? r.json() : { users: [] }),
    ]).then(([orgsData, usersData]) => {
      setTenantOrgs((orgsData.orgs ?? []) as TenantOrg[]);
      setTenantUsers((usersData.users ?? []) as TenantUser[]);
    }).catch(() => {}).finally(() => setTenantLoading(false));
  };

  const filteredTenantOrgs = tenantOrgs.filter(o =>
    o.name.toLowerCase().includes(tenantFilter.toLowerCase())
  );
  const orgUsers = tenantOrgId ? tenantUsers.filter(u => u.organisation_id === tenantOrgId) : [];
  const linkedTenantOrg = tenantOrgs.find(o => o.id === tenantOrgId);

  const selectTenantOrg = (id: string) => {
    setTenantOrgId(id);
    setTenantContactId('');
    const o = tenantOrgs.find(x => x.id === id);
    if (o && !org.trim()) setOrg(o.name);
  };

  // ── Existing CRM client flow ──────────────────────────────────────────────
  const filtered = clients.filter(c =>
    c.org.toLowerCase().includes(orgFilter.toLowerCase())
  );

  const selectExisting = (id: number) => {
    setSelId(id);
    const c = clients.find(x => x.id === id);
    if (!c) return;
    setOrg(c.org);
    if (c.contact && c.contact !== '—') setContact(c.contact);
    if (c.email) setEmail(c.email);
    if (c.value) setValStr(String(c.value));
    setStage(c.stage === 'lost' ? 'lead' : c.stage);
    if (c.action && c.action !== '—') setNextAction(c.action);
    if (c.notes) setNote(c.notes);
  };

  const switchMode = (m: 'existing' | 'new') => {
    setMode(m);
    setSelId(null);
    setOrg(''); setContact(''); setEmail('');
    setStage('lead'); setValStr(''); setNextAction(''); setNote('');
  };

  const ready = !!org.trim() && (mode === 'new' || selId !== null);

  const submit = async () => {
    if (!ready || loading) return;
    setLoading(true);
    try {
      await fetch('/api/admin/founder-action/add-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org:                org.trim(),
          contact_name:       contact.trim() || undefined,
          email:              email.trim()   || undefined,
          stage,
          estimated_value:    valStr ? Number(valStr) : undefined,
          next_action:        nextAction.trim() || undefined,
          note:               note.trim()       || undefined,
          existing_client_id: selId ?? undefined,
          organisation_id:    tenantOrgId     || undefined,
          primary_contact_id: tenantContactId || undefined,
        }),
      });
      onAdded(`Lead added — ${org.trim()}`);
    } finally {
      setLoading(false);
    }
  };

  const modeBtn = (m: 'existing' | 'new', label: string) => (
    <button
      onClick={() => switchMode(m)}
      style={{
        flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600, borderRadius: 4,
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        background: mode === m ? T.purple : 'transparent',
        color:      mode === m ? '#fff'    : T.dim,
      }}
    >{label}</button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.55)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 420, maxHeight: '88vh', overflowY: 'auto', zIndex: 300, background: T.s2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 22px', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Add Lead</div>
            <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>Add a prospect to the pipeline</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.dim, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 2, padding: 3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 14 }}>
          {modeBtn('existing', 'Existing organisation')}
          {modeBtn('new',      'New organisation')}
        </div>

        {/* ── Existing org flow ── */}
        {mode === 'existing' && (
          <div style={{ marginBottom: 12 }}>
            <Lbl s="Search organisations" />
            <input
              value={orgFilter}
              onChange={e => { setOrgFilter(e.target.value); setSelId(null); setOrg(''); }}
              placeholder="Type to filter…"
              style={{ ...INPUT_S, marginBottom: 5 }}
            />
            {filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: T.dim, padding: '6px 8px' }}>No matches — switch to &ldquo;New organisation&rdquo;</div>
            ) : (
              <select
                size={Math.min(filtered.length, 5)}
                value={selId ?? ''}
                onChange={e => selectExisting(Number(e.target.value))}
                style={{ ...INPUT_S, height: 'auto', padding: 0 }}
              >
                {filtered.map(c => (
                  <option key={c.id} value={c.id} style={{ padding: '5px 8px' }}>
                    {c.org}{c.contact && c.contact !== '—' ? ` — ${c.contact}` : ''} [{c.stage.toUpperCase()}]
                  </option>
                ))}
              </select>
            )}
            {selId !== null && (
              <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 5, background: T.purpleA, border: `1px solid ${T.purpleB}`, fontSize: 10, color: T.purple }}>
                Lead will be added for <strong>{org}</strong>
              </div>
            )}
          </div>
        )}

        {/* ── Org name (new mode only) ── */}
        {mode === 'new' && (
          <div style={{ marginBottom: 10 }}>
            <Lbl s="Organisation name" />
            <input
              value={org}
              onChange={e => setOrg(e.target.value)}
              placeholder="e.g. City of Adelaide"
              style={INPUT_S}
            />
          </div>
        )}

        {/* Contact + Email */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <Lbl s="Contact name" />
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Full name" style={INPUT_S} />
          </div>
          <div>
            <Lbl s="Email (optional)" />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@council.sa.gov.au" style={INPUT_S} />
          </div>
        </div>

        {/* Stage + Value */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <Lbl s="Stage" />
            <select value={stage} onChange={e => setStage(e.target.value as Stage)} style={INPUT_S}>
              {STAGE_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <Lbl s="Est. value $/mo (optional)" />
            <input type="number" value={valStr} onChange={e => setValStr(e.target.value)} placeholder="e.g. 2400" style={INPUT_S} />
          </div>
        </div>

        {/* Next action */}
        <div style={{ marginBottom: 10 }}>
          <Lbl s="Next action (optional)" />
          <input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. Send intro email" style={INPUT_S} />
        </div>

        {/* Note */}
        <div style={{ marginBottom: 12 }}>
          <Lbl s="Note (optional)" />
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Context, source, key contacts…"
            rows={2}
            style={{ ...INPUT_S, resize: 'vertical' }}
          />
        </div>

        {/* ── Link existing tenant ── */}
        <div style={{ marginBottom: 16, borderRadius: 7, border: `1px solid ${tenantOrgId ? 'rgba(34,211,238,0.25)' : T.border}`, overflow: 'hidden' }}>
          <button
            onClick={() => tenantOpen ? setTenantOpen(false) : openTenantSection()}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', background: tenantOrgId ? 'rgba(34,211,238,0.06)' : 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tenantOrgId ? T.cyan : T.dim }}>Link existing tenant</span>
              {linkedTenantOrg && (
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(34,211,238,0.12)', color: T.cyan, border: '1px solid rgba(34,211,238,0.22)', fontWeight: 700 }}>
                  {linkedTenantOrg.name}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, color: T.dim }}>{tenantOpen ? '▲' : '▼'}</span>
          </button>

          {tenantOpen && (
            <div style={{ padding: '10px 11px', borderTop: `1px solid ${T.border}` }}>
              {tenantLoading ? (
                <div style={{ fontSize: 11, color: T.dim, padding: '4px 0' }}>Loading organisations…</div>
              ) : tenantOrgs.length === 0 ? (
                <div style={{ fontSize: 11, color: T.dim, padding: '4px 0' }}>No tenant organisations found.</div>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Lbl s="Find tenant organisation" />
                    <input
                      value={tenantFilter}
                      onChange={e => setTenantFilter(e.target.value)}
                      placeholder="Type to filter…"
                      style={{ ...INPUT_S, marginBottom: 5 }}
                    />
                    <select
                      value={tenantOrgId}
                      onChange={e => selectTenantOrg(e.target.value)}
                      style={INPUT_S}
                    >
                      <option value="">— No link —</option>
                      {filteredTenantOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>
                      ))}
                    </select>
                  </div>

                  {tenantOrgId && (
                    <div style={{ marginBottom: 0 }}>
                      <Lbl s="Primary contact (optional)" />
                      {orgUsers.length === 0 ? (
                        <div style={{ fontSize: 10, color: T.dim, padding: '3px 0' }}>No users in this organisation.</div>
                      ) : (
                        <select
                          value={tenantContactId}
                          onChange={e => setTenantContactId(e.target.value)}
                          style={INPUT_S}
                        >
                          <option value="">— Select contact —</option>
                          {orgUsers.map(u => (
                            <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={submit}
            disabled={!ready || loading}
            style={{ flex: 1, padding: '8px', borderRadius: 6, background: ready && !loading ? T.purple : 'rgba(139,92,246,0.3)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: ready && !loading ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
          >
            {loading ? 'Adding…' : 'Add Lead'}
          </button>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', border: `1px solid ${T.border}`, color: T.sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Book Demo modal ──────────────────────────────────────────────────────────

function BookDemoModal({ onClose, onBook, clients }: {
  onClose: () => void;
  onBook: (org: string, date: string, time?: string) => Promise<void>;
  clients: Client[];
}) {
  const [org,     setOrg]     = useState('');
  const [date,    setDate]    = useState('');
  const [time,    setTime]    = useState('');
  const [loading, setLoading] = useState(false);
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
            {clients.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
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
            onClick={async () => {
              if (!ready || loading) return;
              setLoading(true);
              await onBook(org, date, time || undefined);
              setLoading(false);
            }}
            style={{ flex: 1, padding: '8px', borderRadius: 6, background: ready && !loading ? T.purple : 'rgba(139,92,246,0.3)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: ready && !loading ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
          >
            {loading ? 'Logging…' : 'Confirm Demo'}
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

function ProposalModal({ preselect, onClose, onConfirm, clients }: { preselect?: Client | null; onClose: () => void; onConfirm: (msg: string) => void; clients: Client[] }) {
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
            {clients.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
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

// Phase B: every tile in the old KPI_TILES mock (fake MRR, Active clients,
// Active trials, Demos this week, Follow-ups due, Failed analyses) plus its
// fake delta/trend arrow is gone. Per the Phase B data-authority audit, only
// MRR has an authoritative Production source (managed_services.monthly_value,
// active subscriptions) — the other five have no real backing anywhere in
// the schema and are shown as "Not connected" rather than invented. No fake
// comparison text ("+18% vs April" etc.) is shown anywhere in this row.
function SnapshotHero({ metrics, loading }: { metrics: AttnMetrics | null; loading: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
      {SNAPSHOT_TILE_META.map(t => {
        const isReal = t.real && !loading && !!metrics;
        const value = t.real
          ? (loading ? '…' : metrics ? `$${Math.round(metrics.activeMrr).toLocaleString()}` : '—')
          : '—';
        const sub = t.real
          ? (loading ? 'loading' : metrics ? 'active managed services' : 'not connected')
          : 'not connected';
        return (
          <div key={t.label} style={{ background: T.s1, border: `1px solid ${T.border}`, borderTop: `2px solid ${isReal ? t.accent : T.borderB}`, borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.dim, marginBottom: 5 }}>{t.label}</div>
            <div style={{ fontFamily: T.mono, fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em', color: isReal ? T.text : T.dim, marginBottom: 3 }}>{value}</div>
            <div style={{ fontSize: 9, color: T.dim }}>{sub}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function FounderPage() {
  const [section,        setSection]        = useState<Section>('overview');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [toast,          setToast]          = useState<string | null>(null);
  const [toastError,     setToastError]     = useState<string | null>(null);
  const [modal,          setModal]          = useState<'book-demo' | 'proposal' | 'add-lead' | null>(null);

  // ─── Session-level action state ──────────────────────────────────────────
  const [clientOverrides, setClientOverrides] = useState<Record<number, ClientOverride>>({});
  const [sessionEvents,   setSessionEvents]   = useState<SessionEvent[]>([]);
  const [drawerActivity,  setDrawerActivity]  = useState<Record<number, Array<{ ts: string; event: string }>>>({});

  // ─── Clients — real data only (Phase B: no more silent fallback to the
  // PIPELINE mock; an unreachable/empty founder-clients backend now leaves
  // clients genuinely empty, and ClientPipeline shows an honest
  // "Not connected" state instead of fabricated accounts) ──────────────────
  const [clients,        setClients]        = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/founder-clients')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { clients?: FounderClientRaw[] }) => {
        if (Array.isArray(data?.clients) && data.clients.length > 0)
          setClients(data.clients.map(mapRawClient));
      })
      .catch(() => { /* leave empty — ClientPipeline shows Not connected */ })
      .finally(() => setClientsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Real operational snapshot metrics (Phase B) — same authoritative,
  // already-validated endpoint Phase A's Attention Queue uses
  // (GET /api/founder/attention-queue), fetched once here and shared via
  // props with SnapshotHero and RevenueIntel so those two panels don't each
  // duplicate the request. RealFounderOperations (Phase A) is untouched and
  // keeps its own independent fetch — this is purely additive. ───────────
  const [snapshotMetrics,        setSnapshotMetrics]        = useState<AttnMetrics | null>(null);
  const [snapshotMetricsLoading, setSnapshotMetricsLoading] = useState(true);
  // Founder OS Phase C — same shared fetch above already returns a real,
  // authoritative implementationNextActions list; captured here alongside
  // snapshotMetrics rather than as a 4th duplicate request.
  const [implementationNextActions, setImplementationNextActions] = useState<ImplementationNextAction[]>([]);

  useEffect(() => {
    fetch('/api/founder/attention-queue')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { metrics?: AttnMetrics; implementationNextActions?: ImplementationNextAction[] }) => {
        setSnapshotMetrics(d.metrics ?? null);
        setImplementationNextActions(Array.isArray(d.implementationNextActions) ? d.implementationNextActions : []);
      })
      .catch(() => setSnapshotMetrics(null))
      .finally(() => setSnapshotMetricsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase B hardening: the founder-intelligence fetch (intel/loadIntel/
  // refreshIntel state) was removed entirely — HlnaBriefing is now a
  // permanent, unconditional "not connected" shell that never reads from
  // this backend, so there is nothing left to fetch it for.

  // ─── Instagram OAuth result toast ────────────────────────────────────────
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('ig_connected')) { setToast('Instagram connected!'); window.history.replaceState({}, '', '/admin/founder'); }
    if (p.get('ig_error')) { setToastError(decodeURIComponent(p.get('ig_error')!)); window.history.replaceState({}, '', '/admin/founder'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Real ops alerts (tennis leads etc.) ────────────────────────────────
  type OpsAlert = { id: string; severity: string; title: string; description: string; rule_key: string | null; created_at: string };
  const [opsAlerts, setOpsAlerts] = useState<OpsAlert[]>([]);
  useEffect(() => {
    fetch('/api/ops/alerts')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { alerts?: OpsAlert[] }) => { if (Array.isArray(d?.alerts)) setOpsAlerts(d.alerts.filter(a => (a as { status?: string }).status === 'OPEN' || !(a as { status?: string }).status)); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase B hardening: refreshFounderState() was removed — its only purpose
  // was merging "founder_activity_events" fetched from the external,
  // unverified /api/admin/founder-state backend into sessionEvents. Live
  // Activity may only ever contain genuine events generated locally by real
  // user actions (see addSessionEvent below) — never anything sourced from
  // that backend. Locally-generated sessionEvents are untouched.

  // ─── Derive Clients-tab mini-queue items — real ops alerts only (Phase B:
  // both the QUEUE mock and the intel.attention_queue fallback from the
  // legacy, unverified external founder-intelligence backend are gone; this
  // is a different, separate queue from Phase A's protected
  // RealFounderOperations, which is untouched) ──────────────────────────────
  const queueItems: QueueItem[] = opsAlerts.map((a, i) => ({
    id:       9000 + i,
    severity: toSeverity(a.severity),
    type:     'sales' as FeedType,
    title:    a.title,
    why:      a.description,
    action:   'Review lead in dashboard',
    due:      'Now',
    cta:      'View Lead',
  }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 3500);
  };

  // ─── Session event logger ────────────────────────────────────────────────
  const now = () => {
    const d = new Date();
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const addSessionEvent = (event: string, type: FeedType, client: string | null, clientId?: number) => {
    const ts = now();
    setSessionEvents(prev => [{ ts, event, type, client }, ...prev]);
    if (clientId !== undefined) {
      setDrawerActivity(prev => ({
        ...prev,
        [clientId]: [{ ts, event }, ...(prev[clientId] ?? [])],
      }));
    }
  };

  const flashRow = (id: number) => {
    setClientOverrides(prev => ({ ...prev, [id]: { ...prev[id], highlighted: true } }));
    setTimeout(() => setClientOverrides(prev => ({ ...prev, [id]: { ...prev[id], highlighted: false } })), 2200);
  };

  // ─── Backend action handlers ─────────────────────────────────────────────

  const doFollowUp = async (clientId: number | string | undefined, org: string) => {
    const id = typeof clientId === 'number' ? clientId : clientId != null ? Number(clientId) : undefined;
    // Optimistic: mark row immediately
    if (id != null) {
      setClientOverrides(prev => ({
        ...prev,
        [id]: { ...prev[id], daysAgo: 0, action: 'Follow-up sent', followedUp: true, highlighted: true },
      }));
      setTimeout(() => setClientOverrides(prev => ({ ...prev, [id]: { ...prev[id], highlighted: false } })), 2200);
    }
    try {
      const res = await fetch('/api/admin/founder-action/follow-up-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, org }),
      });
      if (!res.ok) throw new Error(String(res.status));
      addSessionEvent(`Follow-up logged — ${org}`, 'sales', org, id);
      showToast(`Follow-up logged — ${org}`);
    } catch {
      // Revert optimistic changes on error
      if (id != null) {
        setClientOverrides(prev => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      }
      showError(`Could not log follow-up for ${org}`);
    }
  };

  const doAdvanceStage = async (clientId: number | string, org: string, currentStage: Stage) => {
    const STAGE_ORDER: Stage[] = ['lead', 'contacted', 'demo', 'trial', 'proposal', 'paid'];
    const idx = STAGE_ORDER.indexOf(currentStage);
    const nextStage = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
    if (!nextStage) { showError(`${org} is already at the final stage`); return; }
    const id = typeof clientId === 'number' ? clientId : Number(clientId);
    try {
      const res = await fetch('/api/admin/founder-action/advance-client-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, org, stage: nextStage }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setClientOverrides(prev => ({
        ...prev,
        [id]: { ...prev[id], stage: nextStage, action: `Stage → ${nextStage}` },
      }));
      flashRow(id);
      addSessionEvent(`Stage advanced → ${nextStage}`, 'sales', org, id);
      showToast(`${org} → ${nextStage}`);
      setSelectedClient(null);
    } catch {
      showError(`Could not advance stage for ${org}`);
    }
  };

  const doLogDemo = async (clientId: number | string | undefined, org: string, date: string, time?: string) => {
    const id = clientId != null ? (typeof clientId === 'number' ? clientId : Number(clientId)) : undefined;
    try {
      const res = await fetch('/api/admin/founder-action/log-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, org, date, time }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const label = `Demo logged — ${org} · ${date}${time ? ' at ' + time : ''}`;
      addSessionEvent(label, 'sales', org, id);
      if (id != null) flashRow(id);
      showToast(label);
    } catch {
      showError(`Could not log demo for ${org}`);
    }
  };

  const doMarkReviewed = async (analysisId: string | undefined, org: string, clientId?: number) => {
    try {
      const res = await fetch('/api/admin/founder-action/mark-analysis-reviewed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_id: analysisId, org }),
      });
      if (!res.ok) throw new Error(String(res.status));
      addSessionEvent(`Analysis marked reviewed — ${org}`, 'product', org, clientId);
      if (clientId != null) flashRow(clientId);
      showToast(`Analysis marked reviewed — ${org}`);
    } catch {
      showError(`Could not mark analysis reviewed for ${org}`);
    }
  };

  return (
    <div style={{ margin: '-40px', height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: 'var(--font-inter), Inter, -apple-system, sans-serif', fontSize: 12, overflow: 'hidden' }}>

      {/* Status bar — Phase B: the fake "Demo status" dot (always green,
          backed by no real check) and the hardcoded "MRR $12,480 (demo)"
          figure are gone. The date is now real (was a hardcoded, long-stale
          "Thu 8 May 2026"). MRR here is the same real, already-fetched
          value used by SnapshotHero/RevenueIntel — no duplicate request. */}
      <div style={{ height: 36, flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.s1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: T.text }}>BRAINBASE</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: T.purple, background: T.purpleA, border: `1px solid ${T.purpleB}`, padding: '2px 7px', borderRadius: 3 }}>FOUNDER OS</span>
          <span style={{ fontSize: 10, color: T.dim }}>{new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 10 }}>
          <Mono size={10} color={T.sub}>
            MRR {snapshotMetricsLoading ? '…' : snapshotMetrics ? `$${Math.round(snapshotMetrics.activeMrr).toLocaleString()}` : 'not connected'}
          </Mono>
          <span style={{ color: T.dim }}>|</span>
          <a href="/admin" style={{ color: T.dim, textDecoration: 'none', fontSize: 10 }}>← Admin</a>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <LeftSidebar onModal={setModal} section={section} setSection={setSection} />

        {/* Center column */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '11px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Phase B hardening: the conditional "demo backend unreachable"
              banner is gone — it only ever existed to explain HlnaBriefing's
              demo state, and that panel is now unconditionally
              "Intelligence briefing not connected" regardless of backend
              reachability, so a conditional banner would be redundant (and
              inconsistent: it would go silent exactly when the backend
              WAS reachable, while the panel still said not-connected). */}

          <SectionTabs section={section} setSection={setSection} />

          {/* ── Overview ── */}
          {section === 'overview' && <>
            <SnapshotHero metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
            <RealFounderOperations />
            <ImplementationSummary metrics={snapshotMetrics} loading={snapshotMetricsLoading} nextActions={implementationNextActions} />
            <HlnaBriefing />
            <ClientPipeline onSelect={setSelectedClient} onFollowUp={doFollowUp} overrides={clientOverrides} clients={clients} loading={clientsLoading} />
            <RevenueIntel metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
            <FounderTaskSummary />
          </>}

          {/* ── Clients ── */}
          {section === 'clients' && <>
            <ImplementationsByClient />
            <AttentionQueue
              items={queueItems.filter(q => q.type === 'sales' || q.type === 'client')}
              onAction={showToast} onFollowUp={doFollowUp} onMarkReviewed={doMarkReviewed}
            />
            <ClientPipeline onSelect={setSelectedClient} onFollowUp={doFollowUp} overrides={clientOverrides} clients={clients} loading={clientsLoading} />
          </>}

          {/* ── Revenue ── */}
          {section === 'revenue' && <>
            <SnapshotHero metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
            <RevenueIntel metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
          </>}

          {/* ── Tasks ── */}
          {section === 'tasks' && <>
            <FounderTasksPanel />
          </>}

          {/* ── System ── */}
          {section === 'system' && <>
            <SystemHealth />
            <ProductUsage />
            <LiveContext />
          </>}

          {/* ── Instagram ── */}
          {section === 'instagram' && (
            <InstagramFeedPanel />
          )}
        </div>

        {/* Right column — persistent context panel */}
        <div style={{ width: 252, flexShrink: 0, borderLeft: `1px solid ${T.border}`, background: T.s1, overflowY: 'auto', padding: '11px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AiRecommendations />
          <ActivityFeed sessionEvents={sessionEvents} />
          {section !== 'system' && <>
            <SystemHealth />
            <ProductUsage />
            <LiveContext />
          </>}
        </div>
      </div>

      {/* Client drawer */}
      {selectedClient && (
        <ClientDrawer client={selectedClient} onClose={() => setSelectedClient(null)} onAction={showToast} onModal={m => { setSelectedClient(null); setModal(m); }} onAdvanceStage={doAdvanceStage} drawerActivity={drawerActivity[selectedClient.id] ?? []} />
      )}

      {/* Modals */}
      {modal === 'add-lead' && (
        <AddLeadModal
          onClose={() => setModal(null)}
          clients={clients}
          onAdded={msg => { setModal(null); showToast(msg); }}
        />
      )}
      {modal === 'book-demo' && (
        <BookDemoModal
          onClose={() => setModal(null)}
          onBook={async (org, date, time) => { await doLogDemo(undefined, org, date, time); setModal(null); }}
          clients={clients}
        />
      )}
      {modal === 'proposal' && (
        <ProposalModal
          preselect={selectedClient}
          onClose={() => setModal(null)}
          onConfirm={msg => { setModal(null); showToast(msg); }}
          clients={clients}
        />
      )}

      {/* Toast */}
      {toast      && <Toast msg={toast} />}
      {toastError && <Toast msg={toastError} isError />}
    </div>
  );
}
