'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConvertToSquadButton({
  leadId,
  initialInSquad,
}: {
  leadId: string;
  initialInSquad: boolean;
}) {
  const [inSquad, setInSquad] = useState(initialInSquad);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function convert() {
    if (converting || inSquad) return;
    setConverting(true);
    setError(null);

    try {
      const res = await fetch(`/api/leads/${leadId}/convert`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { error?: string; alreadyConverted?: boolean };

      if (!res.ok) {
        setError(data.error ?? `Server error (${res.status})`);
      } else {
        setInSquad(true);
        router.refresh();
      }
    } catch {
      setError('Network error — check your connection');
    }
    setConverting(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={convert}
        disabled={converting || inSquad}
        className={`inline-flex items-center gap-2 font-semibold px-6 py-2.5 rounded-full text-sm transition-colors disabled:cursor-not-allowed ${
          inSquad
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 opacity-90'
            : 'border border-white/10 text-zinc-300 hover:border-white/20 hover:text-white disabled:opacity-50'
        }`}
      >
        {inSquad ? 'In Squad ✓' : converting ? 'Adding…' : 'Add to Squad'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
