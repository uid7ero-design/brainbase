'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import SlidePanel from '../../../_components/SlidePanel';
import SupplierForm from '../../../_components/SupplierForm';
import { Badge, PageHeader, StateMessage, buttonProps } from '@/components/ui/app';

type Supplier = {
  id: string; name: string; legal_name: string | null; contact_name: string | null;
  email: string | null; phone: string | null; billing_address: string | null;
  tax_business_number: string | null; supplier_reference: string | null;
  payment_terms_days: number | null; notes: string | null; active: boolean; created_at: string;
};

// Client-side role check only — UX gating, not enforcement. The real
// floor is authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit)
// inside app/api/commercial/suppliers/[id]/route.ts's PATCH handler.
// Mirrors app/commercial/invoices/[id]/page.tsx's own clientRoleGte exactly.
const CLIENT_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'];
function clientRoleGte(role: string | undefined, min: string): boolean {
  if (!role) return false;
  const i = CLIENT_ROLE_ORDER.indexOf(role);
  const m = CLIENT_ROLE_ORDER.indexOf(min);
  return i !== -1 && m !== -1 && i >= m;
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [hasPurchasing, setHasPurchasing] = useState(false);

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([fetch(`/api/commercial/suppliers/${id}`), fetch('/api/me')]);
    if (res.ok) setSupplier((await res.json()).supplier);
    if (meRes.ok) {
      const me = await meRes.json();
      setCanEdit(clientRoleGte(me.role, 'manager'));
      const keys = new Set((me.enabledCapabilities ?? []).map((c: { key: string }) => c.key));
      setHasPurchasing(keys.has('purchasing'));
    }
    setLoading(false);
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function toggleActive() {
    if (!supplier) return;
    await fetch(`/api/commercial/suppliers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !supplier.active }),
    });
    load();
  }

  if (loading) return <StateMessage kind="loading" title="Loading supplier…" size="page" />;
  if (!supplier) {
    return (
      <StateMessage kind="empty" size="page" title="Supplier not found." action={<Link href="/commercial/purchasing/suppliers">Back to suppliers</Link>} />
    );
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <PageHeader
        eyebrow={<Link href="/commercial/purchasing/suppliers">← Suppliers</Link>}
        title={supplier.name}
        meta={<Badge state={supplier.active ? 'active' : 'inactive'}>{supplier.active ? 'Active' : 'Inactive'}</Badge>}
        actions={canEdit ? (
          <>
            <button type="button" onClick={() => setShowEdit(true)} {...buttonProps('secondary')}>Edit</button>
            <button type="button" onClick={toggleActive} {...buttonProps('secondary')}>
              {supplier.active ? 'Deactivate' : 'Reactivate'}
            </button>
            {hasPurchasing && <Link href={`/commercial/purchasing/purchase-orders/new?supplierId=${supplier.id}`} {...buttonProps('primary')}>New Purchase Order</Link>}
          </>
        ) : undefined}
      />

      <dl style={{ margin: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
        <Row label="Status" value={supplier.active ? 'Active' : 'Inactive'} />
        <Row label="Legal Name" value={supplier.legal_name} />
        <Row label="Contact Name" value={supplier.contact_name} />
        <Row label="Email" value={supplier.email} />
        <Row label="Phone" value={supplier.phone} />
        <Row label="Address" value={supplier.billing_address} />
        <Row label="Tax / Business Number" value={supplier.tax_business_number} />
        <Row label="Supplier Reference" value={supplier.supplier_reference} />
        <Row label="Payment Terms" value={supplier.payment_terms_days != null ? `${supplier.payment_terms_days} days` : null} />
        <Row label="Notes" value={supplier.notes} />
      </dl>

      <SlidePanel open={showEdit} onClose={() => setShowEdit(false)} title="Edit Supplier">
        <SupplierForm
          initial={{
            id: supplier.id, name: supplier.name, legalName: supplier.legal_name, contactName: supplier.contact_name,
            email: supplier.email, phone: supplier.phone, billingAddress: supplier.billing_address,
            taxBusinessNumber: supplier.tax_business_number, supplierReference: supplier.supplier_reference,
            paymentTermsDays: supplier.payment_terms_days, notes: supplier.notes,
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
