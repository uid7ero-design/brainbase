'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import KpiCard from '@/components/dashboard/ui/KpiCard';

const FONT = 'var(--font-inter),-apple-system,sans-serif';
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

function statusColour(status: EventRow['status']) {
  if (status === 'PUBLISHED') return '#10b981';
  if (status === 'CANCELLED') return '#ef4444';
  return '#9ca3af';
}

export default function EventsListClient({ canManage }: { canManage: boolean }) {
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(API);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to load events (${res.status}).`);
        setEvents([]);
        return;
      }
      const body = await res.json();
      setEvents(body.events ?? []);
    } catch {
      setError('Failed to load events.');
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      await load();
    } catch {
      setFormError('Failed to create event.');
    } finally {
      setSaving(false);
    }
  }

  const total = events?.length ?? 0;
  const published = events?.filter(e => e.status === 'PUBLISHED').length ?? 0;
  const draft = events?.filter(e => e.status === 'DRAFT').length ?? 0;

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: '#e5e7eb', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Events &amp; Ticketing</h1>
        {canManage && (
          <button
            onClick={() => setShowCreate(v => !v)}
            style={{
              background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {showCreate ? 'Cancel' : '+ Create Event'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Total Events" value={events ? total : '—'} accentColor="#7C3AED" theme="dark" loading={events === null} />
        <KpiCard label="Published" value={events ? published : '—'} accentColor="#10b981" theme="dark" loading={events === null} />
        <KpiCard label="Draft" value={events ? draft : '—'} accentColor="#9ca3af" theme="dark" loading={events === null} />
      </div>

      {showCreate && canManage && (
        <form
          onSubmit={handleCreate}
          style={{
            background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 12, padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>
              Name
              <input required value={name} onChange={e => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              Slug
              <input required value={slug} onChange={e => { setSlug(e.target.value); setSlugTouched(true); }} style={inputStyle} />
            </label>
          </div>
          <label style={fieldStyle}>
            Venue
            <input value={venue} onChange={e => setVenue(e.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            Description
            <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldStyle}>
              Starts
              <input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              Ends
              <input required type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>Timezone: {timezone}</div>
          {formError && <div style={{ color: '#ef4444', fontSize: 12 }}>{formError}</div>}
          <button
            type="submit"
            disabled={saving}
            style={{
              alignSelf: 'flex-start', background: '#7C3AED', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Creating…' : 'Create Event'}
          </button>
        </form>
      )}

      {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,.02)' }}>
              {['Name', 'Starts', 'Venue', 'Status', 'Sessions', 'Ticket Types'].map(h => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 600, color: '#9ca3af', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events === null && (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Loading…</td></tr>
            )}
            {events !== null && events.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No events yet.</td></tr>
            )}
            {events?.map(ev => (
              <tr key={ev.id} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <td style={{ padding: '10px 14px' }}>
                  <Link href={`/events/${ev.id}`} style={{ color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>{ev.name}</Link>
                </td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{new Date(ev.starts_at).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{ev.venue ?? '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ color: statusColour(ev.status), fontWeight: 600 }}>{ev.status}</span>
                </td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{ev.session_count}</td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{ev.ticket_type_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9ca3af' };
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6,
  padding: '7px 10px', color: '#e5e7eb', fontSize: 13, fontFamily: FONT,
};
