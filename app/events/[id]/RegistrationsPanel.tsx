'use client';

import { Panel, SectionHeader, EmptyState, StatusBadge, orderStatusTone, rowCardStyle, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED } from '../_components/ui';

export type Attendee = { id: string; name: string; email: string | null };
export type OrderRow = {
  id: string;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_phone: string | null;
  status: string;
  created_at: string;
  order_item_id: string;
  quantity: number;
  ticket_type_id: string | null;
  ticket_type_name: string | null;
  event_session_id: string | null;
  session_name: string | null;
  attendees: Attendee[];
};

// Phase 2 — read-only. No CSV export, no CRM auto-sync, no cancellation
// UI (Phase 2 deferred cancellation entirely — see the implementation
// report). viewer+ can see this panel; there is nothing to mutate here
// yet, so no manager-only affordance exists.
//
// Orders are fetched once by the parent (EventDetailClient) rather than
// here, so the same data can also drive the KPI strip and the per-
// session/per-ticket-type "registered" counts without a second network
// round trip to the same endpoint.
export default function RegistrationsPanel({ orders, error }: { orders: OrderRow[] | null; error: string | null }) {
  const nonCancelled = orders?.filter(o => o.status !== 'CANCELLED') ?? [];
  const orderCount = new Set(nonCancelled.map(o => o.id)).size;
  const totalAttendees = nonCancelled.reduce((sum, o) => sum + o.quantity, 0);

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Registrations"
        sub={orders && `${orderCount} order${orderCount === 1 ? '' : 's'} · ${totalAttendees} attendee${totalAttendees === 1 ? '' : 's'}`}
      />

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 12 }}>{error}</div>}
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
                {o.attendees.length > 0 && (
                  <RegField label="Attendees" value={o.attendees.map(a => a.name).join(', ')} />
                )}
                <RegField label="Registered" value={new Date(o.created_at).toLocaleString()} />
              </div>
              <StatusBadge label={o.status} tone={orderStatusTone(o.status)} />
            </div>
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
