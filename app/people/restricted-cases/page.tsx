'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import {
  Badge,
  Field,
  FormActions,
  FormError,
  PageHeader,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  fieldControlClassName,
  tableStyles,
} from '@/components/ui/app';

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

  const readGeneration = useRef(0);

  async function load() {
    const generation = ++readGeneration.current;
    setLoading(true);
    setError('');
    setCases([]);
    setCanManage(false);
    setAccessCandidates([]);
    setCurrentUserId(null);
    try {
      const [casesRes, adminsRes, meRes] = await Promise.all([
        fetch('/api/hr/restricted-cases'),
        fetch('/api/hr/administrators'),
        fetch('/api/me'),
      ]);
      if (!casesRes.ok) throw new Error('Restricted read failed');
      const [data, adminData, me] = await Promise.all([
        casesRes.json(),
        adminsRes.ok ? adminsRes.json() : Promise.resolve({ users: [] }),
        meRes.ok ? meRes.json() : Promise.resolve({}),
      ]);
      if (!Array.isArray(data.cases) || !Array.isArray(adminData.users)
        || data.cases.some((item: RestrictedCase) => !item || typeof item.id !== 'string'
          || typeof item.title !== 'string' || typeof item.case_type !== 'string'
          || (item.reference !== null && typeof item.reference !== 'string'))) {
        throw new Error('Invalid restricted response');
      }
      if (generation !== readGeneration.current) return;
      setCases(data.cases);
      setCanManage(adminsRes.ok);
      setAccessCandidates(adminData.users.filter((user: UserCandidate) => user.grant_eligible === true));
      setCurrentUserId(typeof (me as Me).userId === 'string' ? (me as Me).userId! : null);
    } catch {
      if (generation === readGeneration.current) setError('Could not load restricted HR cases. Refresh to try again.');
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    const generation = readGeneration;
    return () => { active = false; generation.current++; };
    // load reads no changing props or state.
  }, []);

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
      <PageHeader
        title="Restricted Cases"
        eyebrow={<Link href="/people">← People</Link>}
        description="Sensitive HR matters. Only cases you are explicitly authorised to read are shown here."
        actions={canManage && <button onClick={() => setShowCreate(true)} type="button" {...buttonProps('primary')}>+ Open Case</button>}
      />

      <WorkToolbar>
        <button type="button" disabled={loading} onClick={() => void load()} {...buttonProps('secondary')}>Refresh</button>
        <ToolbarSearch
          label="Search cases"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search cases…"
        />
      </WorkToolbar>

      <TableContainer label="Restricted cases" minWidth={720}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Type</th>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
              <th scope="col">Opened</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={6} kind="loading">Loading…</TableStateRow>}
            {!loading && error && <TableStateRow colSpan={6} kind="error">{error}</TableStateRow>}
            {!loading && !error && filtered.length === 0 && (
              <TableStateRow colSpan={6} kind="empty">
                {cases.length === 0 ? 'No restricted cases are currently available to you.' : 'No cases match your search.'}
              </TableStateRow>
            )}
            {!loading && !error && filtered.map(item => (
              <tr key={item.id}>
                <td className={tableStyles.primary}>
                  <Link href={`/people/restricted-cases/${item.id}`}>
                    {item.title}
                  </Link>
                </td>
                <td>{labelCaseType(item.case_type)}</td>
                <td>{item.reference || <span className={tableStyles.muted}>—</span>}</td>
                <td><Status status={item.status} /></td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDate(item.created_at)}</td>
                <td className={tableStyles.actions}>
                  <Link href={`/people/restricted-cases/${item.id}`} className={tableStyles.link} aria-label={`Open ${item.title}`}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

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
  const mutationPending = useRef(false);
  const [uncertain, setUncertain] = useState(false);

  async function grantInitialReader(caseId: string, userId: string) {
    const grantRes = await fetch(`/api/hr/restricted-cases/${caseId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (grantRes.status >= 500) throw new Error('Uncertain grant');
    const grantData = await grantRes.json();
    if (!grantRes.ok) {
      setCreatedCaseId(caseId);
      setNotice(`Case ${caseId} was created, but the initial access grant failed: ${grantData.error ?? 'grant failed'}`);
      return false;
    }
    return true;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mutationPending.current || uncertain || createdCaseId) return;
    mutationPending.current = true;
    setSaving(true);
    try {
    setError('');
    setNotice('');

    const createRes = await fetch('/api/hr/restricted-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_type: caseType, title, reference: reference.trim() || null }),
    });
    if (createRes.status >= 500) throw new Error('Uncertain create');
    const created = await createRes.json();
    if (!createRes.ok) {
      setError(created.error ?? 'Could not create restricted HR case.');
      setSaving(false);
      return;
    }

    const caseId = created.case?.id as string | undefined;
    if (!caseId) {
      throw new Error('Missing created identifier');
    }

    setCreatedCaseId(caseId);
    if (readerUserId) {
      const granted = await grantInitialReader(caseId, readerUserId);
      setSaving(false);
      if (!granted) return;
    } else {
      setSaving(false);
    }

    onCreated();
    } catch {
      setUncertain(true);
      setError('The change could not be confirmed. Do not open this case again until its creation and access have been checked.');
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }

  async function retryGrant() {
    if (!createdCaseId || !readerUserId || mutationPending.current || uncertain) return;
    mutationPending.current = true;
    try {
    setSaving(true);
    setNotice('');
    const granted = await grantInitialReader(createdCaseId, readerUserId);
    setSaving(false);
    if (granted) onCreated();
    } catch {
      setUncertain(true);
      setError('The access change could not be confirmed. Check the case access before retrying.');
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field label="Case type" required>
        {control => (
          <select {...control} value={caseType} onChange={event => setCaseType(event.target.value)} className={fieldControlClassName} disabled={createdCaseId !== null}>
            <option value="grievance">Grievance</option>
            <option value="disciplinary">Disciplinary</option>
            <option value="investigation">Investigation</option>
            <option value="other">Other</option>
          </select>
        )}
      </Field>
      <Field label="Title" required>
        {control => <input {...control} required value={title} onChange={event => setTitle(event.target.value)} className={fieldControlClassName} disabled={createdCaseId !== null} />}
      </Field>
      <Field label="Reference">
        {control => <input {...control} value={reference} onChange={event => setReference(event.target.value)} className={fieldControlClassName} disabled={createdCaseId !== null} />}
      </Field>
      <Field
        label="Initial reader"
        helper="Case creation never grants access implicitly. This performs a separate explicit grant after creation."
      >
        {control => (
          <select {...control} value={readerUserId} onChange={event => setReaderUserId(event.target.value)} className={fieldControlClassName}>
            <option value="">No initial grant</option>
            {users.map(user => <option key={user.id} value={user.id}>{user.name}{user.email ? ` · ${user.email}` : ''}</option>)}
          </select>
        )}
      </Field>
      {error && <FormError>{error}</FormError>}
      {notice && <p role="status" style={warningNotice}>{notice}</p>}
      <FormActions align="stretch">
        {createdCaseId ? (
          <button disabled={saving || uncertain || !readerUserId} type="button" onClick={retryGrant} {...buttonProps('primary')}>
            {saving ? 'Retrying…' : 'Retry access grant'}
          </button>
        ) : (
          <button disabled={saving || uncertain} type="submit" {...buttonProps('primary')}>
            {saving ? 'Opening…' : 'Open Case'}
          </button>
        )}
      </FormActions>
    </form>
  );
}

// Case status → semantic tone; the status word is always shown as the label.
function Status({ status }: { status: string }) {
  const open = status === 'open';
  return <Badge state={open ? 'success' : 'inactive'}>{labelCaseType(status)}</Badge>;
}

function labelCaseType(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const warningNotice: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  borderLeft: '2px solid var(--status-warning)',
  background: 'var(--status-warning-muted)',
  color: 'var(--text-primary)',
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: 'break-word',
};
