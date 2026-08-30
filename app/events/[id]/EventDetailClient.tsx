'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, ArrowLeft, ScanLine } from 'lucide-react';
import KpiCard from '@/components/dashboard/ui/KpiCard';
import RegistrationsPanel, { type OrderRow } from './RegistrationsPanel';
import QuestionsPanel from './QuestionsPanel';
import { ARTWORK_ACCEPT_ATTR, MAX_ARTWORK_MB, isAllowedArtworkMimeType } from '@/lib/events/artworkConstants';
import {
  FONT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, VIOLET_SOFT,
  Panel, SectionHeader, EmptyState, StatusBadge, eventStatusTone, capacityTone,
  primaryBtnStyle, secondaryBtnStyle, DangerButton, fieldStyle, inputStyle, rowCardStyle, EventsSharedStyles,
} from '../_components/ui';

type EventDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  venue: string | null;
  artwork_url: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  starts_at: string;
  ends_at: string;
  timezone: string;
};

type EventSessionRow = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
};

type TicketTypeRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number;
  active: boolean;
  sort_order: number;
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
}
function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}

// registered/attendee counts derived from the orders list already
// loaded by the parent — never a new query. CANCELLED orders are
// excluded, matching the status-aware counting contract used
// everywhere else in Events (see the public registration route and its
// R1 concurrency remediation).
function registeredQuantity(orders: OrderRow[], predicate: (o: OrderRow) => boolean): number {
  return orders.filter(o => o.status !== 'CANCELLED' && predicate(o)).reduce((sum, o) => sum + o.quantity, 0);
}

