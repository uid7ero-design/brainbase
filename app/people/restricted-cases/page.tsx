'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';

const CARD = 'var(--bg-surface)';
const BORDER = 'var(--border)';
const MUTED = 'var(--text-secondary)';

type RestrictedCase = {
  id: string;
  case_type: 'grievance' | 'disciplinary' | 'investigation' | 'other';
  status: 'open' | 'closed';
  title: string;
  reference: string | null;
  opened_by: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

type Me = { userId?: string | null };
type UserCandidate = { id: string; name: string; email: string | null; grant_eligible: boolean };

export default function RestrictedCasesPage() {
  const [cases, setCases] = useState<RestrictedCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accessCandidates, setAccessCandidates] = useState<UserCandidate[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const [casesRes, adminsRes, meRes] = await Promise.all([
      fetch('/api/hr/restricted-cases'),
      fetch('/api/hr/administrators'),
      fetch('/api/me'),
    ]);

    if (casesRes.ok) {
      const data = await casesRes.json();
      setCases(data.cases ?? []);
    } else {
      const data = await casesRes.json().catch(() => ({}));
      setError(data.error ?? 'Could not load restricted HR cases.');
    }

    setCanManage(adminsRes.ok);
    if (adminsRes.ok) {
      const adminData = await adminsRes.json();
      setAccessCandidates((adminData.users ?? []).filter((user: UserCandidate) => user.grant_eligible));
    } else {
      setAccessCandidates([]);
    }
    if (meRes.ok) {
      const me = await meRes.json() as Me;
      setCurrentUserId(typeof me.userId === 'string' ? me.userId : null);
    }
    setLoading(false);
  }

  useEffect(() => { queueMicrotask(() => { load(); }); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(item =>
      item.title.toLowerCase().includes(q)
      || item.case_type.toLowerCase().includes(q)
      || (item.reference ?? '').toLowerCase().includes(q),
    );
  }, [cases, search]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
        <div>
          <div style={{ marginBottom: 10 }}><Link href="/people" style={backLink}>← People</Link></div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Restricted Cases</h1>
          <p style={{ color: MUTED, fontSize: 13, margin: '4px 0 0', maxWidth: 620 }}>
            Sensitive HR matters. Only cases you are explicitly authorised to read are shown here.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search cases…"
            style={inputStyle}
          />
          {canManage && <button onClick={() => setShowCreate(true)} style={primaryButton}>+ Open Case</button>}
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 22 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Case', 'Type', 'Reference', 'Status', 'Opened', ''].map(label => <th key={label} style={th}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={empty}>Loading…</td></tr>}
            {!loading && error && <tr><td colSpan={6} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}
            {!loading && !error && filtered.length === 0 && (
              <tr><td colSpan={6} style={empty}>
                {cases.length === 0 ? 'No restricted cases are currently available to you.' : 'No cases match your search.'}
              </td></tr>
            )}
            {!loading && !error && filtered.map((item, index) => (
              <tr key={item.id} style={{ borderBottom: index < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '14px 16px' }}>
                  <Link href={`/people/restricted-cases/${item.id}`} style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    {item.title}
                  </Link>
                </td>
                <td style={td}>{labelCaseType(item.case_type)}</td>
                <td style={td}>{item.reference || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td style={td}><Status status={item.status} /></td>
                <td style={td}>{formatDate(item.created_at)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <Link href={`/people/restricted-cases/${item.id}`} style={actionLink}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlidePanel open={showCreate} onClose={() => setShowCreate(false)} title="Open Restricted Case">
        <CreateCaseForm
          currentUserId={currentUserId}
          users={accessCandidates}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      </SlidePanel>
    </div>
  );
}

function CreateCaseForm({ currentUserId, users, onCreated }: { currentUserId: string | null; users: UserCandidate[]; onCreated: () => void }) {
  const defaultReader = currentUserId && users.some(user => user.id === currentUserId) ? currentUserId : '';
  const [caseType, setCaseType] = useState('investigation');
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [readerUserId, setReaderUserId] = useState(defaultReader);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function grantInitialReader(caseId: string, userId: string) {
    const grantRes = await fetch(`/api/hr/restricted-cases/${caseId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const grantData = await grantRes.json().catch(() => ({}));
    if (!grantRes.ok) {
      setCreatedCaseId(caseId);
      setNotice(`Case ${caseId} was created, but the initial access grant failed: ${grantData.error ?? 'grant failed'}`);
      return false;
    }
    return true;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    const createRes = await fetch('/api/hr/restricted-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_type: caseType, title, reference: reference.trim() || null }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      setError(created.error ?? 'Could not create restricted HR case.');
      setSaving(false);
      return;
    }

    const caseId = created.case?.id as string | undefined;
    if (!caseId) {
      setError('Case was created but no case identifier was returned.');
      setSaving(false);
      return;
    }

    if (readerUserId) {
      const granted = await grantInitialReader(caseId, readerUserId);
      setSaving(false);
      if (!granted) return;
    } else {
      setSaving(false);
    }

    onCreated();
  }

  async function retryGrant() {
    if (!createdCaseId || !readerUserId) return;
    setSaving(true);
    setNotice('');
    const granted = await grantInitialReader(createdCaseId, readerUserId);
    setSaving(false);
    if (granted) onCreated();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Case type *</label>
        <select value={caseType} onChange={event => setCaseType(event.target.value)} style={selectStyle} disabled={createdCaseId !== null}>
          <option value="grievance">Grievance</option>
          <option value="disciplinary">Disciplinary</option>
          <option value="investigation">Investigation</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Title *</label>
        <input required value={title} onChange={event => setTitle(event.target.value)} style={formInput} disabled={createdCaseId !== null} />
      </div>
      <div>
        <label style={labelStyle}>Reference</label>
        <input value={reference} onChange={event => setReference(event.target.value)} style={formInput} disabled={createdCaseId !== null} />
      </div>
      <div>
        <label style={labelStyle}>Initial reader</label>
        <select value={readerUserId} onChange={event => setReaderUserId(event.target.value)} style={selectStyle}>
          <option value="">No initial grant</option>
          {users.map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ''}</option>)}
        </select>
        <p style={{ color: MUTED, fontSize: 11, lineHeight: 1.4, margin: '6px 0 0' }}>
          Case creation never grants access implicitly. This performs a separate explicit grant after creation.
        </p>
      </div>
      {error && <p style={errorText}>{error}</p>}
      {notice && <p style={{ ...errorText, color: '#fbbf24', wordBreak: 'break-word' }}>{notice}</p>}
      {createdCaseId ? (
        <button disabled={saving || !readerUserId} type="button" onClick={retryGrant} style={{ ...primaryButton, width: '100%', padding: '10px 14px', opacity: saving || !readerUserId ? 0.65 : 1 }}>
          {saving ? 'Retrying…' : 'Retry access grant'}
        </button>
      ) : (
        <button disabled={saving} type="submit" style={{ ...primaryButton, width: '100%', padding: '10px 14px', opacity: saving ? 0.65 : 1 }}>
          {saving ? 'Opening…' : 'Open Case'}
        </button>
      )}
    </form>
  );
}

function Status({ status }: { status: string }) {
  const open = status === 'open';
  return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: open ? '#6ee7b7' : 'var(--text-secondary)', background: open ? 'rgba(16,185,129,.12)' : 'rgba(107,114,128,.12)', textTransform: 'capitalize' }}>{status}</span>;
}

function labelCaseType(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const cardStyle: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' };
const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: MUTED, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 13, color: 'var(--text-secondary)' };
const empty: React.CSSProperties = { padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 };
const inputStyle: React.CSSProperties = { width: 210, padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, outline: 'none' };
const primaryButton: React.CSSProperties = { padding: '8px 16px', background: 'var(--purple-600)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const backLink: React.CSSProperties = { color: MUTED, fontSize: 12, textDecoration: 'none' };
const actionLink: React.CSSProperties = { color: '#8fb3ff', fontSize: 12, textDecoration: 'none' };
const labelStyle: React.CSSProperties = { display: 'block', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const formInput: React.CSSProperties = { width: '100%', padding: '9px 12px', background: 'var(--bg-raised)', border: `1px solid ${BORDER}`, borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const selectStyle: React.CSSProperties = { ...formInput };
const errorText: React.CSSProperties = { color: '#f87171', fontSize: 13, margin: 0 };
