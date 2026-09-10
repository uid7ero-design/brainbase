import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listPurchaseOrders, createPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import type { PurchaseOrderStatus } from '@/lib/commercial/purchaseOrderLifecycle';
import { PURCHASE_ORDER_STATUSES } from '@/lib/commercial/purchaseOrderLifecycle';

// Phase C6.3 — mirrors app/api/commercial/invoices/route.ts's shape
// exactly. organisationId always comes from authorizeCommercialRequest()'s
// own session resolution, never from request input. The GET filter
// surface is deliberately status-only, matching what
// lib/commercial/purchaseOrders.ts's listPurchaseOrders() actually
// supports today.
//
// C6.3 exposes only create/read/DRAFT-update — submit/approve/return/
// issue/cancel are deliberately NOT wired to any route here (the C6.2
// domain functions for them already exist; C6.4 will expose them).
export async function GET(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam && (PURCHASE_ORDER_STATUSES as string[]).includes(statusParam) ? (statusParam as PurchaseOrderStatus) : undefined;

  const purchaseOrders = await listPurchaseOrders(auth.session.organisationId, { status });
  return NextResponse.json({ purchaseOrders });
}

// Only the fields a standalone DRAFT may legitimately be created with
// are read from the body — purchase_order_number/status/snapshots/
// lifecycle metadata/totals are exclusively server/domain-controlled and
// are never accepted here, matching createPurchaseOrder()'s own
// parameter list exactly.
export async function POST(req: NextRequest) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const {
    supplierId, currency, costCentreId, supplierReference, deliveryDate,
    deliveryAddressLine1, deliveryAddressLine2, deliverySuburb, deliveryState, deliveryPostcode, deliveryCountry,
    paymentTermsDays, internalNotes, supplierNotes,
  } = body;
  if (!supplierId) return NextResponse.json({ error: 'supplierId is required.' }, { status: 400 });

  try {
    const purchaseOrder = await createPurchaseOrder({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      supplierId,
      currency: currency ?? 'AUD',
      costCentreId: costCentreId ?? null,
      supplierReference: supplierReference ?? null,
      deliveryDate: deliveryDate ?? null,
      deliveryAddressLine1: deliveryAddressLine1 ?? null,
      deliveryAddressLine2: deliveryAddressLine2 ?? null,
      deliverySuburb: deliverySuburb ?? null,
      deliveryState: deliveryState ?? null,
      deliveryPostcode: deliveryPostcode ?? null,
      deliveryCountry: deliveryCountry ?? null,
      paymentTermsDays: paymentTermsDays === undefined || paymentTermsDays === null ? null : Number(paymentTermsDays),
      internalNotes: internalNotes ?? null,
      supplierNotes: supplierNotes ?? null,
    });
    return NextResponse.json({ purchaseOrder }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create purchase order.' }, { status: 400 });
  }
}
