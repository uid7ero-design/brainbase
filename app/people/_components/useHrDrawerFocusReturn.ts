'use client';
import { useEffect, useRef } from 'react';

/** Drawer close refreshes replace rows, so restore focus after the new view settles. */
export function useHrDrawerFocusReturn(personId: string | null, ready: boolean) {
  const previous = useRef<string | null>(null);
  const pending = useRef<{ id: string; loading: boolean } | null>(null);
  useEffect(() => {
    if (personId) pending.current = null;
    else if (previous.current) pending.current = { id: previous.current, loading: false };
    previous.current = personId;
    if (!pending.current) return;
    if (!ready) { pending.current.loading = true; return; }
    if (!pending.current.loading) return;
    const id = pending.current.id;
    pending.current = null;
    // Respect keyboard/pointer navigation performed while the refreshed view loads.
    if (document.activeElement && document.activeElement !== document.body) return;
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-hr-person-id]'))
      .find(button => button.dataset.hrPersonId === id);
    const fallback = document.querySelector<HTMLButtonElement>('button[data-hr-register-refresh]');
    (row ?? fallback)?.focus();
  }, [personId, ready]);
}
