'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import InstagramFeedPanel from '@/components/instagram/InstagramFeedPanel';
import { formatEventTime } from '@/lib/founder/formatEventTime';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import {
  Button,
  Dialog,
  Field,
  FormActions,
  FormError,
  Metric,
  MetricStrip,
  SlidePanel,
  fieldControlClassName,
  moduleNavItemProps,
  type ButtonVariant,
} from '@/components/ui/app';
import styles from '@/components/founder/FounderOs.module.css';

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
const SNAPSHOT_TILE_META: Array<{ label: string; real: boolean }> = [
  { label: 'MRR',             real: true  },
  { label: 'Active clients',  real: false },
  { label: 'Active trials',   real: false },
  { label: 'Demos this week', real: false },
  { label: 'Follow-ups due',  real: false },
  { label: 'Failed analyses', real: false },
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
// Visual convergence (authenticated visual-completion pass): T used to be a
// private, dark-only palette. Every entry now resolves to an app theme
// token (app/globals.css), so Founder OS follows light and dark like the
// rest of the authenticated app. Structural styling lives in
// components/founder/FounderOs.module.css; T is kept for the small inline
// bits (state-dependent colours) so call sites stay readable.

const T = {
  bg:       'var(--bg-base)',
  s1:       'var(--bg-surface)',
  s2:       'var(--bg-sunken)',
  border:   'var(--border)',
  borderB:  'var(--border-light)',
  purple:   'var(--brand-brainbase-accent)',
  purpleA:  'var(--brand-brainbase-accent-muted)',
  purpleB:  'var(--brand-brainbase-accent-border)',
  text:     'var(--text-primary)',
  sub:      'var(--text-secondary)',
  dim:      'var(--text-muted)',
  green:    'var(--status-success)',
  greenA:   'var(--status-success-muted)',
  yellow:   'var(--status-warning)',
  yellowA:  'var(--status-warning-muted)',
  red:      'var(--status-danger)',
  redA:     'var(--status-danger-muted)',
  cyan:     'var(--status-info)',
  cyanA:    'var(--status-info-muted)',
  inactive: 'var(--status-inactive)',
  mono:     'var(--bb-font-mono)',
} as const;

// "High" (and overdue / urgent) is semantic danger red, like critical;
// medium is amber, low is neutral. Purple is never a severity. Critical and
// high stay distinguishable because the severity is always written as text.
const HIGH = 'var(--status-danger)';

/** Theme-safe translucent tint of a token or data hue. */
function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

const SEV_COLOR: Record<Severity, string> = { critical: T.red, high: HIGH, medium: T.yellow, low: T.inactive };
const FEED_C:    Record<FeedType, string> = { sales: T.green, product: T.sub, system: T.yellow, client: T.cyan };
// CRM pipeline stage hues — a genuine data encoding (mirrored in
// app/admin/orgs/AdminClient.tsx), not chrome. Used on the stage dot, the
// funnel bars and a light tint only; stage label text stays in
// --text-primary so it reads in both themes.
const STAGE_FG:  Record<Stage, string>   = { lead: '#94A3B8', contacted: '#60A5FA', demo: '#A78BFA', trial: '#FCD34D', proposal: '#FDE68A', paid: '#4ADE80', lost: '#F87171' };
// PRIO_C (task-priority color map) removed with FounderTasks' fake TASKS —
// no longer referenced anywhere.

// ─── Atoms ────────────────────────────────────────────────────────────────────

/** Panel / section heading. Typography, not colour. */
function Lbl({ s, strong, as: Tag = 'h2', spaced }: { s: string; strong?: boolean; as?: 'h2' | 'h3' | 'div'; spaced?: boolean }) {
  const cls = [styles.label, strong ? styles.labelStrong : '', spaced ? styles.labelSpaced : ''].join(' ').trim();
  return <Tag className={cls}>{s}</Tag>;
}

function Card({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? `${styles.card} ${styles.cardCompact}` : styles.card}>
      {children}
    </div>
  );
}

/** Honest empty / not-connected state. */
function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      {text && <div className={styles.emptyText}>{text}</div>}
    </div>
  );
}

// Dot (status indicator) removed with the fake "Demo status" bar and
// SERVICES list — no longer referenced anywhere.

function StagePill({ s }: { s: Stage }) {
  const hue = STAGE_FG[s];
  return (
    <span className={styles.stagePill} style={{ background: tint(hue, 14), borderColor: tint(hue, 45) }}>
      <span className={styles.dot} style={{ background: hue }} aria-hidden="true" />
      {s.toUpperCase()}
    </span>
  );
}

/** Secondary metadata (times, counts, money): app sans, tabular figures. */
function Meta({ children, size, color }: { children: React.ReactNode; size?: number; color?: string }) {
  return <span className={styles.num} style={{ fontSize: size ?? 11, color: color ?? T.sub }}>{children}</span>;
}

/** Machine values only — commit hashes, slugs, identifiers. */
function Code({ children, size, color }: { children: React.ReactNode; size?: number; color?: string }) {
  return <span className={styles.code} style={{ fontSize: size ?? 11, color: color ?? T.sub }}>{children}</span>;
}

function Chip({ children, color, title }: { children: React.ReactNode; color: string; title?: string }) {
  return (
    <span className={styles.chip} title={title} style={{ color, background: tint(color, 12), borderColor: tint(color, 30) }}>
      {children}
    </span>
  );
}

