'use client';
import { useId, useState } from 'react';
import { Badge, StateMessage, type SemanticState } from '@/components/ui/app';
import s from '../Wste.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceType =
  | 'bin_collection' | 'bin_lift' | 'hard_waste' | 'mattress_collection'
  | 'street_sweeping' | 'bin_maintenance' | 'missed_collection'
  | 'illegal_dumping' | 'special_service' | 'exception';

export type EvidenceType =
  | 'gps' | 'rfid' | 'lift_sensor' | 'photo' | 'video'
  | 'driver_note' | 'ticket' | 'weighbridge' | 'manual';

export type VerificationStatus =
  | 'verified' | 'likely_completed' | 'likely_missed'
  | 'no_evidence' | 'exception' | 'exception_recorded'
  | 'no_coverage' | 'not_applicable';

export type Evidence = {
  type: EvidenceType;
  description?: string;
  value?: string;
};

export type ServiceEvent = {
  id: string;
  date: string;
  time?: string;
  service_type: ServiceType;
  service_name: string;
  verification_status: VerificationStatus;
  vehicle_reg?: string;
  driver?: string;
  run_name?: string;
  confidence?: number;
  evidence: Evidence[];
  details: { label: string; value: string }[];
  notes?: string;
};

// ─── Metadata maps ────────────────────────────────────────────────────────────
// Service-type identity is a data encoding: its hue lives in
// Wste.module.css (.svcHue[data-type]) with a theme-aware shade and is only
// painted on the icon — the type is always written out as text.

