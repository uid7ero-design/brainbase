'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const FONT = 'var(--font-inter),-apple-system,sans-serif';

type EventDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  venue: string | null;
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

export default function EventDetailClient({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [sessions, setSessions] = useState<EventSessionRow[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([]);
  const [notFound, setNotFoundState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/events/${eventId}`);
    if (res.status === 404) {
      setNotFoundState(true);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed to load event (${res.status}).`);
      return;
    }
    const body = await res.json();
    setEvent(body.event);
    setSessions(body.event_sessions ?? []);
    setTicketTypes(body.ticket_types ?? []);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <div style={{ padding: 48, fontFamily: FONT, color: '#e5e7eb' }}>
        <p>Event not found.</p>
        <Link href="/events" style={{ color: '#a78bfa' }}>← Back to Events</Link>
      </div>
    );
  }

  if (!event) {
    return <div style={{ padding: 48, fontFamily: FONT, color: '#9ca3af' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: '#e5e7eb', maxWidth: 1000, margin: '0 auto' }}>
      <Link href="/events" style={{ color: '#a78bfa', fontSize: 12, textDecoration: 'none' }}>← Back to Events</Link>
      {error && <div style={{ color: '#ef4444', fontSize: 13, margin: '12px 0' }}>{error}</div>}

      <EventOverview event={event} canManage={canManage} onSaved={load} />
      <SessionsPanel eventId={eventId} sessions={sessions} canManage={canManage} onChanged={load} />
      <TicketTypesPanel eventId={eventId} ticketTypes={ticketTypes} canManage={canManage} onChanged={load} />
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────

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
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{event.name}</h1>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>/{event.slug} · {event.timezone}</div>
        </div>
        {canManage && !editing && (
          <button onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
        )}
      </div>

      {!editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
          <div><span style={labelStyle}>Status</span><br />{event.status}</div>
          <div><span style={labelStyle}>Venue</span><br />{event.venue ?? '—'}</div>
          <div><span style={labelStyle}>Starts</span><br />{new Date(event.starts_at).toLocaleString()}</div>
          <div><span style={labelStyle}>Ends</span><br />{new Date(event.ends_at).toLocaleString()}</div>
          {event.description && <div style={{ gridColumn: '1 / -1' }}><span style={labelStyle}>Description</span><br />{event.description}</div>}
        </div>
      ) : (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>Name<input required value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Venue<input value={venue} onChange={e => setVenue(e.target.value)} style={inputStyle} /></label>
          </div>
          <label style={fieldStyle}>Description<textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>Starts<input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Ends<input required type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
            <label style={fieldStyle}>Status
              <select value={status} onChange={e => setStatus(e.target.value as EventDetail['status'])} style={inputStyle}>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
          </div>
          {formError && <div style={{ color: '#ef4444', fontSize: 12 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving} style={primaryBtnStyle}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────

function SessionsPanel({ eventId, sessions, canManage, onChanged }: {
  eventId: string; sessions: EventSessionRow[]; canManage: boolean; onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm('Delete this session?')) return;
    await fetch(`/api/events/${eventId}/sessions/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Sessions</h2>
        {canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Session'}</button>}
      </div>

      {showCreate && (
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
      )}

      {sessions.length === 0 && !showCreate && <div style={{ fontSize: 13, color: '#9ca3af' }}>No sessions yet.</div>}

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
        <div key={s.id} style={rowStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{new Date(s.starts_at).toLocaleString()} – {new Date(s.ends_at).toLocaleTimeString()} · capacity {s.capacity}</div>
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditingId(s.id)} style={secondaryBtnStyle}>Edit</button>
              <button onClick={() => remove(s.id)} style={dangerBtnStyle}>Delete</button>
            </div>
          )}
        </div>
      ))}
    </div>
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
    <form onSubmit={submit} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Name<input required value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Capacity<input required type="number" min={0} value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={inputStyle} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Starts<input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Ends<input required type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
      </div>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={primaryBtnStyle}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Ticket types ────────────────────────────────────────────────────

function TicketTypesPanel({ eventId, ticketTypes, canManage, onChanged }: {
  eventId: string; ticketTypes: TicketTypeRow[]; canManage: boolean; onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm('Delete this ticket type?')) return;
    await fetch(`/api/events/${eventId}/ticket-types/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Ticket Types</h2>
        {canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Ticket Type'}</button>}
      </div>

      {showCreate && (
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
      )}

      {ticketTypes.length === 0 && !showCreate && <div style={{ fontSize: 13, color: '#9ca3af' }}>No ticket types yet.</div>}

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
        <div key={tt.id} style={rowStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {tt.name} {!tt.active && <span style={{ color: '#9ca3af', fontWeight: 400 }}>(inactive)</span>}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              {tt.price_cents === 0 ? 'Free' : `$${(tt.price_cents / 100).toFixed(2)}`} · capacity {tt.capacity}
            </div>
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditingId(tt.id)} style={secondaryBtnStyle}>Edit</button>
              <button onClick={() => remove(tt.id)} style={dangerBtnStyle}>Delete</button>
            </div>
          )}
        </div>
      ))}
    </div>
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
    <form onSubmit={submit} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Name<input required value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Price (AUD)<input required type="number" step="0.01" min={0} value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Capacity<input required type="number" min={0} value={capacity} onChange={e => setCapacity(Number(e.target.value))} style={inputStyle} /></label>
      </div>
      <label style={fieldStyle}>Description<input value={description ?? ''} onChange={e => setDescription(e.target.value)} style={inputStyle} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
        <label style={fieldStyle}>Sort order<input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} style={inputStyle} /></label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
      </div>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={primaryBtnStyle}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Shared styles ───────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 12, padding: 20, marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12,
};
const panelHeaderStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#9ca3af', letterSpacing: '.04em', textTransform: 'uppercase' };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 12px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8,
};
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9ca3af' };
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6,
  padding: '7px 10px', color: '#e5e7eb', fontSize: 13, fontFamily: FONT,
};
const primaryBtnStyle: React.CSSProperties = {
  background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8,
  padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start',
};
const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent', color: '#d1d5db', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const dangerBtnStyle: React.CSSProperties = {
  background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,.35)', borderRadius: 8,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
