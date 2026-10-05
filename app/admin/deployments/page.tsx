'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { APP_HEADER_OFFSET_VAR } from '@/lib/layout/headerOffset';
import {
  PageHeader,
  WorkToolbar,
  MetricStrip,
  Metric,
  Panel,
  Field,
  fieldControlClassName,
  FormActions,
  StateMessage,
  TableContainer,
  TableStateRow,
  tableStyles,
  Badge,
  StatusDot,
  buttonProps,
} from '@/components/ui/app';
import styles from './Deployments.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'rejected';
type ProposalType   = 'website_deployment' | 'operational_deployment' | 'coaching_deployment' | 'automation_deployment' | 'full_system';

interface Proposal {
  id:               string;
  created_at:       string;
  updated_at:       string;
  lead_id:          string | null;
  proposal_title:   string;
  proposal_type:    ProposalType;
  deployment_scope: string | null;
  monthly_recurring:string | number | null;
  one_time_cost:    string | number | null;
  status:           ProposalStatus;
  proposal_content: string | null;
  included_modules: string[];
  notes:            string | null;
  sent_at:          string | null;
  viewed_at:        string | null;
  approved_at:      string | null;
  lead_name:        string | null;
  business_name:    string | null;
  lead_email:       string | null;
}

interface OnboardingRecord {
  id:                  string;
  client_name:         string;
  onboarding_stage:    string;
  target_launch_date:  string | null;
  hosting_status:      string;
  domain_status:       string;
  deployment_status:   string;
  integrations_status: string;
  crm_status:          string;
  launch_status:       string;
  checklist:           ChecklistItem[];
  notes:               string | null;
  created_at:          string;
  lead_name:           string | null;
  business_name:       string | null;
  proposal_title:      string | null;
  monthly_recurring:   string | number | null;
}

interface ChecklistItem { id: string; label: string; done: boolean }

interface ManagedService {
  id:               string;
  client_name:      string;
  domain_name:      string | null;
  hosting_provider: string;
  maintenance_plan: string;
  monthly_value:    string | number;
  renewal_date:     string | null;
  ssl_status:       string;
  status:           string;
  notes:            string | null;
}

interface ManagedMetrics { active_count: number; mrr: number; renewing_soon: number }

// ── Constants ──────────────────────────────────────────────────────────────────

// Visual-convergence (remaining visual islands pass): proposal-type and
// onboarding-stage hues are data encodings resolved per theme from
// Deployments.module.css (dots, rules and progress fills only). Proposal
// status and service health use the shared semantic states.

type SemanticTone = 'success' | 'warning' | 'error' | 'info' | 'inactive';

const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; color: SemanticTone }> = {
  draft:    { label: 'Draft',    color: 'inactive' },
  sent:     { label: 'Sent',     color: 'info'     },
  viewed:   { label: 'Viewed',   color: 'warning'  },
  approved: { label: 'Approved', color: 'success'  },
  rejected: { label: 'Rejected', color: 'error'    },
};

const PROPOSAL_TYPE_META: Record<ProposalType, { label: string; color: string }> = {
  website_deployment:     { label: 'Website',     color: 'var(--dep-type-website)'     },
  operational_deployment: { label: 'Operational', color: 'var(--dep-type-operational)' },
  coaching_deployment:    { label: 'Coaching',    color: 'var(--dep-type-coaching)'    },
  automation_deployment:  { label: 'Automation',  color: 'var(--dep-type-automation)'  },
  full_system:            { label: 'Full System', color: 'var(--dep-type-full-system)' },
};

