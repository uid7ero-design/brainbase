import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { deactivateFinanceDimension, dimensionKind, FinanceDimensionError } from '@/lib/commercial/financeDimensions';

export async function POST(_req: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { kind, id } = await context.params;
  try { return NextResponse.json({ record: await deactivateFinanceDimension(dimensionKind(kind), auth.session.organisationId, auth.session.userId, id) }); }
  catch (error) {
    if (error instanceof FinanceDimensionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409 });
    throw error;
  }
}
