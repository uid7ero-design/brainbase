'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CustomerForm from '../../_components/CustomerForm';
import CoachingInvoicePreparation from '../../_components/CoachingInvoicePreparation';
import { Field } from '../../_components/CustomerForm';
import { Field as AppField, FormActions, FormError, PageHeader, buttonProps, fieldControlClassName } from '@/components/ui/app';

import { useDraftCreation } from '../../_components/useDraftCreation';

type Customer = { id: string; name: string; active: boolean };

// Phase C4.2 §12 — mirrors app/commercial/quotes/new/page.tsx's own
// deliberate two-step flow exactly (create the DRAFT header only; lines
// are added on the detail page once the invoice row actually exists —
// every line-mutation API requires a real invoiceId, and there is no
// unsaved-draft client-side staging model anywhere in this codebase to
// build one for here).
//
// paymentTermsDays is offered only as a convenience to COMPUTE a
// suggested due date client-side — it is never silently applied. The
// user always sees and can edit the resulting due_date directly before
// saving, and whatever due_date value is submitted is exactly what the
// server persists (lib/commercial/invoices.ts's createDraftInvoice()
// stores due_date and payment_terms_days as independent, explicit
// values — neither is ever defaulted for the caller).
export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') ?? '');
  const [dueDate, setDueDate] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const draft = useDraftCreation('invoice');
  const { saving, error, setError } = draft;
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(true);
  const requestNumber = useRef(0);

  async function loadCustomers() {
    const request = ++requestNumber.current;
    setReading(true); setReadError(''); setCustomers([]);
    try {
      const res = await fetch('/api/commercial/customers', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = res.ok ? await res.json() : null;
      if (!Array.isArray(data?.customers)) throw new Error();
      if (request === requestNumber.current) setCustomers(data.customers.filter((c: Customer) => c.active));
    } catch { if (request === requestNumber.current) setReadError('Saved choices could not be loaded. Retry before creating a draft.'); }
    finally { if (request === requestNumber.current) setReading(false); }
  }

  // Mirrors app/commercial/quotes/new/page.tsx's identical, pre-existing pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCustomers(); const currentRequest = requestNumber; return () => { currentRequest.current++; }; }, []);

  // Suggests (never silently sets) a due date from "today + N days" —
  // the resulting value lands in the same editable due-date field the
  // user can override or clear, exactly like typing a date directly.
  function applyTermsSuggestion(days: string) {
    setPaymentTermsDays(days);
    const n = Number(days);
    if (Number.isInteger(n) && n > 0) {
      const d = new Date();
      d.setDate(d.getDate() + n);
      setDueDate(d.toISOString().slice(0, 10));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (draft.blocked || reading || readError) return;
    if (!customers.some(row => row.id === customerId)) { setError('Select or create a customer first.'); return; }
    await draft.create('/api/commercial/invoices', {
      customerId, dueDate: dueDate || null,
      paymentTermsDays: paymentTermsDays ? Number(paymentTermsDays) : null,
      notes: notes || null, terms: terms || null,
    }, id => router.push(`/commercial/invoices/${id}`));
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <PageHeader eyebrow={<Link href="/commercial/invoices">← Invoices</Link>} title="New Invoice" />

      {(searchParams.has('coachingDate') || searchParams.has('coachingBooking')) && <CoachingInvoicePreparation
        key={`${searchParams.get('coachingDate')}:${searchParams.get('coachingBooking')}:${searchParams.get('coachingAfter')}`}
        occurrenceId={searchParams.get('coachingDate') ?? ''} bookingId={searchParams.get('coachingBooking') ?? ''}
        after={searchParams.get('coachingAfter')} onUseNotes={value=>setNotes(current=>current ? `${current}\n\n${value}`:value)} />}

      {readError && <p role="alert">{readError} <button type="button" disabled={reading} onClick={loadCustomers}>Retry saved choices</button></p>}
      {draft.recovery}
      <form onSubmit={submit} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AppField label="Customer" required>
          {control => (
            <div style={{ display: 'flex', gap: 8 }}>
              <select {...control} disabled={draft.blocked || reading || !!readError} value={customerId} onChange={e => setCustomerId(e.target.value)} className={fieldControlClassName}>
                <option value="">— Select a customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewCustomer(true)} {...buttonProps('secondary')} aria-label="Create a new customer" style={{ whiteSpace: 'nowrap' }}>
                + New
              </button>
            </div>
          )}
        </AppField>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <AppField label="Payment Terms (days)">
              {control => (
                <input {...control} value={paymentTermsDays} onChange={e => applyTermsSuggestion(e.target.value)} className={fieldControlClassName} placeholder="e.g. 14" inputMode="numeric" />
              )}
            </AppField>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Due Date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '-8px 0 0' }}>
          Due date can be left blank for now, but must be set before this invoice can be issued.
        </p>
        <AppField label="Notes (internal)">
          {control => (
            <textarea {...control} value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={fieldControlClassName} />
          )}
        </AppField>
        <AppField label="Terms (shown on the invoice)">
          {control => (
            <textarea {...control} value={terms} onChange={e => setTerms(e.target.value)} rows={3} className={fieldControlClassName} placeholder="Payment instructions, ..." />
          )}
        </AppField>
        {error && <FormError>{error}</FormError>}
        <FormActions align="stretch">
          <button type="submit" disabled={draft.blocked || reading || !!readError} {...buttonProps('primary')}>
            {saving ? 'Creating…' : 'Create Draft — add line items next'}
          </button>
        </FormActions>
      </form>

      <SlidePanel open={showNewCustomer} onClose={() => setShowNewCustomer(false)} title="New Customer">
        <CustomerForm onSaved={async (c) => { setShowNewCustomer(false); await loadCustomers(); if (c.id) setCustomerId(c.id); }} />
      </SlidePanel>
    </div>
  );
}
