'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, ArrowLeft, ScanLine } from 'lucide-react';
import { Metric, MetricStrip } from '@/components/ui/app';
import RegistrationsPanel, { type OrderRow, withAnswerArrays } from './RegistrationsPanel';
import { groupOrderRows } from '@/lib/events/orderGrouping';
import QuestionsPanel from './QuestionsPanel';
import { PromotionsPanel, AccessCodesPanel } from './PromotionsPanel';
import { saleWindowPhase } from '@/lib/events/saleWindow';
import { ARTWORK_ACCEPT_ATTR, MAX_ARTWORK_MB, isAllowedArtworkMimeType } from '@/lib/events/artworkConstants';
import {
  FONT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, VIOLET_SOFT,
  Panel, SectionHeader, EmptyState, StatusBadge, eventStatusTone, capacityTone,
  primaryBtnStyle, secondaryBtnStyle, DangerButton, fieldStyle, inputStyle, rowCardStyle, EventsSharedStyles,
  FilterDropdown,
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
  // Phase 5B — opt-in purchaser reminder email (24 hours before the
  // event). Absent on an older payload shape; treated as off.
  reminder_enabled?: boolean;
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
  // Phase 4 — optional sale window + presale gate (see
  // scripts/create-events-promotions-presales-sale-windows.sql). Absent
  // on an older payload shape; treated as "no restriction".
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  requires_access_code?: boolean;
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

export default function EventDetailClient({ eventId, canManage, organisationSlug }: { eventId: string; canManage: boolean; organisationSlug: string | null }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [sessions, setSessions] = useState<EventSessionRow[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([]);
  const [notFound, setNotFoundState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // Phase 5 — decided server-side by GET /api/events/[id]/orders itself
  // (this organisation's real CRM capability entitlement, never assumed
  // client-side). Defaults false until the first successful fetch, so
  // "View CRM Contact" never flashes visible before it's actually known
  // to be allowed.
  const [crmEnabled, setCrmEnabled] = useState(false);

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
        if (!cancelled) {
          setOrders(withAnswerArrays(body.orders ?? []));
          setCrmEnabled(body.crm_enabled === true);
        }
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
  const statusTone = event.status === 'PUBLISHED' ? 'success' as const : event.status === 'CANCELLED' ? 'danger' as const : undefined;
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
  //
  // Phase 2 (multi-ticket-type orders) — the orders API returns one row
  // per order ITEM (see lib/events/orderGrouping.ts), so a cart order
  // arrives as several rows that each carry the same whole-order
  // total_cents and payment_status. Revenue, paid/pending/refunded
  // counts and the refunded amount are ORDER-level facts, so the rows
  // are folded to one entry per order first — otherwise a 3-line order
  // counts as 3 paid orders and its total is summed 3 times. The per-row
  // grain is kept for everything else (attendee totals and the
  // per-ticket-type / per-session registered counts are per line).
  const orderLevel = orders ? groupOrderRows(orders) : [];
  const paidOrders = orderLevel.filter(o => o.payment_status === 'PAID');
  const pendingPaymentOrders = orderLevel.filter(o => o.payment_status === 'PENDING');
  const refundedOrders = orderLevel.filter(o => o.payment_status === 'REFUNDED');
  // Phase 5A — "Revenue" stays TICKET revenue (Σ total_cents, net of
  // discounts — never conflated with platform revenue); platform fees are
  // summed separately and shown only when any paid order carried one, so
  // a zero-fee BrainBase event renders exactly as before. "Refunded" is
  // what was actually returned to customers (refunded_cents, falling back
  // to the ticket total for orders refunded before this phase).
  const grossRevenueCents = paidOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const platformFeesCents = paidOrders.reduce((sum, o) => sum + (o.platform_fee_cents ?? 0), 0);
  const absorbedFeeOrders = paidOrders.filter(o => (o.platform_fee_cents ?? 0) > 0 && o.fee_mode === 'ABSORB').length;
  const passThroughFeeOrders = paidOrders.filter(o => (o.platform_fee_cents ?? 0) > 0 && o.fee_mode === 'PASS_THROUGH').length;
  const refundedCents = refundedOrders.reduce((sum, o) => sum + (o.refunded_cents ?? o.payment_total_cents ?? o.total_cents), 0);
  const revenueCurrency = paidOrders[0]?.currency ?? orders?.find(o => o.payment_status !== 'NOT_REQUIRED')?.currency ?? 'AUD';
  const hasPaidTicketTypes = ticketTypes.some(t => t.price_cents > 0);
  const formatMoney = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: revenueCurrency }).format(cents / 100);

  return (
    // width/boxSizing: bound the root to the viewport (it would otherwise
    // shrink-to-fit its content inside the app's flex column), so the
    // metric strip reflows at phone width instead of widening the page.
    <div style={{ width: '100%', boxSizing: 'border-box', padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 1140, margin: '0 auto' }}>
      <EventsSharedStyles />

      <Link href="/events" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: VIOLET_SOFT, fontSize: 12.5, textDecoration: 'none', marginBottom: 16, fontWeight: 600 }}>
        <ArrowLeft size={13} /> Back to Events
      </Link>

      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <EventOverview event={event} canManage={canManage} onSaved={reload} organisationSlug={organisationSlug} />

      {/* Phase D1 — one compact metric strip (was up to 10 forced-dark KPI
          cards). Colour only where a value carries state: capacity full,
          event status, payments awaiting action. */}
      <MetricStrip style={{ marginTop: 20 }}>
        <Metric label="Orders" value={orderCount} loading={orders === null} />
        <Metric label="Attendees" value={attendeeCount} loading={orders === null} />
        <Metric
          label="Checked In"
          value={checkedInCount}
          loading={orders === null}
          sub={orders && checkInRate !== null ? `${checkInRate}% · ${attendeeCount - checkedInCount} remaining` : undefined}
        />
        <Metric label="Ticket Capacity" value={totalTicketCapacity} />
        <Metric
          label="Remaining"
          value={remainingCapacity}
          tone={orders && remainingCapacity === 0 ? 'danger' : undefined}
          loading={orders === null}
          sub={orders && registrationRate !== null ? `${registrationRate}% booked` : undefined}
        />
        <Metric label="Sessions" value={sessions.length} />
        <Metric label="Status" value={event.status} tone={statusTone} />
        {hasPaidTicketTypes && (
          <>
            <Metric
              label="Revenue"
              value={formatMoney(grossRevenueCents)}
              loading={orders === null}
              sub={orders ? `${paidOrders.length} paid order${paidOrders.length === 1 ? '' : 's'}${platformFeesCents > 0 ? ' · ticket revenue' : ''}` : undefined}
            />
            {platformFeesCents > 0 && (
              <Metric
                label="Platform Fees"
                value={formatMoney(platformFeesCents)}
                sub={[
                  passThroughFeeOrders > 0 ? `${passThroughFeeOrders} paid by customers` : null,
                  absorbedFeeOrders > 0 ? `${absorbedFeeOrders} deducted from proceeds` : null,
                ].filter(Boolean).join(' · ')}
              />
            )}
            <Metric
              label="Pending Payment"
              value={pendingPaymentOrders.length}
              tone={pendingPaymentOrders.length > 0 ? 'warning' : undefined}
              loading={orders === null}
            />
            {refundedOrders.length > 0 && (
              <Metric label="Refunded" value={formatMoney(refundedCents)} sub={`${refundedOrders.length} order${refundedOrders.length === 1 ? '' : 's'}`} />
            )}
          </>
        )}
      </MetricStrip>

      <SessionsPanel eventId={eventId} sessions={sessions} orders={orders} canManage={canManage} onChanged={reload} timezone={event.timezone} />
      <TicketTypesPanel eventId={eventId} ticketTypes={ticketTypes} orders={orders} canManage={canManage} onChanged={reload} timezone={event.timezone} />
      {/* Phase 4 — promotional codes and presale access codes, scoped to
          this event. Keyed on reloadKey so a ticket-type change (new type,
          renamed, restricted) is reflected in the assignment lists. */}
      <PromotionsPanel key={`promo-${reloadKey}`} eventId={eventId} ticketTypes={ticketTypes} canManage={canManage} timezone={event.timezone} />
      <AccessCodesPanel key={`access-${reloadKey}`} eventId={eventId} ticketTypes={ticketTypes} canManage={canManage} timezone={event.timezone} />
      <QuestionsPanel eventId={eventId} canManage={canManage} />
      <RegistrationsPanel
        eventId={eventId} orders={orders} error={ordersError} canManage={canManage} crmEnabled={crmEnabled}
        ticketTypes={ticketTypes} sessions={sessions} onRefunded={reload}
      />
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
    <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', flex: 'none' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

function ArtworkPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--status-danger)' }}>Could not load a preview for this URL.</div>;
  }
  return (
    <div style={{ marginTop: 10, width: 220, aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
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
  fontSize: 11, fontWeight: 600, color: TEXT_MUTED, background: 'var(--bg-sunken)',
  border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
};

// ─── Overview / control header ─────────────────────────────────────

function EventOverview({ event, canManage, onSaved, organisationSlug }: { event: EventDetail; canManage: boolean; onSaved: () => void; organisationSlug: string | null }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Part B — same existing public route, same window.location.origin
  // pattern already established for ticket links (see
  // RegistrationDetail.tsx's own ticketUrl()) — correct in every
  // environment with no configuration to keep in sync. Never gated on
  // event.status; see EventsListClient's identical "View public page"
  // comment for why.
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  function publicEventUrl(): string {
    return `${window.location.origin}/e/${organisationSlug}/${event.slug}`;
  }
  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(publicEventUrl());
      setPublicLinkCopied(true);
      setTimeout(() => setPublicLinkCopied(false), 1500);
    } catch { /* clipboard unavailable — the link is still reachable via View public page */ }
  }
  const [name, setName] = useState(event.name);
  const [venue, setVenue] = useState(event.venue ?? '');
  const [description, setDescription] = useState(event.description ?? '');
  const [status, setStatus] = useState(event.status);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.ends_at));
  const [reminderEnabled, setReminderEnabled] = useState(event.reminder_enabled === true);

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
          reminder_enabled: reminderEnabled,
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Part B — always visible to anyone who can reach this
                  internal screen at all (not canManage-gated): the
                  target URL is the same one already publicly reachable
                  to anyone on the internet, so there's nothing more
                  privileged about viewing/copying it here than a viewer
                  finding it themselves. */}
              {organisationSlug && (
                <>
                  <a
                    href={publicEventUrl()} target="_blank" rel="noopener noreferrer"
                    style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                  >
                    View public page
                  </a>
                  <button onClick={copyPublicLink} style={secondaryBtnStyle}>
                    {publicLinkCopied ? 'Copied!' : 'Copy public link'}
                  </button>
                </>
              )}
              {canManage && (
                <>
                  <Link href={`/events/${event.id}/check-in`} style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                    <ScanLine size={14} /> Check-in
                  </Link>
                  <button onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
                </>
              )}
            </div>
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
            {artworkError && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginTop: 6 }}>{artworkError}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>Starts<input required type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Ends<input required type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Status
              <FilterDropdown
                ariaLabel="Status"
                value={status}
                onChange={v => setStatus(v as EventDetail['status'])}
                options={[
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'PUBLISHED', label: 'Published' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
                style={{ width: '100%' }}
                triggerStyle={{ width: '100%' }}
              />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: TEXT_MUTED, cursor: 'pointer' }}>
            <input type="checkbox" checked={reminderEnabled} onChange={e => setReminderEnabled(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              Send a reminder email to purchasers 24 hours before the event
              <span style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}>One email per confirmed order, with their ticket links. Off by default.</span>
            </span>
          </label>
          {formError && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12 }}>{formError}</div>}
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
  // Phase 3 — which session's ticket type × session inventory table is
  // expanded (at most one at a time; purely a disclosure, no data).
  const [inventoryOpenId, setInventoryOpenId] = useState<string | null>(null);

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

      {deleteError && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}

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
                <button
                  type="button"
                  onClick={() => setInventoryOpenId(cur => (cur === s.id ? null : s.id))}
                  aria-expanded={inventoryOpenId === s.id}
                  style={secondaryBtnStyle}
                >
                  {inventoryOpenId === s.id ? 'Hide inventory' : 'Inventory'}
                </button>
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingId(s.id)} style={secondaryBtnStyle}>Edit</button>
                    <DangerButton ariaLabel={`Delete session ${s.name}`} onClick={() => remove(s.id)}>Delete</DangerButton>
                  </div>
                )}
              </div>
            </div>
            {inventoryOpenId === s.id && (
              <SessionInventoryTable eventId={eventId} session={s} canManage={canManage} />
            )}
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
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Ticket type × session inventory (Phase 3) ──────────────────────
//
// Per session, one row per ticket type: the event-wide capacity, this
// session's override (if any), and the pair's live sold/remaining —
// read from GET /api/events/[id]/sessions/[sessionId]/inventory, which
// applies the same precedence and stale-hold predicate as the
// reservation gate. Managers set an override (PUT) or clear it (DELETE);
// a type with no override shows "Event-wide (N)" and is governed by its
// ordinary ticket-type capacity, exactly as today. Deliberately a small
// disclosure inside the existing Sessions panel — not a new page, not
// a reporting feature.

