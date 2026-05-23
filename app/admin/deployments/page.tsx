'use client';

import { useState, useEffect, useCallback } from 'react';

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

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; color: string }> = {
  draft:    { label: 'Draft',    color: '#64748B' },
  sent:     { label: 'Sent',     color: '#38BDF8' },
  viewed:   { label: 'Viewed',   color: '#F59E0B' },
  approved: { label: 'Approved', color: '#10B981' },
  rejected: { label: 'Rejected', color: '#EF4444' },
};

const PROPOSAL_TYPE_META: Record<ProposalType, { label: string; color: string }> = {
  website_deployment:     { label: 'Website',     color: '#6366F1' },
  operational_deployment: { label: 'Operational', color: '#8B5CF6' },
  coaching_deployment:    { label: 'Coaching',    color: '#10B981' },
  automation_deployment:  { label: 'Automation',  color: '#F59E0B' },
  full_system:            { label: 'Full System', color: '#EC4899' },
};

const ONBOARDING_STAGES = [
  { key: 'discovery',            label: 'Discovery',         color: '#6366F1' },
  { key: 'content_collection',   label: 'Content',           color: '#8B5CF6' },
  { key: 'infrastructure_setup', label: 'Infrastructure',    color: '#38BDF8' },
  { key: 'website_build',        label: 'Website Build',     color: '#A78BFA' },
  { key: 'integrations',         label: 'Integrations',      color: '#F59E0B' },
  { key: 'review',               label: 'Review',            color: '#F97316' },
  { key: 'deployment',           label: 'Deployment',        color: '#EC4899' },
  { key: 'live',                 label: '🟢 Live',            color: '#10B981' },
  { key: 'maintenance',          label: 'Maintenance',       color: '#22C55E' },
];

