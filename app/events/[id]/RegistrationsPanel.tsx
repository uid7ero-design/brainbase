'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Panel, SectionHeader, EmptyState, StatusBadge, orderStatusTone, paymentStatusTone, rowCardStyle,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER_SOFT, DangerButton, secondaryBtnStyle, inputStyle,
  FilterDropdown, type DropdownOption,
} from '../_components/ui';
import RegistrationDetail from './RegistrationDetail';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

// Phase 4B §7 — question_label_snapshot/field_type_snapshot as-of
// response time (never the live question), matching the API's own
// snapshot-only read (see app/api/events/[id]/orders/route.ts).
export type ResponseAnswer = { id: string; question_id: string; label: string; field_type: string; answer: unknown };
export type Attendee = {
  id: string; name: string; email: string | null; checked_in_at: string | null;
  // Phase 6 §8/§9 — resolved display name of whoever checked this
  // attendee in (null if never checked in, or if that user's account was
  // since deleted); the attendee's own existing ticket_token, exposed so
  // the manager UI can offer View/Copy without a new lookup route (never
  // regenerated — see the ticket-view decision in this phase's report).
  checked_in_by: string | null;
  ticket_token: string | null;
  responses: ResponseAnswer[];
};
export type OrderRow = {
  id: string;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_phone: string | null;
  status: string;
  created_at: string;
  // Phase 4 — see scripts/add-events-payments.sql. payment_status is
  // 'NOT_REQUIRED' for every free order (Phase 2/3's entire universe),
  // so every existing caller of this type that never reads it keeps
  // working unchanged.
  payment_status: string;
  total_cents: number;
  currency: string;
  paid_at: string | null;
  refunded_at: string | null;
  refundable: boolean;
  // Phase 5 — set once Events -> CRM sync (lib/crm/eventSync.ts) has
  // resolved/created a purchaser contact for this order; null for every
  // order created before this phase, and for any order created while
  // CRM was disabled for this organisation. Only ever meaningful
  // alongside the parent's own crm_enabled flag — see RegistrationsPanel
  // below, never rendered or linked to on its own.
  crm_contact_id: string | null;
  // Phase 4 remediation — §A.4. expires_at is only ever non-null while
  // payment_status = 'PENDING'; is_expired_pending is computed
  // server-side (comparing against the DB's own NOW(), never the
  // browser's clock) so the "expired" label can never disagree with
  // what the capacity aggregate itself already treats as released.
  expires_at: string | null;
  is_expired_pending: boolean;
  order_item_id: string;
  quantity: number;
  ticket_type_id: string | null;
  ticket_type_name: string | null;
  event_session_id: string | null;
  session_name: string | null;
  attendees: Attendee[];
  // Phase 4B §7 — booking-level (scope=ORDER) answers, once per order.
  order_responses: ResponseAnswer[];
};

function formatAnswerValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

const PAYMENT_STATUS_OPTIONS = ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;

