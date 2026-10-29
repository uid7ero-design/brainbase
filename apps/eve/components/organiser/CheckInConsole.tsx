'use client';

import { useState } from 'react';
import type { CheckInAttendee } from '@/lib/ticketing/gateway';

// Door check-in. Everything is decided server-side: resolve and search
// need a viewer, confirm and undo need a manager (checked against the
// user's current role on every call). This component shows the outcome.

type Outcome = { tone: 'ok' | 'warn' | 'error'; message: string };
const input = 'mt-1 block min-h-11 w-full rounded-lg border border-eve-line bg-white px-3 text-sm';

export function CheckInConsole({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const base = `/api/organiser/check-in/${encodeURIComponent(eventId)}`;
  const [scan, setScan] = useState('');
  const [query, setQuery] = useState('');
  const [attendee, setAttendee] = useState<CheckInAttendee | null>(null);
  const [results, setResults] = useState<CheckInAttendee[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(action: 'resolve' | 'confirm' | 'undo', body: Record<string, string>) {
    setBusy(true);
    try {
      const res = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return { res, data: data as { attendee?: CheckInAttendee; first?: boolean; error?: string } };
    } finally {
      setBusy(false);
    }
  }

  async function resolveScan(e: React.FormEvent) {
    e.preventDefault();
    setOutcome(null);
    const { res, data } = await post('resolve', { ticket_token: scan });
    if (res.ok && data.attendee) { setAttendee(data.attendee); setScan(''); }
    else { setAttendee(null); setOutcome({ tone: 'error', message: data.error ?? 'Ticket not valid.' }); }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setOutcome(null);
    setBusy(true);
    try {
      const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setResults(data.attendees ?? []); else setOutcome({ tone: 'error', message: data.error ?? 'Search failed.' });
    } finally { setBusy(false); }
  }

  async function confirm(a: CheckInAttendee) {
    setOutcome(null);
    const { res, data } = await post('confirm', { attendee_id: a.id });
    if (data.attendee) setAttendee(data.attendee);
    if (res.ok && data.first) setOutcome({ tone: 'ok', message: `${a.attendee_name} is checked in.` });
    else if (res.status === 409 && data.attendee) setOutcome({ tone: 'warn', message: `Already checked in: ${a.attendee_name}. This is a duplicate scan.` });
    else setOutcome({ tone: 'error', message: data.error ?? 'Check-in failed.' });
  }

  async function undo(a: CheckInAttendee) {
    setOutcome(null);
    const { res, data } = await post('undo', { attendee_id: a.id });
    if (res.ok && data.attendee) { setAttendee(data.attendee); setOutcome({ tone: 'ok', message: `Check-in undone for ${a.attendee_name}.` }); }
    else setOutcome({ tone: 'error', message: data.error ?? 'Could not undo.' });
  }

  const tone = { ok: 'bg-green-100 text-green-900', warn: 'bg-amber-100 text-amber-900', error: 'bg-red-100 text-red-900' };

  return (
    <div className="space-y-8">
      <form onSubmit={resolveScan} aria-label="Scan or paste a ticket" className="max-w-xl">
        <label htmlFor="scan" className="block text-sm font-medium">Ticket link or code</label>
        <div className="flex gap-2">
          <input id="scan" className={input} value={scan} onChange={e => setScan(e.target.value)} autoComplete="off" autoFocus />
          <button type="submit" disabled={busy || !scan.trim()} className="mt-1 min-h-11 rounded-full bg-eve-ink px-5 text-sm font-semibold text-white disabled:opacity-50">Look up</button>
        </div>
      </form>

      <form onSubmit={search} aria-label="Search attendees" className="max-w-xl">
        <label htmlFor="q" className="block text-sm font-medium">Or search by attendee name</label>
        <div className="flex gap-2">
          <input id="q" className={input} value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={busy || !query.trim()} className="mt-1 min-h-11 rounded-full border border-eve-line px-5 text-sm font-semibold disabled:opacity-50">Search</button>
        </div>
      </form>

      {outcome ? <p role="status" className={`max-w-xl rounded-lg p-3 text-sm font-medium ${tone[outcome.tone]}`}>{outcome.message}</p> : null}

      {results.length > 0 ? (
        <ul className="max-w-xl divide-y divide-eve-line rounded-lg border border-eve-line bg-eve-surface">
          {results.map(r => (
            <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span>{r.attendee_name}<span className="block text-xs text-eve-muted">{r.ticket_type_name ?? ''}{r.session_name ? ` · ${r.session_name}` : ''}{r.checked_in_at ? ' · checked in' : ''}</span></span>
              <button type="button" className="min-h-11 rounded-full border border-eve-line px-4 font-semibold" onClick={() => { setAttendee(r); setResults([]); }}>Select</button>
            </li>
          ))}
        </ul>
      ) : null}

      {attendee ? (
        <section aria-label="Selected attendee" className="max-w-xl rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-5">
          <h2 className="text-lg font-semibold">{attendee.attendee_name}</h2>
          <p className="text-sm text-eve-muted">{attendee.ticket_type_name ?? 'Ticket'}{attendee.session_name ? ` · ${attendee.session_name}` : ''}</p>
          <p className="mt-2 text-sm font-medium" data-testid="checkin-state">{attendee.checked_in_at ? 'Checked in' : 'Not checked in'}</p>
          {canManage ? (
            <div className="mt-4 flex gap-3">
              {!attendee.checked_in_at ? <button type="button" disabled={busy} onClick={() => confirm(attendee)} className="min-h-11 rounded-full bg-eve-ink px-5 text-sm font-semibold text-white">Check in</button> : null}
              {attendee.checked_in_at ? <button type="button" disabled={busy} onClick={() => undo(attendee)} className="min-h-11 rounded-full border border-eve-line px-5 text-sm font-semibold">Undo check-in</button> : null}
            </div>
          ) : <p className="mt-3 text-sm text-eve-muted">Your role can look tickets up but not check people in.</p>}
        </section>
      ) : null}
    </div>
  );
}
