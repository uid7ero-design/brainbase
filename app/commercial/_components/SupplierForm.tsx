'use client';
import { useState } from 'react';
import { Field, lbl } from './CustomerForm';

type Supplier = {
  id?: string; name?: string; legalName?: string | null; contactName?: string | null;
  email?: string | null; phone?: string | null; billingAddress?: string | null;
  taxBusinessNumber?: string | null; supplierReference?: string | null;
  paymentTermsDays?: number | null; notes?: string | null;
};

// Phase C6.3 — mirrors app/commercial/_components/CustomerForm.tsx's
// shape closely, with two deliberate differences:
//   1. Update uses PATCH, not PUT — app/api/commercial/suppliers/[id]/route.ts
//      exposes GET+PATCH only (this gate's Section D route list has no
//      PUT for suppliers), unlike customers' dedicated full-replace PUT.
//   2. CRM company/contact linkage (crmCompanyId/crmContactId) is
//      omitted from this form — the API/domain layer already accepts
//      both fields untouched, but a real CRM company/contact picker is
//      substantial, unrelated UI scope per this gate's own Section F
//      allowance ("if CRM link UX is substantial unrelated scope, leave
//      API/domain-compatible but omit from C6.3 UI"). A supplier can
//      still be linked to a CRM company/contact later via direct API use
//      or a future phase without any schema/domain change.
export default function SupplierForm({ initial, onSaved }: { initial?: Supplier; onSaved: (s: Supplier) => void }) {
  const [form, setForm] = useState<Supplier>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof Supplier) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) { setError('Supplier name is required.'); return; }
    setSaving(true); setError('');
    const method = initial?.id ? 'PATCH' : 'POST';
    const url = initial?.id ? `/api/commercial/suppliers/${initial.id}` : '/api/commercial/suppliers';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        paymentTermsDays: form.paymentTermsDays === undefined || form.paymentTermsDays === null || (form.paymentTermsDays as unknown as string) === ''
          ? null : Number(form.paymentTermsDays),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Save failed.'); setSaving(false); return; }
    onSaved(data.supplier);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field label="Supplier Name *" value={form.name ?? ''} onChange={set('name')} required />
      <Field label="Legal Name" value={form.legalName ?? ''} onChange={set('legalName')} />
      <Field label="Contact Name" value={form.contactName ?? ''} onChange={set('contactName')} />
      <Field label="Email" value={form.email ?? ''} onChange={set('email')} placeholder="accounts@supplier.com" />
      <Field label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
      <Field label="Address" value={form.billingAddress ?? ''} onChange={set('billingAddress')} />
      <Field label="Tax / Business Number" value={form.taxBusinessNumber ?? ''} onChange={set('taxBusinessNumber')} placeholder="ABN, GST number, ..." />
      <Field label="Supplier Reference" value={form.supplierReference ?? ''} onChange={set('supplierReference')} placeholder="Your account/reference number with this supplier" />
      <div>
        <label style={lbl}>Payment Terms (days)</label>
        <input value={form.paymentTermsDays ?? ''} onChange={e => setForm(f => ({ ...f, paymentTermsDays: e.target.value === '' ? null : Number(e.target.value) }))}
          inputMode="numeric" placeholder="e.g. 30"
          style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <label style={lbl}>Notes</label>
        <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
          style={{ width: '100%', padding: '9px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
      <button type="submit" disabled={saving} style={{ padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Create Supplier'}
      </button>
    </form>
  );
}
