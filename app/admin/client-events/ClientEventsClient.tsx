'use client';

import { useState, useEffect } from 'react';

const FONT = "var(--font-inter), -apple-system, sans-serif";

type ClientEventRow = {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  starts_at: string;
  ends_at: string;
  timezone: string;
  organisation_id: string;
  organisation_name: string;
  organisation_slug: string;
  total_capacity: number;
  registration_count: number;
  paid_count: number;
  pending_count: number;
  cancelled_count: number;
  tickets_sold: number;
  gross_revenue_cents: number;
  refunded_cents: number;
  currency: string;
};

type OrgOption = { id: string; name: string; slug: string };

function fmtMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'AUD' }).format((cents ?? 0) / 100);
}
function fmtDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone }).format(new Date(iso));
}

const STATUS_COLOR: Record<string, string> = { DRAFT: '#94A3B8', PUBLISHED: '#4ADE80', CANCELLED: '#F87171' };

function smallBtn(bg: string, color: string, border: string): React.CSSProperties {
  return { padding: '4px 10px', background: bg, color, border: `1px solid ${border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 7,
  color: '#e5e7eb', fontSize: 12.5, padding: '7px 10px', fontFamily: FONT,
};

// Platform-wide event oversight (§ EVENTS — BRAINBASE CLIENT EVENTS
// OVERSIGHT). This is NOT the tenant-scoped Events module — it never
// mutates anything, and it never renders purchaser/attendee data; it's
// a read-only aggregate table backed entirely by
// GET /api/admin/client-events, which itself is gated by
// requireRole('super_admin') server-side (this component never re-
// implements that check — access control lives on the server; this
// page's own visibility is separately covered by app/admin/layout.tsx
// + this route's own page.tsx redirect).
export default function ClientEventsClient() {
  const [events, setEvents] = useState<ClientEventRow[] | null>(null);
  const [organisations, setOrganisations] = useState<OrgOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [orgFilter, setOrgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [timingFilter, setTimingFilter] = useState('');
  const [search, setSearch] = useState('');
  const [paymentIssueOnly, setPaymentIssueOnly] = useState(false);
  const [includeBrainbase, setIncludeBrainbase] = useState(false);

  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Inlined directly in the effect (not called out to a separately
  // memoized load() function) — same convention this codebase's other
  // self-fetching panels already use (see e.g. QuestionsPanel.tsx's own
  // comment), avoiding a "call a state-setting function from an
  // effect" lint violation. Filter changes re-run this same effect
  // automatically since they're all listed as dependencies.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const params = new URLSearchParams();
      if (orgFilter) params.set('org', orgFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (timingFilter) params.set('timing', timingFilter);
      if (search.trim()) params.set('search', search.trim());
      if (paymentIssueOnly) params.set('paymentIssue', 'true');
      if (includeBrainbase) params.set('includeBrainbase', 'true');
      try {
        const res = await fetch(`/api/admin/client-events?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error ?? `Failed to load client events (${res.status}).`);
          return;
        }
        const body = await res.json();
        if (!cancelled) {
          setEvents(body.events ?? []);
          setOrganisations(body.organisations ?? []);
        }
      } catch {
        if (!cancelled) setError('Failed to load client events.');
      }
    })();
    return () => { cancelled = true; };
  }, [orgFilter, statusFilter, timingFilter, search, paymentIssueOnly, includeBrainbase]);

  // "Open event" — reuses the EXISTING super-admin org-switch mechanism
  // (the same /api/admin/impersonate route components/admin/
  // OrgSwitcher.tsx already uses), never a parallel/insecure shortcut.
  // The context switch must complete and succeed BEFORE navigating —
  // sequential await, not fire-and-forget — so it is never possible to
  // land on /events/{eventId} while still holding the wrong (or no)
  // organisation context. A hard navigation (not client-side routing)
  // matches OrgSwitcher's own window.location.reload() precedent,
  // forcing every server component on the destination page to
  // re-resolve session.organisationId under the freshly-set cookie.
  async function openEvent(row: ClientEventRow) {
    setOpenError(null);
    setOpeningEventId(row.id);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: row.organisation_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setOpenError(body.error ?? `Could not switch into ${row.organisation_name} (${res.status}).`);
        setOpeningEventId(null);
        return;
      }
      window.location.assign(`/events/${row.id}`);
    } catch {
      setOpenError(`Could not switch into ${row.organisation_name}. Please try again.`);
      setOpeningEventId(null);
    }
  }

  return (
    <div style={{ fontFamily: FONT, color: '#F4F4F5', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Client Events</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '4px 0 0' }}>
          Platform-wide oversight of client organisations&rsquo; events — read-only. Use &ldquo;Open event&rdquo; to switch into that organisation and manage it in the normal Events module.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}
      {openError && (
        <div role="alert" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', color: '#FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          {openError}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}>
        <input
          type="text" placeholder="Search event name…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...selectStyle, width: 200 }}
        />
        <select value={orgFilter} onChange={e => setOrgFilter(e.target.value)} style={selectStyle}>
          <option value="">All organisations</option>
          {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">Any status</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={timingFilter} onChange={e => setTimingFilter(e.target.value)} style={selectStyle}>
          <option value="">Any time</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
          <input type="checkbox" checked={paymentIssueOnly} onChange={e => setPaymentIssueOnly(e.target.checked)} />
          Pending payments only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
          <input type="checkbox" checked={includeBrainbase} onChange={e => setIncludeBrainbase(e.target.checked)} />
          Include BrainBase
        </label>
      </div>

      {/* Table */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
          {events === null ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'}`}
        </div>

        {events === null ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
            {orgFilter || statusFilter || timingFilter || search || paymentIssueOnly
              ? 'No events match the current filters.'
              : 'No client events yet — organisations with the Events capability enabled haven’t created any events.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1100 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  {['Organisation', 'Event', 'Date', 'Status', 'Regs', 'Paid', 'Pending', 'Cancelled', 'Sold / Capacity', 'Gross', 'Refunds', 'Net', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', borderBottom: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(row => {
                  const netCents = Number(row.gross_revenue_cents) - Number(row.refunded_cents);
                  const hasPendingIssue = row.pending_count > 0;
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.organisation_name}</td>
                      <td style={{ padding: '10px 12px' }}>{row.name}</td>
                      <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{fmtDate(row.starts_at, row.timezone)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${STATUS_COLOR[row.status]}18`, color: STATUS_COLOR[row.status], border: `1px solid ${STATUS_COLOR[row.status]}30` }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{row.registration_count}</td>
                      <td style={{ padding: '10px 12px', color: '#4ADE80' }}>{row.paid_count}</td>
                      <td style={{ padding: '10px 12px', color: hasPendingIssue ? '#FBBF24' : 'rgba(255,255,255,0.55)', fontWeight: hasPendingIssue ? 700 : 400 }}>
                        {row.pending_count > 0 ? `⚠ ${row.pending_count}` : row.pending_count}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.45)' }}>{row.cancelled_count}</td>
                      <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{row.tickets_sold} / {row.total_capacity}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtMoney(row.gross_revenue_cents, row.currency)}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', whiteSpace: 'nowrap', color: row.refunded_cents > 0 ? '#F87171' : 'rgba(255,255,255,0.35)' }}>{fmtMoney(row.refunded_cents, row.currency)}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', whiteSpace: 'nowrap', fontWeight: 700 }}>{fmtMoney(netCents, row.currency)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => openEvent(row)}
                          disabled={openingEventId === row.id}
                          style={smallBtn('rgba(124,58,237,0.15)', '#C4B5FD', 'rgba(124,58,237,0.30)')}
                        >
                          {openingEventId === row.id ? 'Opening…' : 'Open event'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
