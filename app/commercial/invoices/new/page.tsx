'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CustomerForm from '../../_components/CustomerForm';
import { Field, lbl, sel } from '../../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadCustomers() {
    const res = await fetch('/api/commercial/customers');
    if (res.ok) setCustomers((await res.json()).customers.filter((c: Customer) => c.active));
  }

  // Mirrors app/commercial/quotes/new/page.tsx's identical, pre-existing pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCustomers(); }, []);

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
    if (!customerId) { setError('Select or create a customer first.'); return; }
    setSaving(true); setError('');
    const res = await fetch('/api/commercial/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        dueDate: dueDate || null,
        paymentTermsDays: paymentTermsDays ? Number(paymentTermsDays) : null,
        notes: notes || null,
        terms: terms || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create invoice.'); setSaving(false); return; }
    router.push(`/commercial/invoices/${data.invoice.id}`);
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <Link href="/commercial/invoices" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Invoices</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '16px 0 24px' }}>New Invoice</h1>

      <form onSubmit={submit} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={lbl}>Customer *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={sel}>
              <option value="">— Select a customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={() => setShowNewCustomer(true)} style={{ padding: '9px 14px', background: '#1f2937', color: '#f9fafb', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + New
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Payment Terms (days)</label>
            <input value={paymentTermsDays} onChange={e => applyTermsSuggestion(e.target.value)} style={sel} placeholder="e.g. 14" inputMode="numeric" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Due Date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '-8px 0 0' }}>
          Due date can be left blank for now, but must be set before this invoice can be issued.
        </p>
        <div>
          <label style={lbl}>Notes (internal)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div>
          <label style={lbl}>Terms (shown on the invoice)</label>
          <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} placeholder="Payment instructions, ..." />
        </div>
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Creating…' : 'Create Draft — add line items next'}
        </button>
      </form>

      <SlidePanel open={showNewCustomer} onClose={() => setShowNewCustomer(false)} title="New Customer">
        <CustomerForm onSaved={async (c) => { setShowNewCustomer(false); await loadCustomers(); if (c.id) setCustomerId(c.id); }} />
      </SlidePanel>
    </div>
  );
}
