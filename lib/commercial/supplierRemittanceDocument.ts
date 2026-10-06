import 'server-only';
import sql from '@/lib/db';

export interface SupplierRemittanceDocument {
  payment_id: string;
  organisation_name: string;
  supplier_name: string;
  amount_cents: string;
  currency: string;
  method: string;
  reference: string | null;
  paid_at: string;
  status: 'RECORDED' | 'REVERSED';
  reversed_at: string | null;
  reversal_reason: string | null;
  allocations: Array<{ bill_id: string; bill_number: string | null; supplier_invoice_number: string; allocated_amount_cents: string }>;
}

export async function getSupplierRemittanceDocument(organisationId: string, paymentId: string): Promise<SupplierRemittanceDocument | null> {
  // Explicit public document fields; never include provider data, request keys,
  // user IDs or internal notes. All joins retain the tenant/supplier/currency.
  const [row] = await sql`
    SELECT p.id AS payment_id, o.name AS organisation_name, s.name AS supplier_name,
      p.amount_cents::text, p.currency, p.method, p.reference, p.paid_at::text,
      p.status, p.reversed_at::text, p.reversal_reason,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('bill_id',b.id,'bill_number',b.bill_number,
        'supplier_invoice_number',b.supplier_invoice_number,'allocated_amount_cents',a.allocated_amount_cents::text)
        ORDER BY b.bill_number COLLATE "C" NULLS LAST,b.id)
        FROM commercial_supplier_payment_allocations a
        JOIN commercial_supplier_bills b ON b.id=a.supplier_bill_id AND b.organisation_id=a.organisation_id
          AND b.supplier_id=a.supplier_id AND b.currency=a.currency
        WHERE a.supplier_payment_id=p.id AND a.organisation_id=p.organisation_id
          AND a.supplier_id=p.supplier_id AND a.currency=p.currency),'[]'::jsonb) AS allocations
    FROM commercial_supplier_payments p
    JOIN commercial_suppliers s ON s.id=p.supplier_id AND s.organisation_id=p.organisation_id
    JOIN organisations o ON o.id=p.organisation_id
    WHERE p.organisation_id=${organisationId} AND p.id=${paymentId}
  `;
  if (!row) return null;
  const document = row as SupplierRemittanceDocument;
  const sum = document.allocations.reduce((total, allocation) => total + BigInt(allocation.allocated_amount_cents), BigInt(0));
  if (!document.allocations.length || sum !== BigInt(document.amount_cents)) throw new Error('Remittance allocations do not reconcile');
  return document;
}
