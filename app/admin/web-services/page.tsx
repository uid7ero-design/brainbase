'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type LeadStatus =
  | 'new' | 'contacted' | 'discovery' | 'qualified'
  | 'proposal_sent' | 'proposal_approved'
  | 'onboarding' | 'in_deployment' | 'active_client'
  | 'paused' | 'won' | 'lost';

type Priority = 'high' | 'medium' | 'low';

interface WebLead {
  id:                  string;
  created_at:          string;
  updated_at:          string;
  full_name:           string;
  business_name:       string | null;
  email:               string;
  phone:               string | null;
  website_url:         string | null;
  business_type:       string | null;
  service_interest:    string[];
  budget_range:        string | null;
  project_description: string | null;
  status:              LeadStatus;
  source:              string | null;
  notes:               string | null;
  priority:            Priority | null;
  score:               number | null;
  pipeline_notes:      string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const COLUMNS: { status: LeadStatus; label: string; color: string; group: string }[] = [
  { status: 'new',               label: 'New Enquiry',       color: '#38BDF8', group: 'Acquisition'  },
  { status: 'discovery',         label: 'Discovery',         color: '#818CF8', group: 'Acquisition'  },
  { status: 'qualified',         label: 'Qualified',         color: '#6366F1', group: 'Acquisition'  },
  { status: 'proposal_sent',     label: 'Proposal Sent',     color: '#A78BFA', group: 'Conversion'   },
  { status: 'proposal_approved', label: 'Approved',          color: '#C084FC', group: 'Conversion'   },
  { status: 'onboarding',        label: 'Onboarding',        color: '#F59E0B', group: 'Delivery'     },
  { status: 'in_deployment',     label: 'In Deployment',     color: '#F97316', group: 'Delivery'     },
  { status: 'active_client',     label: 'Active Client',     color: '#10B981', group: 'Retention'    },
  { status: 'paused',            label: 'Paused',            color: '#64748B', group: 'Inactive'     },
  { status: 'lost',              label: 'Lost',              color: '#6B7280', group: 'Inactive'     },
];

const PRIORITY_META: Record<Priority, { label: string; color: string; dot: string }> = {
  high:   { label: 'High',   color: '#EF4444', dot: '#EF4444' },
  medium: { label: 'Medium', color: '#F59E0B', dot: '#F59E0B' },
  low:    { label: 'Low',    color: '#6B7280', dot: '#64748B' },
};

const BUDGET_LABELS: Record<string, string> = {
  under_2500:    '< $2.5k',
  '2500_5000':   '$2.5–5k',
  '5000_10000':  '$5–10k',
  '10000_20000': '$10–20k',
  '20000_plus':  '$20k+',
  unsure:        'Unsure',
};

const SERVICE_LABELS: Record<string, string> = {
  website_design: 'Design',
  ai_website:     'AI Website',
  maintenance:    'Maintenance',
  integrations:   'Integrations',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WebServicesPipeline() {
  const [leads,         setLeads]         = useState<WebLead[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [selected,      setSelected]      = useState<WebLead | null>(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [notesEdit,     setNotesEdit]     = useState('');
  const [pipelineNotes, setPipelineNotes] = useState('');
  const [saving,        setSaving]        = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [search,        setSearch]        = useState('');
  const [filterGroup,   setFilterGroup]   = useState<string>('');
  const [dragId,        setDragId]        = useState<string | null>(null);
  const [dragOver,      setDragOver]      = useState<LeadStatus | null>(null);
  const [view,          setView]          = useState<'kanban' | 'list'>('kanban');
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (search) params.set('search', search);
    try {
      const res  = await fetch(`/api/web-services/leads?${params}`);
      const data = await res.json() as { leads: WebLead[]; error?: string };
      if (!res.ok) console.error('[pipeline] fetch error', res.status, data.error);
      setLeads((data.leads ?? []).map(l => ({ ...l, service_interest: l.service_interest ?? [] })));
    } catch (err) {
      console.error('[pipeline] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Patch ──────────────────────────────────────────────────────────────────
  const patchLead = useCallback(async (id: string, patch: Partial<Pick<WebLead, 'status' | 'notes' | 'pipeline_notes' | 'priority' | 'score'>>) => {
    setSaving(true);
    try {
      const res  = await fetch(`/api/web-services/leads/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      const data = await res.json() as { lead: WebLead };
      if (data.lead) {
        setLeads(ls => ls.map(l => l.id === id ? data.lead : l));
        if (selected?.id === id) {
          setSelected(data.lead);
          setNotesEdit(data.lead.notes ?? '');
          setPipelineNotes(data.lead.pipeline_notes ?? '');
        }
      }
    } finally {
      setSaving(false);
    }
  }, [selected]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteLead = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/web-services/leads/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setLeads(ls => ls.filter(l => l.id !== id));
        closeDrawer();
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const openDrawer = (lead: WebLead) => {
    setSelected(lead);
    setNotesEdit(lead.notes ?? '');
    setPipelineNotes(lead.pipeline_notes ?? '');
    setDrawerOpen(true);
    setConfirmDelete(false);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setConfirmDelete(false);
    setTimeout(() => setSelected(null), 220);
  };

  // ── Drag ───────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd   = () => { setDragId(null); setDragOver(null); };
  const onDragOver  = (e: React.DragEvent, status: LeadStatus) => { e.preventDefault(); setDragOver(status); };
  const onDrop      = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    if (!dragId) return;
    const lead = leads.find(l => l.id === dragId);
    if (lead && lead.status !== status) patchLead(dragId, { status });
    setDragId(null); setDragOver(null);
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const groups = [...new Set(COLUMNS.map(c => c.group))];
  const colMap  = new Map(COLUMNS.map(c => [c.status, c]));

  const filtered = leads.filter(l => {
    if (filterGroup) {
      const col = colMap.get(l.status);
      if (!col || col.group !== filterGroup) return false;
    }
    return true;
  });

  const byStatus = (status: LeadStatus) => filtered.filter(l => l.status === status);

  const totalMRR = leads
    .filter(l => l.status === 'active_client')
    .reduce((acc, l) => acc + (l.budget_range === '20000_plus' ? 400 : l.budget_range === '10000_20000' ? 300 : l.budget_range === '5000_10000' ? 200 : l.budget_range === '2500_5000' ? 150 : 89), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '20px 28px 0',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        background: 'rgba(7,8,11,.95)',
        position: 'sticky', top: 52, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(99,102,241,.65)', textTransform: 'uppercase', marginBottom: 4 }}>Web Systems</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>Deployment Pipeline</h1>
          </div>

          {/* Metrics bar */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { value: leads.length,                                      label: 'Total leads',      color: '#38BDF8' },
              { value: leads.filter(l => l.status === 'active_client').length, label: 'Active clients', color: '#10B981' },
              { value: leads.filter(l => ['proposal_sent','proposal_approved'].includes(l.status)).length, label: 'In proposal', color: '#A78BFA' },
              { value: `$${totalMRR}`, label: 'Est. MRR',              color: '#22C55E' },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: m.color, letterSpacing: '-.03em', lineHeight: 1.1 }}>{m.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.40)', letterSpacing: '.04em', marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingBottom: 14, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.35, pointerEvents: 'none' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search leads…"
              style={{
                width: '100%', padding: '7px 10px 7px 32px', borderRadius: 8,
                background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
                color: '#F5F7FA', fontSize: 13, fontFamily: FONT,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Group filter */}
          {groups.map(g => (
            <button
              key={g}
              onClick={() => setFilterGroup(filterGroup === g ? '' : g)}
              style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: filterGroup === g ? 'rgba(99,102,241,.20)' : 'rgba(255,255,255,.04)',
                border: filterGroup === g ? '1px solid rgba(99,102,241,.40)' : '1px solid rgba(255,255,255,.08)',
                color: filterGroup === g ? '#A78BFA' : 'rgba(255,255,255,.45)',
                cursor: 'pointer', fontFamily: FONT, transition: 'all .14s', whiteSpace: 'nowrap',
              }}
            >{g}</button>
          ))}

          <div style={{ flex: 1 }} />

          {/* View toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, overflow: 'hidden' }}>
            {(['kanban', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                background: view === v ? 'rgba(99,102,241,.20)' : 'transparent',
                color:      view === v ? '#A78BFA' : 'rgba(255,255,255,.40)',
                border: 'none', transition: 'all .14s', textTransform: 'capitalize',
              }}>{v}</button>
            ))}
          </div>

          <button
            onClick={fetchLeads}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
              color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontFamily: FONT, transition: 'all .14s',
            }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'rgba(255,255,255,.28)', fontSize: 13 }}>
          Loading pipeline…
        </div>
      )}

      {/* ── KANBAN VIEW ──────────────────────────────────────────────────────── */}
      {!loading && view === 'kanban' && (
        <div style={{
          overflowX: 'auto', padding: '20px 24px 40px',
          display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: 'calc(100vh - 150px)',
        }}>
          {COLUMNS.map(col => {
            const cards  = byStatus(col.status);
            const isOver = dragOver === col.status;
            return (
              <div
                key={col.status}
                onDragOver={e => onDragOver(e, col.status)}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => onDrop(e, col.status)}
                style={{
                  width: 252, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                {/* Column header */}
                <div style={{
                  padding: '13px 14px 11px', borderRadius: 10, marginBottom: 4,
                  background: isOver ? `${col.color}10` : 'rgba(255,255,255,.03)',
                  border: isOver ? `1px solid ${col.color}30` : '1px solid rgba(255,255,255,.07)',
                  transition: 'all .15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, boxShadow: `0 0 7px ${col.color}` }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F2F5', letterSpacing: '-.01em' }}>{col.label}</span>
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: col.color,
                      background: `${col.color}14`, border: `1px solid ${col.color}28`,
                      padding: '2px 9px', borderRadius: 20, minWidth: 24, textAlign: 'center',
                    }}>{cards.length}</div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.30)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    {col.group}
                  </div>
                </div>

                {/* Drop zone indicator */}
                {isOver && (
                  <div style={{
                    height: 3, borderRadius: 2,
                    background: `linear-gradient(90deg, ${col.color}60, transparent)`,
                    marginBottom: 4,
                  }} />
                )}

                {/* Cards */}
                {cards.map(lead => (
                  <KanbanCard
                    key={lead.id}
                    lead={lead}
                    col={col}
                    isDragging={dragId === lead.id}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onClick={() => openDrawer(lead)}
                  />
                ))}

                {cards.length === 0 && !isOver && (
                  <div style={{
                    padding: '24px 14px', borderRadius: 10, textAlign: 'center',
                    border: '1px dashed rgba(255,255,255,.07)',
                    color: 'rgba(255,255,255,.20)', fontSize: 12, letterSpacing: '.02em',
                  }}>
                    Drop here
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────────────────── */}
      {!loading && view === 'list' && (
        <div style={{ padding: '20px 28px' }}>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,.07)' }}>
            {/* List header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 140px 100px 80px 80px 100px',
              padding: '10px 20px', background: 'rgba(255,255,255,.03)',
              borderBottom: '1px solid rgba(255,255,255,.07)',
            }}>
              {['Contact', 'Status', 'Budget', 'Priority', 'Score', 'Updated'].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>{h}</div>
              ))}
            </div>
            {filtered.map((lead, i) => {
              const col      = colMap.get(lead.status);
              const priority = PRIORITY_META[lead.priority ?? 'medium'];
              return (
                <div
                  key={lead.id}
                  onClick={() => openDrawer(lead)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 140px 100px 80px 80px 100px',
                    padding: '12px 20px', cursor: 'pointer',
                    borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                    background: 'rgba(255,255,255,.015)',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.035)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.015)')}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', marginBottom: 2 }}>{lead.full_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>{lead.business_name ?? lead.email}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {col && (
                      <div style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                        background: `${col.color}14`, border: `1px solid ${col.color}25`,
                        color: col.color, whiteSpace: 'nowrap',
                      }}>{col.label}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'rgba(255,255,255,.55)' }}>
                    {BUDGET_LABELS[lead.budget_range ?? ''] ?? '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: priority.dot }} />
                    <span style={{ fontSize: 11, color: priority.color }}>{priority.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: '#F5F7FA',
                      background: 'rgba(255,255,255,.08)', borderRadius: 6,
                      padding: '2px 8px', minWidth: 32, textAlign: 'center',
                    }}>{lead.score ?? 0}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,.28)' }}>
                    {new Date(lead.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
                No leads match current filters
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DETAIL DRAWER ────────────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        pointerEvents: drawerOpen ? 'auto' : 'none',
      }}>
        {/* Backdrop */}
        <div
          onClick={closeDrawer}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,.55)',
            opacity: drawerOpen ? 1 : 0,
            transition: 'opacity .20s',
          }}
        />

        {/* Panel */}
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 480,
          background: 'rgba(9,10,14,.98)',
          borderLeft: '1px solid rgba(255,255,255,.08)',
          backdropFilter: 'blur(20px)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .22s cubic-bezier(.32,.72,0,1)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {selected && (
            <DrawerContent
              lead={selected}
              notesEdit={notesEdit}
              setNotesEdit={setNotesEdit}
              pipelineNotes={pipelineNotes}
              setPipelineNotes={setPipelineNotes}
              saving={saving}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              deleting={deleting}
              onClose={closeDrawer}
              onPatch={patchLead}
              onDelete={deleteLead}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── KanbanCard ─────────────────────────────────────────────────────────────────

function KanbanCard({
  lead, col, isDragging, onDragStart, onDragEnd, onClick,
}: {
  lead: WebLead;
  col: typeof COLUMNS[number];
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const priority = PRIORITY_META[lead.priority ?? 'medium'];

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
        background: hov ? 'rgba(255,255,255,.055)' : 'rgba(255,255,255,.03)',
        border: hov ? '1px solid rgba(255,255,255,.13)' : '1px solid rgba(255,255,255,.07)',
        opacity: isDragging ? 0.40 : 1,
        transform: hov && !isDragging ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all .15s',
        userSelect: 'none',
      }}>
      {/* Top: name + priority */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F2F5', marginBottom: 3, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.full_name}</div>
          {lead.business_name && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.business_name}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, paddingTop: 1 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: priority.dot }} />
          {(lead.score ?? 0) > 0 && (
            <div style={{
              fontSize: 11, fontWeight: 700, color: col.color,
              background: `${col.color}14`, padding: '2px 7px', borderRadius: 20,
            }}>{lead.score}</div>
          )}
        </div>
      </div>

      {/* Service tags */}
      {lead.service_interest.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {lead.service_interest.slice(0, 3).map((s, i) => (
            <span key={i} style={{
              fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
              color: 'rgba(226,232,240,.52)', background: 'rgba(255,255,255,.05)',
              border: '1px solid rgba(255,255,255,.09)',
            }}>{SERVICE_LABELS[s] ?? s}</span>
          ))}
        </div>
      )}

      {/* Budget + date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: col.color }}>
          {BUDGET_LABELS[lead.budget_range ?? ''] ?? '—'}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)' }}>
          {new Date(lead.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Pipeline note snippet */}
      {lead.pipeline_notes && (
        <div style={{
          marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,.35)', lineHeight: 1.5,
          borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 9,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        } as React.CSSProperties}>
          {lead.pipeline_notes}
        </div>
      )}
    </div>
  );
}

// ── DrawerContent ──────────────────────────────────────────────────────────────

function DrawerContent({
  lead, notesEdit, setNotesEdit, pipelineNotes, setPipelineNotes,
  saving, confirmDelete, setConfirmDelete, deleting,
  onClose, onPatch, onDelete,
}: {
  lead: WebLead;
  notesEdit: string;
  setNotesEdit: (v: string) => void;
  pipelineNotes: string;
  setPipelineNotes: (v: string) => void;
  saving: boolean;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  deleting: boolean;
  onClose: () => void;
  onPatch: (id: string, patch: Partial<Pick<WebLead, 'status' | 'notes' | 'pipeline_notes' | 'priority' | 'score'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const col      = COLUMNS.find(c => c.status === lead.status);
  const priority = PRIORITY_META[lead.priority ?? 'medium'];
  const FONT     = 'var(--font-inter), "Inter", -apple-system, sans-serif';

  return (
    <>
      {/* Drawer header */}
      <div style={{
        padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#F5F7FA', marginBottom: 4, letterSpacing: '-.01em' }}>{lead.full_name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.40)' }}>{lead.business_name ?? lead.email}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.35)',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 4px',
          flexShrink: 0, fontFamily: FONT,
        }}>✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Status + priority row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {col && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8,
              background: `${col.color}12`, border: `1px solid ${col.color}28`,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: col.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: col.color }}>{col.label}</span>
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: priority.dot }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: priority.color }}>{priority.label} Priority</span>
          </div>
          <div style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
            color: '#F5F7FA',
          }}>Score: {lead.score ?? 0}</div>
        </div>

        {/* Change status */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>Move to stage</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COLUMNS.map(c => (
              <button
                key={c.status}
                disabled={saving || lead.status === c.status}
                onClick={() => onPatch(lead.id, { status: c.status })}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  cursor: lead.status === c.status ? 'default' : 'pointer',
                  background: lead.status === c.status ? `${c.color}20` : 'rgba(255,255,255,.04)',
                  border: lead.status === c.status ? `1px solid ${c.color}45` : '1px solid rgba(255,255,255,.09)',
                  color: lead.status === c.status ? c.color : 'rgba(255,255,255,.45)',
                  fontFamily: FONT, transition: 'all .13s', opacity: saving ? 0.6 : 1,
                }}
              >{c.label}</button>
            ))}
          </div>
        </div>

        {/* Priority + score */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>Priority</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['high', 'medium', 'low'] as Priority[]).map(p => (
                <button
                  key={p}
                  onClick={() => onPatch(lead.id, { priority: p })}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: FONT, transition: 'all .13s',
                    background: lead.priority === p ? `${PRIORITY_META[p].dot}18` : 'rgba(255,255,255,.04)',
                    border: lead.priority === p ? `1px solid ${PRIORITY_META[p].dot}40` : '1px solid rgba(255,255,255,.08)',
                    color: lead.priority === p ? PRIORITY_META[p].color : 'rgba(255,255,255,.40)',
                  }}
                >{PRIORITY_META[p].label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>Score (0–100)</div>
            <input
              type="number" min={0} max={100}
              defaultValue={lead.score ?? 0}
              onBlur={e => {
                const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                if (v !== (lead.score ?? 0)) onPatch(lead.id, { score: v });
              }}
              style={{
                width: 80, padding: '7px 10px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
                color: '#F5F7FA', fontFamily: FONT, outline: 'none', textAlign: 'center',
              }}
            />
          </div>
        </div>

        {/* Lead details */}
        <FieldBlock label="Contact">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>{lead.email}</span>
            {lead.phone && <span style={{ color: 'rgba(255,255,255,.45)' }}>{lead.phone}</span>}
            {lead.website_url && (
              <a href={lead.website_url} target="_blank" rel="noopener noreferrer" style={{ color: '#818CF8', fontSize: 11 }}>{lead.website_url}</a>
            )}
          </div>
        </FieldBlock>

        {lead.project_description && (
          <FieldBlock label="Project Description">
            <p style={{ lineHeight: 1.6, margin: 0 }}>{lead.project_description}</p>
          </FieldBlock>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          {lead.budget_range && (
            <FieldBlock label="Budget" compact>
              {({ BUDGET_LABELS } as Record<string, Record<string, string>>).BUDGET_LABELS?.[lead.budget_range] ?? lead.budget_range}
            </FieldBlock>
          )}
          {lead.service_interest.length > 0 && (
            <FieldBlock label="Services" compact>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {lead.service_interest.map((s, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)', color: '#818CF8' }}>
                    {SERVICE_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </FieldBlock>
          )}
        </div>

        {/* Pipeline notes */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>Pipeline Notes</div>
          <textarea
            value={pipelineNotes}
            onChange={e => setPipelineNotes(e.target.value)}
            placeholder="Internal operational notes…"
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical',
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
              color: '#F5F7FA', fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
              lineHeight: 1.55,
            }}
          />
          <button
            disabled={saving || pipelineNotes === (lead.pipeline_notes ?? '')}
            onClick={() => onPatch(lead.id, { pipeline_notes: pipelineNotes })}
            style={{
              marginTop: 6, padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)',
              color: '#A78BFA', cursor: 'pointer', fontFamily: FONT, opacity: saving ? 0.5 : 1,
            }}>
            {saving ? 'Saving…' : 'Save pipeline notes'}
          </button>
        </div>

        {/* Client notes */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>Client Notes</div>
          <textarea
            value={notesEdit}
            onChange={e => setNotesEdit(e.target.value)}
            placeholder="Notes visible to client…"
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical',
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
              color: '#F5F7FA', fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
              lineHeight: 1.55,
            }}
          />
          <button
            disabled={saving || notesEdit === (lead.notes ?? '')}
            onClick={() => onPatch(lead.id, { notes: notesEdit })}
            style={{
              marginTop: 6, padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.30)',
              color: '#34D399', cursor: 'pointer', fontFamily: FONT, opacity: saving ? 0.5 : 1,
            }}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>

        {/* Timestamps */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.22)', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14, lineHeight: 1.7 }}>
          <div>Created: {new Date(lead.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div>Updated: {new Date(lead.updated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          {lead.source && <div>Source: {lead.source}</div>}
        </div>

        {/* Delete */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.06)' }}>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: 'transparent', border: '1px solid rgba(239,68,68,.22)',
                color: 'rgba(239,68,68,.55)', cursor: 'pointer', fontFamily: FONT, transition: 'all .13s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.08)'; e.currentTarget.style.color = 'rgba(239,68,68,.80)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(239,68,68,.55)'; }}>
              Delete lead
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.40)' }}>Confirm delete?</span>
              <button
                disabled={deleting}
                onClick={() => onDelete(lead.id)}
                style={{
                  padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                  background: 'rgba(239,68,68,.20)', border: '1px solid rgba(239,68,68,.40)',
                  color: '#FCA5A5', cursor: 'pointer', fontFamily: FONT, opacity: deleting ? 0.5 : 1,
                }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 12,
                  background: 'transparent', border: '1px solid rgba(255,255,255,.10)',
                  color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontFamily: FONT,
                }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── FieldBlock helper ──────────────────────────────────────────────────────────

function FieldBlock({ label, children, compact }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ marginBottom: compact ? 0 : 18, flex: compact ? 1 : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 7 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'rgba(226,232,240,.75)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}
