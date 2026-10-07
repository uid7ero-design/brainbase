import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { createCalendarYear, FinanceCalendarSetupError } from '@/lib/commercial/financeCalendarSetup';

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  try {
    const year = await createCalendarYear(auth.session.organisationId, auth.session.userId, await req.json().catch(() => null));
    return NextResponse.json({ year }, { status: 201 });
  } catch (error) {
    if (error instanceof FinanceCalendarSetupError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'INVALID_INPUT' ? 400 : 409 });
    throw error;
  }
}
