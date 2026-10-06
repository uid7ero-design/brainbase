import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  FinancialYearStatusError,
  setFinancialYearStatus,
} from '@/lib/commercial/financialPeriods';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }

  try {
    const year = await setFinancialYearStatus({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      financialYearId: id,
      status: 'OPEN',
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    if (!year) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ year });
  } catch (error) {
    if (error instanceof FinancialYearStatusError) {
      const status = error.code === 'REOPEN_REASON_REQUIRED' ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
