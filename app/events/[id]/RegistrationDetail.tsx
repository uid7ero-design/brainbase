'use client';

import { useEffect, useState } from 'react';
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER_SOFT, secondaryBtnStyle, primaryBtnStyle,
  DangerButton, fieldStyle, inputStyle,
} from '../_components/ui';
import type { OrderRow, Attendee, ResponseAnswer } from './RegistrationsPanel';

type Note = { id: string; body: string; author_name_snapshot: string; created_at: string; updated_at: string; edited_at: string | null };

function answerToInputValue(answer: unknown): string {
  if (Array.isArray(answer)) return answer.join(', ');
  if (answer === null || answer === undefined) return '';
  return String(answer);
}

// Mirrors the responses route's own field-type-driven parsing
// (validateAnswerAgainstSnapshot) so what this form submits is already
// shaped the way the server will accept it — the server remains the
// actual authority; this is just avoiding an easily-avoidable 400.
function inputValueToAnswer(fieldType: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (fieldType === 'YES_NO') return trimmed === 'yes';
  if (fieldType === 'MULTI_SELECT') return trimmed.length ? trimmed.split(',').map(s => s.trim()).filter(Boolean) : [];
  return trimmed;
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 8,
};

// Phase 6 — the "registration detail" experience this order row expands
// into. Two clearly separated halves, per §5: everything the purchaser/
// attendee themselves submitted (editable by a manager, but always
// customer-originated content) vs. internal staff notes (manager-
// authored, never shown publicly — see notes/route.ts's own comment on
// why this is a new, Events-only table).
export default function RegistrationDetail({
  eventId, order, onChanged,
}: {
  eventId: string; order: OrderRow; onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Purchaser edit ──
  const [editingPurchaser, setEditingPurchaser] = useState(false);
  const [purchaserForm, setPurchaserForm] = useState({ name: order.purchaser_name, email: order.purchaser_email, phone: order.purchaser_phone ?? '' });

  async function savePurchaser() {
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaser_name: purchaserForm.name, purchaser_email: purchaserForm.email, purchaser_phone: purchaserForm.phone || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Save failed (${res.status}).`); return; }
      setEditingPurchaser(false);
      onChanged();
    } catch { setError('Save failed. Please try again.'); }
    finally { setBusy(false); }
  }

  // ── Attendee edit ──
  const [editingAttendeeId, setEditingAttendeeId] = useState<string | null>(null);
  const [attendeeForm, setAttendeeForm] = useState({ name: '', email: '' });

  function startEditAttendee(a: Attendee) {
    setEditingAttendeeId(a.id);
    setAttendeeForm({ name: a.name, email: a.email ?? '' });
  }

  async function saveAttendee(attendeeId: string) {
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/attendees/${attendeeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendee_name: attendeeForm.name, attendee_email: attendeeForm.email || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Save failed (${res.status}).`); return; }
      setEditingAttendeeId(null);
      onChanged();
    } catch { setError('Save failed. Please try again.'); }
    finally { setBusy(false); }
  }

  // ── Response edit ──
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [responseForm, setResponseForm] = useState('');

  function startEditResponse(r: ResponseAnswer) {
    setEditingResponseId(r.id);
    setResponseForm(answerToInputValue(r.answer));
  }

  async function saveResponse(r: ResponseAnswer) {
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/responses/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: inputValueToAnswer(r.field_type, responseForm) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Save failed (${res.status}).`); return; }
      setEditingResponseId(null);
      onChanged();
    } catch { setError('Save failed. Please try again.'); }
    finally { setBusy(false); }
  }

  function ResponseEditor({ r }: { r: ResponseAnswer }) {
    if (editingResponseId !== r.id) {
      return (
        <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: TEXT_SECONDARY }}>{r.label}: </span>
          <span style={{ color: TEXT_PRIMARY }}>{formatAnswer(r.answer)}</span>
          <button onClick={() => startEditResponse(r)} style={{ ...secondaryBtnStyle, padding: '2px 8px', fontSize: 11 }}>Edit</button>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{r.label}:</span>
        {r.field_type === 'YES_NO' ? (
          <select value={responseForm === 'yes' || responseForm === 'true' ? 'yes' : 'no'} onChange={e => setResponseForm(e.target.value)} style={{ ...inputStyle, padding: '5px 9px', fontSize: 12.5 }}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        ) : r.field_type === 'LONG_TEXT' ? (
          <textarea value={responseForm} onChange={e => setResponseForm(e.target.value)} rows={2} style={{ ...inputStyle, padding: '6px 9px', fontSize: 12.5, minWidth: 220 }} />
        ) : (
          <input value={responseForm} onChange={e => setResponseForm(e.target.value)} style={{ ...inputStyle, padding: '5px 9px', fontSize: 12.5, minWidth: 180 }} />
        )}
        <button onClick={() => saveResponse(r)} disabled={busy} style={{ ...primaryBtnStyle, padding: '4px 10px', fontSize: 11 }}>Save</button>
        <button onClick={() => setEditingResponseId(null)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11 }}>Cancel</button>
      </div>
    );
  }

  // ── Internal notes ──
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteBody, setEditNoteBody] = useState('');

  async function loadNotes() {
    setNotesError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/notes`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotesError(body.error ?? `Could not load notes (${res.status}).`); return; }
      setNotes(body.notes);
    } catch { setNotesError('Could not load notes.'); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNotesError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/orders/${order.id}/notes`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setNotesError(body.error ?? `Could not load notes (${res.status}).`); return; }
        setNotes(body.notes);
      } catch {
        if (!cancelled) setNotesError('Could not load notes.');
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, order.id]);

  async function addNote() {
    if (!newNote.trim()) return;
    setAddingNote(true); setNotesError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newNote }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotesError(body.error ?? `Could not add note (${res.status}).`); return; }
      setNewNote('');
      loadNotes();
    } catch { setNotesError('Could not add note.'); }
    finally { setAddingNote(false); }
  }

  function startEditNote(n: Note) {
    setEditingNoteId(n.id);
    setEditNoteBody(n.body);
  }

  async function saveNote(noteId: string) {
    setNotesError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/notes/${noteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: editNoteBody }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotesError(body.error ?? `Could not save note (${res.status}).`); return; }
      setEditingNoteId(null);
      loadNotes();
    } catch { setNotesError('Could not save note.'); }
  }

  async function deleteNote(noteId: string) {
    if (!confirm('Delete this internal note? This cannot be undone from the manager view.')) return;
    setNotesError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/orders/${order.id}/notes/${noteId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotesError(body.error ?? `Could not delete note (${res.status}).`); return; }
      loadNotes();
    } catch { setNotesError('Could not delete note.'); }
  }

  // ── Ticket view/copy — existing token only, never regenerated (see
  // this phase's ticket-view/resend investigation: reissuing a token
  // would break any already-issued link/QR code with no recovery path).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  function ticketUrl(token: string): string {
    return `${window.location.origin}/t/${token}`;
  }
  async function copyTicketLink(token: string, attendeeId: string) {
    try {
      await navigator.clipboard.writeText(ticketUrl(token));
      setCopiedId(attendeeId);
      setTimeout(() => setCopiedId(id => (id === attendeeId ? null : id)), 1500);
    } catch { /* clipboard unavailable — the visible link text is still selectable */ }
  }

  const allResponses = [...order.order_responses, ...order.attendees.flatMap(a => a.responses)];

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER_SOFT}`, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{error}</div>}

      <div>
        <div style={sectionHeaderStyle}>Customer-submitted information</div>

        {/* Purchaser */}
        <div style={{ marginBottom: 12 }}>
          {!editingPurchaser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: TEXT_PRIMARY, fontWeight: 500 }}>{order.purchaser_name}</span>
              <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{order.purchaser_email}</span>
              {order.purchaser_phone && <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{order.purchaser_phone}</span>}
              <button onClick={() => setEditingPurchaser(true)} style={{ ...secondaryBtnStyle, padding: '3px 10px', fontSize: 11 }}>Edit purchaser</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...fieldStyle, minWidth: 140 }}>Name
                <input value={purchaserForm.name} onChange={e => setPurchaserForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </label>
              <label style={{ ...fieldStyle, minWidth: 180 }}>Email
                <input value={purchaserForm.email} onChange={e => setPurchaserForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} />
              </label>
              <label style={{ ...fieldStyle, minWidth: 140 }}>Phone
                <input value={purchaserForm.phone} onChange={e => setPurchaserForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} />
              </label>
              <button onClick={savePurchaser} disabled={busy} style={{ ...primaryBtnStyle, padding: '7px 14px' }}>Save</button>
              <button onClick={() => { setEditingPurchaser(false); setPurchaserForm({ name: order.purchaser_name, email: order.purchaser_email, phone: order.purchaser_phone ?? '' }); }} style={secondaryBtnStyle}>Cancel</button>
            </div>
          )}
        </div>

        {/* Attendees */}
        {order.attendees.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.attendees.map(a => (
              <div key={a.id} style={{ fontSize: 12.5 }}>
                {editingAttendeeId !== a.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: TEXT_PRIMARY, fontWeight: 500 }}>{a.name}</span>
                    {a.email && <span style={{ color: TEXT_SECONDARY }}>{a.email}</span>}
                    {a.checked_in_at ? (
                      <span style={{ color: '#4ADE80', fontWeight: 600 }}>
                        Checked in · {new Date(a.checked_in_at).toLocaleTimeString()}{a.checked_in_by ? ` by ${a.checked_in_by}` : ''}
                      </span>
                    ) : (
                      <span style={{ color: TEXT_MUTED }}>Not checked in</span>
                    )}
                    <button onClick={() => startEditAttendee(a)} style={{ ...secondaryBtnStyle, padding: '3px 10px', fontSize: 11 }}>Edit</button>
                    {a.ticket_token && (
                      <>
                        <a href={ticketUrl(a.ticket_token)} target="_blank" rel="noopener noreferrer" style={{ ...secondaryBtnStyle, padding: '3px 10px', fontSize: 11, textDecoration: 'none', display: 'inline-block' }}>View ticket</a>
                        <button onClick={() => copyTicketLink(a.ticket_token!, a.id)} style={{ ...secondaryBtnStyle, padding: '3px 10px', fontSize: 11 }}>
                          {copiedId === a.id ? 'Copied!' : 'Copy link'}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ ...fieldStyle, minWidth: 140 }}>Name
                      <input value={attendeeForm.name} onChange={e => setAttendeeForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                    </label>
                    <label style={{ ...fieldStyle, minWidth: 180 }}>Email
                      <input value={attendeeForm.email} onChange={e => setAttendeeForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} />
                    </label>
                    <button onClick={() => saveAttendee(a.id)} disabled={busy} style={{ ...primaryBtnStyle, padding: '7px 14px' }}>Save</button>
                    <button onClick={() => setEditingAttendeeId(null)} style={secondaryBtnStyle}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Registration answers */}
        {allResponses.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allResponses.map(r => <ResponseEditor key={r.id} r={r} />)}
          </div>
        )}
      </div>

      <div>
        <div style={sectionHeaderStyle}>Internal staff notes</div>
        {notesError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 8 }}>{notesError}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {notes === null && <div style={{ fontSize: 12, color: TEXT_MUTED }}>Loading notes…</div>}
          {notes !== null && notes.length === 0 && <div style={{ fontSize: 12, color: TEXT_MUTED }}>No internal notes yet.</div>}
          {notes?.map(n => (
            <div key={n.id} style={{ background: 'rgba(255,255,255,.02)', border: `1px solid ${BORDER_SOFT}`, borderRadius: 8, padding: '9px 11px' }}>
              {editingNoteId !== n.id ? (
                <>
                  <div style={{ fontSize: 12.5, color: TEXT_PRIMARY, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: TEXT_MUTED }}>
                    <span>{n.author_name_snapshot} · {new Date(n.created_at).toLocaleString()}{n.edited_at ? ' · edited' : ''}</span>
                    <button onClick={() => startEditNote(n)} style={{ ...secondaryBtnStyle, padding: '2px 8px', fontSize: 10.5 }}>Edit</button>
                    <DangerButton ariaLabel="Delete note" onClick={() => deleteNote(n.id)}>Delete</DangerButton>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea value={editNoteBody} onChange={e => setEditNoteBody(e.target.value)} rows={2} style={{ ...inputStyle, fontSize: 12.5 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => saveNote(n.id)} style={{ ...primaryBtnStyle, padding: '5px 12px', fontSize: 11.5 }}>Save</button>
                    <button onClick={() => setEditingNoteId(null)} style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 11.5 }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add an internal note…" rows={2}
            style={{ ...inputStyle, flex: 1, fontSize: 12.5 }}
          />
          <button onClick={addNote} disabled={addingNote || !newNote.trim()} style={{ ...primaryBtnStyle, opacity: addingNote || !newNote.trim() ? 0.6 : 1 }}>
            {addingNote ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAnswer(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}
