'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  FormError,
  PageHeader,
  StateMessage,
  buttonProps,
  fieldControlClassName,
} from '@/components/ui/app';

type RestrictedCase = {
  id: string;
  case_type: string;
  status: string;
  title: string;
  reference: string | null;
  opened_by: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};
type Participant = { id: string; person_id: string; role_in_case: string; created_at: string };
type Note = { id: string; author_id: string; body: string; created_at: string };
type DocumentRow = { id: string; uploaded_by: string; original_filename: string; content_type: string; byte_size: number; deleted_at: string | null; created_at: string };
type Person = { id: string; first_name: string; last_name: string };
type UserCandidate = { id: string; name: string; email: string | null; grant_eligible: boolean };

export default function RestrictedCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [caseRecord, setCaseRecord] = useState<RestrictedCase | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [users, setUsers] = useState<UserCandidate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const [caseRes, participantsRes, notesRes, docsRes, peopleRes, adminsRes] = await Promise.all([
      fetch(`/api/hr/restricted-cases/${id}`),
      fetch(`/api/hr/restricted-cases/${id}/participants`),
      fetch(`/api/hr/restricted-cases/${id}/notes`),
      fetch(`/api/hr/restricted-cases/${id}/documents`),
      fetch('/api/hr/people'),
      fetch('/api/hr/administrators'),
    ]);

    if (!caseRes.ok) {
      const data = await caseRes.json().catch(() => ({}));
      setError(data.error ?? 'Could not load restricted HR case.');
      setLoading(false);
      return;
    }

    const caseData = await caseRes.json();
    setCaseRecord(caseData.case ?? null);

    if (participantsRes.ok) setParticipants((await participantsRes.json()).participants ?? []);
    if (notesRes.ok) setNotes((await notesRes.json()).notes ?? []);
    if (docsRes.ok) setDocuments((await docsRes.json()).documents ?? []);
    if (peopleRes.ok) setPeople((await peopleRes.json()).people ?? []);
    if (adminsRes.ok) {
      const adminData = await adminsRes.json();
      setCanManage(true);
      setUsers((adminData.users ?? []).filter((user: UserCandidate) => user.grant_eligible));
    } else {
      setCanManage(false);
      setUsers([]);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the case route id changes; load is intentionally local.
  useEffect(() => { queueMicrotask(() => { load(); }); }, [id]);

  const personNames = useMemo(() => new Map(people.map(person => [person.id, `${person.first_name} ${person.last_name}`])), [people]);

  if (loading) return <StateMessage kind="loading" title="Loading restricted case…" size="page" />;
  if (error || !caseRecord) {
    return <div style={{ maxWidth: 800 }}><Link href="/people/restricted-cases" style={backLink}>← Restricted Cases</Link><StateMessage kind="error" title={error || 'Restricted HR case not found.'} /></div>;
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        eyebrow={<Link href="/people/restricted-cases">← Restricted Cases</Link>}
        title={caseRecord.title}
        meta={
          <>
            <Badge state="inactive">{capitalise(caseRecord.case_type)}</Badge>
            <Badge state={caseRecord.status === 'open' ? 'success' : 'inactive'}>{capitalise(caseRecord.status)}</Badge>
          </>
        }
        description={<>{caseRecord.reference ? `Reference ${caseRecord.reference} · ` : ''}Opened {formatDate(caseRecord.created_at)}</>}
      />

      {actionError && <div style={{ marginBottom: 16 }}><FormError>{actionError}</FormError></div>}

      <div style={grid}>
        <section style={panel}>
          <h2 style={sectionTitle}>Participants</h2>
          <ParticipantSection
            caseId={id}
            participants={participants}
            people={people}
            personNames={personNames}
            canManage={canManage}
            onChanged={load}
            onError={setActionError}
          />
        </section>

        <section style={panel}>
          <h2 style={sectionTitle}>Case access</h2>
          {canManage ? (
            <AccessSection caseId={id} users={users} onError={setActionError} />
          ) : (
            <p style={mutedText}>Access grants can only be managed by an HR administrator or super administrator.</p>
          )}
        </section>
      </div>

      <section style={{ ...panel, marginTop: 24 }}>
        <h2 style={sectionTitle}>Notes</h2>
        <NoteSection caseId={id} notes={notes} onChanged={load} onError={setActionError} />
      </section>

      <section style={{ ...panel, marginTop: 24 }}>
        <h2 style={sectionTitle}>Documents</h2>
        <DocumentSection caseId={id} documents={documents} onChanged={load} onError={setActionError} />
      </section>
    </div>
  );
}