const SERVICE_META: Record<ServiceType, { label: string; icon: React.ReactNode }> = {
  bin_collection: {
    label: 'Bin Collection',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  },
  bin_lift: {
    label: 'Bin Lift',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5m-7 7l7-7 7 7"/></svg>,
  },
  hard_waste: {
    label: 'Hard Waste',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  },
  mattress_collection: {
    label: 'Mattress',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/></svg>,
  },
  street_sweeping: {
    label: 'Street Sweeping',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  },
  bin_maintenance: {
    label: 'Bin Maintenance',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  },
  missed_collection: {
    label: 'Missed Collection',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  },
  illegal_dumping: {
    label: 'Illegal Dumping',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
  special_service: {
    label: 'Special Service',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
  exception: {
    label: 'Exception',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
};

// Verification outcome → semantic state (label is always written).
const STATUS_META: Record<VerificationStatus, { label: string; state: SemanticState }> = {
  verified:           { label: 'Verified',           state: 'success'  },
  likely_completed:   { label: 'Likely Completed',   state: 'info'     },
  likely_missed:      { label: 'Likely Missed',      state: 'error'    },
  no_evidence:        { label: 'No Evidence',        state: 'warning'  },
  exception:          { label: 'Exception',          state: 'warning'  },
  exception_recorded: { label: 'Exception Recorded', state: 'warning'  },
  no_coverage:        { label: 'No Coverage',        state: 'inactive' },
  not_applicable:     { label: 'N/A',                state: 'inactive' },
};

const EVIDENCE_META: Record<EvidenceType, { label: string }> = {
  gps:           { label: 'GPS'          },
  rfid:          { label: 'RFID'         },
  lift_sensor:   { label: 'Lift sensor'  },
  photo:         { label: 'Photo'        },
  video:         { label: 'Video'        },
  driver_note:   { label: 'Driver note'  },
  ticket:        { label: 'Ticket'       },
  weighbridge:   { label: 'Weighbridge'  },
  manual:        { label: 'Manual'       },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(s: string) {
  try { return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); }
  catch { return s; }
}

const SERVICE_FILTER_ORDER: ServiceType[] = [
  'bin_collection', 'bin_lift', 'hard_waste', 'mattress_collection',
  'street_sweeping', 'bin_maintenance', 'missed_collection', 'illegal_dumping', 'exception',
];

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: ServiceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const sm = SERVICE_META[event.service_type];
  const vm = STATUS_META[event.verification_status];

  return (
    <li className={s.event}>
      {/* Timeline dot */}
      <div className={s.eventDotCol} aria-hidden="true">
        <span className={s.eventDot} data-state={vm.state}/>
      </div>

      {/* Card */}
      <div className={s.eventCard}>
        {/* Card header */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          className={s.eventToggle}
        >
          {/* Service type icon + label */}
          <span className={s.svcTag}>
            <span className={s.svcHue} data-type={event.service_type} aria-hidden="true" style={{ display: 'inline-flex' }}>{sm.icon}</span>
            <span>{sm.label}</span>
          </span>

          {/* Service name */}
          <span className={s.eventName}>
            {event.service_name}
          </span>

          {/* Date */}
          <span className={s.eventWhen}>
            {fmtShort(event.date)}{event.time && ` · ${event.time}`}
          </span>

          {/* Status badge */}
          <Badge state={vm.state}>{vm.label}</Badge>

          {/* Expand indicator */}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={s.chevron} data-open={expanded} aria-hidden="true">
            <path d="M2 3.5L5 6.5L8 3.5"/>
          </svg>
        </button>

        {/* Evidence chips row */}
        {event.evidence.length > 0 && (
          <div className={s.chipRow}>
            {event.evidence.map((ev, i) => {
              const em = EVIDENCE_META[ev.type];
              return (
                <span key={i} className={s.chip}>
                  {em.label}
                </span>
              );
            })}
            {event.vehicle_reg && (
              <span className={s.chipMeta}>
                <span className={s.mono}>{event.vehicle_reg}</span>
                {event.driver && ` · ${event.driver}`}
              </span>
            )}
            {event.confidence != null && (
              <span className={s.chip} data-tone={event.confidence >= 80 ? 'success' : event.confidence >= 50 ? 'warning' : 'danger'}>
                {event.confidence}% conf.
              </span>
            )}
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div id={detailsId} className={s.eventDetails}>
            {event.details.length > 0 && (
              <dl className={s.detailGrid}>
                {event.details.map(({ label, value }) => (
                  <div key={label} className={s.fact}>
                    <dt className={s.factLabel}>{label}</dt>
                    <dd className={s.factValue}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {event.evidence.length > 0 && (
              <div>
                <p className={s.factLabel} style={{ marginBottom: 6 }}>Evidence</p>
                <ul className={s.evidenceList}>
                  {event.evidence.map((ev, i) => {
                    const em = EVIDENCE_META[ev.type];
                    return (
                      <li key={i} className={s.evidenceItem}>
                        <span className={s.chip}>
                          {em.label}
                        </span>
                        {ev.description && (
                          <span className={s.evidenceText}>{ev.description}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {event.notes && (
              <p className={s.notes}>
                {event.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function ServiceTimeline({ events, title = 'Service Timeline' }: {
  events: ServiceEvent[];
  title?: string;
}) {
  const [activeFilters, setActiveFilters] = useState<Set<ServiceType>>(new Set());
  const headingId = useId();

  const typesInData = [...new Set(events.map(e => e.service_type))];
  const filtered = activeFilters.size === 0
    ? events
    : events.filter(e => activeFilters.has(e.service_type));

  function toggleFilter(t: ServiceType) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  return (
    <section className={`${s.card} ${s.timeline}`} aria-labelledby={headingId}>
      {/* Header + filters */}
      <div className={s.timelineHead}>
        <h2 id={headingId} className={s.sectionTitle}>
          {title} ({filtered.length})
        </h2>
        {typesInData.length > 1 && (
          <div className={s.filterGroup} role="group" aria-label="Filter by service type">
            {SERVICE_FILTER_ORDER.filter(t => typesInData.includes(t)).map(t => {
              const sm = SERVICE_META[t];
              const active = activeFilters.has(t);
              return (
                <button key={t} type="button" aria-pressed={active} onClick={() => toggleFilter(t)} className={s.filterButton}>
                  <span className={s.svcHue} data-type={t} aria-hidden="true" style={{ display: 'inline-flex' }}>{sm.icon}</span>
                  {sm.label}
                </button>
              );
            })}
            {activeFilters.size > 0 && (
              <button type="button" onClick={() => setActiveFilters(new Set())} className={s.filterButton}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className={s.timelineBody}>
        {/* Vertical line */}
        <div className={s.timelineRail} aria-hidden="true"/>
        {filtered.length === 0 ? (
          <div className={s.timelineEmpty}>
            <StateMessage kind="empty" title="No events match the selected filters." />
          </div>
        ) : (
          <ol className={s.eventList}>
            {filtered.map(event => <EventCard key={event.id} event={event} />)}
          </ol>
        )}
      </div>
    </section>
  );
}
