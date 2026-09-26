import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { reopenFinancialPeriod, FinanceCloseError } from '@/lib/commercial/financeClose';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { reason?: unknown };

  try {
    const close = await reopenFinancialPeriod({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      financialPeriodId: id,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    return NextResponse.json({ close });
  } catch (error) {
    if (error instanceof FinanceCloseError) {
      if (error.code === 'NOT_FOUND') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      const status = error.code === 'REOPEN_REASON_REQUIRED' ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
