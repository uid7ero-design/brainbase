import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { isPurchaseOrderEditable } from '@/lib/commercial/purchaseOrderLifecycle';
import { listAttachmentsForPurchaseOrder, uploadPurchaseOrderAttachment, MAX_ATTACHMENT_BYTES } from '@/lib/commercial/documentAttachments';

type Ctx = { params: Promise<{ id: string }> };

// C6.9 remediation — Supporting Documents for a purchase order.
// GET: view/download listing, available in every status (retention
// requirement — attachments must remain visible/accessible after issue
// and cancellation, never gated tighter than the PO itself already is).
// POST: upload — DRAFT only. No established Commercial approval
// convention supports mutating a PENDING_APPROVAL/APPROVED/ISSUED/
// CANCELLED document's supporting files, so this mirrors
// isPurchaseOrderEditable()'s own single DRAFT-only rule exactly,
// matching every other PO mutation (header edit, line CRUD) in this
// codebase — no new lifecycle concept invented for attachments.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const attachments = await listAttachmentsForPurchaseOrder(auth.session.organisationId, id);
  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!isPurchaseOrderEditable(purchaseOrder.status)) {
    return NextResponse.json({ error: `Purchase order is ${purchaseOrder.status} — supporting documents can only be added while it is DRAFT.` }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  const file = formData.get('file');
  const category = formData.get('category');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (typeof category !== 'string') return NextResponse.json({ error: 'category is required.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.` }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadPurchaseOrderAttachment({
    organisationId: auth.session.organisationId,
    userId: auth.session.userId,
    purchaseOrder,
    category,
    originalFilename: file.name || 'file',
    mimeType: file.type || 'application/octet-stream',
    bytes,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ attachment: result.attachment }, { status: 201 });
}
