'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button, Field, fieldControlClassName } from '@/components/ui/app';

export function StartReceipt({ month, path }: { month: string; path: string }) {
  return <Button type="button" onClick={() => {
    window.location.assign(path + '?month=' + month + '&entry=' + crypto.randomUUID());
  }}>Record a paid expense</Button>;
}

export default function ReceiptForm({ id, today, api, organisationId }: { id: string; today: string; api: string; organisationId: string }) {
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || uncertain) return;
    const form = new FormData(event.currentTarget);
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(form), id, expectedOrganisationId: organisationId }), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (response.status === 400 || response.status === 403 || response.status === 401) {
        setError(result.error || 'Receipt could not be recorded.');
        sending.current = false;
        setBusy(false);
        return;
      }
      if (!response.ok || result.id !== id) throw new Error();
      window.location.reload();
    } catch {
      setUncertain(true);
      setBusy(false);
      setError('The save could not be confirmed. Check this entry for the saved receipt.');
    }
  }
  return <form onSubmit={submit} className="grid gap-4 max-w-xl">
    <fieldset disabled={busy || uncertain} className="grid gap-4">
      <Field label="Purchase date">{props => <input {...props} className={fieldControlClassName} name="date" type="date" min="2000-01-01" max={today} defaultValue={today} required />}</Field>
      <Field label="Merchant">{props => <input {...props} className={fieldControlClassName} name="merchant" maxLength={160} required />}</Field>
      <Field label="What was purchased?">{props => <input {...props} className={fieldControlClassName} name="description" maxLength={300} required />}</Field>
      <Field label="Receipt total (AUD)">{props => <input {...props} className={fieldControlClassName} name="amount" inputMode="decimal" placeholder="24.95" required />}</Field>
      <Field label="Receipt number (optional)">{props => <input {...props} className={fieldControlClassName} name="reference" maxLength={100} />}</Field>
      <Button type="submit">{busy ? 'Saving receipt…' : 'Record paid expense'}</Button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {uncertain && <Button type="button" onClick={() => window.location.reload()}>Check saved receipt</Button>}
  </form>;
}