function ParticipantSection({ caseId, participants, people, personNames, canManage, onChanged, onError }: {
  caseId: string; participants: Participant[]; people: Person[]; personNames: Map<string, string>; canManage: boolean; onChanged: () => void; onError: (message: string) => void;
}) {
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState('subject');
  const existing = new Set(participants.map(item => item.person_id));

  async function add() {
    if (!personId) return;
    onError('');
    const res = await fetch(`/api/hr/restricted-cases/${caseId}/participants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: personId, role_in_case: role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { onError(data.error ?? 'Could not add participant.'); return; }
    setPersonId('');
    onChanged();
  }

  async function remove(id: string) {
    onError('');
    const res = await fetch(`/api/hr/restricted-cases/${caseId}/participants/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { onError(data.error ?? 'Could not remove participant.'); return; }
    onChanged();
  }

  return <>
    {participants.length === 0 ? <p style={mutedText}>No participants recorded.</p> : (
      <div style={list}>
        {participants.map(item => (
          <div key={item.id} style={rowBox}>
            <div><div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{personNames.get(item.person_id) ?? item.person_id}</div><div style={{ ...mutedText, marginTop: 2, textTransform: 'capitalize' }}>{item.role_in_case}</div></div>
            {canManage && <button type="button" onClick={() => remove(item.person_id)} {...buttonProps('danger', 'sm')} aria-label={`Remove ${personNames.get(item.person_id) ?? item.person_id} from this case`}>Remove</button>}
          </div>
        ))}
      </div>
    )}
    {canManage && (
      <div style={{ ...formRow, marginTop: 14 }}>
        <select value={personId} onChange={event => setPersonId(event.target.value)} className={fieldControlClassName} style={growControl} aria-label="Participant">
          <option value="">Select person…</option>
          {people.filter(person => !existing.has(person.id)).map(person => <option key={person.id} value={person.id}>{person.first_name} {person.last_name}</option>)}
        </select>
        <select value={role} onChange={event => setRole(event.target.value)} className={fieldControlClassName} style={{ ...growControl, flex: '0 1 150px' }} aria-label="Role in case">
          {['subject','complainant','respondent','witness','other'].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <button type="button" onClick={add} disabled={!personId} {...buttonProps('primary', 'sm')}>Add</button>
      </div>
    )}
  </>;
}

function AccessSection({ caseId, users, onError }: { caseId: string; users: UserCandidate[]; onError: (message: string) => void }) {
  const [userId, setUserId] = useState('');
  const [message, setMessage] = useState('');

  async function mutate(method: 'grant' | 'revoke') {
    if (!userId) return;
    onError(''); setMessage('');
    const url = method === 'grant'
      ? `/api/hr/restricted-cases/${caseId}/access`
      : `/api/hr/restricted-cases/${caseId}/access/${encodeURIComponent(userId)}`;
    const res = await fetch(url, method === 'grant' ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
    } : { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { onError(data.error ?? `Could not ${method} access.`); return; }
    setMessage(method === 'grant' ? (data.already_granted ? 'Access was already granted.' : 'Access granted.') : (data.already_revoked ? 'No live grant remained.' : 'Access revoked.'));
  }

  return <>
    <p style={mutedText}>Select an active organisation user, then grant or revoke this case&apos;s read access. Participants do not receive access automatically.</p>
    <select value={userId} onChange={event => setUserId(event.target.value)} className={fieldControlClassName} style={{ width: '100%', marginTop: 10 }} aria-label="User">
      <option value="">Select user…</option>
      {users.map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ''}</option>)}
    </select>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      <button type="button" disabled={!userId} onClick={() => mutate('grant')} {...buttonProps('primary', 'sm')}>Grant access</button>
      <button type="button" disabled={!userId} onClick={() => mutate('revoke')} {...buttonProps('danger', 'sm')}>Revoke access</button>
    </div>
    {message && <p role="status" style={{ color: 'var(--status-success)', fontSize: 12, margin: '9px 0 0' }}>{message}</p>}
  </>;
}

function NoteSection({ caseId, notes, onChanged, onError }: { caseId: string; notes: Note[]; onChanged: () => void; onError: (message: string) => void }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true); onError('');
    const res = await fetch(`/api/hr/restricted-cases/${caseId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { onError(data.error ?? 'Could not add note.'); return; }
    setBody(''); onChanged();
  }

  return <>
    {notes.length === 0 ? <p style={mutedText}>No case notes recorded.</p> : (
      <div style={list}>
        {notes.map(note => <div key={note.id} style={noteBox}><div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.55 }}>{note.body}</div><div style={{ ...mutedText, marginTop: 8 }}>{formatDateTime(note.created_at)} · author {note.author_id}</div></div>)}
      </div>
    )}
    <form onSubmit={addNote} style={{ marginTop: 14 }}>
      <textarea value={body} onChange={event => setBody(event.target.value)} rows={4} placeholder="Add an append-only case note…" aria-label="New case note" className={fieldControlClassName} style={{ width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button disabled={saving || !body.trim()} type="submit" {...buttonProps('primary', 'sm')}>{saving ? 'Adding…' : 'Add note'}</button>
      </div>
    </form>
  </>;
}

function DocumentSection({ caseId, documents, onChanged, onError }: { caseId: string; documents: DocumentRow[]; onChanged: () => void; onError: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!file) return;
    setUploading(true); onError('');
    const form = new FormData(); form.append('file', file);
    const res = await fetch(`/api/hr/restricted-cases/${caseId}/documents`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) { onError(data.error ?? 'Could not upload document.'); return; }
    setFile(null); onChanged();
  }

  async function remove(documentId: string) {
    onError('');
    const res = await fetch(`/api/hr/restricted-cases/${caseId}/documents/${documentId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { onError(data.error ?? 'Could not delete document.'); return; }
    onChanged();
  }

  return <>
    {documents.length === 0 ? <p style={mutedText}>No documents attached.</p> : (
      <div style={list}>
        {documents.map(doc => <div key={doc.id} style={rowBox}><div style={{ minWidth: 0 }}><a href={`/api/hr/restricted-cases/${caseId}/documents/${doc.id}`} style={{ color: 'var(--brand-brainbase-accent)', fontSize: 13, fontWeight: 600, textDecoration: 'none', overflowWrap: 'anywhere' }}>{doc.original_filename}</a><div style={{ ...mutedText, marginTop: 2 }}>{formatBytes(doc.byte_size)} · {doc.content_type} · {formatDate(doc.created_at)}</div></div><button type="button" onClick={() => remove(doc.id)} {...buttonProps('danger', 'sm')} aria-label={`Delete ${doc.original_filename}`}>Delete</button></div>)}
      </div>
    )}
    <div style={{ ...formRow, marginTop: 14 }}>
      <input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} aria-label="Document to upload" style={{ color: 'var(--text-secondary)', fontSize: 12, flex: '1 1 200px', minWidth: 0 }} />
      <button type="button" disabled={!file || uploading} onClick={upload} {...buttonProps('primary', 'sm')}>{uploading ? 'Uploading…' : 'Upload'}</button>
    </div>
  </>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }

function capitalise(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }

// Sections are separated by headings and a top rule rather than nested cards.
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 };
const panel: React.CSSProperties = { borderTop: '1px solid var(--border)', paddingTop: 16, minWidth: 0 };
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' };
const mutedText: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 12, margin: 0, lineHeight: 1.45 };
const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' };
const rowBox: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--border-light)' };
const noteBox: React.CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--border-light)' };
const formRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const growControl: React.CSSProperties = { flex: '1 1 180px', minWidth: 0 };
const backLink: React.CSSProperties = { display: 'inline-block', marginBottom: 12, color: 'var(--text-secondary)', fontSize: 12, textDecoration: 'none' };
