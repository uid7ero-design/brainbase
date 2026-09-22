import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  getSupplierBillWithLines, updateDraftSupplierBill, deleteSupplierBill,
  getBilledAmountsForPurchaseOrder,
} from '@/lib/commercial/supplierBills';
import { getPurchaseOrderWithLines } from '@/lib/commercial/purchaseOrders';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 — mirrors app/api/commercial/purchase-receipts/[id]/route.ts's
// shape exactly. GET additionally folds in the parent purchase order
// (with its own lines) and the derived, org-scoped billed-to-date map
// for that PO — everything the bill detail/create-from-PO UI needs
// (ordered / previously billed / remaining / this-draft's-own amount) in
// one payload, with the server remaining the sole authority for the
// actual over-billing decision at post time.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const result = await getSupplierBillWithLines(auth.session.organisationId, id);
  if (!result) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const poResult = await getPurchaseOrderWithLines(auth.session.organisationId, result.supplierBill.source_purchase_order_id);
  const billedAmounts = await getBilledAmountsForPurchaseOrder(auth.session.organisationId, result.supplierBill.source_purchase_order_id);

  return NextResponse.json({
    ...result,
    purchaseOrder: poResult?.purchaseOrder ?? null,
    purchaseOrderLines: poResult?.lines ?? [],
    billedAmounts,
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const { supplierInvoiceNumber, billDate, dueDate } = body;

  try {
    const supplierBill = await updateDraftSupplierBill({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      supplierBillId: id,
      supplierInvoiceNumber,
      billDate,
      dueDate,
    });
    if (!supplierBill) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ supplierBill });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update supplier bill.';
    const status = /can no longer be edited/.test(message)
      ? 409
      : /already been recorded/.test(message)
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// Safe discard/delete for a never-posted DRAFT — deleteSupplierBill()
// itself enforces the full eligibility gate (status = DRAFT AND
// bill_number IS NULL) atomically in its own WHERE clause; this route's
// only job is translating a false result into one generic 404.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const ok = await deleteSupplierBill({ organisationId: auth.session.organisationId, userId: auth.session.userId, supplierBillId: id });
  if (!ok) return NextResponse.json({ error: 'Not found, or not an eligible never-posted draft.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