export default function EventDetailClient({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [sessions, setSessions] = useState<EventSessionRow[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([]);
  const [notFound, setNotFoundState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);

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
      const res = await fetch(`/api/events/${eventId}`);
      if (res.status === 404) {
        if (!cancelled) setNotFoundState(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setError(body.error ?? `Failed to load event (${res.status}).`);
        return;
      }
      const body = await res.json();
      if (!cancelled) {
        setEvent(body.event);
        setSessions(body.event_sessions ?? []);
        setTicketTypes(body.ticket_types ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  // Orders are fetched once here (not inside RegistrationsPanel) so the
  // same data can also drive the KPI strip and the per-session/per-
  // ticket-type "registered" counts below, without a second round trip
  // to GET /api/events/[id]/orders — that endpoint itself is unchanged.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOrdersError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/orders`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setOrdersError(body.error ?? `Failed to load registrations (${res.status}).`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setOrders(body.orders ?? []);
      } catch {
        if (!cancelled) setOrdersError('Failed to load registrations.');
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  if (notFound) {
    return (
      <div style={{ padding: 48, fontFamily: FONT, color: TEXT_PRIMARY }}>
        <p>Event not found.</p>
        <Link href="/events" style={{ color: VIOLET_SOFT }}>← Back to Events</Link>
      </div>
    );
  }

  if (!event) {
    return <div style={{ padding: 48, fontFamily: FONT, color: TEXT_MUTED }}>Loading…</div>;
  }

  const nonCancelledOrders = orders?.filter(o => o.status !== 'CANCELLED') ?? [];
  const orderCount = new Set(nonCancelledOrders.map(o => o.id)).size;
  const attendeeCount = nonCancelledOrders.reduce((sum, o) => sum + o.quantity, 0);
  const totalTicketCapacity = ticketTypes.reduce((sum, t) => sum + t.capacity, 0);
  const remainingCapacity = Math.max(0, totalTicketCapacity - attendeeCount);
  const registrationRate = orders && totalTicketCapacity > 0 ? Math.round((attendeeCount / totalTicketCapacity) * 100) : null;
  const statusAccent = event.status === 'PUBLISHED' ? '#4ADE80' : event.status === 'CANCELLED' ? '#F87171' : '#9ca3af';
  // Live attendance metrics (section 13) — derived entirely from the
  // orders data already loaded for the KPI strip/RegistrationsPanel
  // above; no new query, no realtime sockets, just the same fetch a
  // normal page reload already re-runs.
  const checkedInCount = nonCancelledOrders.flatMap(o => o.attendees).filter(a => a.checked_in_at).length;
  const checkInRate = attendeeCount > 0 ? Math.round((checkedInCount / attendeeCount) * 100) : null;

  // Revenue KPIs (§21) — server-calculated DB values only (every
  // figure here is total_cents already written by the payment-gated
  // order rows this same fetch already loaded; nothing is recomputed
  // client-side beyond simple aggregation). Deliberately basic: gross
  // revenue, paid-order count, pending-payment count, refunded amount
  // — no accounting/P&L reporting.
  const paidOrders = orders?.filter(o => o.payment_status === 'PAID') ?? [];
  const pendingPaymentOrders = orders?.filter(o => o.payment_status === 'PENDING') ?? [];
  const refundedOrders = orders?.filter(o => o.payment_status === 'REFUNDED') ?? [];
  const grossRevenueCents = paidOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const refundedCents = refundedOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const revenueCurrency = paidOrders[0]?.currency ?? orders?.find(o => o.payment_status !== 'NOT_REQUIRED')?.currency ?? 'AUD';
  const hasPaidTicketTypes = ticketTypes.some(t => t.price_cents > 0);
  const formatMoney = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: revenueCurrency }).format(cents / 100);

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 1140, margin: '0 auto' }}>
      <EventsSharedStyles />

      <Link href="/events" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: VIOLET_SOFT, fontSize: 12.5, textDecoration: 'none', marginBottom: 16, fontWeight: 600 }}>
        <ArrowLeft size={13} /> Back to Events
      </Link>

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <EventOverview event={event} canManage={canManage} onSaved={reload} />

      <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
        <KpiCard label="Orders" value={orders ? orderCount : '—'} accentColor="#8A4DFF" theme="dark" loading={orders === null} />
        <KpiCard label="Attendees" value={orders ? attendeeCount : '—'} accentColor="#A78BFA" theme="dark" loading={orders === null} />
        <KpiCard
          label="Checked In"
          value={orders ? checkedInCount : '—'}
          accentColor="#4ADE80" theme="dark" loading={orders === null}
          sub={orders && checkInRate !== null ? `${checkInRate}% · ${attendeeCount - checkedInCount} remaining` : undefined}
        />
        <KpiCard label="Ticket Capacity" value={totalTicketCapacity} accentColor="#06B6D4" theme="dark" />
        <KpiCard
          label="Remaining"
          value={orders ? remainingCapacity : '—'}
          accentColor={orders && remainingCapacity === 0 ? '#F87171' : '#4ADE80'}
          theme="dark" loading={orders === null}
          sub={orders && registrationRate !== null ? `${registrationRate}% booked` : undefined}
        />
        <KpiCard label="Sessions" value={sessions.length} accentColor="#FBBF24" theme="dark" />
        <KpiCard label="Status" value={event.status} accentColor={statusAccent} theme="dark" />
        {hasPaidTicketTypes && (
          <>
            <KpiCard
              label="Revenue"
              value={orders ? formatMoney(grossRevenueCents) : '—'}
              accentColor="#4ADE80" theme="dark" loading={orders === null}
              sub={orders ? `${paidOrders.length} paid order${paidOrders.length === 1 ? '' : 's'}` : undefined}
            />
            <KpiCard
              label="Pending Payment"
              value={orders ? pendingPaymentOrders.length : '—'}
              accentColor="#FBBF24" theme="dark" loading={orders === null}
            />
            {refundedOrders.length > 0 && (
              <KpiCard label="Refunded" value={formatMoney(refundedCents)} accentColor="#F87171" theme="dark" sub={`${refundedOrders.length} order${refundedOrders.length === 1 ? '' : 's'}`} />
            )}
          </>
        )}
      </div>

      <SessionsPanel eventId={eventId} sessions={sessions} orders={orders} canManage={canManage} onChanged={reload} timezone={event.timezone} />
      <TicketTypesPanel eventId={eventId} ticketTypes={ticketTypes} orders={orders} canManage={canManage} onChanged={reload} />
      <QuestionsPanel eventId={eventId} canManage={canManage} />
      <RegistrationsPanel eventId={eventId} orders={orders} error={ordersError} canManage={canManage} onRefunded={reload} />
    </div>
  );
}