const MAINTENANCE_META: Record<string, { label: string; color: string }> = {
  none:        { label: 'None',         color: '#6B7280' },
  standard:    { label: 'Standard',     color: '#38BDF8' },
  growth:      { label: 'Growth',       color: '#A78BFA' },
  full_system: { label: 'Full System',  color: '#10B981' },
};

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

  return (
    <div style={{ minHeight: '100vh', background: '#08090C', color: '#F5F7FA', fontFamily: FONT }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '20px 28px 0',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        background: 'rgba(7,8,11,.95)',
        position: 'sticky', top: 52, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(139,92,246,.65)', textTransform: 'uppercase', marginBottom: 4 }}>Web Systems</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>Deployment Operations</h1>
          </div>

          {/* Revenue metrics */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { value: `$${metrics.mrr.toFixed(0)}/mo`, label: 'Monthly Recurring', color: '#10B981' },
              { value: metrics.active_count,             label: 'Active deployments', color: '#38BDF8' },
              { value: pendingCount,                     label: 'Proposals pending',  color: '#A78BFA' },
              { value: activeOnboarding,                 label: 'In delivery',        color: '#F59E0B' },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: m.color, letterSpacing: '-.03em', lineHeight: 1.1 }}>{m.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.40)', letterSpacing: '.04em', marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, paddingBottom: 0 }}>
          {([
            { key: 'proposals',  label: 'Proposals',        count: proposals.length   },
            { key: 'onboarding', label: 'Deployments',      count: onboarding.length  },
            { key: 'managed',    label: 'Managed Services', count: services.length    },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 20px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT, transition: 'all .14s',
                background:  tab === t.key ? 'rgba(139,92,246,.12)' : 'transparent',
                borderBottom: tab === t.key ? '2px solid #8B5CF6' : '2px solid transparent',
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                color: tab === t.key ? '#C4B5FD' : 'rgba(255,255,255,.42)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
              {t.label}
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: tab === t.key ? '#A78BFA' : 'rgba(255,255,255,.28)',
                background: tab === t.key ? 'rgba(139,92,246,.20)' : 'rgba(255,255,255,.07)',
                padding: '2px 9px', borderRadius: 20, lineHeight: 1.4,
              }}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'rgba(255,255,255,.28)', fontSize: 13 }}>
          Loading deployments…
        </div>
      ) : (
        <div style={{ padding: '24px 28px' }}>

          {/* ════════════════════════════════ PROPOSALS TAB ══════════════════════ */}
          {tab === 'proposals' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {/* Stat pills */}
                  {(['draft', 'sent', 'viewed', 'approved', 'rejected'] as ProposalStatus[]).map(s => {
                    const count = proposals.filter(p => p.status === s).length;
                    const meta  = PROPOSAL_STATUS_META[s];
                    return (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 13px', borderRadius: 20, background: `${meta.color}10`, border: `1px solid ${meta.color}28` }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, opacity: 0.8 }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => setShowNewProp(v => !v)}
                  style={{
                    padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: showNewProp ? 'rgba(139,92,246,.25)' : 'rgba(139,92,246,.16)',
                    border: '1px solid rgba(139,92,246,.40)',
                    color: '#C4B5FD', cursor: 'pointer', fontFamily: FONT,
                  }}>
                  {showNewProp ? '✕ Cancel' : '+ New Proposal'}
                </button>
              </div>

              {/* New proposal form */}
              {showNewProp && (
                <div style={{
                  marginBottom: 24, padding: '28px', borderRadius: 14,
                  background: 'rgba(139,92,246,.05)', border: '1px solid rgba(139,92,246,.16)',
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', marginBottom: 20, letterSpacing: '-.01em' }}>New Deployment Proposal</div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                    <FormField label="Proposal Title" required>
                      <input
                        value={form.proposal_title}
                        onChange={e => setForm(f => ({ ...f, proposal_title: e.target.value }))}
                        placeholder="e.g. LD Tennis — Full System Deployment"
                        style={inputStyle}
                      />
                    </FormField>
                    <FormField label="Deployment Type">
                      <select
                        value={form.proposal_type}
                        onChange={e => setForm(f => ({ ...f, proposal_type: e.target.value as ProposalType }))}
                        style={inputStyle}
                      >
                        {(Object.entries(PROPOSAL_TYPE_META) as [ProposalType, { label: string }][]).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="One-time Investment ($)">
                      <input
                        type="number" min={0}
                        value={form.one_time_cost}
                        onChange={e => setForm(f => ({ ...f, one_time_cost: e.target.value }))}
                        placeholder="0"
                        style={inputStyle}
                      />
                    </FormField>
                    <FormField label="Monthly Recurring ($)">
                      <input
                        type="number" min={0}
                        value={form.monthly_recurring}
                        onChange={e => setForm(f => ({ ...f, monthly_recurring: e.target.value }))}
                        placeholder="0"
                        style={inputStyle}
                      />
                    </FormField>
                  </div>

                  <FormField label="Deployment Scope">
                    <textarea
                      value={form.deployment_scope}
                      onChange={e => setForm(f => ({ ...f, deployment_scope: e.target.value }))}
                      placeholder="What is included in this deployment…"
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
                    />
                  </FormField>

                  <FormField label="Included Modules">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {MODULES_LIST.map(m => {
                        const active = form.included_modules.includes(m);
                        return (
                          <button
                            key={m}
                            onClick={() => setForm(f => ({
                              ...f,
                              included_modules: active ? f.included_modules.filter(x => x !== m) : [...f.included_modules, m],
                            }))}
                            style={{
                              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', fontFamily: FONT, transition: 'all .13s',
                              background: active ? 'rgba(99,102,241,.20)' : 'rgba(255,255,255,.04)',
                              border: active ? '1px solid rgba(99,102,241,.45)' : '1px solid rgba(255,255,255,.09)',
                              color: active ? '#A78BFA' : 'rgba(255,255,255,.45)',
                            }}>
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </FormField>

                  <FormField label="Proposal Notes">
                    <textarea
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Internal notes…"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </FormField>

                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      disabled={submitting || !form.proposal_title.trim()}
                      onClick={createProposal}
                      style={{
                        padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                        background: 'rgba(139,92,246,.24)', border: '1px solid rgba(139,92,246,.48)',
                        color: '#F5F7FA', cursor: 'pointer', fontFamily: FONT,
                        opacity: submitting || !form.proposal_title.trim() ? 0.5 : 1,
                      }}>
                      {submitting ? 'Creating…' : 'Create Proposal'}
                    </button>
                  </div>
                </div>
              )}

              {/* Proposal cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
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
                  <div style={{ gridColumn: '1/-1', padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13, border: '1px dashed rgba(255,255,255,.08)', borderRadius: 12 }}>
                    No proposals yet — create your first deployment proposal above.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════ ONBOARDING TAB ═════════════════════ */}
          {tab === 'onboarding' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {ONBOARDING_STAGES.map(s => {
                  const count = onboarding.filter(o => o.onboarding_stage === s.key).length;
                  return (
                    <div key={s.key} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '5px 13px', borderRadius: 20,
                      background: `${s.color}10`, border: `1px solid ${s.color}28`,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: s.color, opacity: 0.8 }}>{count}</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
                {onboarding.map(record => (
                  <OnboardingCard key={record.id} record={record} />
                ))}
                {onboarding.length === 0 && (
                  <div style={{ gridColumn: '1/-1', padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13, border: '1px dashed rgba(255,255,255,.08)', borderRadius: 12 }}>
                    No active deployments — onboarding records appear here once created from the pipeline.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════════════════════════════════ MANAGED SERVICES TAB ═══════════════ */}
          {tab === 'managed' && (
            <div>
              {/* MRR bar */}
              <div style={{
                display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24,
                padding: '20px 24px', borderRadius: 14,
                background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.14)',
              }}>
                {[
                  { label: 'Monthly Recurring Revenue', value: `$${metrics.mrr.toFixed(2)}`, color: '#10B981', big: true },
                  { label: 'Active deployments', value: metrics.active_count, color: '#38BDF8', big: false },
                  { label: 'Renewing soon (30d)', value: metrics.renewing_soon, color: '#F59E0B', big: false },
                  { label: 'Annual value', value: `$${(metrics.mrr * 12).toFixed(0)}`, color: '#A78BFA', big: false },
                ].map((m, i) => (
                  <div key={i} style={{ flex: m.big ? '1 1 200px' : '0 0 auto' }}>
                    <div style={{ fontSize: m.big ? 32 : 22, fontWeight: 700, color: m.color, letterSpacing: '-.03em', marginBottom: 4, lineHeight: 1.1 }}>{m.value}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', letterSpacing: '.03em' }}>{m.label}</div>
                  </div>
                ))}
              </div>

              {/* Services list */}
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,.07)' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 140px 110px 100px 80px 110px',
                  padding: '12px 20px', background: 'rgba(255,255,255,.03)',
                  borderBottom: '1px solid rgba(255,255,255,.07)',
                }}>
                  {['Client', 'Domain', 'Maintenance', 'MRR', 'SSL', 'Renewal'].map((h, i) => (
                    <div key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>{h}</div>
                  ))}
                </div>

                {services.map((svc, i) => {
                  const maint = MAINTENANCE_META[svc.maintenance_plan] ?? MAINTENANCE_META.standard;
                  const sslColor = svc.ssl_status === 'active' ? '#10B981' : svc.ssl_status === 'expiring' ? '#F59E0B' : '#EF4444';
                  const renewalDate = svc.renewal_date ? new Date(svc.renewal_date) : null;
                  const renewalSoon = renewalDate && (renewalDate.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                  return (
                    <div key={svc.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 140px 110px 100px 80px 110px',
                      padding: '14px 20px',
                      borderBottom: i < services.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                      background: svc.status === 'active' ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.008)',
                      opacity: svc.status === 'cancelled' ? 0.45 : 1,
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', marginBottom: 2 }}>{svc.client_name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)' }}>{svc.hosting_provider}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'rgba(255,255,255,.55)', overflow: 'hidden' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.domain_name ?? '—'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: `${maint.color}12`, border: `1px solid ${maint.color}25`, color: maint.color }}>{maint.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#10B981' }}>
                        ${parseFloat(String(svc.monthly_value)).toFixed(0)}<span style={{ fontSize: 10, color: 'rgba(255,255,255,.30)', fontWeight: 400, marginLeft: 2 }}>/mo</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sslColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: sslColor, display: 'inline-block' }} />
                          {svc.ssl_status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: renewalSoon ? '#F59E0B' : 'rgba(255,255,255,.35)' }}>
                        {renewalDate ? renewalDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                        {renewalSoon && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.25)', padding: '1px 5px', borderRadius: 20 }}>SOON</span>}
                      </div>
                    </div>
                  );
                })}

                {services.length === 0 && (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
                    No managed services yet
                  </div>
                )}
              </div>

              <p style={{ fontSize: 12, color: 'rgba(255,255,255,.22)', marginTop: 12, textAlign: 'center' }}>
                Add managed services via the deployment pipeline — services are created when a client goes live.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ProposalCard ───────────────────────────────────────────────────────────────

function ProposalCard({
  proposal, selected, onClick, onStatusChange,
}: {
  proposal: Proposal;
  selected: boolean;
  onClick: () => void;
  onStatusChange: (id: string, s: ProposalStatus) => void;
}) {
  const [hov, setHov] = useState(false);
  const status    = PROPOSAL_STATUS_META[proposal.status];
  const typeM     = PROPOSAL_TYPE_META[proposal.proposal_type] ?? { label: proposal.proposal_type, color: '#64748B' };
  const monthly   = parseFloat(String(proposal.monthly_recurring))  || 0;
  const oneTime   = parseFloat(String(proposal.one_time_cost))       || 0;
  const FONT      = 'var(--font-inter), "Inter", -apple-system, sans-serif';

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 14, overflow: 'hidden',
        background: selected ? 'rgba(139,92,246,.08)' : hov ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.025)',
        border: selected ? '1px solid rgba(139,92,246,.30)' : hov ? '1px solid rgba(255,255,255,.12)' : '1px solid rgba(255,255,255,.07)',
        transition: 'all .18s',
      }}>
      {/* Top accent */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${typeM.color}80, transparent)` }} />

      <div style={{ padding: '18px 20px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', marginBottom: 3, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proposal.proposal_title}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.40)' }}>
              {proposal.lead_name ?? 'No lead linked'}{proposal.business_name ? ` · ${proposal.business_name}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: `${typeM.color}12`, border: `1px solid ${typeM.color}25`, color: typeM.color }}>
              {typeM.label}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: `${status.color}12`, border: `1px solid ${status.color}25`, color: status.color }}>
              {status.label}
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
          {oneTime > 0 && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#F0F2F5', letterSpacing: '-.03em', lineHeight: 1.15 }}>${oneTime.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>one-time</div>
            </div>
          )}
          {monthly > 0 && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981', letterSpacing: '-.03em', lineHeight: 1.15 }}>${monthly.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,.32)', marginLeft: 2 }}>/mo</span></div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>recurring</div>
            </div>
          )}
          {oneTime === 0 && monthly === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.25)', paddingTop: 4 }}>No pricing set</div>
          )}
        </div>

        {/* Modules */}
        {proposal.included_modules.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
            {proposal.included_modules.slice(0, 4).map((m, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 20, color: 'rgba(226,232,240,.50)', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)' }}>
                {m}
              </span>
            ))}
            {proposal.included_modules.length > 4 && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', alignSelf: 'center' }}>+{proposal.included_modules.length - 4}</span>
            )}
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)' }}>
            {new Date(proposal.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
          </div>
          {/* Quick status advance */}
          {proposal.status === 'draft' && (
            <button
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'sent'); }}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                background: 'rgba(56,189,248,.14)', border: '1px solid rgba(56,189,248,.32)',
                color: '#38BDF8', cursor: 'pointer', fontFamily: FONT,
              }}>Mark Sent →</button>
          )}
          {proposal.status === 'sent' && (
            <button
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'viewed'); }}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.32)',
                color: '#F59E0B', cursor: 'pointer', fontFamily: FONT,
              }}>Mark Viewed →</button>
          )}
          {proposal.status === 'viewed' && (
            <button
              onClick={e => { e.stopPropagation(); onStatusChange(proposal.id, 'approved'); }}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                background: 'rgba(16,185,129,.16)', border: '1px solid rgba(16,185,129,.36)',
                color: '#34D399', cursor: 'pointer', fontFamily: FONT,
              }}>Mark Approved ✓</button>
          )}
        </div>
      </div>
    </div>
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
    ['live', 'complete', 'configured', 'syncing'].includes(val) ? '#10B981' :
    ['in_progress', 'scheduled', 'transferred'].includes(val)   ? '#F59E0B' : '#64748B';

  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
    }}>
      {/* Stage accent */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${stage.color}80, transparent)` }} />

      <div style={{ padding: '18px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', marginBottom: 3 }}>{record.client_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.38)' }}>{record.lead_name ?? ''}{record.business_name ? ` · ${record.business_name}` : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: stage.color, boxShadow: `0 0 6px ${stage.color}` }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: stage.color }}>{stage.label}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.35)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Deployment Progress</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: stage.color }}>{progress}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.08)' }}>
            <div style={{ height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${stage.color}, ${stage.color}80)`, width: `${progress}%`, transition: 'width .4s' }} />
          </div>
        </div>

        {/* Status dots */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {statusDots.map(({ key, label }) => {
            const val   = String(record[key] ?? '');
            const color = statusColor(val);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.48)' }}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Checklist preview */}
        {checklist.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 9, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.35)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Checklist</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: doneCount === checklist.length ? '#10B981' : 'rgba(255,255,255,.40)' }}>{doneCount}/{checklist.length}</div>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.07)', marginBottom: 10 }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#10B981', width: `${checklist.length > 0 ? (doneCount / checklist.length) * 100 : 0}%`, transition: 'width .3s' }} />
            </div>
            {checklist.slice(0, 4).map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                <div style={{
                  width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                  background: item.done ? 'rgba(16,185,129,.20)' : 'rgba(255,255,255,.06)',
                  border: item.done ? '1px solid rgba(16,185,129,.45)' : '1px solid rgba(255,255,255,.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.done && <svg width="7" height="6" viewBox="0 0 7 6" fill="none"><path d="M1 3L3 5L6 1" stroke="#34D399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span style={{ fontSize: 12, color: item.done ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.68)', textDecoration: item.done ? 'line-through' : 'none', lineHeight: 1.4 }}>{item.label}</span>
              </div>
            ))}
            {checklist.length > 4 && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 4 }}>+{checklist.length - 4} more tasks</div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 10 }}>
          <div>
            {monthly > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981' }}>${monthly}/mo</span>
            )}
          </div>
          {daysToLaunch !== null && (
            <div style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
              background: daysToLaunch <= 7 ? 'rgba(239,68,68,.12)' : daysToLaunch <= 14 ? 'rgba(245,158,11,.10)' : 'rgba(255,255,255,.05)',
              border: daysToLaunch <= 7 ? '1px solid rgba(239,68,68,.25)' : daysToLaunch <= 14 ? '1px solid rgba(245,158,11,.22)' : '1px solid rgba(255,255,255,.08)',
              color: daysToLaunch <= 7 ? '#FCA5A5' : daysToLaunch <= 14 ? '#FCD34D' : 'rgba(255,255,255,.35)',
            }}>
              {daysToLaunch <= 0 ? 'Overdue' : `${daysToLaunch}d to launch`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', marginBottom: 7 }}>
        {label}{required && <span style={{ color: '#EF4444', marginLeft: 3 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
  background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
  color: '#F5F7FA', fontFamily: 'var(--font-inter), "Inter", -apple-system, sans-serif',
  outline: 'none', boxSizing: 'border-box',
};
