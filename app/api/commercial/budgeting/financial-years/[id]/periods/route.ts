import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { createCalendarPeriod, FinanceCalendarSetupError } from '@/lib/commercial/financeCalendarSetup';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const period = await createCalendarPeriod(auth.session.organisationId, auth.session.userId, id, await req.json().catch(() => null));
    return NextResponse.json({ period }, { status: 201 });
  } catch (error) {
    if (error instanceof FinanceCalendarSetupError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409 });
    throw error;
  }
}
