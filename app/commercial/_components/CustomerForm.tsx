'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Field as AppField, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';

type Customer = {
  id?: string; name?: string; billingEmail?: string | null; billingPhone?: string | null;
  billingAddress?: string | null; taxBusinessNumber?: string | null;
  crmCompanyId?: string | null; crmContactId?: string | null;
};

const CUSTOMER_LOCK = 'brainbase:commercial:customer-unconfirmed';
// Shared across drawer remounts in this tab. A newly opened drawer cannot
// clear the recovery marker while the previous drawer's write is still running.
let customerWritesInFlight = 0;
type ContactChoice = { id: string; first_name: string; last_name: string; email: string | null };
export default function CustomerForm({ initial, onSaved, onReview }: { initial?: Customer; onSaved: (c: Customer) => void; onReview?: () => void }) {
  const [form, setForm] = useState<Customer>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const [contacts, setContacts] = useState<ContactChoice[]>([]);
  const [contactError, setContactError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    // Restore only a non-personal recovery marker after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { if (sessionStorage.getItem(CUSTOMER_LOCK)) setUncertain(true); } catch { setUncertain(true); }
    void (async () => { try {
      const response = await fetch('/api/crm/contacts', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (!Array.isArray(data.contacts)) throw new Error();
      if (active) setContacts(data.contacts);
    } catch { if (active) setContactError('CRM contacts are unavailable. Existing links are preserved; you can enter billing details directly.'); } })();
    return () => { active = false; controller.abort(); };
  }, []);

  const set = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || uncertain || customerWritesInFlight) return;
    try { if (sessionStorage.getItem(CUSTOMER_LOCK)) { setUncertain(true); return; } } catch { setUncertain(true); return; }
    if (!form.name?.trim()) { setError('Customer name is required.'); return; }
    busy.current = true; setSaving(true); setError('');
    const method = initial?.id ? 'PUT' : 'POST';
    const url = initial?.id ? `/api/commercial/customers/${initial.id}` : '/api/commercial/customers';
    try {
      sessionStorage.setItem(CUSTOMER_LOCK, '1');
      customerWritesInFlight++;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        if (res.status >= 500 || res.status === 408) throw new Error();
        sessionStorage.removeItem(CUSTOMER_LOCK); const data = await res.json().catch(() => ({})); setError(data.error ?? 'Save refused.'); return;
      }
      const data = await res.json(); if (typeof data.customer?.id !== 'string') throw new Error();
      sessionStorage.removeItem(CUSTOMER_LOCK); onSaved(data.customer);
    } catch { setUncertain(true); setError('The customer save could not be confirmed. Review saved billing customers before repeating it.'); }
    finally { customerWritesInFlight = Math.max(0, customerWritesInFlight - 1); busy.current = false; setSaving(false); }
  }
  async function review() {
    if (customerWritesInFlight) { setError('The previous save is still running. Wait for it to finish before reviewing.'); return; }
    if (busy.current) return; busy.current = true; setSaving(true);
    try {
      const response = await fetch('/api/commercial/customers', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok || !Array.isArray((await response.json()).customers)) throw new Error();
      sessionStorage.removeItem(CUSTOMER_LOCK); setUncertain(false); setError(''); onReview?.();
    } catch { setError('Saved billing customers are unavailable. The save remains locked.'); }
    finally { busy.current = false; setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <fieldset disabled={saving || uncertain} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
      <AppField label="Linked CRM billing contact" helper="Choose the person or organisation contact responsible for payment. This does not merge player records.">
        {control => <select {...control} className={fieldControlClassName} value={form.crmContactId ?? ''} disabled={!!contactError} onChange={event => setForm(value => ({ ...value, crmContactId: event.target.value || null }))}>
          <option value="">No CRM contact linked</option>
          {form.crmContactId && !contacts.some(contact => contact.id === form.crmContactId) && <option value={form.crmContactId}>Current linked contact</option>}
          {contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.first_name} {contact.last_name}{contact.email ? ` — ${contact.email}` : ''}</option>)}
        </select>}
      </AppField>
      {contactError && <p>{contactError}</p>}
      <Field label="Customer Name" value={form.name ?? ''} onChange={set('name')} required />
      <Field label="Billing Email" value={form.billingEmail ?? ''} onChange={set('billingEmail')} placeholder="billing@customer.com" />
      <Field label="Billing Phone" value={form.billingPhone ?? ''} onChange={set('billingPhone')} />
      <Field label="Billing Address" value={form.billingAddress ?? ''} onChange={set('billingAddress')} />
      <Field label="Tax / Business Number" value={form.taxBusinessNumber ?? ''} onChange={set('taxBusinessNumber')} placeholder="ABN, GST number, ..." />
      {error && <FormError>{error}</FormError>}
      <FormActions align="stretch">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Customer'}
        </Button>
      </FormActions>
      </fieldset>
      {uncertain && <><p role="alert">Review saved billing customers before making another change.</p><Button type="button" disabled={saving} onClick={review}>Review saved billing customers</Button></>}
    </form>
  );
}

/**
 * Labelled single-line text input on the shared Field contract. Kept as a
 * named export because the other Commercial forms reuse it.
 */
export function Field({ label, value, onChange, required, placeholder, type }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <AppField label={label} required={required}>
      {control => (
        <input {...control} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder}
          className={fieldControlClassName} />
      )}
    </AppField>
  );
}
