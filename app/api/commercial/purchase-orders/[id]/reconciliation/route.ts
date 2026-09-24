import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getPurchaseOrderReconciliation } from '@/lib/commercial/purchasingReconciliation';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reconciliation = await getPurchaseOrderReconciliation(auth.session.organisationId, id);
  if (!reconciliation) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return NextResponse.json({ reconciliation });
}
