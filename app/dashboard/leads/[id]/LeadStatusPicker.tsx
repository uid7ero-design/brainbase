'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = [
  { value: 'new',       label: 'New',       cls: 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' },
  { value: 'contacted', label: 'Contacted', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20' },
  { value: 'booked',    label: 'Booked',    cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20' },
  { value: 'closed',    label: 'Closed',    cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 hover:bg-zinc-500/20' },
];

export default function LeadStatusPicker({ leadId, currentStatus }: { leadId: string; currentStatus: string }) {
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function update(next: string) {
    if (next === status || saving) return;
    setSaving(true);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      setStatus(next);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/2 p-5 mb-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Status</p>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <button
            key={s.value}
            onClick={() => update(s.value)}
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
  );
}
