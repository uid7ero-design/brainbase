'use client';
import { useActionState, useState, useTransition } from 'react';
import { createOrg, updateOrg, deleteOrg } from '@/app/actions/orgs';

const CARD = '#0e1014';
const BORDER = '#1a1d24';

type Org = { id: string; name: string; slug: string; created_at: string; user_count: number };

export default function OrgsClient({ orgs }: { orgs: Org[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Org | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(createOrg, undefined);
  const [editState, editAction, editPending] = useActionState(updateOrg, undefined);

  function handleDelete(org: Org) {
    if (!confirm(`Delete "${org.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteOrg(org.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Organisations</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4, marginBottom: 0 }}>{orgs.length} organisation{orgs.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={btnStyle('#1a6aff')}>+ New Organisation</button>
      </div>

      {deleteError && (
        <div style={{ ...errorBox, marginBottom: 16 }}>{deleteError} <button onClick={() => setDeleteError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', marginLeft: 8 }}>×</button></div>
      )}

      {/* Table */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Name', 'Slug', 'Users', 'Created', 'Actions'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 }}>No organisations yet.</td></tr>
            )}
            {orgs.map((org, i) => (
              <tr key={org.id} style={{ borderBottom: i < orgs.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: isPending ? 0.6 : 1 }}>
                <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500 }}>{org.name}</td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>{org.slug}</td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#9ca3af' }}>
                  <a href={`/admin/users?org=${org.id}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>{org.user_count} user{org.user_count !== 1 ? 's' : ''}</a>
                </td>
                <td style={{ padding: '14px 16px', fontSize: 12, color: '#6b7280' }}>{new Date(org.created_at).toLocaleDateString()}</td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditTarget(org)} style={smallBtn('#1f2937', '#d1d5db')}>Edit</button>
                    {org.user_count === 0 && (
                      <button onClick={() => handleDelete(org)} style={smallBtn('rgba(239,68,68,0.1)', '#f87171')}>Delete</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showAdd && (
        <Modal title="New Organisation" onClose={() => setShowAdd(false)}>
          <form
            action={async (fd) => {
              await createAction(fd);
              if (!createState?.error) setShowAdd(false);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <Field label="Organisation Name" name="name" placeholder="Acme Council" />
            <Field label="Slug" name="slug" placeholder="acme-council" />
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Slug is a unique URL-safe identifier. Lowercase, hyphens only.</p>
            {createState?.error && <div style={errorBox}>{createState.error}</div>}
            {createState?.success && <div style={successBox}>{createState.success}</div>}
            <button type="submit" disabled={createPending} style={btnStyle('#1a6aff')}>{createPending ? 'Creating…' : 'Create Organisation'}</button>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal title={`Edit — ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <form
            action={async (fd) => {
              await editAction(fd);
              if (!editState?.error) setEditTarget(null);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <input type="hidden" name="orgId" value={editTarget.id} />
            <Field label="Organisation Name" name="name" defaultValue={editTarget.name} />
            <Field label="Slug" name="slug" defaultValue={editTarget.slug} />
            {editState?.error && <div style={errorBox}>{editState.error}</div>}
            {editState?.success && <div style={successBox}>{editState.success}</div>}
            <button type="submit" disabled={editPending} style={btnStyle('#1a6aff')}>{editPending ? 'Saving…' : 'Save changes'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}>
      <div style={{ background: '#0e1014', border: '1px solid #1a1d24', borderRadius: 14, padding: 28, width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, name, type = 'text', defaultValue, placeholder }: { label: string; name: string; type?: string; defaultValue?: string; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input name={name} type={type} required defaultValue={defaultValue} placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const errorBox: React.CSSProperties = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px' };
const successBox: React.CSSProperties = { color: '#34d399', fontSize: 13, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px' };
function btnStyle(bg: string): React.CSSProperties { return { padding: '9px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
function smallBtn(bg: string, color: string): React.CSSProperties { return { padding: '5px 10px', background: bg, color, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
