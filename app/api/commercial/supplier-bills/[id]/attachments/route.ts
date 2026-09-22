import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getSupplierBill } from '@/lib/commercial/supplierBills';
import { isSupplierBillEditable } from '@/lib/commercial/supplierBillLifecycle';
import { listAttachmentsForSupplierBill, uploadSupplierBillAttachment, MAX_ATTACHMENT_BYTES } from '@/lib/commercial/documentAttachments';

type Ctx = { params: Promise<{ id: string }> };

// Phase C7.4 — Supporting Documents for a supplier bill. Mirrors
// app/api/commercial/purchase-receipts/[id]/attachments/route.ts
// exactly. GET: view/download listing, available in every status. POST:
// upload — DRAFT only, matching isSupplierBillEditable()'s own single
// DRAFT-only rule.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const supplierBill = await getSupplierBill(auth.session.organisationId, id);
  if (!supplierBill) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const attachments = await listAttachmentsForSupplierBill(auth.session.organisationId, id);
  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const supplierBill = await getSupplierBill(auth.session.organisationId, id);
  if (!supplierBill) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!isSupplierBillEditable(supplierBill.status)) {
    return NextResponse.json({ error: `Supplier bill is ${supplierBill.status} — supporting documents can only be added while it is DRAFT.` }, { status: 409 });
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
  const result = await uploadSupplierBillAttachment({
    organisationId: auth.session.organisationId,
    userId: auth.session.userId,
    supplierBill,
    category,
    originalFilename: file.name || 'file',
    mimeType: file.type || 'application/octet-stream',
    bytes,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ attachment: result.attachment }, { status: 201 });
}
