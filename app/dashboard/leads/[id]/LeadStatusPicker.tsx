'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = [
  { value: 'new',         label: 'New',         cls: 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' },
  { value: 'contacted',   label: 'Contacted',   cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20' },
  { value: 'in_progress', label: 'In Progress', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20' },
  { value: 'booked',      label: 'Booked',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20' },
  { value: 'closed',      label: 'Closed',      cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 hover:bg-zinc-500/20' },
];

export default function LeadStatusPicker({
  leadId,
  currentStatus,
  currentNotes,
}: {
  leadId: string;
  currentStatus: string;
  currentNotes?: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState(currentNotes ?? '');
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const dirty = status !== currentStatus || note !== (currentNotes ?? '');

  async function save() {
    if (saving) return;
    setSaving(true);
    const body: Record<string, unknown> = { note };
    if (status !== currentStatus) body.status = status;
    if (notify) body.notify = true;

    const res = await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setSaved(true);
      setNotify(false);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/2 p-5 mb-6 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Status</p>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              disabled={saving}
              className={`text-xs font-semibold px-4 py-1.5 rounded-full border capitalize transition-all disabled:opacity-50 ${
                status === s.value
                  ? s.cls + ' ring-1 ring-offset-1 ring-offset-black/80 ring-white/20 scale-105'
                  : 'bg-white/4 text-zinc-500 border-white/8 hover:border-white/16 hover:text-zinc-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Note</p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note for the client..."
          rows={3}
          className="w-full bg-white/4 border border-white/8 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/20 resize-none"
        />
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            onClick={() => setNotify(v => !v)}
            className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${notify ? 'bg-green-500' : 'bg-white/10'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notify ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-zinc-400">Notify client by email</span>
        </label>

        <button
          onClick={save}
          disabled={saving || (!dirty && !notify)}
          className="text-sm font-semibold px-5 py-2 rounded-full bg-green-500 text-black hover:bg-green-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Update'}
        </button>
      </div>
    </div>
  );
}
