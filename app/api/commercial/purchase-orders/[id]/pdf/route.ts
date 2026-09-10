import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrderWithLines } from '@/lib/commercial/purchaseOrders';
import { getBusinessProfile } from '@/lib/commercial/businessProfile';
import { loadBrandLockupBase64Server } from '@/lib/commercial/documentEmail';
import { buildPurchaseOrderPdf, type PurchaseOrderPdfBuyer } from '@/lib/commercial/purchaseOrderPdf';

type Ctx = { params: Promise<{ id: string }> };

// Phase C6.5 — GET /api/commercial/purchase-orders/[id]/pdf. View floor
// (purchasing/viewer) — downloading the final document is a read
// action, matching every other GET route's own floor in this vertical.
// Unlike quotes/invoices (which build their PDF client-side), the
// server is the sole PDF generator here — see purchaseOrderPdf.ts's own
// header comment for why.
//
// Only ISSUED and CANCELLED ever produce a document: both are the only
// statuses guaranteed to carry a permanent purchase_order_number and a
// frozen supplier snapshot (see assertPurchaseOrderEditable() — DRAFT/
// PENDING_APPROVAL/APPROVED are all still editable and have no number
// yet). Requesting a PDF for any of those three is a 409 (the resource
// this route serves does not yet exist for this PO, not a client input
// error) — consistent with this vertical's own established convention
// of mapping "wrong lifecycle state for the requested action" to 409
// (see every C6.4 lifecycle route).
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const bundle = await getPurchaseOrderWithLines(session.organisationId, id);
  if (!bundle) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { purchaseOrder, lines } = bundle;

  if (purchaseOrder.status !== 'ISSUED' && purchaseOrder.status !== 'CANCELLED') {
    return NextResponse.json({ error: 'A PDF is only available once this purchase order has been issued.' }, { status: 409 });
  }
  // Guaranteed non-null by the status check above — every ISSUED/CANCELLED
  // row carries a permanent number, allocated atomically at issue time
  // and never cleared afterward (see issuePurchaseOrderAtomically() /
  // cancelPurchaseOrder() in lib/commercial/purchaseOrders.ts).
  const purchaseOrderNumber = purchaseOrder.purchase_order_number!;

  const businessProfile = await getBusinessProfile(session.organisationId);
  const buyer: PurchaseOrderPdfBuyer = {
    displayName: businessProfile?.profile.tradingName ?? businessProfile?.organisationName ?? 'BRΛINBΛSE',
    address: businessProfile?.profile.address ?? null,
    email: businessProfile?.profile.email ?? null,
    phone: businessProfile?.profile.phone ?? null,
    abn: businessProfile?.profile.abn ?? null,
  };

  let pdfBytes: Uint8Array;
  try {
    const brandLockupBase64 = await loadBrandLockupBase64Server();
    pdfBytes = await buildPurchaseOrderPdf({
      purchaseOrder: { ...purchaseOrder, purchase_order_number: purchaseOrderNumber, status: purchaseOrder.status },
      lines,
      buyer,
      brandLockupBase64,
    });
  } catch (err) {
    console.error('[commercial] purchase order PDF: rendering failed', err, { purchaseOrderId: id });
    return NextResponse.json({ error: 'The purchase order document could not be generated.' }, { status: 500 });
  }

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${purchaseOrderNumber}.pdf"`,
    },
  });
}
