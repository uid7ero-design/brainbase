'use client';

import { useState, useEffect } from 'react';
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

type FounderIntel = {
  summary?: string;
  opportunities?: string[];
  risks?: string[];
  recommended_actions?: Array<{ impact?: string; urgency?: string; effort?: string; action: string; detail?: string }>;
  attention_queue?: Array<{ id?: number; severity?: string; type?: string; title: string; why?: string; action?: string; due?: string; cta?: string; client_id?: number | string; analysis_id?: string }>;
  system_alerts?: string[];
  confidence?: number;
  generated_at?: string;
  // 'demo' when the intelligence backend was unreachable/unconfigured and
  // the API returned its sample payload instead — see
  // app/api/admin/founder-intelligence/route.ts. Absent/'live' otherwise.
  source?: 'live' | 'demo';
};

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
// authority map). ClientPipeline, FounderTasks, RevenueIntel, SystemHealth,
// ProductUsage, LiveContext, AiRecommendations, and ActivityFeed now render
// an honest "Not connected" state in their place, or (ClientPipeline) an
// empty state driven by the existing real founder-clients fetch.

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

type AttnItemType = 'alert' | 'client_request' | 'web_lead' | 'upcoming_launch' | 'overdue_deployment';
type AttnItem = {
  id: string; type: AttnItemType; severity: Severity; title: string; description: string;
  organisationId: string | null; organisationName: string | null; createdAt: string | null;
  href: string; metadata: Record<string, unknown>;
};
type AttnMetrics = {
  leadsByStage: Record<string, number>;
  openAlerts: number; openRequests: number; onboardingInProgress: number;
  activeManagedServices: number; activeMrr: number;
};

