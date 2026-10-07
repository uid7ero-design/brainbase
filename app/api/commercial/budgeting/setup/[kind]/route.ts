import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { createFinanceDimension, dimensionKind, FinanceDimensionError, listFinanceDimensions } from '@/lib/commercial/financeDimensions';

type Context = { params: Promise<{ kind: string }> };
function failure(error: unknown) {
  if (error instanceof FinanceDimensionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409 });
  throw error;
}
export async function GET(_req: Request, context: Context) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json({ records: await listFinanceDimensions(dimensionKind((await context.params).kind), auth.session.organisationId) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export async function POST(req: Request, context: Context) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json({ record: await createFinanceDimension(dimensionKind((await context.params).kind), auth.session.organisationId, auth.session.userId, await req.json().catch(() => null)) }, { status: 201 }); }
  catch (error) { return failure(error); }
}
