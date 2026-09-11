import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrder } from '@/lib/commercial/purchaseOrders';
import { isPurchaseOrderEditable } from '@/lib/commercial/purchaseOrderLifecycle';
import { getPurchaseOrderAttachment, downloadPurchaseOrderAttachmentBytes, removePurchaseOrderAttachment } from '@/lib/commercial/documentAttachments';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

// C6.9 remediation — GET streams the file's actual bytes back through
// this authenticated, tenant-checked route; the raw Commercial Blob
// object URL is NEVER constructed, returned, or redirected to anywhere
// in this codebase (contrast lib/organiser/attachmentStorage.ts's own
// documented, accepted "public URL, security-by-obscurity" limitation —
// this feature deliberately does not repeat that gap: the underlying
// store is private, and even a leaked storage_key value is useless
// without the server-side credential this route alone holds).
// getPurchaseOrderAttachment() is scoped by organisation_id AND
// document_id (this PO) AND the attachment id — a wrong-tenant or
// wrong-PO attachment id resolves to the identical 404 a nonexistent id
// would, never distinguishing the two.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id, attachmentId } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const attachment = await getPurchaseOrderAttachment(auth.session.organisationId, id, attachmentId);
  if (!attachment) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await downloadPurchaseOrderAttachmentBytes(attachment);
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === 'NOT_FOUND') {
      return NextResponse.json({ error: 'The stored file could not be found.' }, { status: 404 });
    }
    console.error('[commercial attachments] download failed', err, { attachmentId });
    return NextResponse.json({ error: 'The file could not be retrieved.' }, { status: 502 });
  }

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': attachment.mime_type,
      'Content-Disposition': `attachment; filename="${attachment.original_filename.replace(/"/g, '')}"`,
    },
  });
}

// DELETE — remove, DRAFT only (same eligibility rule as upload — see
// the parent route's own comment for why no other status is supported).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, attachmentId } = await params;

  const purchaseOrder = await getPurchaseOrder(auth.session.organisationId, id);
  if (!purchaseOrder) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!isPurchaseOrderEditable(purchaseOrder.status)) {
    return NextResponse.json({ error: `Purchase order is ${purchaseOrder.status} — supporting documents can only be removed while it is DRAFT.` }, { status: 409 });
  }

  const ok = await removePurchaseOrderAttachment({
    organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseOrder, attachmentId,
  });
  if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
