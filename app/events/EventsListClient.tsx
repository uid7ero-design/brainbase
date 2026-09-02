'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, ChevronRight } from 'lucide-react';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import { CapabilityIcon } from '@/components/brand/CapabilityIcon';
import {
  FONT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, VIOLET_SOFT,
  Panel, EmptyState, StatusBadge, eventStatusTone,
  primaryBtnStyle, secondaryBtnStyle, fieldStyle, inputStyle, EventsSharedStyles,
} from './_components/ui';

const API = '/api/events';

type EventRow = {
  id: string;
  name: string;
  slug: string;
  venue: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  starts_at: string;
  ends_at: string;
  timezone: string;
  session_count: number;
  ticket_type_count: number;
};

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function EventsListClient({ canManage, organisationSlug }: { canManage: boolean; organisationSlug: string | null }) {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [timezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  });

  // Fetch is inlined directly in the effect (rather than called out to a
  // separately memoized function) so mount-time loading isn't a
  // synchronous "call a state-setting function from an effect" pattern —
  // reload() below just bumps reloadKey to re-run this same effect on
  // demand (e.g. after a mutation), instead of exposing a callable
  // load() reference for callers to invoke directly.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(API);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) {
            setError(body.error ?? `Failed to load events (${res.status}).`);
            setEvents([]);
          }
          return;
        }
        const body = await res.json();
        if (!cancelled) setEvents(body.events ?? []);
      } catch {
        if (!cancelled) {
          setError('Failed to load events.');
          setEvents([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slugTouched ? slug : slugify(name),
          description: description || undefined,
          venue: venue || undefined,
          starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
          ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
          timezone,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(body.error ?? `Failed to create event (${res.status}).`);
        return;
      }
      setShowCreate(false);
      setName('');
      setSlug('');
      setSlugTouched(false);
      setVenue('');
      setDescription('');
      setStartsAt('');
      setEndsAt('');
      reload();
    } catch {
      setFormError('Failed to create event.');
    } finally {
      setSaving(false);
    }
  }

  const total = events?.length ?? 0;
  const published = events?.filter(e => e.status === 'PUBLISHED').length ?? 0;
  const draft = events?.filter(e => e.status === 'DRAFT').length ?? 0;
  // "Upcoming" is derivable purely from starts_at, already present on
  // every row — no new query. Registrations/attendee totals are NOT
  // currently returned by GET /api/events (only session_count/
  // ticket_type_count are), so that KPI is intentionally omitted here
  // rather than adding a new aggregate query — see the R1/UI-polish
  // report's backend-change confirmation.
  const upcoming = events?.filter(e => e.status !== 'CANCELLED' && new Date(e.starts_at) > new Date()).length ?? 0;

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 1140, margin: '0 auto' }}>
      <EventsSharedStyles />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          {/* Module identity moment (Phase D.4.3) — the same Ticket/amber
              CapabilityIcon already shown in ModuleAccessCard and TopNav for
              this capability, decorative since the heading right beside it
              already supplies the accessible name. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CapabilityIcon capability="events" size="md" />
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-.01em' }}>Events</h1>
          </div>
          <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '5px 0 0' }}>Create, manage and monitor registrations</p>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/events/payments" style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Payments
            </Link>
            <button onClick={() => setShowCreate(v => !v)} style={primaryBtnStyle}>
              {showCreate ? 'Cancel' : '+ Create Event'}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Total Events" value={events ? total : '—'} accentColor="#8A4DFF" theme="dark" loading={events === null} />
        <KpiCard label="Published" value={events ? published : '—'} accentColor="#4ADE80" theme="dark" loading={events === null} />
        <KpiCard label="Upcoming" value={events ? upcoming : '—'} accentColor="#A78BFA" theme="dark" loading={events === null} />
        <KpiCard label="Draft" value={events ? draft : '—'} accentColor="#9ca3af" theme="dark" loading={events === null} />
      </div>

      {showCreate && canManage && (
        <Panel style={{ marginBottom: 24 }}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={fieldStyle}>
                Name
                <input required className="bb-evt-input" value={name} onChange={e => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Slug
                <input required className="bb-evt-input" value={slug} onChange={e => { setSlug(e.target.value); setSlugTouched(true); }} style={inputStyle} />
              </label>
            </div>
            <label style={fieldStyle}>
              Venue
              <input className="bb-evt-input" value={venue} onChange={e => setVenue(e.target.value)} style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              Description
              <textarea className="bb-evt-input" value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={fieldStyle}>
                Starts
                <input required type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Ends
                <input required type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} />
              </label>
            </div>
            <div style={{ fontSize: 11, color: TEXT_MUTED }}>Timezone: {timezone}</div>
            {formError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{formError}</div>}
            <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, alignSelf: 'flex-start', opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Creating…' : 'Create Event'}
            </button>
          </form>
        </Panel>
      )}

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <Panel style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events === null && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: TEXT_MUTED, fontSize: 13 }}>Loading…</div>
        )}
        {events !== null && events.length === 0 && (
          <EmptyState
            title="No events yet"
            body="Create your first event to start accepting registrations."
          />
        )}
        {events?.map(ev => (
          // Not a single wrapping <Link> anymore (Part B) — "View public
          // page" needs its own click target, and an <a> nested inside
          // another <a> is invalid HTML with unreliable click behaviour.
          // The event name/meta area keeps the primary "go to management
          // screen" Link; "View public page" is a sibling secondary
          // action in the same row, never nested inside it.
          <div key={ev.id} className="bb-evt-row" style={{
            padding: '14px 16px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          }}>
            <Link href={`/events/${ev.id}`} style={{ textDecoration: 'none', color: 'inherit', minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY }}>{ev.name}</span>
                <StatusBadge label={ev.status} tone={eventStatusTone(ev.status)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 7, fontSize: 12, color: TEXT_SECONDARY, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Calendar size={12} color={VIOLET_SOFT} /> {new Date(ev.starts_at).toLocaleString()}
                </span>
                {ev.venue && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <MapPin size={12} color={VIOLET_SOFT} /> {ev.venue}
                  </span>
                )}
              </div>
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
              <span style={metaPillStyle}>{ev.session_count} session{ev.session_count === 1 ? '' : 's'}</span>
              <span style={metaPillStyle}>{ev.ticket_type_count} ticket type{ev.ticket_type_count === 1 ? '' : 's'}</span>
              {/* Part B — the existing public route (app/e/[organisationSlug]/
                  [eventSlug]/**), never a new one. A relative href resolves
                  correctly in any environment on its own (Production
                  custom domain, a Vercel preview URL, localhost) with no
                  origin construction needed for plain navigation.
                  Deliberately does NOT gate on ev.status: an unpublished
                  event's own public route already decides how to respond
                  (see that route's own not-found/unavailable handling) —
                  this link only ever points at the real URL, never a
                  preview-bypass of any kind. Hidden entirely (rather than
                  shown disabled) when organisationSlug is unavailable, so
                  a broken /e/null/... URL can never be constructed. */}
              {organisationSlug && (
                <a
                  href={`/e/${organisationSlug}/${ev.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ ...secondaryBtnStyle, padding: '5px 10px', fontSize: 11.5, textDecoration: 'none' }}
                >
                  View public page
                </a>
              )}
              <Link href={`/events/${ev.id}`} aria-label={`Manage ${ev.name}`}>
                <ChevronRight size={16} color={TEXT_MUTED} aria-hidden="true" />
              </Link>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

const metaPillStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: TEXT_MUTED, background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.07)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
};
