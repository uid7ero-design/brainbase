'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import LeadMessages from './LeadMessages';
import {
  PageHeader,
  WorkToolbar,
  ToolbarSearch,
  MetricStrip,
  Metric,
  SlidePanel,
  StateMessage,
  TableContainer,
  TableStateRow,
  tableStyles,
  Field,
  fieldControlClassName,
  buttonProps,
} from '@/components/ui/app';
import styles from './WebServices.module.css';

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

// Visual-convergence (remaining visual islands pass): each stage keeps its
// own hue (a genuine data encoding), now resolved per theme from
// WebServices.module.css so it stays >= 3:1 in light and dark. The hue is
// only used on dots, borders and faint tints; stage text uses text tokens.
const COLUMNS: { status: LeadStatus; label: string; color: string; group: string }[] = [
  { status: 'new',               label: 'New Enquiry',       color: 'var(--stage-new)',               group: 'Acquisition'  },
  { status: 'discovery',         label: 'Discovery',         color: 'var(--stage-discovery)',         group: 'Acquisition'  },
  { status: 'qualified',         label: 'Qualified',         color: 'var(--stage-qualified)',         group: 'Acquisition'  },
  { status: 'proposal_sent',     label: 'Proposal Sent',     color: 'var(--stage-proposal-sent)',     group: 'Conversion'   },
  { status: 'proposal_approved', label: 'Approved',          color: 'var(--stage-proposal-approved)', group: 'Conversion'   },
  { status: 'onboarding',        label: 'Onboarding',        color: 'var(--stage-onboarding)',        group: 'Delivery'     },
  { status: 'in_deployment',     label: 'In Deployment',     color: 'var(--stage-in-deployment)',     group: 'Delivery'     },
  { status: 'active_client',     label: 'Active Client',     color: 'var(--stage-active-client)',     group: 'Retention'    },
  { status: 'paused',            label: 'Paused',            color: 'var(--stage-paused)',            group: 'Inactive'     },
  { status: 'lost',              label: 'Lost',              color: 'var(--stage-lost)',              group: 'Inactive'     },
];