const ONBOARDING_STAGES = [
  { key: 'discovery',            label: 'Discovery',         color: 'var(--dep-stage-discovery)'      },
  { key: 'content_collection',   label: 'Content',           color: 'var(--dep-stage-content)'        },
  { key: 'infrastructure_setup', label: 'Infrastructure',    color: 'var(--dep-stage-infrastructure)' },
  { key: 'website_build',        label: 'Website Build',     color: 'var(--dep-stage-website-build)'  },
  { key: 'integrations',         label: 'Integrations',      color: 'var(--dep-stage-integrations)'   },
  { key: 'review',               label: 'Review',            color: 'var(--dep-stage-review)'         },
  { key: 'deployment',           label: 'Deployment',        color: 'var(--dep-stage-deployment)'     },
  { key: 'live',                 label: '🟢 Live',            color: 'var(--dep-stage-live)'           },
  { key: 'maintenance',          label: 'Maintenance',       color: 'var(--dep-stage-maintenance)'    },
];

const MAINTENANCE_META: Record<string, { label: string }> = {
  none:        { label: 'None'         },
  standard:    { label: 'Standard'     },
  growth:      { label: 'Growth'       },
  full_system: { label: 'Full System'  },
};

/** Inline custom property carrying a data hue into the CSS module. */
function hueVar(color: string): React.CSSProperties {
  return { ['--hue' as string]: color } as React.CSSProperties;
}

const MODULES_LIST = [
  'Intelligent Website', 'CRM & Pipeline', 'Booking System', 'AI Assistants',
  'Workflow Automation', 'Dashboards', 'Client Portal', 'Revenue Intelligence',
  'Hosted & Managed', 'Domain & SSL',
];

// ── New Proposal Form state ────────────────────────────────────────────────────

interface ProposalForm {
  proposal_title: string;
  proposal_type: ProposalType;
  deployment_scope: string;
  monthly_recurring: string;
  one_time_cost: string;
  proposal_content: string;
  included_modules: string[];
  notes: string;
}

