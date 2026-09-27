'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonProps } from '@/components/ui/app';
import styles from '../Leads.module.css';

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
    <div className={styles.convert}>
      <button
        type="button"
        onClick={convert}
        disabled={converting || inSquad}
        {...buttonProps('secondary')}
        data-in-squad={inSquad ? 'true' : undefined}
      >
        {inSquad ? 'In Squad ✓' : converting ? 'Adding…' : 'Add to Squad'}
      </button>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
    </div>
  );
}