const ATTN_TYPE_LABEL: Record<AttnItemType, string> = {
  alert:              'Alert',
  client_request:     'Client Request',
  web_lead:           'Web Lead',
  upcoming_launch:    'Upcoming Launch',
  overdue_deployment: 'Overdue Deployment',
};
const ATTN_TYPE_COLOR: Record<AttnItemType, string> = {
  alert:              T.red,
  client_request:     T.cyan,
  web_lead:           T.green,
  upcoming_launch:    '#60A5FA',
  overdue_deployment: '#F97316',
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

// Phase B: MOCK_QUADS (fake council-specific opportunity/risk/action text,
// reusing the same fictional Port Adelaide/Campbelltown narrative as the
// other removed mocks) is gone. The fake "HIGH URGENCY" badge and the fake
// 2.4s "regenerating" animation (which never actually re-fetched anything)
// are also gone — the Regenerate button now calls the real onRegenerate
// (refreshIntel), and loading state reflects the real fetch. When the
// external founder-intelligence backend is unreachable or returns its own
// demo payload, this panel now honestly says so instead of silently
// substituting fabricated content.
function HlnaBriefing({ intel, loading, hasError, onRegenerate }: {
  intel: FounderIntel | null; loading: boolean; hasError: boolean; onRegenerate: () => void;
}) {
  const isLive = !loading && !hasError && !!intel && intel.source !== 'demo';

  const quads = isLive ? [
    { k: '↗ Opportunity',        c: '#22C55E', text: intel!.opportunities?.slice(0, 2).join(' ') || 'No opportunities reported.' },
    { k: '⚠ Risk',               c: '#F59E0B', text: intel!.risks?.slice(0, 2).join(' ') || 'No risks reported.' },
    { k: "◎ Today's focus",      c: '#8B5CF6', text: intel!.summary || 'No summary available.' },
    { k: '→ Recommended action', c: '#22D3EE', text: intel!.recommended_actions?.[0]?.action || 'No recommended action.' },
  ] : [];

  const conf = intel?.confidence != null
    ? (intel.confidence > 1 ? Math.round(intel.confidence) : Math.round(intel.confidence * 100))
    : null;

  const displayTs = intel?.generated_at
    ? (() => { const d = new Date(intel.generated_at!); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} today`; })()
    : null;

  return (
    <Card accent={isLive ? T.purple : T.borderB} style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: loading ? T.yellow : isLive ? T.green : T.dim, boxShadow: isLive ? `0 0 6px ${T.green}` : undefined, display: 'inline-block' }} />
          <Lbl s="HLNΛ Chief of Staff" c={T.text} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive && <Mono size={9} color={T.dim}>{displayTs ? `Generated ${displayTs}` : 'Generated'}{conf != null ? ` · ${conf}% confidence` : ''}</Mono>}
          <Btn small label={loading ? '⟳ Checking…' : '↺ Refresh'} onClick={onRegenerate} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '18px 4px' }}>
          <div style={{ fontSize: 11, color: T.dim, marginBottom: 10 }}>Checking founder-intelligence backend…</div>
          <div style={{ height: 2, background: T.borderB, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: T.purple, borderRadius: 2, width: '45%', opacity: 0.7 }} />
          </div>
        </div>
      ) : isLive ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {quads.map(q => (
            <div key={q.k} style={{ padding: '9px 11px', borderRadius: 6, background: 'rgba(255,255,255,0.016)', border: `1px solid rgba(255,255,255,0.05)`, borderLeft: `2px solid ${q.c}` }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: q.c, marginBottom: 4 }}>{q.k}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(238,238,240,0.75)', lineHeight: 1.58 }}>{q.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
          <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>The founder-intelligence backend is unreachable — no briefing is available.</div>
        </div>
      )}
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

// ─── Founder tasks ────────────────────────────────────────────────────────────
// Phase B: no authoritative task/follow-up table exists anywhere in the
// schema (client-side "done" toggling on the old TASKS mock was never
// persisted). Shown as not-connected rather than removed, so the shell
// stays available for a future Client Implementations-style task system.

function FounderTasks() {
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl s="Founder tasks" />
      </div>
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No authoritative task/follow-up source exists yet.</div>
      </div>
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
// Phase B: SERVICES was a hardcoded, fabricated list (fake per-service "ok"/
// "warn" status and fake latency numbers — no live health check ever ran).
// No live service-health-check integration exists, so this is honestly
// "Not connected" rather than a fake all-green dashboard.

function SystemHealth() {
  return (
    <Card style={{ padding: '11px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Lbl s="System health" />
      </div>
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No live service health checks are implemented yet.</div>
      </div>
    </Card>
  );
}

// ─── Product usage ────────────────────────────────────────────────────────────
// Phase B: USAGE was fully fabricated (no persisted upload/analysis/API-call
// counters were found within this task's scope). Not connected rather than
// invented — see the Phase B report's KPI authority map for what was
// checked.

function ProductUsage() {
  return (
    <Card style={{ padding: '11px 12px' }}>
      <Lbl s="Product usage" />
      <div style={{ padding: '14px', textAlign: 'center', borderRadius: 6, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 11, color: T.dim }}>Not connected</div>
        <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>No authoritative usage-tracking source was found for this panel.</div>
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

type NavItem = { label: string; section?: Section; href?: string };

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
    { label: 'Product',    href: '/data'          },
    { label: 'Admin',    href: '/admin'      },
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
                color: active ? T.purple : n.href ? T.dim : T.sub,
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

  useEffect(() => {
    fetch('/api/founder/attention-queue')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { metrics?: AttnMetrics }) => setSnapshotMetrics(d.metrics ?? null))
      .catch(() => setSnapshotMetrics(null))
      .finally(() => setSnapshotMetricsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Founder intelligence ────────────────────────────────────────────────
  const [intel,        setIntel]        = useState<FounderIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const [intelError,   setIntelError]   = useState(false);

  const loadIntel = () => {
    fetch('/api/admin/founder-intelligence')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: FounderIntel) => { setIntel(data); setIntelLoading(false); setIntelError(false); })
      .catch(() => { setIntelError(true); setIntelLoading(false); });
  };

  useEffect(() => { loadIntel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshIntel = () => { setIntelLoading(true); loadIntel(); };

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

  // Tries founder-state for activity events; silently skips if not available
  const refreshFounderState = async () => {
    try {
      const res = await fetch('/api/admin/founder-state', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const data = await res.json() as { founder_activity_events?: SessionEvent[] };
      if (Array.isArray(data?.founder_activity_events) && data.founder_activity_events.length > 0) {
        setSessionEvents(prev => {
          const seen = new Set(prev.map(e => `${e.ts}|${e.event}`));
          const fresh = data.founder_activity_events!.filter(e => !seen.has(`${e.ts}|${e.event}`));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
      }
    } catch { /* founder-state not available */ }
  };

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
      refreshIntel();
      refreshFounderState();
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
      refreshIntel();
      refreshFounderState();
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
      refreshIntel();
      refreshFounderState();
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
      refreshIntel();
      refreshFounderState();
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

          {/* Phase B: this banner used to claim "KPIs and recommendations
              below are sample content" whenever the external intelligence
              backend was unreachable — but KPIs are now real-or-honestly-
              unavailable regardless of that backend's state, and
              Recommendations no longer shows demo content at all (just a
              plain Not-connected panel). The only thing that's still
              genuinely demo-shaped when this backend is down is the HLNΛ
              Chief of Staff briefing panel itself, which now shows its own
              local "Not connected" state — so this banner is scoped to
              describe only that one panel, not the page. */}
          {(intelError || intel?.source === 'demo') && (
            <div style={{ padding: '6px 11px', borderRadius: 5, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: T.yellow }}>⚠</span>
              <span style={{ fontSize: 10, color: 'rgba(245,158,11,0.75)' }}>
                Founder-intelligence backend unreachable — the HLNΛ Chief of Staff briefing below is not connected. Everything else on this page is real, local data.
              </span>
            </div>
          )}

          <SectionTabs section={section} setSection={setSection} />

          {/* ── Overview ── */}
          {section === 'overview' && <>
            <SnapshotHero metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
            <RealFounderOperations />
            <HlnaBriefing intel={intel} loading={intelLoading} hasError={intelError} onRegenerate={refreshIntel} />
            <ClientPipeline onSelect={setSelectedClient} onFollowUp={doFollowUp} overrides={clientOverrides} clients={clients} loading={clientsLoading} />
            <RevenueIntel metrics={snapshotMetrics} loading={snapshotMetricsLoading} />
            <FounderTasks />
          </>}

          {/* ── Clients ── */}
          {section === 'clients' && <>
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
            <FounderTasks />
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
          onAdded={msg => { setModal(null); showToast(msg); refreshFounderState(); }}
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
