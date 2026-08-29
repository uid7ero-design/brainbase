'use client';

import { useState } from 'react';
import type { PublicEventDetail } from '@/lib/events/publicEventDetail';

const FONT = 'var(--font-inter),-apple-system,sans-serif';

export default function PublicEventClient({
  organisationSlug,
  eventSlug,
  detail,
}: {
  organisationSlug: string;
  eventSlug: string;
  detail: PublicEventDetail;
}) {
  const { event, sessions, ticket_types: ticketTypes } = detail;

  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '');
  const [sessionId, setSessionId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [attendeeNames, setAttendeeNames] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ reference: string; quantity: number } | null>(null);

  const selectedTicketType = ticketTypes.find(t => t.id === ticketTypeId);
  const maxQuantity = selectedTicketType ? Math.max(0, Math.min(selectedTicketType.remaining, 20)) : 0;

  function setQuantityAndResizeAttendees(next: number) {
    setQuantity(next);
    setAttendeeNames(prev => {
      const arr = prev.slice(0, next);
      while (arr.length < next) arr.push('');
      return arr;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/events/${organisationSlug}/${eventSlug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_type_id: ticketTypeId,
          event_session_id: sessionId || undefined,
          quantity,
          purchaser_name: purchaserName,
          purchaser_email: purchaserEmail,
          purchaser_phone: purchaserPhone || undefined,
          attendees: attendeeNames.map(name => ({ name })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Registration failed (${res.status}).`);
        return;
      }
      setConfirmation({ reference: body.confirmation_reference, quantity: body.quantity });
    } catch {
      setError('Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Registration confirmed</h1>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
            {confirmation.quantity} ticket{confirmation.quantity === 1 ? '' : 's'} for {event.name}
          </p>
          <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: 13 }}>
            Confirmation reference: {confirmation.reference}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{event.name}</h1>
        <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>
          {new Date(event.starts_at).toLocaleString()} {event.venue ? `· ${event.venue}` : ''}
        </div>
        {event.description && <p style={{ fontSize: 14, lineHeight: 1.6, color: '#374151' }}>{event.description}</p>}
      </div>

      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Register</h2>
        {ticketTypes.length === 0 ? (
          <p style={{ fontSize: 14, color: '#6b7280' }}>No tickets are currently available for this event.</p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={fieldStyle}>
              Ticket type
              <select
                required
                value={ticketTypeId}
                onChange={e => { setTicketTypeId(e.target.value); setQuantityAndResizeAttendees(1); }}
                style={inputStyle}
              >
                {ticketTypes.map(t => (
                  <option key={t.id} value={t.id} disabled={t.remaining <= 0}>
                    {t.name} — {t.price_cents === 0 ? 'Free' : `$${(t.price_cents / 100).toFixed(2)}`} ({t.remaining} left)
                  </option>
                ))}
              </select>
            </label>

            {sessions.length > 0 && (
              <label style={fieldStyle}>
                Session (optional)
                <select value={sessionId} onChange={e => setSessionId(e.target.value)} style={inputStyle}>
                  <option value="">No specific session</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id} disabled={s.remaining <= 0}>
                      {s.name} — {new Date(s.starts_at).toLocaleString()} ({s.remaining} left)
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={fieldStyle}>
              Quantity
              <input
                required
                type="number"
                min={1}
                max={maxQuantity || 1}
                value={quantity}
                onChange={e => setQuantityAndResizeAttendees(Math.max(1, Number(e.target.value)))}
                style={inputStyle}
              />
            </label>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 4 }}>Purchaser details</div>
            <label style={fieldStyle}>Name<input required value={purchaserName} onChange={e => setPurchaserName(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Email<input required type="email" value={purchaserEmail} onChange={e => setPurchaserEmail(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Phone (optional)<input value={purchaserPhone} onChange={e => setPurchaserPhone(e.target.value)} style={inputStyle} /></label>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 4 }}>Attendee names</div>
            {attendeeNames.map((name, i) => (
              <label key={i} style={fieldStyle}>
                Attendee {i + 1}
                <input
                  required
                  value={name}
                  onChange={e => setAttendeeNames(prev => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
                  style={inputStyle}
                />
              </label>
            ))}

            {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}

            <button
              type="submit"
              disabled={submitting || maxQuantity <= 0}
              style={{
                background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 20px', fontSize: 14, fontWeight: 600,
                cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'Registering…' : 'Register'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#fafafa', padding: '32px 16px',
  fontFamily: FONT, color: '#111827', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
};
const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 560, background: '#fff', border: '1px solid #e5e7eb',
  borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};
const sectionHeadingStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: '0 0 14px' };
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#4b5563', fontWeight: 500 };
const inputStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
  padding: '8px 10px', color: '#111827', fontSize: 14, fontFamily: FONT,
};
