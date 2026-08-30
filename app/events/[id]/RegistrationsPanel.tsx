'use client';

import { useState } from 'react';
import {
  Panel, SectionHeader, EmptyState, StatusBadge, orderStatusTone, paymentStatusTone, rowCardStyle,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER_SOFT, DangerButton, secondaryBtnStyle,
} from '../_components/ui';

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

export type Attendee = { id: string; name: string; email: string | null; checked_in_at: string | null };
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
};

// Phase 2 — read-only. No CSV export, no CRM auto-sync. Phase 4 adds
// exactly one mutation to this previously fully read-only panel: a
// manager-only "Refund" action on a paid order (see the button below
// and app/api/events/[id]/orders/[orderId]/refund/route.ts) — every
// other row here remains display-only.
//
// Orders are fetched once by the parent (EventDetailClient) rather than
// here, so the same data can also drive the KPI strip and the per-
// session/per-ticket-type "registered" counts without a second network
// round trip to the same endpoint. `onRefunded` asks the parent to
// re-fetch after a successful refund, the same reload() callback every
// other mutating panel in this module already uses.
export default function RegistrationsPanel({
  eventId, orders, error, canManage, onRefunded,
}: {
  eventId: string; orders: OrderRow[] | null; error: string | null; canManage: boolean; onRefunded: () => void;
}) {
  const nonCancelled = orders?.filter(o => o.status !== 'CANCELLED') ?? [];
  const orderCount = new Set(nonCancelled.map(o => o.id)).size;
  const totalAttendees = nonCancelled.reduce((sum, o) => sum + o.quantity, 0);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
        sub={orders && `${orderCount} order${orderCount === 1 ? '' : 's'} · ${totalAttendees} attendee${totalAttendees === 1 ? '' : 's'}`}
      />

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {actionError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>{actionError}</div>}
      {orders === null && !error && <div style={{ fontSize: 13, color: TEXT_MUTED }}>Loading…</div>}
      {orders !== null && orders.length === 0 && (
        <EmptyState title="No registrations yet" body="Registrations will appear here as people reserve tickets." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orders?.map(o => (
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
                {o.payment_status === 'NOT_REQUIRED' ? (
                  <StatusBadge label="Free" tone="neutral" />
                ) : o.payment_status === 'PENDING' && o.is_expired_pending ? (
                  <StatusBadge label="Pending payment (expired)" tone="danger" />
                ) : (
                  <StatusBadge label={o.payment_status === 'PENDING' ? 'Pending payment' : o.payment_status} tone={paymentStatusTone(o.payment_status)} />
                )}
                <StatusBadge label={o.status} tone={orderStatusTone(o.status)} />
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
          </div>
        ))}
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
