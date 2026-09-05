'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CustomerForm from '../../_components/CustomerForm';
import { Field, lbl, sel } from '../../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Customer = { id: string; name: string; active: boolean };

// Phase C3 — deliberately a two-step flow, not a single unsaved-staging
// page: this screen creates the DRAFT header only (customer + notes/
// terms/expiry); adding lines happens on /commercial/quotes/[id] once
// the quote row actually exists. Every line-mutation API
// (lib/commercial/quotes.ts's addQuoteLine/updateQuoteLine/
// deleteQuoteLine) already requires a real quoteId, and there is no
// unsaved-draft client-side model anywhere else in this codebase to copy
// for staging lines before a row exists — building one would be new,
// unproven complexity for a single screen. The result is one extra
// click (create draft, then add lines) in exchange for reusing the exact
// same detail-page line-editing UI a user returns to for every
// subsequent edit anyway.
export default function NewQuotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') ?? '');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadCustomers() {
    const res = await fetch('/api/commercial/customers');
    if (res.ok) setCustomers((await res.json()).customers.filter((c: Customer) => c.active));
  }

  useEffect(() => { loadCustomers(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { setError('Select or create a customer first.'); return; }
    setSaving(true); setError('');
    const res = await fetch('/api/commercial/quotes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, notes: notes || null, terms: terms || null, expiryDate: expiryDate || null }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create quote.'); setSaving(false); return; }
    router.push(`/commercial/quotes/${data.quote.id}`);
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <Link href="/commercial/quotes" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Quotes</Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '16px 0 24px' }}>New Quote</h1>

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
        <Field label="Expiry Date" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
        <div>
          <label style={lbl}>Notes (internal)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div>
          <label style={lbl}>Terms (shown on the quote)</label>
          <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} style={{ ...sel, resize: 'vertical', lineHeight: 1.5 }} placeholder="Payment terms, validity, ..." />
        </div>
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Creating…' : 'Create Draft — add products next'}
        </button>
      </form>

      <SlidePanel open={showNewCustomer} onClose={() => setShowNewCustomer(false)} title="New Customer">
        <CustomerForm onSaved={async (c) => { setShowNewCustomer(false); await loadCustomers(); if (c.id) setCustomerId(c.id); }} />
      </SlidePanel>
    </div>
  );
}