// ─── Artwork (staff-pasted external URL — see scripts/add-events-artwork.sql) ─
// Plain <img>, not next/image: the source is an arbitrary external host
// chosen per-event by the organiser, not a bounded set of remote origins
// next/image's own allow-list expects. Both components render nothing
// (not a broken-image icon) if the URL fails to load — it was never
// verified server-side to actually resolve to an image.

function ArtworkThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)', flex: 'none' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

function ArtworkPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div style={{ marginTop: 8, fontSize: 11.5, color: '#FCA5A5' }}>Could not load a preview for this URL.</div>;
  }
  return (
    <div style={{ marginTop: 10, width: 220, aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

// ─── Capacity pill (shared by Sessions + Ticket Types rows) ───────────

function CapacityPill({ registered, capacity }: { registered: number | null; capacity: number }) {
  if (registered === null) {
    return <span style={metaPillStyle}>capacity {capacity}</span>;
  }
  const remaining = Math.max(0, capacity - registered);
  return <StatusBadge label={`${registered}/${capacity} booked`} tone={capacityTone(remaining, capacity)} />;
}

const metaPillStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: TEXT_MUTED, background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.07)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
};

// ─── Overview / control header ─────────────────────────────────────

function EventOverview({ event, canManage, onSaved }: { event: EventDetail; canManage: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState(event.name);
  const [venue, setVenue] = useState(event.venue ?? '');
  const [description, setDescription] = useState(event.description ?? '');
  const [status, setStatus] = useState(event.status);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.ends_at));

  // Artwork upload/remove are immediate, independent actions against
  // their own dedicated endpoint (app/api/events/[id]/artwork/route.ts)
  // — not part of this form's batched PATCH — so they persist right
  // away regardless of whether the rest of the form is ever saved,
  // matching the same pattern app/api/account/avatar/route.ts already
  // established. onSaved() re-fetches the event, which is what actually
  // updates event.artwork_url everywhere it's read (this component,
  // the compact header thumbnail, the public page on its next load).
  const [artworkUploading, setArtworkUploading] = useState(false);
  const [artworkRemoving, setArtworkRemoving] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const artworkFileInputRef = useRef<HTMLInputElement>(null);

  async function handleArtworkFile(file: File) {
    setArtworkError(null);
    if (!isAllowedArtworkMimeType(file.type)) {
      setArtworkError('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > MAX_ARTWORK_MB * 1024 * 1024) {
      setArtworkError(`File too large — max ${MAX_ARTWORK_MB}MB.`);
      return;
    }
    setArtworkUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/events/${event.id}/artwork`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setArtworkError(body.error ?? `Upload failed (${res.status}).`); return; }
      onSaved();
    } catch {
      setArtworkError('Upload failed. Please try again.');
    } finally {
      setArtworkUploading(false);
    }
  }

  async function handleRemoveArtwork() {
    setArtworkError(null);
    setArtworkRemoving(true);
    try {
      const res = await fetch(`/api/events/${event.id}/artwork`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setArtworkError(body.error ?? `Failed to remove (${res.status}).`); return; }
      onSaved();
    } catch {
      setArtworkError('Failed to remove. Please try again.');
    } finally {
      setArtworkRemoving(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, venue: venue || null, description: description || null, status,
          starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(body.error ?? `Failed to save (${res.status}).`); return; }
      setEditing(false);
      onSaved();
    } catch {
      setFormError('Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      {!editing ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
              {event.artwork_url && <ArtworkThumb src={event.artwork_url} alt={`${event.name} artwork`} />}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, letterSpacing: '-.01em' }}>{event.name}</h1>
                  <StatusBadge label={event.status} tone={eventStatusTone(event.status)} />
                </div>
                <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 4 }}>/{event.slug}</div>
              </div>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Link href={`/events/${event.id}/check-in`} style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                  <ScanLine size={14} /> Check-in
                </Link>
                <button onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap', fontSize: 13, color: TEXT_SECONDARY }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={14} color={VIOLET_SOFT} /> {formatDate(event.starts_at, event.timezone)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} color={VIOLET_SOFT} /> {formatTime(event.starts_at, event.timezone)} – {formatTime(event.ends_at, event.timezone)} ({event.timezone})
            </span>
            {event.venue && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={14} color={VIOLET_SOFT} /> {event.venue}
              </span>
            )}
          </div>

          {event.description && (
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: TEXT_SECONDARY, marginTop: 14, marginBottom: 0, maxWidth: 720 }}>
              {event.description}
            </p>
          )}
        </>
      ) : (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>Name<input required className="bb-evt-input" value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Venue<input className="bb-evt-input" value={venue} onChange={e => setVenue(e.target.value)} style={inputStyle} /></label>
          </div>
          <label style={fieldStyle}>Description<textarea className="bb-evt-input" value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} /></label>

          <div>
            <div style={fieldStyle}>Event artwork</div>
            {event.artwork_url && <ArtworkPreview key={event.artwork_url} src={event.artwork_url} alt="Event artwork preview" />}
            <input
              ref={artworkFileInputRef} type="file" accept={ARTWORK_ACCEPT_ATTR} style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleArtworkFile(f); e.target.value = ''; }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: event.artwork_url ? 10 : 6 }}>
              <button
                type="button" style={secondaryBtnStyle} disabled={artworkUploading}
                onClick={() => artworkFileInputRef.current?.click()}
              >
                {artworkUploading ? 'Uploading…' : event.artwork_url ? 'Replace image' : 'Upload image'}
              </button>
              {event.artwork_url && (
                <DangerButton ariaLabel="Remove event artwork" onClick={handleRemoveArtwork} disabled={artworkRemoving}>
                  {artworkRemoving ? 'Removing…' : 'Remove'}
                </DangerButton>
              )}
            </div>
            <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 6 }}>JPEG, PNG, or WebP · up to {MAX_ARTWORK_MB}MB</div>
            {artworkError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginTop: 6 }}>{artworkError}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>Starts<input required type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Ends<input required type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Status
              <select className="bb-evt-input" value={status} onChange={e => setStatus(e.target.value as EventDetail['status'])} style={inputStyle}>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
          </div>
          {formError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Cancel</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────

function SessionsPanel({ eventId, sessions, orders, canManage, onChanged, timezone }: {
  eventId: string; sessions: EventSessionRow[]; orders: OrderRow[] | null; canManage: boolean; onChanged: () => void; timezone: string;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm('Delete this session?')) return;
    setDeleteError(null);
    const res = await fetch(`/api/events/${eventId}/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? `Failed to delete session (${res.status}).`);
      return;
    }
    onChanged();
  }

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Sessions"
        action={canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Session'}</button>}
      />

      {deleteError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}

      {showCreate && (
        <div style={{ marginBottom: 10 }}>
          <SessionForm
            onCancel={() => setShowCreate(false)}
            onSubmit={async (values) => {
              const res = await fetch(`/api/events/${eventId}/sessions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setShowCreate(false); onChanged(); }
              return res;
            }}
          />
        </div>
      )}

      {sessions.length === 0 && !showCreate && (
        <EmptyState title="No sessions yet" body="Add a session if this event runs at a specific time or capacity." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => editingId === s.id ? (
          <SessionForm
            key={s.id}
            initial={s}
            onCancel={() => setEditingId(null)}
            onSubmit={async (values) => {
              const res = await fetch(`/api/events/${eventId}/sessions/${s.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setEditingId(null); onChanged(); }
              return res;
            }}
          />
        ) : (
          <div key={s.id} className="bb-evt-row" style={rowCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY }}>{s.name}</div>
                <div style={{ display: 'flex', gap: 14, marginTop: 5, fontSize: 12, color: TEXT_SECONDARY, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Calendar size={12} color={VIOLET_SOFT} /> {formatDate(s.starts_at, timezone)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Clock size={12} color={VIOLET_SOFT} /> {formatTime(s.starts_at, timezone)} – {formatTime(s.ends_at, timezone)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CapacityPill registered={orders ? registeredQuantity(orders, o => o.event_session_id === s.id) : null} capacity={s.capacity} />
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingId(s.id)} style={secondaryBtnStyle}>Edit</button>
                    <DangerButton ariaLabel={`Delete session ${s.name}`} onClick={() => remove(s.id)}>Delete</DangerButton>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SessionForm({ initial, onSubmit, onCancel }: {
  initial?: EventSessionRow;
  onSubmit: (values: { name: string; starts_at: string; ends_at: string; capacity: number }) => Promise<Response>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startsAt, setStartsAt] = useState(initial ? toLocalInput(initial.starts_at) : '');
  const [endsAt, setEndsAt] = useState(initial ? toLocalInput(initial.ends_at) : '');
  const [capacity, setCapacity] = useState(initial?.capacity ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await onSubmit({ name, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), capacity: Number(capacity) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to save (${res.status}).`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...rowCardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Name<input required className="bb-evt-input" value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Capacity<input required type="number" min={0} className="bb-evt-input" value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={inputStyle} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Starts<input required type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Ends<input required type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
      </div>
      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Ticket types ────────────────────────────────────────────────────

function TicketTypesPanel({ eventId, ticketTypes, orders, canManage, onChanged }: {
  eventId: string; ticketTypes: TicketTypeRow[]; orders: OrderRow[] | null; canManage: boolean; onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm('Delete this ticket type?')) return;
    setDeleteError(null);
    const res = await fetch(`/api/events/${eventId}/ticket-types/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? `Failed to delete ticket type (${res.status}).`);
      return;
    }
    onChanged();
  }

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Ticket Types"
        action={canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Ticket Type'}</button>}
      />

      {deleteError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}

      {showCreate && (
        <div style={{ marginBottom: 10 }}>
          <TicketTypeForm
            onCancel={() => setShowCreate(false)}
            onSubmit={async (values) => {
              const res = await fetch(`/api/events/${eventId}/ticket-types`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setShowCreate(false); onChanged(); }
              return res;
            }}
          />
        </div>
      )}

      {ticketTypes.length === 0 && !showCreate && (
        <EmptyState title="No ticket types yet" body="Add a ticket type before accepting registrations." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ticketTypes.map(tt => editingId === tt.id ? (
          <TicketTypeForm
            key={tt.id}
            initial={tt}
            onCancel={() => setEditingId(null)}
            onSubmit={async (values) => {
              const res = await fetch(`/api/events/${eventId}/ticket-types/${tt.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setEditingId(null); onChanged(); }
              return res;
            }}
          />
        ) : (
          <div key={tt.id} className="bb-evt-row" style={rowCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY }}>{tt.name}</span>
                  <StatusBadge label={tt.active ? 'Active' : 'Inactive'} tone={tt.active ? 'success' : 'neutral'} />
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: TEXT_SECONDARY }}>
                  {tt.price_cents === 0 ? 'Free' : `$${(tt.price_cents / 100).toFixed(2)}`}
                  {tt.description ? ` · ${tt.description}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CapacityPill registered={orders ? registeredQuantity(orders, o => o.ticket_type_id === tt.id) : null} capacity={tt.capacity} />
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingId(tt.id)} style={secondaryBtnStyle}>Edit</button>
                    <DangerButton ariaLabel={`Delete ticket type ${tt.name}`} onClick={() => remove(tt.id)}>Delete</DangerButton>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TicketTypeForm({ initial, onSubmit, onCancel }: {
  initial?: TicketTypeRow;
  onSubmit: (values: { name: string; description?: string | null; price_cents: number; capacity: number; active: boolean; sort_order: number }) => Promise<Response>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial ? (initial.price_cents / 100).toFixed(2) : '0.00');
  const [capacity, setCapacity] = useState(initial?.capacity ?? 0);
  const [active, setActive] = useState(initial?.active ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await onSubmit({
        name, description: description || null,
        price_cents: Math.round(Number(price) * 100), capacity: Number(capacity),
        active, sort_order: Number(sortOrder),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to save (${res.status}).`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...rowCardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Name<input required className="bb-evt-input" value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Price (AUD)<input required type="number" step="0.01" min={0} className="bb-evt-input" value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Capacity<input required type="number" min={0} className="bb-evt-input" value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={inputStyle} /></label>
      </div>
      <label style={fieldStyle}>Description<input className="bb-evt-input" value={description ?? ''} onChange={e => setDescription(e.target.value)} style={inputStyle} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
        <label style={fieldStyle}>Sort order<input type="number" className="bb-evt-input" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} style={inputStyle} /></label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
      </div>
      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}
