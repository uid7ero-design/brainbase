'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const inFlight = new Set<string>();

/** A lost response is not permission to repeat a financial write. No draft data is stored. */
export function useDraftCreation(kind: 'invoice' | 'supplierBill') {
  const key = `brainbase:commercial:${kind}:unconfirmed`;
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const confirmed = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setUncertain(!!sessionStorage.getItem(key)); } catch { setUncertain(true); }
    setReady(true);
  }, [key]);
  async function create(url: string, body: unknown, onSaved: (id: string) => void) {
    if (!ready || confirmed.current || busy.current || uncertain || inFlight.has(key)) return;
    try { if (sessionStorage.getItem(key)) { setUncertain(true); return; } } catch { setUncertain(true); return; }
    busy.current = true; inFlight.add(key); setSaving(true); setError('');
    try {
      sessionStorage.setItem(key, '1');
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) throw new Error();
        sessionStorage.removeItem(key);
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? 'Draft creation was refused. Review the details before trying again.');
        return;
      }
      const data = await response.json();
      const id = data[kind]?.id;
      if (typeof id !== 'string' || !id) throw new Error();
      sessionStorage.removeItem(key); confirmed.current = true; onSaved(id);
    } catch {
      setUncertain(true);
      setError('The draft may have been saved. Review the saved records before creating another.');
    } finally { busy.current = false; inFlight.delete(key); setSaving(false); }
  }
  async function unlock() {
    if (inFlight.has(key) || busy.current) return;
    setSaving(true);
    try {
      const path = kind === 'invoice' ? 'invoices' : 'supplier-bills';
      const response = await fetch(`/api/commercial/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = response.ok ? await response.json() : null;
      if (!Array.isArray(data?.[kind === 'invoice' ? 'invoices' : 'supplierBills'])) throw new Error();
      sessionStorage.removeItem(key); setUncertain(false); setError('');
    } catch { setError('Saved records could not be confirmed. Creation remains locked.'); }
    finally { setSaving(false); }
  }
  const href = kind === 'invoice' ? '/commercial/invoices' : '/commercial/purchasing/supplier-bills';
  return { create, saving, error, setError, blocked: !ready || saving || uncertain,
    recovery: uncertain ? <section aria-label="Review uncertain draft"><p role="alert">Creation is locked to avoid a duplicate. Open the saved records and continue the existing draft if it is present. Only unlock after checking that another draft is needed.</p><Link href={href} target="_blank" rel="noopener noreferrer">Review saved records (new tab)</Link><p><button type="button" disabled={saving} onClick={unlock}>I checked saved records — allow a new draft</button></p></section> : null };
}
