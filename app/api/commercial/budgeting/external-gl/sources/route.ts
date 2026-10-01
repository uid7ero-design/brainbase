import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listExternalGlSourceSystemIds } from '@/lib/commercial/externalGl';

export async function GET() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const sourceSystemIds = await listExternalGlSourceSystemIds(auth.session.organisationId);
  return NextResponse.json(
    { sourceSystemIds },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
