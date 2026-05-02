"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

const statusStyles: Record<string, string> = {
  lead:      'bg-green-500/10 text-green-400 border-green-500/20',
  contacted: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  active:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  inactive:  'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
};

const inputClass = "w-full bg-white/4 border border-white/8 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:border-white/20 focus:bg-white/6 transition-all";
const labelClass = "block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1.5";

function formatDate(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  return `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} (${label})`;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="py-3.5 border-b border-white/5 last:border-none grid grid-cols-[140px_1fr] gap-4 items-start">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-600 pt-0.5">{label}</span>
      <span className="text-sm text-zinc-300 leading-relaxed">{value || '—'}</span>
    </div>
  );
}

export default function ContactDetailClient({ contact: initial }: { contact: Contact }) {
  const router = useRouter();
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
      <div className="flex gap-2 mb-5">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 text-sm font-medium border border-white/10 text-zinc-300 px-4 py-2 rounded-full hover:border-white/20 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            Call
          </a>
        )}
        <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-green-500 text-black px-4 py-2 rounded-full hover:bg-green-400 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Email
        </a>
      </div>

      {/* Status + timeline */}
      <div className="rounded-2xl border border-white/8 bg-white/2 overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-1">Status</p>
            <select
              value={contact.status}
              onChange={handleStatusChange}
              disabled={statusSaving}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize bg-transparent cursor-pointer focus:outline-none ${statusStyles[contact.status] ?? statusStyles.lead}`}
            >
              <option value="lead">Lead</option>
              <option value="contacted">Contacted</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-1">Last Contacted</p>
            <p className="text-sm text-zinc-300">{formatDate(contact.last_contacted_at)}</p>
          </div>
        </div>
        <div className="px-5 py-3 text-xs text-zinc-600">
          Added {new Date(contact.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Details */}
      {editing ? (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-5 mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-5">Edit Details</p>
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>Name</label><input name="name" value={form.name} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Email</label><input name="email" type="email" value={form.email} onChange={handleChange} className={inputClass} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>Phone</label><input name="phone" type="tel" value={form.phone ?? ""} onChange={handleChange} className={inputClass} /></div>
              <div><label className={labelClass}>Age</label><input name="age" type="number" value={form.age ?? ""} onChange={handleChange} className={inputClass} placeholder="e.g. 12" /></div>
            </div>
            <div><label className={labelClass}>Program</label><input name="program" value={form.program ?? ""} onChange={handleChange} className={inputClass} placeholder="e.g. Hot Shots, Private Lesson" /></div>
            <div><label className={labelClass}>Session Times</label><input name="session_times" value={form.session_times ?? ""} onChange={handleChange} className={inputClass} placeholder="e.g. Tue 4pm, Thu 4pm" /></div>
            <div><label className={labelClass}>Address</label><input name="address" value={form.address ?? ""} onChange={handleChange} className={inputClass} placeholder="e.g. 12 Main St, Adelaide" /></div>
            <div><label className={labelClass}>Next Action</label><input name="next_action" value={form.next_action ?? ""} onChange={handleChange} className={inputClass} placeholder="e.g. Call to confirm Thursday session" /></div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleSave} disabled={saving} className="bg-green-500 text-black font-semibold px-5 py-2 rounded-full hover:bg-green-400 disabled:opacity-50 transition-colors text-sm">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setForm({ ...contact }); }} className="border border-white/10 text-zinc-400 px-5 py-2 rounded-full hover:text-white transition-colors text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/2 overflow-hidden mb-4">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Details</p>
            <button onClick={() => setEditing(true)} className="text-xs text-zinc-500 hover:text-white transition-colors font-medium">Edit</button>
          </div>
          <div className="px-5">
            <Field label="Age" value={contact.age} />
            <Field label="Program" value={contact.program} />
            <Field label="Session Times" value={contact.session_times} />
            <Field label="Address" value={contact.address} />
            {contact.next_action && <Field label="Next Action" value={contact.next_action} />}
          </div>
        </div>
      )}

      {/* Delete */}
      <div className="flex justify-end mt-2">
        {confirmDelete ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">Delete this contact?</span>
            <button onClick={handleDelete} disabled={deleting} className="text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50">
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors font-medium">
            Delete contact
          </button>
        )}
      </div>
    </>
  );
}
