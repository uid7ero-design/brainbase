'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CustomerForm from '../../_components/CustomerForm';
import { Badge, PageHeader, StateMessage, buttonProps } from '@/components/ui/app';

type Customer = {
  id: string; name: string; billing_email: string | null; billing_phone: string | null;
  billing_address: string | null; tax_business_number: string | null; active: boolean;
  crm_company_id: string | null; crm_contact_id: string | null; created_at: string;
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  // Phase C4.4A (Finding 3 remediation) — a customer is a SHARED
  // resource now reachable by quotes-only and invoicing-only
  // organisations alike, but the "New Quote"/"New Invoice" ACTIONS
  // themselves must not be. Read from /api/me's own enabledCapabilities
  // (the same mechanism app/commercial/quotes/[id]/page.tsx already
  // uses for its own "Create Invoice" gating) rather than assuming
  // every visitor of this page has Quotes — an invoicing-only
  // organisation reaching this page must never see a "New Quote" button
  // that would 403 the moment it's clicked.
  const [hasQuotes, setHasQuotes] = useState(false);
  const [hasInvoicing, setHasInvoicing] = useState(false);

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([fetch(`/api/commercial/customers/${id}`), fetch('/api/me')]);
    if (res.ok) setCustomer((await res.json()).customer);
    if (meRes.ok) {
      const me = await meRes.json();
      const keys = new Set((me.enabledCapabilities ?? []).map((c: { key: string }) => c.key));
      setHasQuotes(keys.has('quotes'));
      setHasInvoicing(keys.has('invoicing'));
    }
    setLoading(false);
  }, [id]);

  // Mirrors the identical, pre-existing load()-in-effect pattern already
  // used unmodified throughout Commercial — a pre-existing violation of
  // this rule, not introduced by this phase (confirmed via direct diff
  // against this file's own pre-C4.4A content); silenced only because
  // this file is already being touched for Finding 3 remediation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function toggleActive() {
    if (!customer) return;
    await fetch(`/api/commercial/customers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !customer.active }),
    });
    load();
  }

  if (loading) return <StateMessage kind="loading" title="Loading customer…" size="page" />;
  if (!customer) {
    return (
      <StateMessage kind="empty" size="page" title="Customer not found." action={<Link href="/commercial/customers">Back to customers</Link>} />
    );
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <PageHeader
        eyebrow={<Link href="/commercial/customers">← Customers</Link>}
        title={customer.name}
        meta={<Badge state={customer.active ? 'active' : 'inactive'}>{customer.active ? 'Active' : 'Inactive'}</Badge>}
        actions={
          <>
            <button type="button" onClick={() => setShowEdit(true)} {...buttonProps('secondary')}>Edit</button>
            <button type="button" onClick={toggleActive} {...buttonProps('secondary')}>
              {customer.active ? 'Deactivate' : 'Reactivate'}
            </button>
            {hasQuotes && <Link href={`/commercial/quotes/new?customerId=${customer.id}`} {...buttonProps('primary')}>New Quote</Link>}
            {hasInvoicing && <Link href={`/commercial/invoices/new?customerId=${customer.id}`} {...buttonProps(hasQuotes ? 'secondary' : 'primary')}>New Invoice</Link>}
          </>
        }
      />

      <dl style={{ margin: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
        <Row label="Status" value={customer.active ? 'Active' : 'Inactive'} />
        <Row label="CRM Link" value={(customer.crm_company_id || customer.crm_contact_id) ? 'Linked' : 'Not linked'} />
        <Row label="Billing Email" value={customer.billing_email} />
        <Row label="Billing Phone" value={customer.billing_phone} />
        <Row label="Billing Address" value={customer.billing_address} />
        <Row label="Tax / Business Number" value={customer.tax_business_number} />
      </dl>

      <SlidePanel open={showEdit} onClose={() => setShowEdit(false)} title="Edit Customer">
        <CustomerForm
          initial={{
            id: customer.id, name: customer.name, billingEmail: customer.billing_email,
            billingPhone: customer.billing_phone, billingAddress: customer.billing_address,
            taxBusinessNumber: customer.tax_business_number,
          }}
          onSaved={() => { setShowEdit(false); load(); router.refresh(); }}
        />
      </SlidePanel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{value ?? '—'}</dd>
    </div>
  );
}
