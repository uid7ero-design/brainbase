import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseReceipt } from '@/lib/commercial/purchaseReceipts';
import { isPurchaseReceiptEditable } from '@/lib/commercial/purchaseReceiptLifecycle';
import { getPurchaseReceiptAttachment, downloadPurchaseReceiptAttachmentBytes, removePurchaseReceiptAttachment } from '@/lib/commercial/documentAttachments';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

// Phase C7.3 — mirrors app/api/commercial/purchase-orders/[id]/attachments/[attachmentId]/route.ts
// exactly, including its no-raw-Blob-URL guarantee: GET streams the
// file's actual bytes back through this authenticated, tenant-checked
// route; the raw Commercial Blob object URL is never constructed,
// returned, or redirected to anywhere.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id, attachmentId } = await params;

  const purchaseReceipt = await getPurchaseReceipt(auth.session.organisationId, id);
  if (!purchaseReceipt) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const attachment = await getPurchaseReceiptAttachment(auth.session.organisationId, id, attachmentId);
  if (!attachment) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await downloadPurchaseReceiptAttachmentBytes(attachment);
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

// DELETE — remove, DRAFT only (same eligibility rule as upload).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id, attachmentId } = await params;

  const purchaseReceipt = await getPurchaseReceipt(auth.session.organisationId, id);
  if (!purchaseReceipt) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!isPurchaseReceiptEditable(purchaseReceipt.status)) {
    return NextResponse.json({ error: `Purchase receipt is ${purchaseReceipt.status} — supporting documents can only be removed while it is DRAFT.` }, { status: 409 });
  }

  const ok = await removePurchaseReceiptAttachment({
    organisationId: auth.session.organisationId, userId: auth.session.userId, purchaseReceipt, attachmentId,
  });
  if (!ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
