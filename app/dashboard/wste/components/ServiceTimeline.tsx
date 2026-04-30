'use client';
import { useState } from 'react';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

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

const SERVICE_META: Record<ServiceType, { label: string; colour: string; bg: string; icon: React.ReactNode }> = {
  bin_collection: {
    label: 'Bin Collection', colour: '#2DD4BF', bg: 'rgba(45,212,191,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  },
  bin_lift: {
    label: 'Bin Lift', colour: '#60a5fa', bg: 'rgba(96,165,250,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5m-7 7l7-7 7 7"/></svg>,
  },
  hard_waste: {
    label: 'Hard Waste', colour: '#fb923c', bg: 'rgba(251,146,60,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  },
  mattress_collection: {
    label: 'Mattress', colour: '#a78bfa', bg: 'rgba(167,139,250,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/></svg>,
  },
  street_sweeping: {
    label: 'Street Sweeping', colour: '#94a3b8', bg: 'rgba(148,163,184,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  },
  bin_maintenance: {
    label: 'Bin Maintenance', colour: '#facc15', bg: 'rgba(250,204,21,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  },
  missed_collection: {
    label: 'Missed Collection', colour: '#f87171', bg: 'rgba(248,113,113,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  },
  illegal_dumping: {
    label: 'Illegal Dumping', colour: '#ef4444', bg: 'rgba(239,68,68,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
  special_service: {
    label: 'Special Service', colour: '#c084fc', bg: 'rgba(192,132,252,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
  exception: {
    label: 'Exception', colour: '#f97316', bg: 'rgba(249,115,22,.10)',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
};

const STATUS_META: Record<VerificationStatus, { label: string; colour: string; bg: string; border: string; dot: string }> = {
  verified:           { label: 'Verified',           colour: '#4ade80', bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.25)',   dot: '#22c55e' },
  likely_completed:   { label: 'Likely Completed',   colour: '#2DD4BF', bg: 'rgba(45,212,191,.10)',  border: 'rgba(45,212,191,.22)',  dot: '#14b8a6' },
  likely_missed:      { label: 'Likely Missed',      colour: '#f87171', bg: 'rgba(239,68,68,.12)',   border: 'rgba(239,68,68,.25)',   dot: '#ef4444' },
  no_evidence:        { label: 'No Evidence',        colour: '#fbbf24', bg: 'rgba(245,158,11,.10)',  border: 'rgba(245,158,11,.22)',  dot: '#f59e0b' },
  exception:          { label: 'Exception',          colour: '#fb923c', bg: 'rgba(251,146,60,.12)',  border: 'rgba(251,146,60,.25)',  dot: '#f97316' },
  exception_recorded: { label: 'Exception Recorded', colour: '#fb923c', bg: 'rgba(251,146,60,.12)',  border: 'rgba(251,146,60,.25)',  dot: '#f97316' },
  no_coverage:        { label: 'No Coverage',        colour: '#94a3b8', bg: 'rgba(148,163,184,.08)', border: 'rgba(148,163,184,.18)', dot: '#64748b' },
  not_applicable:     { label: 'N/A',                colour: '#64748b', bg: 'rgba(100,116,139,.08)', border: 'rgba(100,116,139,.18)', dot: '#475569' },
};

const EVIDENCE_META: Record<EvidenceType, { label: string; colour: string; bg: string }> = {
  gps:           { label: 'GPS',          colour: '#2DD4BF', bg: 'rgba(45,212,191,.12)'  },
  rfid:          { label: 'RFID',         colour: '#60a5fa', bg: 'rgba(96,165,250,.12)'  },
  lift_sensor:   { label: 'Lift sensor',  colour: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
  photo:         { label: 'Photo',        colour: '#fb923c', bg: 'rgba(251,146,60,.12)'  },
  video:         { label: 'Video',        colour: '#ef4444', bg: 'rgba(239,68,68,.12)'   },
  driver_note:   { label: 'Driver note',  colour: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  ticket:        { label: 'Ticket',       colour: '#4ade80', bg: 'rgba(34,197,94,.12)'   },
  weighbridge:   { label: 'Weighbridge',  colour: '#f59e0b', bg: 'rgba(245,158,11,.12)'  },
  manual:        { label: 'Manual',       colour: '#c084fc', bg: 'rgba(192,132,252,.12)' },
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
  const sm = SERVICE_META[event.service_type];
  const vm = STATUS_META[event.verification_status];

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Timeline dot + line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 18, paddingTop: 3 }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0, zIndex: 1,
          background: `${vm.dot}22`, border: `2px solid ${vm.dot}`,
        }}/>
      </div>

      {/* Card */}
      <div style={{
        flex: 1, marginBottom: 16,
        background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)',
        borderRadius: 10, overflow: 'hidden',
        transition: 'border-color .15s',
      }}>
        {/* Card header */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left', fontFamily: FONT,
          }}
        >
          {/* Service type icon + label */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
            borderRadius: 20, background: sm.bg, color: sm.colour, flexShrink: 0,
          }}>
            {sm.icon}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em' }}>{sm.label}</span>
          </div>

          {/* Service name */}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(245,247,250,.80)', flex: 1 }}>
            {event.service_name}
          </span>

          {/* Date */}
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', flexShrink: 0 }}>
            {fmtShort(event.date)}{event.time && ` · ${event.time}`}
          </span>

          {/* Status badge */}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
            padding: '2px 8px', borderRadius: 20, flexShrink: 0,
            background: vm.bg, border: `1px solid ${vm.border}`, color: vm.colour,
          }}>
            {vm.label}
          </span>

          {/* Expand indicator */}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1.5" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>
            <path d="M2 3.5L5 6.5L8 3.5"/>
          </svg>
        </button>

        {/* Evidence chips row */}
        {event.evidence.length > 0 && (
          <div style={{ display: 'flex', gap: 5, padding: '0 14px 10px', flexWrap: 'wrap' }}>
            {event.evidence.map((ev, i) => {
              const em = EVIDENCE_META[ev.type];
              return (
                <span key={i} style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.04em',
                  padding: '2px 6px', borderRadius: 20,
                  background: em.bg, color: em.colour,
                }}>
                  {em.label}
                </span>
              );
            })}
            {event.vehicle_reg && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,.30)', padding: '2px 6px' }}>
                {event.vehicle_reg}
                {event.driver && ` · ${event.driver}`}
              </span>
            )}
            {event.confidence != null && (
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 20,
                color: event.confidence >= 80 ? '#4ade80' : event.confidence >= 50 ? '#fbbf24' : '#f87171',
                background: event.confidence >= 80 ? 'rgba(34,197,94,.08)' : event.confidence >= 50 ? 'rgba(245,158,11,.08)' : 'rgba(239,68,68,.08)',
              }}>
                {event.confidence}% conf.
              </span>
            )}
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '12px 14px' }}>
            {event.details.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px 20px', marginBottom: event.evidence.length > 0 || event.notes ? 12 : 0 }}>
                {event.details.map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(245,247,250,.75)' }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
            {event.evidence.length > 0 && (
              <div style={{ marginBottom: event.notes ? 10 : 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', marginBottom: 6 }}>Evidence</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {event.evidence.map((ev, i) => {
                    const em = EVIDENCE_META[ev.type];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 10, background: em.bg, color: em.colour, flexShrink: 0 }}>
                          {em.label}
                        </span>
                        {ev.description && (
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.50)', lineHeight: 1.5 }}>{ev.description}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {event.notes && (
              <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,.42)', fontStyle: 'italic', lineHeight: 1.5 }}>
                {event.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function ServiceTimeline({ events, title = 'Service Timeline' }: {
  events: ServiceEvent[];
  title?: string;
}) {
  const [activeFilters, setActiveFilters] = useState<Set<ServiceType>>(new Set());

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
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: '20px 20px 4px' }}>
      {/* Header + filters */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>
          {title} ({filtered.length})
        </div>
        {typesInData.length > 1 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {SERVICE_FILTER_ORDER.filter(t => typesInData.includes(t)).map(t => {
              const sm = SERVICE_META[t];
              const active = activeFilters.has(t);
              return (
                <button key={t} onClick={() => toggleFilter(t)} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
                  background: active ? sm.bg : 'rgba(255,255,255,.03)',
                  border: active ? `1px solid ${sm.colour}44` : '1px solid rgba(255,255,255,.07)',
                  color: active ? sm.colour : 'rgba(255,255,255,.35)',
                  fontSize: 10, fontWeight: 600, fontFamily: FONT, letterSpacing: '.03em',
                  transition: 'all .15s',
                }}>
                  <span style={{ color: active ? sm.colour : 'rgba(255,255,255,.25)' }}>{sm.icon}</span>
                  {sm.label}
                </button>
              );
            })}
            {activeFilters.size > 0 && (
              <button onClick={() => setActiveFilters(new Set())} style={{
                padding: '3px 8px', borderRadius: 20, cursor: 'pointer', fontSize: 10,
                background: 'none', border: '1px solid rgba(255,255,255,.07)', color: 'rgba(255,255,255,.30)',
                fontFamily: FONT, letterSpacing: '.03em',
              }}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ position: 'relative' }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 9, top: 3,
          bottom: 16, width: 1, background: 'rgba(255,255,255,.07)',
        }}/>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(255,255,255,.28)', fontSize: 12 }}>
            No events match the selected filters.
          </div>
        ) : (
          filtered.map(event => <EventCard key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
