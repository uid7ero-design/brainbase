'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../_components/SlidePanel';
import CustomerForm from '../../_components/CustomerForm';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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

  const load = useCallback(async () => {
    const res = await fetch(`/api/commercial/customers/${id}`);
    if (res.ok) setCustomer((await res.json()).customer);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive() {
    if (!customer) return;
    await fetch(`/api/commercial/customers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !customer.active }),
    });
    load();
  }

  if (loading) return <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>;
  if (!customer) return <div style={{ color: '#6b7280', fontSize: 14 }}>Customer not found.</div>;

  return (
    <div style={{ maxWidth: 700 }}>
      <Link href="/commercial/customers" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Customers</Link>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 24px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{customer.name}</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowEdit(true)} style={btn('#1f2937')}>Edit</button>
          <button onClick={toggleActive} style={btn(customer.active ? 'rgba(239,68,68,0.15)' : 'rgba(74,222,128,0.15)', customer.active ? '#f87171' : '#4ade80')}>
            {customer.active ? 'Deactivate' : 'Reactivate'}
          </button>
          <Link href={`/commercial/quotes/new?customerId=${customer.id}`} style={{ ...btn('#1a6aff'), textDecoration: 'none', display: 'inline-block' }}>New Quote</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Row label="Status" value={customer.active ? 'Active' : 'Inactive'} />
        <Row label="CRM Link" value={(customer.crm_company_id || customer.crm_contact_id) ? 'Linked' : 'Not linked'} />
        <Row label="Billing Email" value={customer.billing_email} />
        <Row label="Billing Phone" value={customer.billing_phone} />
        <Row label="Billing Address" value={customer.billing_address} />
        <Row label="Tax / Business Number" value={customer.tax_business_number} />
      </div>

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
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: value ? '#f9fafb' : '#4b5563' }}>{value ?? '—'}</div>
    </div>
  );
}

function btn(bg: string, color = '#fff'): React.CSSProperties {
  return { padding: '8px 16px', background: bg, color, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
}