function Btn({ label, onClick, variant = 'secondary', small, ariaLabel }: { label: string; onClick: () => void; variant?: ButtonVariant; small?: boolean; ariaLabel?: string }) {
  return (
    <Button variant={variant} size={small ? 'sm' : 'md'} onClick={onClick} aria-label={ariaLabel} style={{ flexShrink: 0 }}>
      {label}
    </Button>
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
  const summary = stages.map(s => `${s} ${counts[s] ?? 0}`).join(', ');
  return (
    <div className={styles.funnel} role="img" aria-label={`Accounts by stage: ${summary}`}>
      {stages.map(s => {
        const n = counts[s] ?? 0;
        return (
          <div key={s} className={styles.funnelStep}>
            <div className={styles.funnelBar} style={{ height: Math.max(n === 0 ? 2 : (n/mx)*20, 2), background: n === 0 ? T.borderB : tint(STAGE_FG[s], 35), borderColor: n === 0 ? 'transparent' : STAGE_FG[s] }} />
            <span className={styles.funnelLabel}>{s.slice(0,3).toUpperCase()}</span>
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
    <div className={styles.tabs} role="group" aria-label="Founder OS view">
      {SECTION_TABS.map(t => (
        <button
          key={t.id}
          type="button"
          className={styles.tab}
          aria-pressed={section === t.id}
          onClick={() => setSection(t.id)}
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
    <Card>
      <div className={styles.cardHeaderGroup}>
        <Lbl s="Attention queue" />
        <span style={{ fontSize: 11, color: T.green }}>✓ All clear</span>
      </div>
    </Card>
  );

  const critical = visible.filter(q => q.severity === 'critical').length;

  return (
    <Card>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderGroup}>
          <span className={styles.dot} style={{ background: critical > 0 ? T.red : T.yellow }} aria-hidden="true" />
          <Lbl s="Attention queue" strong />
          <Chip color={T.red}>
            {visible.length} item{visible.length !== 1 ? 's' : ''} need action
          </Chip>
        </div>
      </div>

      <div className={styles.stack}>
        {visible.map(q => {
          const done = actioned.has(q.id);
          const sc   = SEV_COLOR[q.severity];
          return (
            <div key={q.id} className={styles.queueItem} style={{ borderLeftColor: sc, background: done ? T.greenA : undefined }}>
              <div className={styles.queueHead}>
                <Chip color={sc}>{q.severity}</Chip>
                <Chip color={FEED_C[q.type]}>{q.type}</Chip>
                <span className={styles.queueTitle} style={{ color: done ? T.sub : T.text }}>{q.title}</span>
                {q.due && <Meta size={11} color={T.dim}>{q.due}</Meta>}
                {done ? (
                  <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>✓ Done</span>
                ) : (
                  <Btn small label={`→ ${q.cta}`} variant={q.severity === 'critical' ? 'danger' : 'secondary'} onClick={() => {
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
                <button type="button" className={styles.iconButton} aria-label={`Dismiss ${q.title}`} onClick={() => setDismissed(p => new Set([...p, q.id]))}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              {q.why && (
                <div className={styles.queueWhy}>{q.why}</div>
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
  upcoming_launch:    T.cyan,
  overdue_deployment: HIGH,
  implementation_blocked:         T.red,
  implementation_at_risk:         T.yellow,
  implementation_overdue_launch:  HIGH,
  implementation_upcoming_launch: T.cyan,
};

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
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
      <Card>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderGroup}>
            <span className={styles.dot} style={{ background: critical ? T.red : T.green }} aria-hidden="true" />
            <Lbl s="Attention queue" strong />
            {!loading && !loadError && (
              <Chip color={items.length ? T.red : T.green}>
                {items.length ? `${items.length} item${items.length !== 1 ? 's' : ''} need action` : '✓ All clear'}
              </Chip>
            )}
          </div>
        </div>

        {loading && <div className={styles.stateText}>Loading…</div>}
        {!loading && loadError && (
          <div className={styles.errorText}>Couldn&apos;t load the attention queue.</div>
        )}

        <div className={styles.stack}>
          {items.map(item => {
            const sc = SEV_COLOR[item.severity];
            const tc = ATTN_TYPE_COLOR[item.type];
            return (
              <a key={item.id} href={item.href} className={styles.queueItem} style={{ borderLeftColor: sc }}>
                <div className={styles.queueHead}>
                  <Chip color={sc}>{item.severity}</Chip>
                  <Chip color={tc}>{ATTN_TYPE_LABEL[item.type]}</Chip>
                  {item.organisationName && <Meta size={11} color={T.dim}>{item.organisationName}</Meta>}
                  <span className={styles.queueTitle}>{item.title}</span>
                  {item.createdAt && <Meta size={11} color={T.dim}>{timeAgo(item.createdAt)}</Meta>}
                </div>
                {item.description && (
                  <div className={styles.queueWhy}>{item.description}</div>
                )}
              </a>
            );
          })}
        </div>
      </Card>

      <Card>
        <Lbl s="Real operational snapshot" spaced />
        {(loading || !metrics) ? (
          <div className={styles.stateText}>{loadError ? 'Unavailable.' : 'Loading…'}</div>
        ) : (
          <MetricStrip>
            <Metric label="Active MRR"               value={`$${Math.round(metrics.activeMrr).toLocaleString()}`} />
            <Metric label="Active managed services"  value={String(metrics.activeManagedServices)} />
            <Metric label="In implementation"        value={String(metrics.onboardingInProgress)} />
            <Metric label="Open requests"            value={String(metrics.openRequests)} />
            <Metric label="Open alerts"              value={String(metrics.openAlerts)} />
            <Metric label="New Web Systems leads"    value={String(metrics.leadsByStage['new'] ?? 0)} />
          </MetricStrip>
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
    <Card>
      <div className={styles.cardHeaderGroup} style={{ marginBottom: 10 }}>
        <span className={styles.dot} style={{ background: T.inactive }} aria-hidden="true" />
        <Lbl s="HLNΛ Chief of Staff" strong />
      </div>
      <Empty title="Intelligence briefing not connected" text="No authoritative briefing source is wired up yet." />
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
//
// Visual convergence: each row's organisation name is now a real <button>
// (onSelect, same handler the clickable row <div> had) whose ::after
// stretches over the row, so a pointer click anywhere on the row still
// opens the client and the keyboard can reach it. The row's "Follow up"
// action used to be a Btn with a no-op onClick nested in a <div> whose own
// onClick did the work (plus a stopPropagation wrapper) — the button now
// calls onFollowUp directly, which is the same effect for pointer and
// keyboard users (the click used to bubble to that wrapper).

function ClientPipeline({ onSelect, onFollowUp, overrides, clients, loading }: {
  onSelect: (c: Client) => void;
  onFollowUp: (clientId: number, org: string) => void;
  overrides: Record<number, ClientOverride>;
  clients: Client[];
  loading: boolean;
}) {
  const pipelineVal = clients.filter(c => c.stage !== 'lost').reduce((a, c) => a + c.value, 0);
  const colTpl = 'minmax(0, 2fr) minmax(0, 1fr) 0.6fr 0.8fr minmax(0, 2fr) 0.65fr 92px';

  if (!loading && clients.length === 0) return (
    <Card>
      <Lbl s="Client pipeline" spaced />
      <Empty title="Not connected" text="No authoritative sales-pipeline source is wired up yet." />
    </Card>
  );

  return (
    <Card>
      <div style={{ marginBottom: 10 }}>
        <div className={styles.cardHeaderGroup} style={{ marginBottom: 8 }}>
          <Lbl s="Client pipeline" />
          <Meta size={11} color={T.dim}>{clients.length} accounts · ${pipelineVal.toLocaleString()} open</Meta>
        </div>
        <StageFunnel clients={clients} />
      </div>

      <div className={styles.scrollX}>
        <div className={`${styles.pipelineGrid} ${styles.pipelineHead}`} style={{ gridTemplateColumns: colTpl }}>
          {['Organisation', 'Contact', 'Value', 'Stage', 'Next action', 'Activity', ''].map(h => (
            <span key={h} className={styles.pipelineHeadCell}>{h}</span>
          ))}
        </div>

        {clients.map(base => {
          const ov       = overrides[base.id] ?? {};
          const effDays  = ov.daysAgo  ?? base.daysAgo;
          const effStage = ov.stage    ?? base.stage;
          const effAct   = ov.action   ?? base.action;
          const stale    = !ov.followedUp && effDays >= 4;
          const merged: Client = { ...base, daysAgo: effDays, stage: effStage, action: effAct };
          return (
            <div key={base.id}
              className={`${styles.pipelineGrid} ${styles.pipelineRow}`}
              data-highlighted={ov.highlighted ? 'true' : undefined}
              style={{
                gridTemplateColumns: colTpl,
                borderLeftColor: stale ? T.red : ov.highlighted ? T.green : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <button type="button" className={styles.pipelineOpen} onClick={() => onSelect(merged)}>{base.org}</button>
                {base.linked_organisation && (
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex' }}>
                    <Chip color={T.cyan} title={`Linked: ${base.linked_organisation.name}`}>LINKED</Chip>
                  </span>
                )}
              </div>
              <span className={styles.ellipsis} style={{ fontSize: 12, color: T.sub }}>{base.contact}</span>
              <Meta size={12} color={T.text}>${(base.value/1000).toFixed(1)}k</Meta>
              <StagePill s={effStage} />
              <span className={styles.ellipsis} style={{ fontSize: 12, color: ov.followedUp ? T.green : T.sub }}>{effAct}</span>
              <Meta size={11} color={ov.followedUp ? T.green : ageColor(effDays)}>{ov.followedUp ? 'just now' : ageLabel(effDays)}</Meta>
              <div className={styles.pipelineAction}>
                {ov.followedUp ? (
                  <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>✓ Sent</span>
                ) : (
                  <Btn small label="Follow up" ariaLabel={`Follow up ${base.org}`} variant={stale ? 'danger' : 'secondary'} onClick={() => onFollowUp(base.id, base.org)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
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
    <Card>
      <div className={styles.revenueGrid}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Lbl s="Active MRR" />
            <Meta size={20} color={mrr != null ? T.text : T.dim}>{mrrDisplay}</Meta>
          </div>
          <Empty title="Historical MRR trend not available" text="No revenue history is tracked yet — this shows current active recurring revenue only." />
          <div className={styles.sourceNote}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.dim }}>Source </span>
            <Code size={11} color={T.sub}>managed_services · active subscriptions</Code>
          </div>
        </div>
        <div className={styles.stackTight}>
          <div className={styles.statRow}>
            <span style={{ fontSize: 12, color: T.sub }}>ARR run rate</span>
            <span style={{ fontWeight: 600 }}><Meta size={12} color={arr != null ? T.text : T.dim}>{arrDisplay}</Meta></span>
          </div>
          {REVENUE_UNAVAILABLE_STATS.map(l => (
            <div key={l} className={styles.statRow}>
              <span style={{ fontSize: 12, color: T.dim }}>{l}</span>
              <Meta size={11} color={T.dim}>Not connected</Meta>
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
    <Card>
      <div className={styles.cardHeader}>
        <Lbl s="Client implementations" />
        <Link href="/admin/implementations" style={{ fontSize: 11, color: T.purple, textDecoration: 'none' }}>View all →</Link>
      </div>

      {loading ? (
        <div className={styles.stateText}>Loading…</div>
      ) : !metrics || metrics.implementationsTotal === undefined ? (
        <Empty title="Not connected" />
      ) : metrics.implementationsTotal === 0 ? (
        <Empty title="No implementations yet" text="Create one from the Client Implementations workspace." />
      ) : (
        <>
          <MetricStrip style={{ marginBottom: 12 }}>
            <Metric label="Total (active)"      value={String(metrics.implementationsTotal)} />
            <Metric label="At risk"             value={String(metrics.implementationsAtRisk ?? 0)} />
            <Metric label="Blocked"             value={String(metrics.implementationsBlocked ?? 0)} />
            <Metric label="Approaching launch"  value={String(metrics.implementationsApproachingLaunch ?? 0)} />
          </MetricStrip>

          {metrics.implementationsByStage && Object.keys(metrics.implementationsByStage).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: nextActions.length > 0 ? 12 : 0 }}>
              {Object.entries(metrics.implementationsByStage).map(([stage, count]) => (
                <span key={stage} className={styles.row} style={{ fontSize: 11, color: T.sub, padding: '3px 8px' }}>
                  {IMPL_STAGE_LABEL[stage] ?? stage}: <Meta size={11} color={T.text}>{count}</Meta>
                </span>
              ))}
            </div>
          )}

          {nextActions.length > 0 && (
            <div>
              <Lbl s="Next actions" as="h3" spaced />
              <div className={styles.stackTight}>
                {nextActions.map(n => (
                  <a key={n.id} href={n.href} className={styles.row} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className={styles.ellipsis} style={{ fontSize: 12, color: T.text }}>
                      {n.organisationName ? `${n.organisationName} — ` : ''}{n.name}
                    </span>
                    <span style={{ fontSize: 11, color: T.sub, flexShrink: 0 }}>{n.nextAction}</span>
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
    <Card>
      <Lbl s="Client implementations" spaced />
      {loading ? (
        <div className={styles.stateText}>Loading…</div>
      ) : loadError ? (
        <div className={styles.errorText}>Couldn&apos;t load implementations.</div>
      ) : groups.size === 0 ? (
        <Empty title="No implementations yet" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[...groups.entries()].map(([orgId, group]) => (
            <div key={orgId}>
              <h3 style={{ margin: '0 0 5px', fontSize: 12, fontWeight: 600, color: T.text }}>{group.name}</h3>
              <div className={`${styles.stackTight} ${styles.scrollX}`}>
                {group.items.map(impl => {
                  const health = HEALTH_META[impl.health] ?? HEALTH_META.on_track;
                  return (
                    <a key={impl.id} href={`/admin/implementations/${impl.id}`} className={styles.row} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) auto minmax(0, 1fr) minmax(0, 1.5fr)', gap: 8, alignItems: 'center',
                      minWidth: 600,
                    }}>
                      <span className={styles.ellipsis} style={{ fontSize: 12, color: T.text }}>{impl.name}</span>
                      <span style={{ fontSize: 11, color: T.sub }}>{impl.service_type ?? '—'}</span>
                      <span style={{ fontSize: 11, color: T.sub }}>{IMPL_STAGE_LABEL[impl.stage] ?? impl.stage}</span>
                      <Chip color={health.color}>{health.label}</Chip>
                      <span style={{ fontSize: 11, color: T.sub }}>{impl.owner_name ?? 'Unassigned'}</span>
                      <span className={styles.ellipsis} style={{ fontSize: 11, color: T.dim }}>
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
  on_track: { label: 'On Track', color: T.green },
  at_risk:  { label: 'At Risk',  color: T.yellow },
  blocked:  { label: 'Blocked',  color: T.red },
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
  Critical: T.red, High: HIGH, Medium: T.yellow, Low: T.dim,
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
    <Card>
      <Lbl s="Founder tasks" spaced />
      {loading ? (
        <div className={styles.stateText}>Loading…</div>
      ) : loadError ? (
        <Empty title="Not connected" />
      ) : !board ? (
        <Empty title="No task board yet" />
      ) : (
        <MetricStrip>
          <Metric label="Overdue" value={String(groups.overdue.length)} />
          <Metric label="Due today" value={String(groups.today.length)} />
        </MetricStrip>
      )}
    </Card>
  );
}

function TaskRow({ task, onUpdate }: { task: FounderTaskItem; onUpdate: (id: string, patch: Record<string, unknown>) => void }) {
  const done = task.status === 'Done';
  return (
    <div className={`${styles.row} ${styles.taskGrid}`}>
      <button
        type="button"
        className={styles.taskCheck}
        data-done={done ? 'true' : undefined}
        onClick={() => onUpdate(task.id, { status: done ? 'Not Started' : 'Done' })}
        title={done ? 'Reopen' : 'Mark complete'}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} complete`}
      ><span aria-hidden="true">{done ? '✓' : ''}</span></button>
      <span className={styles.ellipsis} style={{ fontSize: 12, color: done ? T.sub : T.text, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
      <select
        value={task.priority ?? ''}
        onChange={e => onUpdate(task.id, { priority: e.target.value || null })}
        aria-label={`Priority for ${task.title}`}
        className={styles.taskControl}
        style={{ color: task.priority ? (TASK_PRIORITY_COLOR[task.priority] ?? T.sub) : T.dim }}
      >
        {TASK_PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p || 'No priority'}</option>)}
      </select>
      <input
        type="date"
        value={task.dueDate ?? ''}
        onChange={e => onUpdate(task.id, { due_date: e.target.value || null })}
        aria-label={`Due date for ${task.title}`}
        className={styles.taskControl}
      />
      <input
        type="text"
        defaultValue={task.owner ?? ''}
        placeholder="Owner"
        onBlur={e => { if (e.target.value.trim() !== (task.owner ?? '')) onUpdate(task.id, { owner: e.target.value.trim() || null }); }}
        aria-label={`Owner for ${task.title}`}
        className={styles.taskControl}
      />
      <select
        value={task.status}
        onChange={e => onUpdate(task.id, { status: e.target.value })}
        aria-label={`Status for ${task.title}`}
        className={styles.taskControl}
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
      <button type="button" className={styles.disclosure} aria-expanded={open} onClick={() => setOpen(p => !p)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>{label}</span>
        <span className={styles.num}>({tasks.length})</span>
      </button>
      {open && (
        <div className={`${styles.stackTight} ${styles.scrollX}`}>
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
    <Card>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderGroup}>
          <Lbl s="Founder tasks" />
          {board && <Meta size={11} color={T.dim}>{board.name}</Meta>}
        </div>
        <div className={styles.cardHeaderGroup}>
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
            style={{ fontSize: 11, color: T.purple, textDecoration: 'none' }}
          >
            Open in Organiser →
          </Link>
          {board && <Btn small label={showCreate ? '✕ Cancel' : '+ New Task'} onClick={() => setShowCreate(p => !p)} />}
        </div>
      </div>

      {loading ? (
        <div className={styles.stateText}>Loading…</div>
      ) : loadError ? (
        <Empty title="Not connected" />
      ) : !board ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle} style={{ marginBottom: 8 }}>No task board yet</div>
          <Btn small label={creatingBoard ? 'Creating…' : 'Create Founder Tasks board'} onClick={createBoard} />
        </div>
      ) : (
        <>
          {showCreate && (
            <div className={styles.createForm}>
              {createError && <FormError>{createError}</FormError>}
              <div className={styles.formGrid}>
                <Field label="Task title">
                  {control => <input {...control} className={fieldControlClassName} value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" />}
                </Field>
                <Field label="Priority">
                  {control => (
                    <select {...control} className={fieldControlClassName} value={priority} onChange={e => setPriority(e.target.value)}>
                      {TASK_PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p || 'No priority'}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Due date">
                  {control => <input {...control} className={fieldControlClassName} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />}
                </Field>
                <Field label="Owner">
                  {control => <input {...control} className={fieldControlClassName} value={owner} onChange={e => setOwner(e.target.value)} placeholder="Owner" />}
                </Field>
              </div>
              <Field label="Notes (optional)">
                {control => <textarea {...control} className={fieldControlClassName} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} />}
              </Field>
              <div>
                <Btn small variant="primary" label={creating ? 'Creating…' : 'Create Task'} onClick={submitCreate} />
              </div>
            </div>
          )}

          {taskCount(groups) === 0 && groups.completed.length === 0 ? (
            <Empty title="No tasks yet" />
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
    <Card compact>
      <Lbl s="HLNΛ recommendations" spaced />
      <Empty title="Recommendations not connected" text="No authoritative recommendation source is wired up yet." />
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
    <Card compact>
      <Lbl s="Live activity" spaced />
      <Empty title="No activity yet this session" text="Actions you take will appear here as they happen." />
    </Card>
  );

  return (
    <Card compact>
      <div className={styles.cardHeaderGroup} style={{ marginBottom: 8 }}>
        <span className={styles.dot} style={{ background: T.green }} aria-hidden="true" />
        <Lbl s="Live activity" />
        <Chip color={T.green}>{sessionEvents.length} this session</Chip>
      </div>
      {sessionEvents.map((a, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, padding: '5px 0',
          borderBottom: i < sessionEvents.length - 1 ? `1px solid ${T.borderB}` : 'none',
        }}>
          <Code size={11} color={T.dim}>{a.ts}</Code>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>{a.event}</div>
            {a.client && <Meta size={11} color={T.sub}>{a.client}</Meta>}
          </div>
          <span className={styles.dot} style={{ background: FEED_C[a.type], marginTop: 5 }} aria-hidden="true" />
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
    microsoft365: { state: FounderConnectionState };
  };
};
const SERVICE_STATE_LABEL: Record<FounderConnectionState, string> = {
  connected: 'Connected', not_connected: 'Not connected',
  connected_issue: 'Connection issue', unknown: 'Unknown',
};
const SERVICE_STATE_COLOR: Record<FounderConnectionState, string> = {
  connected: T.green, not_connected: T.inactive, connected_issue: T.yellow, unknown: T.inactive,
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
      <Card compact>
        <Lbl s="System status" spaced />
        <div className={styles.stateText}>Loading…</div>
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card compact>
        <Lbl s="System status" spaced />
        <Empty title="Not connected" text="Could not load system status." />
      </Card>
    );
  }

  const { application, database, services } = data;
  const dbLabel = database.ok ? 'Operational' : 'Unavailable';
  const dbColor = database.ok ? T.green : T.red;

  return (
    <div className={styles.stack} style={{ gap: 10 }}>
      <Card compact>
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
          <div className={styles.tile} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div className={styles.tileLabel}>Application</div>
            <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{application.environment}</div>
            {application.commitShaShort ? (
              <>
                <Code size={11} color={T.sub}>{application.commitShaShort}</Code>
                {application.commitMessage && (
                  <div style={{
                    fontSize: 11, color: T.dim, marginTop: 3,
                    overflowWrap: 'anywhere', wordBreak: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{application.commitMessage}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: T.dim, marginTop: 3 }}>Commit: Unknown</div>
            )}
          </div>
          <div className={styles.tile} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div className={styles.tileLabel}>Database</div>
            <div style={{ fontSize: 12, color: dbColor, fontWeight: 600 }}>{dbLabel}</div>
            <div className={styles.num} style={{ fontSize: 11, color: T.dim, marginTop: 3 }}>
              {database.ok && database.latencyMs != null ? `${database.latencyMs} ms this request · live check` : 'Live check'}
            </div>
          </div>
        </div>
      </Card>

      <Card compact>
        <Lbl s="Service connections" />
        <div className={styles.stack} style={{ marginTop: 8 }}>
          {([
            ['Gmail', services.gmail.state],
            ['Google Calendar', services.googleCalendar.state],
            ['Instagram', services.instagram.state],
            ['Microsoft 365', services.microsoft365.state],
          ] as const).map(([label, state]) => (
            <div key={label} className={styles.row} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: T.sub }}>{label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: SERVICE_STATE_COLOR[state] }}>
                <span className={styles.dot} style={{ background: SERVICE_STATE_COLOR[state] }} aria-hidden="true" />
                {SERVICE_STATE_LABEL[state]}
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>
          Gmail/Google Calendar/Microsoft 365 show whether an OAuth connection is stored, not a live API check.
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
      <Card compact>
        <Lbl s="Product usage" spaced />
        <div className={styles.stateText}>Loading…</div>
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card compact>
        <Lbl s="Product usage" spaced />
        <Empty title="Not connected" text="Could not load product usage." />
      </Card>
    );
  }

  return (
    <Card compact>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8, minWidth: 0 }}>
        <Lbl s="Product usage" />
        <span style={{ fontSize: 11, color: T.dim, flexShrink: 0 }}>Last {data.windowDays} days</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 0 }}>
        {([
          ['Uploads', data.uploads],
          ['Organiser updates', data.organiserUpdates],
        ] as const).map(([label, value]) => (
          <div key={label} className={styles.tile} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div className={styles.tileLabel} style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{label}</div>
            <div className={styles.tileValue}>{value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Today's calendar (Microsoft 365, Phase E.5C) ──────────────────────────────
// Read-only consumer of the already-approved, already-Production
// GET /api/integrations/microsoft/events (Phase E.5B). Deliberately
// separate from LiveContext()'s "Upcoming demos" card below, which
// remains reserved for a future, dedicated demo-calendar capability
// (see LiveContext()'s own header comment) — this card shows whatever
// is actually on the connected Microsoft account's default calendar
// today, honestly labelled as that, not as "demos". Does not read or
// alter the server-side definition of "today" (a known UTC-day-
// boundary limitation, deliberately deferred to a separate follow-up —
// see the route's own comments) — this component only formats
// whatever the endpoint already returns.

type MicrosoftCalendarEvent = {
  id: string;
  title: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  location: string | null;
  account: string | null;
};

function MicrosoftTodayCard() {
  const [data, setData] = useState<{ events: MicrosoftCalendarEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/microsoft/events')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { events: MicrosoftCalendarEvent[] }) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card compact>
        <Lbl s="Today's calendar" spaced />
        <div className={styles.stateText}>Loading…</div>
      </Card>
    );
  }

  // A stored-but-invalid connection (401 "Not connected") and any
  // network/Graph failure (502) are deliberately shown identically —
  // matching ProductUsage()'s own established "Not connected only on
  // load failure" convention immediately above.
  if (loadError || !data) {
    return (
      <Card compact>
        <Lbl s="Today's calendar" spaced />
        <Empty title="Not connected" />
      </Card>
    );
  }

  if (data.events.length === 0) {
    return (
      <Card compact>
        <Lbl s="Today's calendar" spaced />
        <Empty title="No events today" />
      </Card>
    );
  }

  return (
    <Card compact>
      <Lbl s="Today's calendar" spaced />
      <div className={styles.stack}>
        {data.events.map(event => (
          <div key={event.id} className={styles.row}>
            <div className={styles.num} style={{ fontSize: 11, color: T.dim }}>
              {event.allDay ? 'All day' : [formatEventTime(event.start), formatEventTime(event.end)].filter(Boolean).join(' – ')}
            </div>
            <div style={{ fontSize: 12, color: T.text, fontWeight: 600, marginTop: 1, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              {event.title}
            </div>
            {event.location && (
              <div style={{ fontSize: 11, color: T.sub, marginTop: 1, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {event.location}
              </div>
            )}
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
    <div className={styles.stack} style={{ gap: 10 }}>
      <Card compact>
        <Lbl s="Upcoming demos" spaced />
        <Empty title="Not connected" />
      </Card>
      <Card compact>
        <Lbl s="Signals" spaced />
        <Empty title="Not connected" />
      </Card>
    </div>
  );
}

// ─── Client drawer ────────────────────────────────────────────────────────────
// Visual convergence: the hand-rolled fixed drawer + click-away overlay is
// now the shared SlidePanel (dialog semantics, Escape, focus trap, focus
// return, named close button). Same props, same actions, same content.

function ClientDrawer({ client, onClose, onAction, onModal, onAdvanceStage, drawerActivity }: {
  client: Client; onClose: () => void; onAction: (msg: string) => void;
  onModal: (m: 'book-demo' | 'proposal') => void;
  onAdvanceStage: (clientId: number, org: string, stage: Stage) => void;
  drawerActivity: Array<{ ts: string; event: string }>;
}) {
  const router = useRouter();
  return (
    <SlidePanel open onClose={onClose} title={client.org}>
      <div className={styles.drawerSummary}>
        <div>
          <div style={{ fontSize: 13, color: T.sub }}>{client.contact}</div>
          <Meta size={11} color={T.dim}>{client.email}</Meta>
        </div>
        <div className={styles.cardHeaderGroup}>
          <StagePill s={client.stage} />
          <Meta size={12} color={T.text}>${client.value.toLocaleString()}/mo</Meta>
          <span style={{ fontSize: 11, color: ageColor(client.daysAgo) }}>Last active: {ageLabel(client.daysAgo)}</span>
        </div>
      </div>

      <div className={styles.drawerSections}>
        <div className={styles.focusBox}>
          <Lbl s="Next action" as="h3" spaced />
          <div style={{ fontSize: 13, color: T.text, marginBottom: 10 }}>{client.action}</div>
          <div className={styles.buttonRow}>
            <Btn small label="← Back"             onClick={onClose} />
            <Btn small label="Generate Briefing" onClick={() => { onClose(); router.push('/command'); }} />
            <Btn small label="Create Proposal"   onClick={() => { onClose(); onModal('proposal'); }} />
            {client.stage !== 'paid' && client.stage !== 'lost' && (
              <Btn small variant="primary" label="Advance →" onClick={() => onAdvanceStage(client.id, client.org, client.stage)} />
            )}
          </div>
        </div>

        {drawerActivity.length > 0 && (
          <div className={styles.drawerSection}>
            <Lbl s="Session activity" as="h3" />
            <div className={styles.stackTight}>
              {drawerActivity.map((ev, i) => (
                <div key={i} className={styles.row} style={{
                  borderLeft: `2px solid ${T.green}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
                }}>
                  <span style={{ fontSize: 12, color: T.sub, flex: 1 }}>{ev.event}</span>
                  <Meta size={11} color={T.green}>now</Meta>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Linked Tenant panel ── */}
        {client.linked_organisation ? (
          <div className={styles.drawerSection}>
            <div className={styles.cardHeaderGroup}>
              <Lbl s="Linked tenant" as="h3" />
              <Chip color={T.cyan}>LINKED</Chip>
            </div>
            <div className={styles.row} style={{ padding: '9px 11px', borderColor: 'var(--status-info-border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{client.linked_organisation.name}</div>
              <Code size={11} color={T.dim}>{client.linked_organisation.slug}</Code>
              <div className={styles.twoCol} style={{ marginTop: 8 }}>
                {client.linked_organisation.status && (
                  <div className={styles.tile} style={{ background: T.s1 }}>
                    <div className={styles.tileLabel}>Status</div>
                    <div style={{ fontSize: 12, color: T.sub }}>{client.linked_organisation.status}</div>
                  </div>
                )}
                {client.linked_organisation.created_at && (
                  <div className={styles.tile} style={{ background: T.s1 }}>
                    <div className={styles.tileLabel}>Created</div>
                    <div style={{ fontSize: 12, color: T.sub }}>{new Date(client.linked_organisation.created_at).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
              {client.linked_primary_user && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                  <div className={styles.tileLabel}>Primary contact</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{client.linked_primary_user.name}</div>
                  {client.linked_primary_user.email && <Meta size={11} color={T.dim}>{client.linked_primary_user.email}</Meta>}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Btn small label="Open Organisation Admin" onClick={() => router.push('/admin/orgs')} />
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.drawerSection}>
            <Lbl s="Tenant link" as="h3" />
            <div className={styles.empty}>
              <div className={styles.emptyTitle} style={{ marginBottom: 8 }}>Not linked to a tenant organisation</div>
              <Btn small label="Link to existing org" onClick={() => router.push('/admin/orgs')} />
            </div>
          </div>
        )}

        <div className={styles.drawerSection}>
          <Lbl s="Notes" as="h3" />
          <div className={styles.row} style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, padding: '8px 10px' }}>
            {client.notes || <span style={{ color: T.dim, fontStyle: 'italic' }}>No notes</span>}
          </div>
        </div>

        <div className={styles.drawerSection}>
          <Lbl s="Usage summary" as="h3" />
          <div className={styles.twoCol}>
            {[
              { l: 'Uploads',      v: client.usage.uploads   },
              { l: 'Analyses run', v: client.usage.analyses  },
              { l: 'Last active',  v: client.usage.lastActive },
              { l: 'Top module',   v: client.usage.topModule  },
            ].map(r => (
              <div key={r.l} className={styles.tile}>
                <div className={styles.tileLabel}>{r.l}</div>
                <div className={styles.num} style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.v}</div>
              </div>
            ))}
          </div>
        </div>

        {client.uploads.length > 0 && (
          <div className={styles.drawerSection}>
            <Lbl s="Recent uploads" as="h3" />
            <div className={styles.stackTight}>
              {client.uploads.map((u, i) => (
                <div key={i} className={styles.row} style={{ padding: '4px 8px' }}>
                  <Code size={11} color={u.includes('FAILED') ? T.red : T.sub}>{u}</Code>
                </div>
              ))}
            </div>
          </div>
        )}

        {client.insights.length > 0 && (
          <div className={styles.drawerSection}>
            <Lbl s="Recent HLNΛ insights" as="h3" />
            {client.insights.map((ins, i) => (
              <div key={i} className={styles.insight}>
                {ins}
              </div>
            ))}
          </div>
        )}

        {client.insights.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>No HLNΛ insights yet</div>
            <div className={styles.emptyText}>Upload data to generate analysis</div>
            <div style={{ marginTop: 8 }}>
              <Btn small label="Upload Dataset" onClick={() => onAction(`Upload: ${client.org}`)} />
            </div>
          </div>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Left sidebar ─────────────────────────────────────────────────────────────
// Visual convergence: nav entries are real controls on the shared module-nav
// contract (moduleNavItemProps — aria-current on the current section, same
// active language as the rest of the app). In-app sections are <button>s
// calling setSection (as the clickable <div>s did); destinations with an
// href are <Link>s to the same href router.push used to navigate to. Below
// 900px the sidebar becomes a strip above the content (FounderOs.module.css).

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
    <div className={styles.sidebar}>
      <nav className={styles.sidebarGroup} aria-label="Founder OS">
        <h2 className={styles.sidebarHeading}>Navigate</h2>
        <ul className={styles.navList}>
          {NAV.map(n => {
            const active = n.section ? n.section === section : false;
            const item = moduleNavItemProps(active);
            const itemStyle: React.CSSProperties = {
              color: active ? T.purple : n.dim ? T.dim : T.sub,
            };
            return (
              <li key={n.label}>
                {n.section ? (
                  <button
                    type="button"
                    className={`${item.className} ${styles.navButton}`}
                    aria-current={item['aria-current']}
                    onClick={() => setSection(n.section!)}
                    style={itemStyle}
                  >
                    {n.label}
                  </button>
                ) : (
                  <Link href={n.href ?? '/'} className={item.className} style={itemStyle}>
                    {n.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={styles.sidebarGroup}>
        <h2 className={styles.sidebarHeading}>Actions</h2>
        <div className={styles.actionList}>
          {ACTS.map(a => (
            <button key={a.l} type="button" onClick={a.fn} className={styles.actionButton}>
              <span className={styles.actionIcon} aria-hidden="true">{a.icon}</span>
              {a.l}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.sidebarContext}>
        <h2 className={styles.sidebarHeading} style={{ padding: 0 }}>Context</h2>
        {/* Phase B: "Open pipeline $19,600" / "Overdue actions 3" were
            fabricated with no backing source (and duplicated the same
            ambiguity as the removed ClientPipeline mock) — removed rather
            than wired to a misleading proxy. */}
        <div>{new Date().toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}</div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, isError }: { msg: string; isError?: boolean }) {
  return (
    <div
      className={styles.toast}
      role={isError ? 'alert' : 'status'}
      style={{ borderColor: isError ? 'var(--status-danger-border)' : T.border }}
    >
      <span style={{ color: isError ? T.red : T.green }} aria-hidden="true">{isError ? '⚠' : '✓'}</span>
      {msg}
    </div>
  );
}

// ─── Add Lead modal ───────────────────────────────────────────────────────────
// Visual convergence (all three modals): the hand-rolled fixed overlay +
// box is now the shared Dialog (role="dialog", aria-modal, Escape, focus
// trap, initial focus, focus return, named close). Every field keeps its
// state binding, and every submit handler and request payload is unchanged;
// fields gained real <label> associations via Field.

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
      type="button"
      className={styles.segment}
      aria-pressed={mode === m}
      onClick={() => switchMode(m)}
    >{label}</button>
  );

  return (
    <Dialog open onClose={onClose} title="Add Lead" width={460}>
      <div className={styles.dialogBody}>
        <p className={styles.dialogIntro}>Add a prospect to the pipeline</p>

        {/* Mode toggle */}
        <div className={styles.segmented} role="group" aria-label="Organisation">
          {modeBtn('existing', 'Existing organisation')}
          {modeBtn('new',      'New organisation')}
        </div>

        {/* ── Existing org flow ── */}
        {mode === 'existing' && (
          <div style={{ display: 'grid', gap: 6 }}>
            <Field label="Search organisations">
              {control => (
                <input
                  {...control}
                  className={fieldControlClassName}
                  value={orgFilter}
                  onChange={e => { setOrgFilter(e.target.value); setSelId(null); setOrg(''); }}
                  placeholder="Type to filter…"
                />
              )}
            </Field>
            {filtered.length === 0 ? (
              <div className={styles.stateText} style={{ padding: '6px 8px' }}>No matches — switch to &ldquo;New organisation&rdquo;</div>
            ) : (
              <select
                size={Math.min(filtered.length, 5)}
                value={selId ?? ''}
                onChange={e => selectExisting(Number(e.target.value))}
                aria-label="Matching organisations"
                className={fieldControlClassName}
                style={{ height: 'auto', padding: 0 }}
              >
                {filtered.map(c => (
                  <option key={c.id} value={c.id} style={{ padding: '5px 8px' }}>
                    {c.org}{c.contact && c.contact !== '—' ? ` — ${c.contact}` : ''} [{c.stage.toUpperCase()}]
                  </option>
                ))}
              </select>
            )}
            {selId !== null && (
              <div className={styles.notice}>
                Lead will be added for <strong>{org}</strong>
              </div>
            )}
          </div>
        )}

        {/* ── Org name (new mode only) ── */}
        {mode === 'new' && (
          <Field label="Organisation name">
            {control => (
              <input
                {...control}
                className={fieldControlClassName}
                value={org}
                onChange={e => setOrg(e.target.value)}
                placeholder="e.g. City of Adelaide"
              />
            )}
          </Field>
        )}

        {/* Contact + Email */}
        <div className={styles.formGrid2}>
          <Field label="Contact name">
            {control => <input {...control} className={fieldControlClassName} value={contact} onChange={e => setContact(e.target.value)} placeholder="Full name" />}
          </Field>
          <Field label="Email (optional)">
            {control => <input {...control} className={fieldControlClassName} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@council.sa.gov.au" />}
          </Field>
        </div>

        {/* Stage + Value */}
        <div className={styles.formGrid2}>
          <Field label="Stage">
            {control => (
              <select {...control} className={fieldControlClassName} value={stage} onChange={e => setStage(e.target.value as Stage)}>
                {STAGE_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Est. value $/mo (optional)">
            {control => <input {...control} className={fieldControlClassName} type="number" value={valStr} onChange={e => setValStr(e.target.value)} placeholder="e.g. 2400" />}
          </Field>
        </div>

        {/* Next action */}
        <Field label="Next action (optional)">
          {control => <input {...control} className={fieldControlClassName} value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. Send intro email" />}
        </Field>

        {/* Note */}
        <Field label="Note (optional)">
          {control => (
            <textarea
              {...control}
              className={fieldControlClassName}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Context, source, key contacts…"
              rows={2}
            />
          )}
        </Field>

        {/* ── Link existing tenant ── */}
        <div className={styles.tenantBox} data-linked={tenantOrgId ? 'true' : undefined}>
          <button
            type="button"
            className={styles.tenantToggle}
            aria-expanded={tenantOpen}
            onClick={() => tenantOpen ? setTenantOpen(false) : openTenantSection()}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: tenantOrgId ? T.cyan : undefined }}>
              Link existing tenant
              {linkedTenantOrg && (
                <span className={styles.chip} style={{ color: T.cyan, background: T.cyanA, borderColor: 'var(--status-info-border)', textTransform: 'none', letterSpacing: 0 }}>
                  {linkedTenantOrg.name}
                </span>
              )}
            </span>
            <span aria-hidden="true">{tenantOpen ? '▲' : '▼'}</span>
          </button>

          {tenantOpen && (
            <div className={styles.tenantBody}>
              {tenantLoading ? (
                <div className={styles.stateText}>Loading organisations…</div>
              ) : tenantOrgs.length === 0 ? (
                <div className={styles.stateText}>No tenant organisations found.</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gap: 5 }}>
                    <Field label="Find tenant organisation">
                      {control => (
                        <input
                          {...control}
                          className={fieldControlClassName}
                          value={tenantFilter}
                          onChange={e => setTenantFilter(e.target.value)}
                          placeholder="Type to filter…"
                        />
                      )}
                    </Field>
                    <select
                      value={tenantOrgId}
                      onChange={e => selectTenantOrg(e.target.value)}
                      aria-label="Tenant organisation"
                      className={fieldControlClassName}
                    >
                      <option value="">— No link —</option>
                      {filteredTenantOrgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>
                      ))}
                    </select>
                  </div>

                  {tenantOrgId && (
                    orgUsers.length === 0 ? (
                      <div>
                        <div className={styles.label} style={{ marginBottom: 4 }}>Primary contact (optional)</div>
                        <div className={styles.stateText}>No users in this organisation.</div>
                      </div>
                    ) : (
                      <Field label="Primary contact (optional)">
                        {control => (
                          <select
                            {...control}
                            className={fieldControlClassName}
                            value={tenantContactId}
                            onChange={e => setTenantContactId(e.target.value)}
                          >
                            <option value="">— Select contact —</option>
                            {orgUsers.map(u => (
                              <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''}</option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <FormActions>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!ready || loading}>
            {loading ? 'Adding…' : 'Add Lead'}
          </Button>
        </FormActions>
      </div>
    </Dialog>
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
    <Dialog open onClose={onClose} title="Book Demo" width={420}>
      <div className={styles.dialogBody}>
        <p className={styles.dialogIntro}>Schedule a product walkthrough with a prospect</p>

        <Field label="Client">
          {control => (
            <select {...control} className={fieldControlClassName} value={org} onChange={e => setOrg(e.target.value)} style={{ color: org ? T.text : T.sub }}>
              <option value="">Select a client or prospect…</option>
              {clients.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
            </select>
          )}
        </Field>

        <div className={styles.formGrid2}>
          <Field label="Date">
            {control => <input {...control} className={fieldControlClassName} type="date" value={date} onChange={e => setDate(e.target.value)} />}
          </Field>
          <Field label="Time (optional)">
            {control => <input {...control} className={fieldControlClassName} type="time" value={time} onChange={e => setTime(e.target.value)} />}
          </Field>
        </div>

        <FormActions>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready || loading}
            onClick={async () => {
              if (!ready || loading) return;
              setLoading(true);
              await onBook(org, date, time || undefined);
              setLoading(false);
            }}
          >
            {loading ? 'Logging…' : 'Confirm Demo'}
          </Button>
        </FormActions>
      </div>
    </Dialog>
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
    <Dialog open onClose={onClose} title="Generate Proposal" width={420}>
      <div className={styles.dialogBody}>
        <p className={styles.dialogIntro}>Draft a pricing proposal for a client or prospect</p>

        <Field label="Client">
          {control => (
            <select {...control} className={fieldControlClassName} value={org} onChange={e => setOrg(e.target.value)} style={{ color: org ? T.text : T.sub }}>
              <option value="">Select a client…</option>
              {clients.map(c => <option key={c.id} value={c.org}>{c.org} — {c.contact}</option>)}
            </select>
          )}
        </Field>

        <div className={styles.formGrid2}>
          <Field label="Monthly value ($)">
            {control => <input {...control} className={fieldControlClassName} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 2400" />}
          </Field>
          <Field label="Primary module">
            {control => (
              <select {...control} className={fieldControlClassName} value={mod} onChange={e => setMod(e.target.value)}>
                {MODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </Field>
        </div>

        <div className={styles.hint}>
          Full proposal generation will be wired to the reporting module in the next sprint.
        </div>

        <FormActions>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => ready && onConfirm(`Proposal drafted for ${org}${price ? ' · $' + price + '/mo' : ''}`)}
          >
            Create Proposal
          </Button>
        </FormActions>
      </div>
    </Dialog>
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
    <MetricStrip>
      {SNAPSHOT_TILE_META.map(t => {
        const isReal = t.real && !loading && !!metrics;
        const value = t.real
          ? (loading ? '…' : metrics ? `$${Math.round(metrics.activeMrr).toLocaleString()}` : '—')
          : '—';
        const sub = t.real
          ? (loading ? 'loading' : metrics ? 'active managed services' : 'not connected')
          : 'not connected';
        return (
          <Metric
            key={t.label}
            label={t.label}
            value={<span style={{ color: isReal ? T.text : T.dim }}>{value}</span>}
            sub={sub}
          />
        );
      })}
    </MetricStrip>
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
    <div className={styles.root} style={{ margin: '-40px', height: APP_HEADER_OFFSET_VH_CALC }}>

      {/* Status bar — Phase B: the fake "Demo status" dot (always green,
          backed by no real check) and the hardcoded "MRR $12,480 (demo)"
          figure are gone. The date is now real (was a hardcoded, long-stale
          "Thu 8 May 2026"). MRR here is the same real, already-fetched
          value used by SnapshotHero/RevenueIntel — no duplicate request. */}
      <div className={styles.statusBar}>
        <div className={styles.brandRow}>
          <h1 className={styles.brand}>
            <span>BRAINBASE</span>{' '}
            <span className={styles.brandTag}>FOUNDER OS</span>
          </h1>
          <span className={styles.num} style={{ fontSize: 11, color: T.dim }}>{new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div className={styles.statusMeta}>
          <Meta size={11} color={T.sub}>
            MRR {snapshotMetricsLoading ? '…' : snapshotMetrics ? `$${Math.round(snapshotMetrics.activeMrr).toLocaleString()}` : 'not connected'}
          </Meta>
          <span aria-hidden="true">|</span>
          <a href="/admin" className={styles.statusLink}>← Admin</a>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>

        <LeftSidebar onModal={setModal} section={section} setSection={setSection} />

        {/* Center column */}
        <div className={styles.main}>

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
            <MicrosoftTodayCard />
            <LiveContext />
          </>}

          {/* ── Instagram ── */}
          {section === 'instagram' && (
            <InstagramFeedPanel />
          )}
        </div>

        {/* Right column — persistent context panel (stacks below the
            content on narrow screens — see FounderOs.module.css) */}
        <aside className={styles.rail} aria-label="Founder context">
          <AiRecommendations />
          <ActivityFeed sessionEvents={sessionEvents} />
          {section !== 'system' && <>
            <SystemHealth />
            <ProductUsage />
            <MicrosoftTodayCard />
            <LiveContext />
          </>}
        </aside>
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
