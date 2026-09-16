import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listSupplierBills, createSupplierBill } from '@/lib/commercial/supplierBills';
import { SUPPLIER_BILL_STATUSES, type SupplierBillStatus } from '@/lib/commercial/supplierBillLifecycle';

// Phase C7.4 — mirrors app/api/commercial/purchase-receipts/route.ts's
// shape exactly, including validating the status filter against the
// real status union before it ever reaches the domain layer.
export async function GET(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam && (SUPPLIER_BILL_STATUSES as string[]).includes(statusParam) ? (statusParam as SupplierBillStatus) : undefined;

  const supplierBills = await listSupplierBills(auth.session.organisationId, { status });
  return NextResponse.json({ supplierBills });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const { purchaseOrderId, supplierInvoiceNumber, billDate, dueDate } = body;
  if (typeof purchaseOrderId !== 'string' || !purchaseOrderId) {
    return NextResponse.json({ error: 'purchaseOrderId is required.' }, { status: 400 });
  }
  if (typeof supplierInvoiceNumber !== 'string' || !supplierInvoiceNumber.trim()) {
    return NextResponse.json({ error: 'supplierInvoiceNumber is required.' }, { status: 400 });
  }

  try {
    const supplierBill = await createSupplierBill({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      purchaseOrderId,
      supplierInvoiceNumber,
      billDate: billDate ?? null,
      dueDate: dueDate ?? null,
    });
    return NextResponse.json({ supplierBill }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create supplier bill.';
    const status = /not found for this organisation/.test(message)
      ? 404
      : /already been recorded/.test(message)
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
