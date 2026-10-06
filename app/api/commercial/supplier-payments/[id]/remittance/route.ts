import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getSupplierRemittanceDocument } from '@/lib/commercial/supplierRemittanceDocument';
import { buildSupplierRemittancePdf } from '@/lib/commercial/supplierRemittancePdf';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
  try {
    const document = await getSupplierRemittanceDocument(auth.session.organisationId, id);
    if (!document) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
    const bytes = buildSupplierRemittancePdf(document);
    return new NextResponse(Buffer.from(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="supplier-remittance-${id.toLowerCase()}.pdf"` } });
  } catch {
    return NextResponse.json({ error: 'Unable to generate supplier remittance.' }, { status: 500, headers });
  }
}
