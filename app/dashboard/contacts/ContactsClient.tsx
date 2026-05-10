"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  last_contacted_at: string | null;
  created_at: string;
  address?: string | null;
  age?: number | null;
  program?: string | null;
  session_times?: string | null;
  next_action?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  session_id?: string | null;
};

type Session = { id: string; name: string; session_type: string; day_of_week: number; start_time: string };

type Filter = "all" | "active" | "attention";

type FormState = {
  name: string; email: string; phone: string; status: string;
  address: string; age: string; program: string; session_times: string; next_action: string;
  guardian_name: string; guardian_phone: string; session_id: string;
};

const EMPTY_FORM: FormState = {
  name: '', email: '', phone: '', status: 'lead',
  address: '', age: '', program: '', session_times: '', next_action: '',
  guardian_name: '', guardian_phone: '', session_id: '',
};

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  lead:      { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)',   label: 'Lead' },
  contacted: { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.22)',  label: 'Contacted' },
  active:    { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)',  label: 'Active' },
  inactive:  { bg: 'rgba(113,113,122,.10)', color: '#71717a', border: 'rgba(113,113,122,.22)', label: 'Inactive' },
};

const AVATAR_HUES = [210, 160, 280, 30, 340, 50, 190, 120];
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_HUES.length;
  return AVATAR_HUES[h];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function needsAttention(c: Contact): boolean {
  if (c.status === 'inactive') return false;
  if (!c.last_contacted_at) return true;
  return (Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000 > 7;
}
function lastContactedLabel(ts: string | null): string {
  if (!ts) return 'Never';
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}
function contactToForm(c: Contact): FormState {
  return {
    name: c.name, email: c.email ?? '', phone: c.phone ?? '',
    status: c.status, address: c.address ?? '', age: c.age != null ? String(c.age) : '',
    program: c.program ?? '', session_times: c.session_times ?? '', next_action: c.next_action ?? '',
    guardian_name: c.guardian_name ?? '', guardian_phone: c.guardian_phone ?? '',
    session_id: c.session_id ?? '',
  };
}

// ── Contact Form Modal ────────────────────────────────────────────────────────

function ContactModal({ mode, initial, onClose, onSave }: {
  mode: 'create' | 'edit';
  initial?: Contact;
  onClose: () => void;
  onSave: (c: Contact) => void;
}) {
  const [form, setForm]       = useState<FormState>(initial ? contactToForm(initial) : EMPTY_FORM);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch('/api/dashboard/sessions')
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => null);
  }, []);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const age = form.age !== '' ? parseInt(form.age, 10) : null;
  const isMinor = age !== null && !isNaN(age) && age < 18;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');

    const payload = {
      ...form,
      age: form.age !== '' ? Number(form.age) : null,
      guardian_name:  isMinor ? form.guardian_name  || null : null,
      guardian_phone: isMinor ? form.guardian_phone || null : null,
      session_id: form.session_id || null,
    };

    const res = mode === 'create'
      ? await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`/api/contacts/${initial!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSave(data.contact);
  }

  return (
    <>
      <style>{`@keyframes _cf{from{opacity:0}to{opacity:1}}@keyframes _cs{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:translateX(0)}}`}</style>
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', animation: '_cf .15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(3px)' }} />
        <div style={{
          width: 460, background: '#0e1014', borderLeft: '1px solid rgba(255,255,255,.09)',
          display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden',
          fontFamily: FONT, animation: '_cs .18s ease',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 28px', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA' }}>{mode === 'create' ? 'New Contact' : 'Edit Contact'}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          {/* Scrollable form */}
          <form onSubmit={submit} style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Basic details */}
            <F label="Name *">
              <input style={inp} value={form.name} onChange={set('name')} placeholder="Full name" required />
            </F>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <F label="Email">
                <input style={inp} type="email" value={form.email} onChange={set('email')} placeholder="name@email.com" />
              </F>
              <F label="Phone">
                <input style={inp} type="tel" value={form.phone} onChange={set('phone')} placeholder="04xx xxx xxx" />
              </F>
            </div>
            <F label="Status">
              <select style={inp} value={form.status} onChange={set('status')}>
                <option value="lead">Lead</option>
                <option value="contacted">Contacted</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </F>
            <F label="Address">
              <input style={inp} value={form.address} onChange={set('address')} placeholder="Street, suburb…" />
            </F>

            {/* Age — triggers guardian section */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <F label="Age">
                <input style={inp} type="number" min={1} max={120} value={form.age} onChange={set('age')} placeholder="—" />
              </F>
              <F label="Program">
                <input style={inp} value={form.program} onChange={set('program')} placeholder="Hot Shots, Squad…" />
              </F>
            </div>

            {/* Guardian section — visible only when under 18 */}
            {isMinor && (
              <div style={{ background: 'rgba(251,191,36,.05)', border: '1px solid rgba(251,191,36,.20)', borderRadius: 10, padding: '16px 16px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#fbbf24', marginBottom: 12 }}>
                  Guardian Details — required (under 18)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <F label="Guardian Name">
                    <input style={inp} value={form.guardian_name} onChange={set('guardian_name')} placeholder="Full name" />
                  </F>
                  <F label="Guardian Phone">
                    <input style={inp} type="tel" value={form.guardian_phone} onChange={set('guardian_phone')} placeholder="04xx xxx xxx" />
                  </F>
                </div>
              </div>
            )}

            {/* Session dropdown */}
            <F label="Session">
              <select style={inp} value={form.session_id} onChange={set('session_id')}>
                <option value="">— Not enrolled in a session —</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({DAY[s.day_of_week]} {s.start_time} · {s.session_type})
                  </option>
                ))}
              </select>
            </F>

            <F label="Session Times">
              <input style={inp} value={form.session_times} onChange={set('session_times')} placeholder="Mon 4pm, Wed 5pm…" />
            </F>
            <F label="Next Action">
              <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} rows={2} value={form.next_action} onChange={set('next_action')} placeholder="Follow up call, send invoice…" />
            </F>

            {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}

            {/* Footer */}
            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.40)', fontFamily: FONT }}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ flex: 2, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: saving ? 'default' : 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: saving ? .5 : 1 }}>
                {saving ? 'Saving…' : mode === 'create' ? 'Create Contact' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 5, fontFamily: FONT }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
};

// ── Contact Tile ──────────────────────────────────────────────────────────────

function ContactTile({ contact, onEdit, onStatusChange }: {
  contact: Contact;
  onEdit: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState(contact.status);
  const [saving, setSaving] = useState(false);
  const attention = needsAttention({ ...contact, status });
  const badge = STATUS_STYLES[status] ?? STATUS_STYLES.lead;
  const hue = avatarHue(contact.name);

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setStatus(val);
    setSaving(true);
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: val }),
    });
    setSaving(false);
    onStatusChange(contact.id, val);
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: `1px solid ${attention ? 'rgba(251,191,36,.25)' : 'rgba(255,255,255,.07)'}`,
      borderRadius: 16, padding: '20px', display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'border-color .15s, background .15s', fontFamily: FONT,
    }}>

      {/* Avatar + name + edit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: `hsl(${hue},55%,22%)`, border: `1.5px solid hsl(${hue},55%,35%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: `hsl(${hue},80%,72%)`, letterSpacing: '.02em',
        }}>
          {initials(contact.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/dashboard/contacts/${contact.id}`}
            style={{ fontSize: 14, fontWeight: 600, color: '#F5F7FA', textDecoration: 'none', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact.name}
          </Link>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>Last: {lastContactedLabel(contact.last_contacted_at)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {attention && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.28)', letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              Attn
            </span>
          )}
          <button onClick={onEdit} style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 7, cursor: 'pointer',
            background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.11)',
            color: 'rgba(255,255,255,.45)', fontFamily: FONT,
          }}>
            Edit
          </button>
        </div>
      </div>

      {/* Contact info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href={`mailto:${contact.email}`} style={{ fontSize: 12, color: 'rgba(255,255,255,.40)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {contact.email}
        </a>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} style={{ fontSize: 12, color: 'rgba(255,255,255,.30)', textDecoration: 'none' }}>{contact.phone}</a>
        )}
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <select value={status} onChange={handleStatusChange} disabled={saving} style={{
          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
          background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
          letterSpacing: '.04em', textTransform: 'capitalize', cursor: 'pointer',
          outline: 'none', flex: 1,
        }}>
          <option value="lead">Lead</option>
          <option value="contacted">Contacted</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ display: 'flex', gap: 5 }}>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(34,197,94,.10)', color: '#4ade80', border: '1px solid rgba(34,197,94,.18)', textDecoration: 'none' }}>
              Call
            </a>
          )}
          <a href={`mailto:${contact.email}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(59,130,246,.10)', color: '#60a5fa', border: '1px solid rgba(59,130,246,.18)', textDecoration: 'none' }}>
            Email
          </a>
          <Link href={`/dashboard/contacts/${contact.id}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.55)', border: '1px solid rgba(255,255,255,.10)', textDecoration: 'none' }}>
            View
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactsClient({ contacts: initial }: { contacts: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const sorted = useMemo(() => [...contacts].sort((a, b) => (needsAttention(a) ? 0 : 1) - (needsAttention(b) ? 0 : 1)), [contacts]);

  const filtered = useMemo(() => {
    if (filter === "active")    return sorted.filter(c => c.status === "active");
    if (filter === "attention") return sorted.filter(needsAttention);
    return sorted;
  }, [sorted, filter]);

  const attentionCount = contacts.filter(needsAttention).length;

  function handleCreated(c: Contact) {
    setContacts(prev => [c, ...prev]);
    setShowCreate(false);
  }

  function handleEdited(c: Contact) {
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, ...c } : x));
    setEditingContact(null);
  }

  function handleStatusChange(id: string, status: string) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  }

  function tabStyle(t: Filter): React.CSSProperties {
    const active = filter === t;
    return {
      padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: active ? '1px solid rgba(255,255,255,.12)' : '1px solid transparent',
      background: active ? 'rgba(255,255,255,.08)' : 'transparent',
      color: active ? '#F5F7FA' : 'rgba(255,255,255,.35)',
      transition: 'all .15s', fontFamily: FONT,
    };
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Filter bar + New Contact */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setFilter("all")} style={tabStyle("all")}>All ({contacts.length})</button>
          <button onClick={() => setFilter("active")} style={tabStyle("active")}>Active</button>
          <button onClick={() => setFilter("attention")} style={tabStyle("attention")}>
            Needs Attention{attentionCount > 0 && (
              <span style={{ marginLeft: 6, background: 'rgba(251,191,36,.18)', color: '#fbbf24', padding: '1px 6px', borderRadius: 10, fontSize: 10 }}>
                {attentionCount}
              </span>
            )}
          </button>
        </div>

        <button onClick={() => setShowCreate(true)} style={{
          fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 20, cursor: 'pointer',
          background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.40)',
          color: '#a5b4fc', fontFamily: FONT, whiteSpace: 'nowrap',
        }}>
          + New Contact
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.025)', padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
          {filter === "attention" ? "No contacts need attention right now." :
           filter === "active"    ? "No active contacts yet." :
           "No contacts yet. Click \"+ New Contact\" to add one."}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map(c => (
            <ContactTile key={c.id} contact={c} onEdit={() => setEditingContact(c)} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      {showCreate && (
        <ContactModal mode="create" onClose={() => setShowCreate(false)} onSave={handleCreated} />
      )}
      {editingContact && (
        <ContactModal mode="edit" initial={editingContact} onClose={() => setEditingContact(null)} onSave={handleEdited} />
      )}
    </div>
  );
}