// Registration operations phase — search + filters + CSV export. The
// query params below (q/paymentStatus/checkin/cancelled/ticketTypeId/
// sessionId) are exactly what app/api/events/[id]/orders/route.ts and
// .../orders/export/route.ts both accept, parsed/applied server-side by
// the SHARED module lib/events/registrationFilters.ts — this component
// only ever builds the query string, it never re-implements filter
// semantics client-side.
//
// This panel runs its OWN, independent fetch of the orders list (rather
// than only ever rendering the `orders` prop EventDetailClient already
// fetched once, unfiltered) — deliberately: the KPI strip and the
// per-session/per-ticket-type "registered" counts on the parent page
// must stay based on the FULL, unfiltered order set (they describe the
// whole event, not a filtered view), so they cannot share a single
// filtered fetch with this panel's own list. `orders`/`error` props are
// still accepted (used as the initial seed, so there's no blank flash
// before this panel's own first fetch resolves) but this panel's actual
// rendered list is always its own `listOrders` state going forward.
export default function RegistrationsPanel({
  eventId, orders, error, canManage, crmEnabled, ticketTypes, sessions, onRefunded,
}: {
  eventId: string;
  orders: OrderRow[] | null;
  error: string | null;
  canManage: boolean;
  crmEnabled: boolean;
  ticketTypes: { id: string; name: string }[];
  sessions: { id: string; name: string }[];
  onRefunded: () => void;
}) {
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Search + filters ────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [checkinFilter, setCheckinFilter] = useState('');
  const [cancelledFilter, setCancelledFilter] = useState(''); // '' | 'true' | 'false'
  const [ticketTypeFilter, setTicketTypeFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');

  const hasActiveFilter =
    debouncedQuery !== '' || paymentStatusFilter !== '' || checkinFilter !== '' ||
    cancelledFilter !== '' || ticketTypeFilter !== '' || sessionFilter !== '';

  // Search box debounced ~300ms; every filter select refreshes
  // immediately (no debounce needed — a select change is already a
  // single discrete action, not a keystroke stream).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  function buildQueryString(): string {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (paymentStatusFilter) params.set('paymentStatus', paymentStatusFilter);
    if (checkinFilter) params.set('checkin', checkinFilter);
    if (cancelledFilter) params.set('cancelled', cancelledFilter);
    if (ticketTypeFilter) params.set('ticketTypeId', ticketTypeFilter);
    if (sessionFilter) params.set('sessionId', sessionFilter);
    return params.toString();
  }

  const [listOrders, setListOrders] = useState<OrderRow[] | null>(orders);
  const [listOrderCount, setListOrderCount] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(error);
  // Bumped after a mutation (refund/cancel/retry) to force this effect
  // to re-run even when none of the filter/search values themselves
  // changed — same "reloadKey" idiom EventDetailClient's own two data-
  // fetching effects already use, kept local to this panel since its
  // fetch is independent of the parent's.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshList = useCallback(() => setRefreshKey(k => k + 1), []);

  // Inline async IIFE directly in the effect body, matching
  // EventDetailClient's own two data-fetching effects exactly (rather
  // than calling a separately-memoized function from inside the
  // effect) — both for consistency and because this codebase's lint
  // config flags the latter pattern (cascading setState-in-effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListError(null);
      const qs = buildQueryString();
      try {
        const res = await fetch(`/api/events/${eventId}/orders${qs ? `?${qs}` : ''}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setListError(body.error ?? `Failed to load registrations (${res.status}).`);
          return;
        }
        setListOrders(body.orders ?? []);
        setListOrderCount(typeof body.order_count === 'number' ? body.order_count : null);
      } catch {
        if (!cancelled) setListError('Failed to load registrations. Please try again.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, debouncedQuery, paymentStatusFilter, checkinFilter, cancelledFilter, ticketTypeFilter, sessionFilter, refreshKey]);

  function clearFilters() {
    setSearchInput('');
    setDebouncedQuery('');
    setPaymentStatusFilter('');
    setCheckinFilter('');
    setCancelledFilter('');
    setTicketTypeFilter('');
    setSessionFilter('');
  }

  const displayedOrders = listOrders;
  const nonCancelled = displayedOrders?.filter(o => o.status !== 'CANCELLED') ?? [];
  const orderCount = new Set(nonCancelled.map(o => o.id)).size;
  const totalAttendees = nonCancelled.reduce((sum, o) => sum + o.quantity, 0);

  // Phase 4B §7 — collapsed by default, per-order, so a booking with no
  // registration-question answers (the common case for events with no
  // configured questions) never grows the row at all, and one with
  // answers doesn't clutter every other row by default either.
  const [expandedResponseIds, setExpandedResponseIds] = useState<Set<string>>(new Set());
  function toggleResponses(orderId: string) {
    setExpandedResponseIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  // Phase 6 §2/§15 — the full "registration detail" experience (editable
  // purchaser/attendee/answers + internal notes), collapsed by default
  // per order, separate from the quick read-only "View answers" toggle
  // above so a manager who just wants to glance at answers isn't shown
  // an edit form by default.
  const [managingIds, setManagingIds] = useState<Set<string>>(new Set());
  function toggleManaging(orderId: string) {
    setManagingIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  }

  async function refund(orderId: string) {
    if (!confirm('Refund this order in full via Stripe? This also cancels the tickets.')) return;
    setActionError(null);
    setRefundingId(orderId);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${orderId}/refund`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error ?? `Refund failed (${res.status}).`);
        return;
      }
      onRefunded();
      refreshList();
    } catch {
      setActionError('Refund failed. Please try again.');
    } finally {
      setRefundingId(null);
    }
  }

  // §A.1 — cancel an abandoned/incomplete PENDING reservation. Manager-
  // only, destructive (releases the reservation for good), so it goes
  // through the same confirm() pattern as refund above.
  async function cancelPending(orderId: string) {
    if (!confirm('Cancel this pending registration? This releases the reserved tickets.')) return;
    setActionError(null);
    setCancellingId(orderId);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${orderId}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error ?? `Cancel failed (${res.status}).`);
        return;
      }
      onRefunded();
      refreshList();
    } catch {
      setActionError('Cancel failed. Please try again.');
    } finally {
      setCancellingId(null);
    }
  }

  // §A.2 — retry payment for a still-PENDING order. Not destructive
  // (no confirm() needed): it either succeeds and opens a fresh Stripe
  // Checkout in a new tab, or fails cleanly with no state change.
  async function retryPayment(orderId: string) {
    setActionError(null);
    setRetryingId(orderId);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${orderId}/retry`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error ?? `Retry failed (${res.status}).`);
        return;
      }
      window.open(body.checkout_url, '_blank', 'noopener,noreferrer');
      onRefunded();
      refreshList();
    } catch {
      setActionError('Retry failed. Please try again.');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Registrations"
        sub={displayedOrders && `${orderCount} order${orderCount === 1 ? '' : 's'} · ${totalAttendees} attendee${totalAttendees === 1 ? '' : 's'}`}
      />

      <div
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${BORDER_SOFT}`,
        }}
      >
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search name, email, phone, order ref…"
          style={{ ...inputStyle, flex: '1 1 220px', minWidth: 180 }}
          aria-label="Search registrations"
        />
        <FilterDropdown
          ariaLabel="Filter by payment status"
          value={paymentStatusFilter}
          onChange={setPaymentStatusFilter}
          options={[
            { value: '', label: 'Any payment status' },
            ...PAYMENT_STATUS_OPTIONS.map(v => ({ value: v, label: v })),
          ]}
        />
        <FilterDropdown
          ariaLabel="Filter by check-in status"
          value={checkinFilter}
          onChange={setCheckinFilter}
          options={[
            { value: '', label: 'Any check-in status' },
            { value: 'in', label: 'Checked in' },
            { value: 'out', label: 'Not checked in' },
          ]}
        />
        <FilterDropdown
          ariaLabel="Filter by cancellation"
          value={cancelledFilter}
          onChange={setCancelledFilter}
          options={[
            { value: '', label: 'Active + cancelled' },
            { value: 'false', label: 'Active only' },
            { value: 'true', label: 'Cancelled only' },
          ]}
        />
        {ticketTypes.length > 0 && (
          <FilterDropdown
            ariaLabel="Filter by ticket type"
            value={ticketTypeFilter}
            onChange={setTicketTypeFilter}
            options={[
              { value: '', label: 'Any ticket type' },
              ...ticketTypes.map((t): DropdownOption => ({ value: t.id, label: t.name })),
            ]}
          />
        )}
        {sessions.length > 0 && (
          <FilterDropdown
            ariaLabel="Filter by session"
            value={sessionFilter}
            onChange={setSessionFilter}
            options={[
              { value: '', label: 'Any session' },
              ...sessions.map((s): DropdownOption => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
        {hasActiveFilter && (
          <button onClick={clearFilters} style={secondaryBtnStyle}>Clear filters</button>
        )}
        <div style={{ flex: '1 1 auto' }} />
        <span style={{ fontSize: 12, color: TEXT_MUTED, whiteSpace: 'nowrap' }}>
          {listOrderCount !== null ? `${listOrderCount} matching registration${listOrderCount === 1 ? '' : 's'}` : ''}
        </span>
        {/* Export is manager+ only (authorizeEventsRequest('manager') on
            the server route) — canManage here is exactly that same
            manager-or-above check (see app/events/[id]/page.tsx), reused
            as-is rather than inventing a separate client-side auth model.
            An ordinary viewer gets search/filter but never sees this
            button; the server route remains authoritative regardless. */}
        {canManage && (
          <a
            href={`/api/events/${eventId}/orders/export${buildQueryString() ? `?${buildQueryString()}` : ''}`}
            style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-block' }}
          >
            Export CSV
          </a>
        )}
      </div>

      {(error || listError) && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>{listError ?? error}</div>}
      {actionError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>{actionError}</div>}
      {displayedOrders === null && !listError && <div style={{ fontSize: 13, color: TEXT_MUTED }}>Loading…</div>}
      {displayedOrders !== null && displayedOrders.length === 0 && (
        <EmptyState
          title={hasActiveFilter ? 'No registrations match these filters' : 'No registrations yet'}
          body={hasActiveFilter ? 'Try a different search term or clear the active filters.' : 'Registrations will appear here as people reserve tickets.'}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {displayedOrders?.map(o => {
          const hasResponses = o.order_responses.length > 0 || o.attendees.some(a => a.responses.length > 0);
          const responsesOpen = expandedResponseIds.has(o.id);
          return (
          <div key={o.order_item_id} style={rowCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, flex: 1, minWidth: 260 }}>
                <RegField label="Purchaser" value={o.purchaser_name} sub={o.purchaser_email} />
                <RegField label="Ticket" value={`${o.ticket_type_name ?? 'Unknown ticket type'} × ${o.quantity}`} />
                {o.session_name && <RegField label="Session" value={o.session_name} />}
                {o.payment_status !== 'NOT_REQUIRED' && (
                  <RegField label="Amount" value={formatAmount(o.total_cents, o.currency)} />
                )}
                <RegField label="Registered" value={new Date(o.created_at).toLocaleString()} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {hasResponses && (
                  <button onClick={() => toggleResponses(o.id)} style={secondaryBtnStyle}>
                    {responsesOpen ? 'Hide answers' : 'View answers'}
                  </button>
                )}
                {canManage && (
                  <button onClick={() => toggleManaging(o.id)} style={secondaryBtnStyle}>
                    {managingIds.has(o.id) ? 'Close registration detail' : 'Manage registration'}
                  </button>
                )}
                {o.payment_status === 'NOT_REQUIRED' ? (
                  <StatusBadge label="Free" tone="neutral" />
                ) : o.payment_status === 'PENDING' && o.is_expired_pending ? (
                  <StatusBadge label="Pending payment (expired)" tone="danger" />
                ) : (
                  <StatusBadge label={o.payment_status === 'PENDING' ? 'Pending payment' : o.payment_status} tone={paymentStatusTone(o.payment_status)} />
                )}
                <StatusBadge label={o.status} tone={orderStatusTone(o.status)} />
                {/* Phase 5 — only when CRM is enabled for this
                    organisation AND this specific order has a resolved
                    link (both server-decided, never assumed client-side
                    — see EventDetailClient's crmEnabled fetch and
                    app/api/events/[id]/orders/route.ts's crm_enabled/
                    crm_contact_id fields). canManage gates this the same
                    as every other action in this row; CRM's own access
                    model has no further per-user split beyond being an
                    authenticated, entitled org member (see
                    lib/capabilities/requireCapability.ts), which
                    canManage + crmEnabled together already establish. */}
                {canManage && crmEnabled && o.crm_contact_id && (
                  <Link href={`/crm/contacts/${o.crm_contact_id}`} style={secondaryBtnStyle}>
                    View CRM Contact
                  </Link>
                )}
                {canManage && o.payment_status === 'PAID' && o.refundable && (
                  <DangerButton
                    ariaLabel={`Refund order for ${o.purchaser_name}`}
                    onClick={() => refund(o.id)}
                    disabled={refundingId === o.id}
                  >
                    {refundingId === o.id ? 'Refunding…' : 'Refund'}
                  </DangerButton>
                )}
                {canManage && o.payment_status === 'PENDING' && (
                  <>
                    <button
                      onClick={() => retryPayment(o.id)}
                      disabled={retryingId === o.id}
                      style={{ ...secondaryBtnStyle, opacity: retryingId === o.id ? 0.6 : 1 }}
                    >
                      {retryingId === o.id ? 'Starting…' : 'Retry payment'}
                    </button>
                    <DangerButton
                      ariaLabel={`Cancel pending registration for ${o.purchaser_name}`}
                      onClick={() => cancelPending(o.id)}
                      disabled={cancellingId === o.id}
                    >
                      {cancellingId === o.id ? 'Cancelling…' : 'Cancel registration'}
                    </DangerButton>
                  </>
                )}
              </div>
            </div>

            {o.attendees.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER_SOFT}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {o.attendees.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                    <span style={{ color: TEXT_PRIMARY, fontWeight: 500 }}>{a.name}</span>
                    {a.checked_in_at ? (
                      <span style={{ color: '#4ADE80', fontWeight: 600 }}>Checked in · {new Date(a.checked_in_at).toLocaleTimeString()}</span>
                    ) : (
                      <span style={{ color: TEXT_MUTED }}>Not checked in</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {responsesOpen && hasResponses && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER_SOFT}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {o.order_responses.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 4 }}>Booking details</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {o.order_responses.map(r => (
                        <div key={r.question_id} style={{ fontSize: 12.5 }}>
                          <span style={{ color: TEXT_SECONDARY }}>{r.label}: </span>
                          <span style={{ color: TEXT_PRIMARY }}>{formatAnswerValue(r.answer)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {o.attendees.filter(a => a.responses.length > 0).map(a => (
                  <div key={a.id}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 4 }}>{a.name}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {a.responses.map(r => (
                        <div key={r.question_id} style={{ fontSize: 12.5 }}>
                          <span style={{ color: TEXT_SECONDARY }}>{r.label}: </span>
                          <span style={{ color: TEXT_PRIMARY }}>{formatAnswerValue(r.answer)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {managingIds.has(o.id) && (
              <RegistrationDetail eventId={eventId} order={o} onChanged={onRefunded} />
            )}
          </div>
          );
        })}
      </div>
    </Panel>
  );
}

function RegField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: TEXT_PRIMARY, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
