"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Field as FormField, Panel, buttonProps, fieldControlClassName, type SemanticState } from "@/components/ui/app";
import styles from "../Contacts.module.css";

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  address: string | null;
  age: number | null;
  program: string | null;
  session_times: string | null;
  next_action: string | null;
  last_contacted_at: string | null;
  created_at: string;
};

// Contact status → shared semantic state (token colours, AA in both themes).
const statusState: Record<string, SemanticState> = {
  lead:      'info',
  contacted: 'warning',
  active:    'success',
  inactive:  'inactive',
};

function formatDate(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} (${label})`;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className={styles.detailRow}>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={styles.detailValue}>{value || '—'}</dd>
    </div>
  );
}

export default function ContactDetailClient({ contact: initial }: { contact: Contact }) {
  const router = useRouter();
  const uid = useId();
  const [contact, setContact] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...initial });
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const status = e.target.value;
    setContact(prev => ({ ...prev, status }));
    setStatusSaving(true);
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const { contact: updated } = await res.json();
      setContact(prev => ({ ...prev, last_contacted_at: updated.last_contacted_at }));
    }
    setStatusSaving(false);
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        address: form.address || null,
        age: form.age ? Number(form.age) : null,
        program: form.program || null,
        session_times: form.session_times || null,
        next_action: form.next_action || null,
      }),
    });
    if (res.ok) {
      const { contact: updated } = await res.json();
      setContact(prev => ({ ...prev, ...updated }));
      setEditing(false);
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
    router.push("/dashboard/contacts");
  }

  return (
    <>
      {/* Quick actions */}
      <div className={styles.quickActions}>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} {...buttonProps('secondary')}>
            <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            Call
          </a>
        )}
        <a href={`mailto:${contact.email}`} {...buttonProps('primary')}>
          <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Email
        </a>
      </div>

      {/* Status + timeline */}
      <Panel>
        <div className={styles.statusRow}>
          <div className={styles.statusField}>
            <label htmlFor={`${uid}-status`} className={styles.fieldLabel}>Status</label>
            <select
              id={`${uid}-status`}
              value={contact.status}
              onChange={handleStatusChange}
              disabled={statusSaving}
              className={styles.statusSelect}
              data-state={statusState[contact.status] ?? statusState.lead}
            >
              <option value="lead">Lead</option>
              <option value="contacted">Contacted</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className={`${styles.statusField} ${styles.lastContacted}`}>
            <span className={styles.fieldLabel}>Last Contacted</span>
            <p className={styles.value}>{formatDate(contact.last_contacted_at)}</p>
          </div>
        </div>
        <p className={styles.added}>
          Added {new Date(contact.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </Panel>

      {/* Details */}
      {editing ? (
        <Panel title="Edit Details">
          <div className={styles.editGrid}>
            <div className={styles.row2}>
              <FormField label="Name">{c => <input {...c} name="name" value={form.name} onChange={handleChange} className={fieldControlClassName} />}</FormField>
              <FormField label="Email">{c => <input {...c} name="email" type="email" value={form.email} onChange={handleChange} className={fieldControlClassName} />}</FormField>
            </div>
            <div className={styles.row2}>
              <FormField label="Phone">{c => <input {...c} name="phone" type="tel" value={form.phone ?? ""} onChange={handleChange} className={fieldControlClassName} />}</FormField>
              <FormField label="Age">{c => <input {...c} name="age" type="number" value={form.age ?? ""} onChange={handleChange} className={fieldControlClassName} placeholder="e.g. 12" />}</FormField>
            </div>
            <FormField label="Program">{c => <input {...c} name="program" value={form.program ?? ""} onChange={handleChange} className={fieldControlClassName} placeholder="e.g. Hot Shots, Private Lesson" />}</FormField>
            <FormField label="Session Times">{c => <input {...c} name="session_times" value={form.session_times ?? ""} onChange={handleChange} className={fieldControlClassName} placeholder="e.g. Tue 4pm, Thu 4pm" />}</FormField>
            <FormField label="Address">{c => <input {...c} name="address" value={form.address ?? ""} onChange={handleChange} className={fieldControlClassName} placeholder="e.g. 12 Main St, Adelaide" />}</FormField>
            <FormField label="Next Action">{c => <input {...c} name="next_action" value={form.next_action ?? ""} onChange={handleChange} className={fieldControlClassName} placeholder="e.g. Call to confirm Thursday session" />}</FormField>
          </div>
          <div className={styles.editActions}>
            <button type="button" onClick={handleSave} disabled={saving} {...buttonProps('primary')}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm({ ...contact }); }} {...buttonProps('secondary')}>
              Cancel
            </button>
          </div>
        </Panel>
      ) : (
        <Panel
          title="Details"
          actions={
            <button type="button" onClick={() => setEditing(true)} {...buttonProps('ghost', 'sm')} aria-label="Edit details">Edit</button>
          }
        >
          <dl className={styles.detailList}>
            <Field label="Age" value={contact.age} />
            <Field label="Program" value={contact.program} />
            <Field label="Session Times" value={contact.session_times} />
            <Field label="Address" value={contact.address} />
            {contact.next_action && <Field label="Next Action" value={contact.next_action} />}
          </dl>
        </Panel>
      )}

      {/* Delete */}
      <div className={styles.deleteRow}>
        {confirmDelete ? (
          <div className={styles.confirm} role="group" aria-label="Confirm delete">
            <span>Delete this contact?</span>
            <button type="button" onClick={handleDelete} disabled={deleting} {...buttonProps('danger', 'sm')}>
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} {...buttonProps('ghost', 'sm')}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} {...buttonProps('ghost', 'sm')}>
            Delete contact
          </button>
        )}
      </div>
    </>
  );
}
