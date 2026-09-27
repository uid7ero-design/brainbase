"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Badge, Field, FormError, SlidePanel, StateMessage, buttonProps, fieldControlClassName, type SemanticState,
} from "@/components/ui/app";
import styles from "./Contacts.module.css";

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

// Contact status → shared semantic state (token colours, AA in both themes).
const STATUS_STATE: Record<string, SemanticState> = {
  lead:      'info',
  contacted: 'warning',
  active:    'success',
  inactive:  'inactive',
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

/// ── Contact Form Modal ────────────────────────────────────────────────────────
//
// The shared SlidePanel: role="dialog", aria-modal, labelled by its title,
// Escape / × / scrim close, focus trapped and returned to the opener.

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
    <SlidePanel open onClose={onClose} title={mode === 'create' ? 'New Contact' : 'Edit Contact'}>
      {/* Scrollable form */}
      <form onSubmit={submit} className={styles.form}>

        {/* Basic details */}
        <Field label="Name *">
          {c => <input {...c} className={fieldControlClassName} value={form.name} onChange={set('name')} placeholder="Full name" required />}
        </Field>
        <div className={styles.row2}>
          <Field label="Email">
            {c => <input {...c} className={fieldControlClassName} type="email" value={form.email} onChange={set('email')} placeholder="name@email.com" />}
          </Field>
          <Field label="Phone">
            {c => <input {...c} className={fieldControlClassName} type="tel" value={form.phone} onChange={set('phone')} placeholder="04xx xxx xxx" />}
          </Field>
        </div>
        <Field label="Status">
          {c => (
            <select {...c} className={fieldControlClassName} value={form.status} onChange={set('status')}>
              <option value="lead">Lead</option>
              <option value="contacted">Contacted</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
        </Field>
        <Field label="Address">
          {c => <input {...c} className={fieldControlClassName} value={form.address} onChange={set('address')} placeholder="Street, suburb…" />}
        </Field>

        {/* Age — triggers guardian section */}
        <div className={styles.row2}>
          <Field label="Age">
            {c => <input {...c} className={fieldControlClassName} type="number" min={1} max={120} value={form.age} onChange={set('age')} placeholder="—" />}
          </Field>
          <Field label="Program">
            {c => <input {...c} className={fieldControlClassName} value={form.program} onChange={set('program')} placeholder="Hot Shots, Squad…" />}
          </Field>
        </div>

        {/* Guardian section — visible only when under 18 */}
        {isMinor && (
          <fieldset className={styles.guardian}>
            <legend className={styles.guardianLegend}>
              Guardian Details — required (under 18)
            </legend>
            <div className={styles.row2}>
              <Field label="Guardian Name">
                {c => <input {...c} className={fieldControlClassName} value={form.guardian_name} onChange={set('guardian_name')} placeholder="Full name" />}
              </Field>
              <Field label="Guardian Phone">
                {c => <input {...c} className={fieldControlClassName} type="tel" value={form.guardian_phone} onChange={set('guardian_phone')} placeholder="04xx xxx xxx" />}
              </Field>
            </div>
          </fieldset>
        )}

        {/* Session dropdown */}
        <Field label="Session">
          {c => (
            <select {...c} className={fieldControlClassName} value={form.session_id} onChange={set('session_id')}>
              <option value="">— Not enrolled in a session —</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({DAY[s.day_of_week]} {s.start_time} · {s.session_type})
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Session Times">
          {c => <input {...c} className={fieldControlClassName} value={form.session_times} onChange={set('session_times')} placeholder="Mon 4pm, Wed 5pm…" />}
        </Field>
        <Field label="Next Action">
          {c => <textarea {...c} className={fieldControlClassName} rows={2} value={form.next_action} onChange={set('next_action')} placeholder="Follow up call, send invoice…" />}
        </Field>

        {error && <FormError>{error}</FormError>}

        {/* Footer */}
        <div className={styles.formFooter}>
          <button type="button" onClick={onClose} {...buttonProps('secondary')}>
            Cancel
          </button>
          <button type="submit" disabled={saving} {...buttonProps('primary')}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create Contact' : 'Save Changes'}
          </button>
        </div>
      </form>
    </SlidePanel>
  );
}

// ── Contact Tile ──────────────────────────────────────────────────────────────

function ContactTile({ contact, onEdit, onStatusChange }: {
  contact: Contact;
  onEdit: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [status, setStatus] = useState(contact.status);
  const [saving, setSaving] = useState(false);
  const attention = needsAttention({ ...contact, status });
  const badgeState = STATUS_STATE[status] ?? STATUS_STATE.lead;
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
    <article className={styles.tile} data-attention={attention ? 'true' : undefined} aria-label={contact.name}>

      {/* Avatar + name + edit */}
      <div className={styles.tileHeader}>
        {/* Avatar hue is a per-person identity encoding: a theme-mixed tint
            behind primary text, so it reads in light and dark. */}
        <div className={styles.avatar} aria-hidden="true" style={{
          background: `color-mix(in srgb, hsl(${hue} 60% 50%) 18%, var(--bg-surface))`,
          borderColor: `color-mix(in srgb, hsl(${hue} 60% 50%) 45%, var(--bg-surface))`,
        }}>
          {initials(contact.name)}
        </div>
        <div className={styles.tileIdentity}>
          <Link href={`/dashboard/contacts/${contact.id}`} className={styles.tileName} title={contact.name}>
            {contact.name}
          </Link>
          <div className={styles.tileMeta}>Last: {lastContactedLabel(contact.last_contacted_at)}</div>
        </div>
        <div className={styles.tileTools}>
          {attention && (
            <Badge state="warning" dot={false}>
              Attn
            </Badge>
          )}
          <button type="button" onClick={onEdit} {...buttonProps('ghost', 'sm')} aria-label={`Edit ${contact.name}`}>
            Edit
          </button>
        </div>
      </div>

      {/* Contact info */}
      <div className={styles.tileContact}>
        <a href={`mailto:${contact.email}`} className={styles.tileEmail} title={contact.email}>
          {contact.email}
        </a>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className={styles.tilePhone}>{contact.phone}</a>
        )}
      </div>

      {/* Status + actions */}
      <div className={styles.tileFooter}>
        <select
          value={status}
          onChange={handleStatusChange}
          disabled={saving}
          aria-label={`Status for ${contact.name}`}
          className={styles.statusSelect}
          data-state={badgeState}
        >
          <option value="lead">Lead</option>
          <option value="contacted">Contacted</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className={styles.tileActions}>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} {...buttonProps('secondary', 'sm')} aria-label={`Call ${contact.name}`}>
              Call
            </a>
          )}
          <a href={`mailto:${contact.email}`} {...buttonProps('secondary', 'sm')} aria-label={`Email ${contact.name}`}>
            Email
          </a>
          <Link href={`/dashboard/contacts/${contact.id}`} {...buttonProps('ghost', 'sm')} aria-label={`View ${contact.name}`}>
            View
          </Link>
        </div>
      </div>
    </article>
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

  function tabStyle(t: Filter) {
    return { className: styles.filterButton, 'aria-pressed': filter === t } as const;
  }

  return (
    <div className={styles.client}>
      {/* Filter bar + New Contact */}
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter contacts">
          <button type="button" onClick={() => setFilter("all")} {...tabStyle("all")}>All ({contacts.length})</button>
          <button type="button" onClick={() => setFilter("active")} {...tabStyle("active")}>Active</button>
          <button type="button" onClick={() => setFilter("attention")} {...tabStyle("attention")}>
            Needs Attention{attentionCount > 0 && (
              <span className={styles.count}>
                {attentionCount}
              </span>
            )}
          </button>
        </div>

        <button type="button" onClick={() => setShowCreate(true)} {...buttonProps('primary')}>
          + New Contact
        </button>
      </div>

      {filtered.length === 0 ? (
        <StateMessage
          kind="empty"
          size="page"
          title={
            filter === "attention" ? "No contacts need attention right now." :
            filter === "active"    ? "No active contacts yet." :
            "No contacts yet. Click \"+ New Contact\" to add one."
          }
        />
      ) : (
        <ul className={styles.grid}>
          {filtered.map(c => (
            <li key={c.id}>
              <ContactTile contact={c} onEdit={() => setEditingContact(c)} onStatusChange={handleStatusChange} />
            </li>
          ))}
        </ul>
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