const BLANK_FORM: ProposalForm = {
  proposal_title: '', proposal_type: 'website_deployment',
  deployment_scope: '', monthly_recurring: '', one_time_cost: '',
  proposal_content: '', included_modules: [], notes: '',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeploymentsDashboard() {
  const [tab,          setTab]          = useState<'proposals' | 'onboarding' | 'managed'>('proposals');
  const [proposals,    setProposals]    = useState<Proposal[]>([]);
  const [onboarding,   setOnboarding]   = useState<OnboardingRecord[]>([]);
  const [services,     setServices]     = useState<ManagedService[]>([]);
  const [metrics,      setMetrics]      = useState<ManagedMetrics>({ active_count: 0, mrr: 0, renewing_soon: 0 });
  const [loading,      setLoading]      = useState(true);
  const [showNewProp,  setShowNewProp]  = useState(false);
  const [form,         setForm]         = useState<ProposalForm>(BLANK_FORM);
  const [submitting,   setSubmitting]   = useState(false);
  const [selectedProp, setSelectedProp] = useState<Proposal | null>(null);
  const [patchStatus,  setPatchStatus]  = useState<ProposalStatus | ''>('');
  const tabsId = useId();

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [propRes, onbRes, svcRes] = await Promise.all([
        fetch('/api/web-services/proposals?limit=100'),
        fetch('/api/deployments/onboarding'),
        fetch('/api/deployments/managed-services?status=ALL'),
      ]);
      const [propData, onbData, svcData] = await Promise.all([
        propRes.json() as Promise<{ proposals: Proposal[] }>,
        onbRes.json()  as Promise<{ onboarding: OnboardingRecord[] }>,
        svcRes.json()  as Promise<{ services: ManagedService[]; metrics: ManagedMetrics }>,
      ]);
      setProposals(propData.proposals ?? []);
      setOnboarding((onbData.onboarding ?? []).map(o => ({
        ...o,
        checklist: Array.isArray(o.checklist) ? o.checklist : [],
      })));
      setServices(svcData.services ?? []);
      setMetrics(svcData.metrics ?? { active_count: 0, mrr: 0, renewing_soon: 0 });
    } catch (err) {
      console.error('[deployments] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Create proposal ────────────────────────────────────────────────────────
  const createProposal = async () => {
    if (!form.proposal_title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/web-services/proposals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...form,
          monthly_recurring: parseFloat(form.monthly_recurring) || 0,
          one_time_cost:     parseFloat(form.one_time_cost)     || 0,
        }),
      });
      const data = await res.json() as { proposal: Proposal };
      if (data.proposal) {
        setProposals(ps => [data.proposal, ...ps]);
        setForm(BLANK_FORM);
        setShowNewProp(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Patch proposal status ──────────────────────────────────────────────────
  const patchProposal = async (id: string, status: ProposalStatus) => {
    const res = await fetch(`/api/web-services/proposals/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json() as { proposal: Proposal };
    if (data.proposal) {
      setProposals(ps => ps.map(p => p.id === id ? data.proposal : p));
      if (selectedProp?.id === id) setSelectedProp(data.proposal);
    }
  };

  // ── Metrics ─────────────────────────────────────────────────────────────────
  const totalProposalMRR = proposals
    .filter(p => p.status === 'approved')
    .reduce((acc, p) => acc + (parseFloat(String(p.monthly_recurring)) || 0), 0);
  const pendingCount = proposals.filter(p => ['sent', 'viewed'].includes(p.status)).length;
  const activeOnboarding = onboarding.filter(o => !['live', 'maintenance'].includes(o.onboarding_stage)).length;

  const tabs = [
    { key: 'proposals',  label: 'Proposals',        count: proposals.length   },
    { key: 'onboarding', label: 'Deployments',      count: onboarding.length  },
    { key: 'managed',    label: 'Managed Services', count: services.length    },
  ] as const;

  // Tabs follow the WAI-ARIA tabs pattern (same as ClientWorkspace):
  // arrow keys / Home / End move between tabs and select them.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const order = tabs.map(t => t.key);
    const i = order.indexOf(tab);
    let next: typeof tab | null = null;
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length];
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  }

  return (
    <div className={styles.page}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <PageHeader eyebrow="Web Systems" title="Deployment Operations" />

      {/* Revenue metrics */}
      <div className={styles.metrics}>
        <MetricStrip>
          <Metric label="Monthly Recurring"  value={`$${metrics.mrr.toFixed(0)}/mo`} />
          <Metric label="Active deployments" value={metrics.active_count} />
          <Metric label="Proposals pending"  value={pendingCount} />
          <Metric label="In delivery"        value={activeOnboarding} />
        </MetricStrip>
      </div>

      {/* Tabs */}
      <div className={styles.tabBar} style={{
        position: 'sticky', top: APP_HEADER_OFFSET_VAR, zIndex: 50,
      }}>
        <div className={styles.tabList} role="tablist" aria-label="Deployment operations" onKeyDown={onTabKeyDown}>
          {tabs.map(t => (
            <button
              key={t.key}
              id={`${tabsId}-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === t.key ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className={styles.tabCount}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The tabpanel is always rendered so the tabs' aria-controls resolves; the loading state sits inside it. */}
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${tab}`}>
      {loading ? (
        <StateMessage kind="loading" size="page" title="Loading deployments…" />
      ) : (
        <>

          {/* ════════════════════════════════ PROPOSALS TAB ══════════════════════ */}
          {tab === 'proposals' && (
            <div>
              <WorkToolbar
                actions={
                  <button
                    type="button"
                    onClick={() => setShowNewProp(v => !v)}
                    aria-expanded={showNewProp}
                    {...buttonProps(showNewProp ? 'secondary' : 'primary')}
                  >
                    {showNewProp ? '✕ Cancel' : '+ New Proposal'}
                  </button>
                }
              >
                {/* Status counts */}
                <ul className={styles.summary} aria-label="Proposals by status">
                  {(['draft', 'sent', 'viewed', 'approved', 'rejected'] as ProposalStatus[]).map(s => {
                    const count = proposals.filter(p => p.status === s).length;
                    const meta  = PROPOSAL_STATUS_META[s];
                    return (
                      <li key={s} className={styles.summaryItem}>
                        <StatusDot state={meta.color} label={meta.label} />
                        <span className={styles.summaryCount}>{count}</span>
                      </li>
                    );
                  })}
                </ul>
              </WorkToolbar>

              {/* New proposal form */}
              {showNewProp && (
                <Panel title="New Deployment Proposal" className={styles.formPanel}>
                  <div className={styles.form}>
                    <div className={styles.formGrid}>
                      <Field label="Proposal Title" required>
                        {control => (
                          <input
                            {...control}
                            required
                            value={form.proposal_title}
                            onChange={e => setForm(f => ({ ...f, proposal_title: e.target.value }))}
                            placeholder="e.g. LD Tennis — Full System Deployment"
                            className={fieldControlClassName}
                          />
                        )}
                      </Field>
                      <Field label="Deployment Type">
                        {control => (
                          <select
                            {...control}
                            value={form.proposal_type}
                            onChange={e => setForm(f => ({ ...f, proposal_type: e.target.value as ProposalType }))}
                            className={fieldControlClassName}
                          >
                            {(Object.entries(PROPOSAL_TYPE_META) as [ProposalType, { label: string }][]).map(([k, v]) => (
                              <option key={k} value={k}>{v.label}</option>
                            ))}
                          </select>
                        )}
                      </Field>
                      <Field label="One-time Investment ($)">
                        {control => (
                          <input
                            {...control}
                            type="number" min={0}
                            value={form.one_time_cost}
                            onChange={e => setForm(f => ({ ...f, one_time_cost: e.target.value }))}
                            placeholder="0"
                            className={fieldControlClassName}
                          />
                        )}
                      </Field>
                      <Field label="Monthly Recurring ($)">
                        {control => (
                          <input
                            {...control}
                            type="number" min={0}
                            value={form.monthly_recurring}
                            onChange={e => setForm(f => ({ ...f, monthly_recurring: e.target.value }))}
                            placeholder="0"
                            className={fieldControlClassName}
                          />
                        )}
                      </Field>
                    </div>

                    <Field label="Deployment Scope">
                      {control => (
                        <textarea
                          {...control}
                          value={form.deployment_scope}
                          onChange={e => setForm(f => ({ ...f, deployment_scope: e.target.value }))}
                          placeholder="What is included in this deployment…"
                          rows={3}
                          className={fieldControlClassName}
                        />
                      )}
                    </Field>

                    <div role="group" aria-labelledby={`${tabsId}-modules`}>
                      <p id={`${tabsId}-modules`} className={styles.groupLabel}>Included Modules</p>
                      <div className={styles.toggles}>
                        {MODULES_LIST.map(m => {
                          const active = form.included_modules.includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              className={styles.toggle}
                              aria-pressed={active}
                              onClick={() => setForm(f => ({
                                ...f,
                                included_modules: active ? f.included_modules.filter(x => x !== m) : [...f.included_modules, m],
                              }))}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <Field label="Proposal Notes">
                      {control => (
                        <textarea
                          {...control}
                          value={form.notes}
                          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="Internal notes…"
                          rows={2}
                          className={fieldControlClassName}
                        />
                      )}
                    </Field>

                    <FormActions align="end">
                      <button
                        type="button"
                        disabled={submitting || !form.proposal_title.trim()}
                        onClick={createProposal}
                        {...buttonProps('primary')}
                      >
                        {submitting ? 'Creating…' : 'Create Proposal'}
                      </button>
                    </FormActions>
                  </div>
                </Panel>
              )}

              {/* Proposal cards */}
              <div className={styles.grid}>
                {proposals.map(proposal => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    selected={selectedProp?.id === proposal.id}
                    onClick={() => setSelectedProp(selectedProp?.id === proposal.id ? null : proposal)}
                    onStatusChange={patchProposal}
                  />
                ))}
                {proposals.length === 0 && (
                  <div className={styles.empty}>
                    <StateMessage kind="empty" title="No proposals yet — create your first deployment proposal above." />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════ ONBOARDING TAB ═════════════════════ */}
          {tab === 'onboarding' && (
            <div>
              <div className={styles.summaryBlock}>
                <ul className={styles.summary} aria-label="Deployments by stage">
                  {ONBOARDING_STAGES.map(s => {
                    const count = onboarding.filter(o => o.onboarding_stage === s.key).length;
                    return (
                      <li key={s.key} className={styles.summaryItem}>
                        <span className={styles.hueDot} style={hueVar(s.color)} aria-hidden="true" />
                        <span>{s.label}</span>
                        <span className={styles.summaryCount}>{count}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className={`${styles.grid} ${styles.gridWide}`}>
                {onboarding.map(record => (
                  <OnboardingCard key={record.id} record={record} />
                ))}
                {onboarding.length === 0 && (
                  <div className={styles.empty}>
                    <StateMessage kind="empty" title="No active deployments — onboarding records appear here once created from the pipeline." />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════ MANAGED SERVICES TAB ═══════════════ */}
          {tab === 'managed' && (
            <div>
              {/* MRR bar */}
              <div className={styles.metrics}>
                <MetricStrip>
                  <Metric label="Monthly Recurring Revenue" value={`$${metrics.mrr.toFixed(2)}`} />
                  <Metric label="Active deployments"        value={metrics.active_count} />
                  <Metric label="Renewing soon (30d)"       value={metrics.renewing_soon} />
                  <Metric label="Annual value"              value={`$${(metrics.mrr * 12).toFixed(0)}`} />
                </MetricStrip>
              </div>

              {/* Services list */}
              <TableContainer label="Managed services" minWidth={720}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Client', 'Domain', 'Maintenance', 'MRR', 'SSL', 'Renewal'].map((h, i) => (
                        <th key={i} scope="col" className={h === 'MRR' ? tableStyles.num : undefined}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {services.map(svc => {
                      const maint = MAINTENANCE_META[svc.maintenance_plan] ?? MAINTENANCE_META.standard;
                      const sslState: SemanticTone = svc.ssl_status === 'active' ? 'success' : svc.ssl_status === 'expiring' ? 'warning' : 'error';
                      const renewalDate = svc.renewal_date ? new Date(svc.renewal_date) : null;
                      const renewalSoon = renewalDate && (renewalDate.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                      return (
                        <tr key={svc.id} className={styles.row} data-cancelled={svc.status === 'cancelled' ? 'true' : undefined}>
                          <td className={tableStyles.primary}>
                            {svc.client_name}
                            <span className={tableStyles.meta}>{svc.hosting_provider}</span>
                          </td>
                          <td>
                            <span className={styles.cell}>{svc.domain_name ?? '—'}</span>
                          </td>
                          <td>
                            <span className={styles.tag}>{maint.label}</span>
                          </td>
                          <td className={tableStyles.num}>
                            ${parseFloat(String(svc.monthly_value)).toFixed(0)}<span className={styles.unit}>/mo</span>
                          </td>
                          <td>
                            <StatusDot state={sslState} label={svc.ssl_status} />
                          </td>
                          <td>
                            <span className={styles.renewal}>
                              {renewalDate ? renewalDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                              {renewalSoon && <Badge state="warning" dot={false}>SOON</Badge>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                    {services.length === 0 && (
                      <TableStateRow colSpan={6} kind="empty">
                        No managed services yet
                      </TableStateRow>
                    )}
                  </tbody>
                </table>
              </TableContainer>

              <p className={styles.note}>
                Add managed services via the deployment pipeline — services are created when a client goes live.
              </p>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

// ── ProposalCard ───────────────────────────────────────────────────────────────

function ProposalCard({
  proposal, selected, onStatusChange,
}: {
  proposal: Proposal;
  selected: boolean;
  onClick: () => void;
  onStatusChange: (id: string, s: ProposalStatus) => void;
}) {
  const status    = PROPOSAL_STATUS_META[proposal.status];
  const typeM     = PROPOSAL_TYPE_META[proposal.proposal_type] ?? { label: proposal.proposal_type, color: 'var(--status-inactive)' };
  const monthly   = parseFloat(String(proposal.monthly_recurring))  || 0;
  const oneTime   = parseFloat(String(proposal.one_time_cost))       || 0;

  return (
    <article
      className={styles.card}
      data-selected={selected ? 'true' : undefined}
      style={hueVar(typeM.color)}
    >
      <div className={styles.cardBody}>
        {/* Header row */}
        <div className={styles.cardHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className={styles.cardTitle}>{proposal.proposal_title}</h2>
            <div className={styles.cardSub}>
              {proposal.lead_name ?? 'No lead linked'}{proposal.business_name ? ` · ${proposal.business_name}` : ''}
            </div>
          </div>
          <div className={styles.cardBadges}>
            <span className={styles.typeTag}>
              <span className={styles.hueDot} aria-hidden="true" />
              {typeM.label}
            </span>
            {status
              ? <Badge state={status.color}>{status.label}</Badge>
              : null}
          </div>
        </div>

        {/* Pricing */}
        <div className={styles.pricing}>
          {oneTime > 0 && (
            <div>
              <div className={styles.price}>${oneTime.toLocaleString()}</div>
              <div className={styles.priceLabel}>one-time</div>
            </div>
          )}
          {monthly > 0 && (
            <div>
              <div className={styles.price}>${monthly.toLocaleString()}<span className={styles.unit}>/mo</span></div>
              <div className={styles.priceLabel}>recurring</div>
            </div>
          )}
          {oneTime === 0 && monthly === 0 && (
            <div className={styles.muted}>No pricing set</div>
          )}
        </div>

        {/* Modules */}
        {proposal.included_modules.length > 0 && (
          <div className={styles.tags}>
            {proposal.included_modules.slice(0, 4).map((m, i) => (
              <span key={i} className={styles.tag}>
                {m}
              </span>
            ))}
            {proposal.included_modules.length > 4 && (
              <span className={styles.more}>+{proposal.included_modules.length - 4}</span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className={styles.cardFoot}>
          <div className={styles.date}>
            {new Date(proposal.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
          </div>
          {/* Quick status advance */}
          {proposal.status === 'draft' && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'sent'); }}
              {...buttonProps('secondary', 'sm')}
            >Mark Sent <span aria-hidden="true">→</span></button>
          )}
          {proposal.status === 'sent' && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'viewed'); }}
              {...buttonProps('secondary', 'sm')}
            >Mark Viewed <span aria-hidden="true">→</span></button>
          )}
          {proposal.status === 'viewed' && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'approved'); }}
              {...buttonProps('secondary', 'sm')}
            >Mark Approved <span aria-hidden="true">✓</span></button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── OnboardingCard ─────────────────────────────────────────────────────────────

function OnboardingCard({ record }: { record: OnboardingRecord }) {
  const stage       = ONBOARDING_STAGES.find(s => s.key === record.onboarding_stage) ?? ONBOARDING_STAGES[0];
  const stageIdx    = ONBOARDING_STAGES.findIndex(s => s.key === record.onboarding_stage);
  const progress    = Math.round(((stageIdx + 1) / ONBOARDING_STAGES.length) * 100);
  const checklist   = Array.isArray(record.checklist) ? record.checklist : [];
  const doneCount   = checklist.filter(c => c.done).length;
  const monthly     = parseFloat(String(record.monthly_recurring)) || 0;
  const progressLabelId = useId();

  const daysToLaunch = record.target_launch_date
    ? Math.ceil((new Date(record.target_launch_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const statusDots: { key: keyof typeof record; label: string }[] = [
    { key: 'hosting_status',      label: 'Hosting'      },
    { key: 'domain_status',       label: 'Domain'       },
    { key: 'deployment_status',   label: 'Deployment'   },
    { key: 'integrations_status', label: 'Integrations' },
    { key: 'crm_status',          label: 'CRM'          },
    { key: 'launch_status',       label: 'Launch'       },
  ];

  const statusColor = (val: string) =>
    ['live', 'complete', 'configured', 'syncing'].includes(val) ? 'success' :
    ['in_progress', 'scheduled', 'transferred'].includes(val)   ? 'warning' : 'inactive';

  const launchState: SemanticTone | null = daysToLaunch === null ? null
    : daysToLaunch <= 7 ? 'error' : daysToLaunch <= 14 ? 'warning' : 'inactive';

  return (
    <article className={styles.card} style={hueVar(stage.color)}>
      <div className={styles.cardBody}>
        {/* Header */}
        <div className={styles.cardHead}>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.cardTitle}>{record.client_name}</h2>
            <div className={styles.cardSub}>{record.lead_name ?? ''}{record.business_name ? ` · ${record.business_name}` : ''}</div>
          </div>
          <span className={styles.stage}>
            <span className={styles.hueDot} aria-hidden="true" />
            {stage.label}
          </span>
        </div>

        {/* Progress bar */}
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <span id={progressLabelId} className={styles.label}>Deployment Progress</span>
            <span className={styles.progressValue}>{progress}%</span>
          </div>
          <div
            className={styles.track}
            role="progressbar"
            aria-labelledby={progressLabelId}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className={styles.fill} style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Status dots — the value is spoken, not carried by colour alone */}
        <ul className={styles.checks}>
          {statusDots.map(({ key, label }) => {
            const val   = String(record[key] ?? '');
            const tone  = statusColor(val);
            return (
              <li key={key} className={styles.check} title={val ? `${label}: ${val.replace(/_/g, ' ')}` : label}>
                <span className={styles.checkDot} data-tone={tone} aria-hidden="true" />
                <span>{label}</span>
                {val && <span className={styles.visuallyHidden}>: {val.replace(/_/g, ' ')}</span>}
              </li>
            );
          })}
        </ul>

        {/* Checklist preview */}
        {checklist.length > 0 && (
          <div className={styles.checklist}>
            <div className={styles.checklistHead}>
              <div className={styles.label}>Checklist</div>
              <div className={styles.checklistCount} data-complete={doneCount === checklist.length ? 'true' : undefined}>{doneCount}/{checklist.length}</div>
            </div>
            <div className={`${styles.track} ${styles.checklistTrack}`} aria-hidden="true">
              <div className={styles.fill} data-tone="success" style={{ width: `${checklist.length > 0 ? (doneCount / checklist.length) * 100 : 0}%` }} />
            </div>
            <ul className={styles.items}>
              {checklist.slice(0, 4).map(item => (
                <li key={item.id} className={styles.item} data-done={item.done ? 'true' : undefined}>
                  <span className={styles.box} aria-hidden="true">
                    {item.done && <svg width="7" height="6" viewBox="0 0 7 6" fill="none"><path d="M1 3L3 5L6 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </span>
                  <span>{item.label}</span>
                  {item.done && <span className={styles.visuallyHidden}> (done)</span>}
                </li>
              ))}
            </ul>
            {checklist.length > 4 && (
              <div className={styles.moreTasks}>+{checklist.length - 4} more tasks</div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className={styles.cardFoot}>
          <div>
            {monthly > 0 && (
              <span className={styles.mrr}>${monthly}/mo</span>
            )}
          </div>
          {daysToLaunch !== null && launchState && (
            <Badge state={launchState}>
              {daysToLaunch <= 0 ? 'Overdue' : `${daysToLaunch}d to launch`}
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
}
