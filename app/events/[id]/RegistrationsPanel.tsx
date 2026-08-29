'use client';

import { useEffect, useState } from 'react';

const FONT = 'var(--font-inter),-apple-system,sans-serif';

type Attendee = { id: string; name: string; email: string | null };
type OrderRow = {
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
export default function RegistrationsPanel({ eventId }: { eventId: string }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/orders`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error ?? `Failed to load registrations (${res.status}).`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setOrders(body.orders ?? []);
      } catch {
        if (!cancelled) setError('Failed to load registrations.');
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const totalAttendees = orders?.reduce((sum, o) => sum + o.quantity, 0) ?? 0;

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Registrations</h2>
        {orders && <span style={{ fontSize: 12, color: '#9ca3af' }}>{orders.length} order{orders.length === 1 ? '' : 's'} · {totalAttendees} attendee{totalAttendees === 1 ? '' : 's'}</span>}
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {orders === null && !error && <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>}
      {orders !== null && orders.length === 0 && <div style={{ fontSize: 13, color: '#9ca3af' }}>No registrations yet.</div>}

      {orders?.map(o => (
        <div key={o.order_item_id} style={rowStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{o.purchaser_name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({o.purchaser_email})</span></div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              {o.ticket_type_name ?? 'Unknown ticket type'} × {o.quantity}
              {o.session_name ? ` · ${o.session_name}` : ''} · {new Date(o.created_at).toLocaleString()} · {o.status}
            </div>
            {o.attendees.length > 0 && (
              <div style={{ fontSize: 12, color: '#d1d5db', marginTop: 4 }}>
                Attendees: {o.attendees.map(a => a.name).join(', ')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 12, padding: 20, marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12,
  fontFamily: FONT, color: '#e5e7eb',
};
const panelHeaderStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const rowStyle: React.CSSProperties = {
  padding: '10px 12px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8,
};