type SessionInventoryRow = {
  ticket_type_id: string;
  ticket_type_name: string;
  active: boolean;
  type_capacity: number;
  override_capacity: number | null;
  effective_capacity: number;
  sold: number;
  remaining: number;
};

function SessionInventoryTable({ eventId, session, canManage }: { eventId: string; session: EventSessionRow; canManage: boolean }) {
  const [rows, setRows] = useState<SessionInventoryRow[] | null>(null);
  const [sessionLive, setSessionLive] = useState<{ sold: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const res = await fetch(`/api/events/${eventId}/sessions/${session.id}/inventory`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setError(body.error ?? `Failed to load session inventory (${res.status}).`);
        return;
      }
      const body = await res.json();
      if (!cancelled) {
        setRows(body.inventory ?? []);
        setSessionLive(body.event_session ? { sold: body.event_session.sold, remaining: body.event_session.remaining } : null);
        setDrafts({});
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, session.id, reloadKey]);

  async function setOverride(row: SessionInventoryRow) {
    const raw = drafts[row.ticket_type_id];
    const capacity = raw === undefined || raw === '' ? row.override_capacity : Number(raw);
    if (capacity === null || !Number.isInteger(capacity) || capacity < 0) {
      setError('Capacity must be a non-negative whole number.');
      return;
    }
    setBusyId(row.ticket_type_id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/sessions/${session.id}/inventory/${row.ticket_type_id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capacity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to set session inventory (${res.status}).`);
        return;
      }
      setReloadKey(k => k + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function clearOverride(row: SessionInventoryRow) {
    setBusyId(row.ticket_type_id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/sessions/${session.id}/inventory/${row.ticket_type_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to clear session inventory (${res.status}).`);
        return;
      }
      setReloadKey(k => k + 1);
    } finally {
      setBusyId(null);
    }
  }

  const cellStyle: React.CSSProperties = { padding: '6px 8px', fontSize: 12, color: TEXT_SECONDARY, textAlign: 'left', verticalAlign: 'middle' };
  const headStyle: React.CSSProperties = { ...cellStyle, color: TEXT_MUTED, fontWeight: 600, fontSize: 11, letterSpacing: '.02em', textTransform: 'uppercase' };

  return (
    <div data-testid={`session-inventory-${session.id}`} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: TEXT_PRIMARY }}>Session inventory</div>
        <div style={{ fontSize: 11.5, color: TEXT_MUTED }}>
          Session shared capacity {session.capacity}
          {sessionLive ? ` · ${sessionLive.sold} booked · ${sessionLive.remaining} remaining` : ''}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 8 }}>
        A per-session capacity replaces the ticket type&apos;s event-wide capacity for this session only. The session&apos;s shared capacity still caps every ticket type combined.
      </div>
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {rows === null && !error && <div style={{ fontSize: 12, color: TEXT_MUTED }}>Loading…</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 12, color: TEXT_MUTED }}>No ticket types yet.</div>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headStyle}>Ticket type</th>
                <th style={headStyle}>Capacity in this session</th>
                <th style={headStyle}>Booked</th>
                <th style={headStyle}>Remaining</th>
                {canManage && <th style={headStyle}>Override</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const overridden = row.override_capacity !== null;
                const draft = drafts[row.ticket_type_id] ?? (overridden ? String(row.override_capacity) : '');
                const busy = busyId === row.ticket_type_id;
                return (
                  <tr key={row.ticket_type_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...cellStyle, color: TEXT_PRIMARY, fontWeight: 600 }}>
                      {row.ticket_type_name}{!row.active && <span style={{ color: TEXT_MUTED, fontWeight: 400 }}> · Inactive</span>}
                    </td>
                    <td style={cellStyle}>
                      {overridden
                        ? <span>{row.effective_capacity} <span style={{ color: TEXT_MUTED }}>(session override)</span></span>
                        : <span>Event-wide ({row.type_capacity})</span>}
                    </td>
                    <td style={cellStyle}>{row.sold}</td>
                    <td style={cellStyle}>
                      <StatusBadge label={String(row.remaining)} tone={capacityTone(row.remaining, row.effective_capacity)} />
                    </td>
                    {canManage && (
                      <td style={cellStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number" min={0} className="bb-evt-input" aria-label={`${row.ticket_type_name} capacity in ${session.name}`}
                            value={draft} placeholder="—" disabled={busy}
                            onChange={e => setDrafts(d => ({ ...d, [row.ticket_type_id]: e.target.value }))}
                            style={{ ...inputStyle, width: 80 }}
                          />
                          <button type="button" disabled={busy || draft === ''} onClick={() => setOverride(row)} style={secondaryBtnStyle}>Set</button>
                          {overridden && <button type="button" disabled={busy} onClick={() => clearOverride(row)} style={secondaryBtnStyle}>Clear</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Ticket types ────────────────────────────────────────────────────

// Phase 4 — the organiser-facing on-sale state of a ticket type, from the
// same half-open rule the server enforces (lib/events/saleWindow.ts).
function saleWindowBadge(tt: TicketTypeRow): { label: string; tone: 'success' | 'neutral' | 'warning' } | null {
  if (!tt.sale_starts_at && !tt.sale_ends_at) return null;
  const phase = saleWindowPhase({ sale_starts_at: tt.sale_starts_at ?? null, sale_ends_at: tt.sale_ends_at ?? null });
  if (phase === 'COMING_SOON') return { label: 'Coming soon', tone: 'warning' };
  if (phase === 'SALES_ENDED') return { label: 'Sales ended', tone: 'neutral' };
  return { label: 'On sale', tone: 'success' };
}
function formatSaleWindow(tt: TicketTypeRow, timeZone: string): string | null {
  const fmt = (iso: string) => `${formatDate(iso, timeZone)} ${formatTime(iso, timeZone)}`;
  if (tt.sale_starts_at && tt.sale_ends_at) return `Sales ${fmt(tt.sale_starts_at)} – ${fmt(tt.sale_ends_at)}`;
  if (tt.sale_starts_at) return `Sales open ${fmt(tt.sale_starts_at)}`;
  if (tt.sale_ends_at) return `Sales close ${fmt(tt.sale_ends_at)}`;
  return null;
}

function TicketTypesPanel({ eventId, ticketTypes, orders, canManage, onChanged, timezone }: {
  eventId: string; ticketTypes: TicketTypeRow[]; orders: OrderRow[] | null; canManage: boolean; onChanged: () => void; timezone: string;
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

      {deleteError && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>}

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
                  {(() => { const b = saleWindowBadge(tt); return b ? <StatusBadge label={b.label} tone={b.tone} /> : null; })()}
                  {tt.requires_access_code && <StatusBadge label="Access code required" tone="warning" />}
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: TEXT_SECONDARY }}>
                  {tt.price_cents === 0 ? 'Free' : `$${(tt.price_cents / 100).toFixed(2)}`}
                  {tt.description ? ` · ${tt.description}` : ''}
                  {(() => { const w = formatSaleWindow(tt, timezone); return w ? ` · ${w}` : ''; })()}
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
  onSubmit: (values: {
    name: string; description?: string | null; price_cents: number; capacity: number; active: boolean; sort_order: number;
    sale_starts_at: string | null; sale_ends_at: string | null; requires_access_code: boolean;
  }) => Promise<Response>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial ? (initial.price_cents / 100).toFixed(2) : '0.00');
  const [capacity, setCapacity] = useState(initial?.capacity ?? 0);
  const [active, setActive] = useState(initial?.active ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  // Phase 4 — same datetime-local → ISO convention as SessionForm.
  const [saleStartsAt, setSaleStartsAt] = useState(initial?.sale_starts_at ? toLocalInput(initial.sale_starts_at) : '');
  const [saleEndsAt, setSaleEndsAt] = useState(initial?.sale_ends_at ? toLocalInput(initial.sale_ends_at) : '');
  const [requiresAccessCode, setRequiresAccessCode] = useState(initial?.requires_access_code ?? false);
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
        sale_starts_at: saleStartsAt ? new Date(saleStartsAt).toISOString() : null,
        sale_ends_at: saleEndsAt ? new Date(saleEndsAt).toISOString() : null,
        requires_access_code: requiresAccessCode,
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Sales open (optional)<input type="datetime-local" className="bb-evt-input" value={saleStartsAt} onChange={e => setSaleStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Sales close (optional)<input type="datetime-local" className="bb-evt-input" value={saleEndsAt} onChange={e => setSaleEndsAt(e.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
        <label style={fieldStyle}>Sort order<input type="number" className="bb-evt-input" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} style={inputStyle} /></label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={requiresAccessCode} onChange={e => setRequiresAccessCode(e.target.checked)} /> Requires access code
        </label>
      </div>
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}