// Priority is semantic: text on the AA status tokens, the dot repeats it.
const PRIORITY_META: Record<Priority, { label: string; color: string; dot: string }> = {
  high:   { label: 'High',   color: 'var(--status-danger)',   dot: 'var(--status-danger)'   },
  medium: { label: 'Medium', color: 'var(--status-warning)',  dot: 'var(--status-warning)'  },
  low:    { label: 'Low',    color: 'var(--status-inactive)', dot: 'var(--status-inactive)' },
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

/** Inline custom property carrying a stage hue into the CSS module. */
function stageVar(color: string): React.CSSProperties {
  return { ['--stage' as string]: color } as React.CSSProperties;
}

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
    <div className={styles.page}>
      {/* Always-visible (not hover-only) horizontal scrollbar for the kanban
          row below — without this, the native scrollbar is easy to miss on
          desktop, especially once the row's own minHeight is removed.
          Theme-aware: the thumb uses the 3:1 control-edge token. */}
      <style>{`
        .wsp-kanban-scroll::-webkit-scrollbar { height: 9px; }
        .wsp-kanban-scroll::-webkit-scrollbar-track { background: transparent; }
        .wsp-kanban-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 5px; }
        .wsp-kanban-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
        .wsp-kanban-scroll { scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
      `}</style>

      <PageHeader eyebrow="Web Systems" title="Deployment Pipeline" />

      <MetricStrip style={{ marginBottom: 16 }}>
        <Metric label="Total leads"    value={leads.length} />
        <Metric label="Active clients" value={leads.filter(l => l.status === 'active_client').length} />
        <Metric label="In proposal"    value={leads.filter(l => ['proposal_sent','proposal_approved'].includes(l.status)).length} />
        <Metric label="Est. MRR"       value={`$${totalMRR}`} />
      </MetricStrip>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      {/* top: 0, not 52 — this toolbar's sticky positioning is scoped to
          app/admin/layout.tsx's <main overflow: 'auto'>, which is its own
          independent scroll container (not the page viewport), so top: 0
          sticks it flush against that container's own top edge. 52 was a
          copy of AdminAside's offset, which is correct for AdminAside
          (a sibling of <main>, scoped to the true viewport) but wrong
          here, and caused the sticky header to overlap/clip the top of
          the kanban's first row once scrolled. See
          components/admin/AdminAside.tsx, which intentionally keeps
          its own header offset unchanged — it has a different, correct
          reference frame. */}
      <div className={styles.toolbarBar} style={{
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <WorkToolbar
          actions={
            <>
              {/* View toggle */}
              <div className={styles.segmented} role="group" aria-label="View">
                {(['kanban', 'list'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    className={styles.segment}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                  >{v}</button>
                ))}
              </div>

              <button type="button" onClick={fetchLeads} {...buttonProps('secondary', 'sm')}>
                <span aria-hidden="true">↺</span> Refresh
              </button>
            </>
          }
        >
          {/* Search */}
          <ToolbarSearch
            label="Search leads"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads…"
          />

          {/* Group filter */}
          <div className={styles.segmented} role="group" aria-label="Filter by stage group">
            {groups.map(g => (
              <button
                key={g}
                type="button"
                className={styles.segment}
                aria-pressed={filterGroup === g}
                onClick={() => setFilterGroup(filterGroup === g ? '' : g)}
              >{g}</button>
            ))}
          </div>
        </WorkToolbar>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <StateMessage kind="loading" size="page" title="Loading pipeline…" />
      )}

      {/* ── KANBAN VIEW ──────────────────────────────────────────────────────── */}
      {!loading && view === 'kanban' && (
        <div
          className={`wsp-kanban-scroll ${styles.kanban}`}
          role="region"
          aria-label="Pipeline board"
          tabIndex={0}
          style={{ overflowX: 'auto', overflowY: 'hidden' }}
        >
          {COLUMNS.map(col => {
            const cards  = byStatus(col.status);
            const isOver = dragOver === col.status;
            return (
              <section
                key={col.status}
                className={styles.column}
                data-over={isOver ? 'true' : undefined}
                aria-label={`${col.label} (${cards.length})`}
                style={stageVar(col.color)}
                onDragOver={e => onDragOver(e, col.status)}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => onDrop(e, col.status)}
              >
                {/* Column header */}
                <div className={styles.columnHeader}>
                  <div className={styles.columnTitleRow}>
                    <h2 className={styles.columnTitle}>
                      <span className={styles.stageDot} aria-hidden="true" />
                      {col.label}
                    </h2>
                    <span className={styles.count}>{cards.length}</span>
                  </div>
                  <div className={styles.columnGroup}>
                    {col.group}
                  </div>
                </div>

                {/* Drop zone indicator */}
                {isOver && <div className={styles.dropIndicator} aria-hidden="true" />}

                {/* Cards */}
                {cards.map(lead => (
                  <KanbanCard
                    key={lead.id}
                    lead={lead}
                    isDragging={dragId === lead.id}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onClick={() => openDrawer(lead)}
                  />
                ))}

                {cards.length === 0 && !isOver && (
                  <div className={styles.dropEmpty}>
                    Drop here
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────────────────── */}
      {!loading && view === 'list' && (
        <TableContainer label="Leads" minWidth={720}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                {['Contact', 'Status', 'Budget', 'Priority', 'Score', 'Updated'].map((h, i) => (
                  <th key={i} scope="col" className={h === 'Score' ? tableStyles.num : undefined}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const col      = colMap.get(lead.status);
                const priority = PRIORITY_META[lead.priority ?? 'medium'];
                return (
                  <tr
                    key={lead.id}
                    className={styles.listRow}
                    onClick={() => openDrawer(lead)}
                  >
                    <td className={tableStyles.primary}>
                      {/* The row click opens the drawer; this button is its
                          keyboard / screen-reader equivalent (the click
                          bubbles to the row, so it opens exactly once). */}
                      <button type="button">{lead.full_name}</button>
                      <span className={tableStyles.meta}>{lead.business_name ?? lead.email}</span>
                    </td>
                    <td>
                      {col && (
                        <span className={styles.stagePill} style={stageVar(col.color)}>
                          <span className={styles.stageDot} aria-hidden="true" />
                          {col.label}
                        </span>
                      )}
                    </td>
                    <td>
                      {BUDGET_LABELS[lead.budget_range ?? ''] ?? '—'}
                    </td>
                    <td>
                      <span className={styles.priority} style={{ color: priority.color }}>
                        <span className={styles.priorityDot} style={{ background: priority.dot }} aria-hidden="true" />
                        {priority.label}
                      </span>
                    </td>
                    <td className={tableStyles.num}>
                      <span className={styles.score}>{lead.score ?? 0}</span>
                    </td>
                    <td>
                      {new Date(lead.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <TableStateRow colSpan={6} kind="empty">
                  No leads match current filters
                </TableStateRow>
              )}
            </tbody>
          </table>
        </TableContainer>
      )}

      {/* ── DETAIL DRAWER ────────────────────────────────────────────────────── */}
      <SlidePanel open={drawerOpen} onClose={closeDrawer} title={selected?.full_name ?? 'Lead'}>
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
            onPatch={patchLead}
            onDelete={deleteLead}
          />
        )}
      </SlidePanel>
    </div>
  );
}

// ── KanbanCard ─────────────────────────────────────────────────────────────────

function KanbanCard({
  lead, isDragging, onDragStart, onDragEnd, onClick,
}: {
  lead: WebLead;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const nameId   = useId();
  const priority = PRIORITY_META[lead.priority ?? 'medium'];

  // The card stays a draggable <div> (a native <button> is not reliably
  // draggable in every browser), exposed as a button: it is focusable and
  // Enter / Space open the lead exactly as a click does. Moving between
  // stages without a pointer is available from the drawer's stage buttons.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-labelledby={nameId}
      draggable
      className={styles.card}
      data-dragging={isDragging ? 'true' : undefined}
      onDragStart={e => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Top: name + priority */}
      <div className={styles.cardTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id={nameId} className={styles.cardName}>{lead.full_name}</div>
          {lead.business_name && (
            <div className={styles.cardSub}>{lead.business_name}</div>
          )}
        </div>
        <div className={styles.cardMeta}>
          <span
            className={styles.priorityDot}
            style={{ background: priority.dot }}
            role="img"
            aria-label={`${priority.label} priority`}
            title={`${priority.label} priority`}
          />
          {(lead.score ?? 0) > 0 && (
            <span className={styles.score}>{lead.score}</span>
          )}
        </div>
      </div>

      {/* Service tags */}
      {lead.service_interest.length > 0 && (
        <div className={styles.tags}>
          {lead.service_interest.slice(0, 3).map((s, i) => (
            <span key={i} className={styles.tag}>{SERVICE_LABELS[s] ?? s}</span>
          ))}
        </div>
      )}

      {/* Budget + date */}
      <div className={styles.cardFoot}>
        <span className={styles.budget}>
          {BUDGET_LABELS[lead.budget_range ?? ''] ?? '—'}
        </span>
        <span className={styles.date}>
          {new Date(lead.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Pipeline note snippet */}
      {lead.pipeline_notes && (
        <div className={styles.snippet}>
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
  onPatch, onDelete,
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
  onPatch: (id: string, patch: Partial<Pick<WebLead, 'status' | 'notes' | 'pipeline_notes' | 'priority' | 'score'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const col      = COLUMNS.find(c => c.status === lead.status);
  const priority = PRIORITY_META[lead.priority ?? 'medium'];
  const stageLabelId    = useId();
  const priorityLabelId = useId();

  return (
    <>
      {/* The drawer title (the lead's name) is the SlidePanel heading. */}
      <p className={styles.drawerSub}>{lead.business_name ?? lead.email}</p>

      {/* Status + priority row */}
      <div className={styles.chips}>
        {col && (
          <span className={styles.chip} data-stage="" style={stageVar(col.color)}>
            <span className={styles.stageDot} aria-hidden="true" />
            {col.label}
          </span>
        )}
        <span className={styles.chip}>
          <span className={styles.priorityDot} style={{ background: priority.dot }} aria-hidden="true" />
          <span style={{ color: priority.color }}>{priority.label} Priority</span>
        </span>
        <span className={styles.chip}>Score: {lead.score ?? 0}</span>
      </div>

      {/* Change status */}
      <div className={styles.section}>
        <p id={stageLabelId} className={styles.sectionLabel}>Move to stage</p>
        <div
          className={styles.stageButtons}
          role="group"
          aria-labelledby={stageLabelId}
          data-saving={saving ? 'true' : undefined}
        >
          {COLUMNS.map(c => (
            <button
              key={c.status}
              type="button"
              className={styles.stageButton}
              style={stageVar(c.color)}
              aria-current={lead.status === c.status ? 'true' : undefined}
              disabled={saving || lead.status === c.status}
              onClick={() => onPatch(lead.id, { status: c.status })}
            >
              <span className={styles.stageDot} aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Priority + score */}
      <div className={styles.row}>
        <div className={styles.grow}>
          <p id={priorityLabelId} className={styles.sectionLabel}>Priority</p>
          <div className={`${styles.segmented} ${styles.prioritySegments}`} role="group" aria-labelledby={priorityLabelId}>
            {(['high', 'medium', 'low'] as Priority[]).map(p => (
              <button
                key={p}
                type="button"
                className={styles.segment}
                aria-pressed={lead.priority === p}
                onClick={() => onPatch(lead.id, { priority: p })}
              >{PRIORITY_META[p].label}</button>
            ))}
          </div>
        </div>
        <Field label="Score (0–100)">
          {control => (
            <input
              {...control}
              type="number" min={0} max={100}
              defaultValue={lead.score ?? 0}
              onBlur={e => {
                const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                if (v !== (lead.score ?? 0)) onPatch(lead.id, { score: v });
              }}
              className={`${fieldControlClassName} ${styles.scoreInput}`}
            />
          )}
        </Field>
      </div>

      {/* Lead details */}
      <FieldBlock label="Contact">
        <div className={styles.contactList}>
          <a href={`mailto:${lead.email}`} className={styles.contactLink}>{lead.email}</a>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className={styles.contactLink}>{lead.phone}</a>
          )}
          {lead.website_url && (
            <a href={lead.website_url} target="_blank" rel="noopener noreferrer" className={styles.contactLink} data-kind="web">{lead.website_url}</a>
          )}
        </div>
      </FieldBlock>

      {lead.business_type && (
        <FieldBlock label="Business Type">
          {lead.business_type}
        </FieldBlock>
      )}

      {lead.project_description && (
        <FieldBlock label="Project Description">
          <p style={{ lineHeight: 1.6, margin: 0 }}>{lead.project_description}</p>
        </FieldBlock>
      )}

      <div className={styles.row}>
        {lead.budget_range && (
          <FieldBlock label="Budget" compact>
            {({ BUDGET_LABELS } as Record<string, Record<string, string>>).BUDGET_LABELS?.[lead.budget_range] ?? lead.budget_range}
          </FieldBlock>
        )}
        {lead.service_interest.length > 0 && (
          <FieldBlock label="Services" compact>
            <div className={styles.tags} style={{ marginBottom: 0 }}>
              {lead.service_interest.map((s, i) => (
                <span key={i} className={styles.tag}>
                  {SERVICE_LABELS[s] ?? s}
                </span>
              ))}
            </div>
          </FieldBlock>
        )}
      </div>

      {/* Pipeline notes */}
      <div className={styles.noteBlock}>
        <Field label="Pipeline Notes">
          {control => (
            <textarea
              {...control}
              value={pipelineNotes}
              onChange={e => setPipelineNotes(e.target.value)}
              placeholder="Internal operational notes…"
              rows={3}
              className={fieldControlClassName}
            />
          )}
        </Field>
        <div className={styles.noteActions}>
          <button
            type="button"
            disabled={saving || pipelineNotes === (lead.pipeline_notes ?? '')}
            onClick={() => onPatch(lead.id, { pipeline_notes: pipelineNotes })}
            {...buttonProps('secondary', 'sm')}
          >
            {saving ? 'Saving…' : 'Save pipeline notes'}
          </button>
        </div>
      </div>

      {/* Client notes */}
      <div className={styles.noteBlock}>
        <Field label="Client Notes">
          {control => (
            <textarea
              {...control}
              value={notesEdit}
              onChange={e => setNotesEdit(e.target.value)}
              placeholder="Notes visible to client…"
              rows={3}
              className={fieldControlClassName}
            />
          )}
        </Field>
        <div className={styles.noteActions}>
          <button
            type="button"
            disabled={saving || notesEdit === (lead.notes ?? '')}
            onClick={() => onPatch(lead.id, { notes: notesEdit })}
            {...buttonProps('secondary', 'sm')}
          >
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>

      {/* Email / message history */}
      <LeadMessages leadId={lead.id} leadEmail={lead.email} />

      {/* Timestamps */}
      <div className={styles.meta}>
        <div>Created: {new Date(lead.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div>Updated: {new Date(lead.updated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        {lead.source && <div>Source: {lead.source}</div>}
      </div>

      {/* Delete */}
      <div className={styles.danger}>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            {...buttonProps('danger', 'sm')}
          >
            Delete lead
          </button>
        ) : (
          <div className={styles.confirmRow}>
            <span className={styles.confirmText}>Confirm delete?</span>
            <button
              type="button"
              disabled={deleting}
              onClick={() => onDelete(lead.id)}
              {...buttonProps('danger', 'sm')}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              {...buttonProps('secondary', 'sm')}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── FieldBlock helper ──────────────────────────────────────────────────────────

function FieldBlock({ label, children, compact }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={styles.fieldBlock} data-compact={compact ? 'true' : undefined}>
      <p className={styles.sectionLabel}>{label}</p>
      <div className={styles.fieldValue}>{children}</div>
    </div>
  );
}
