import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { reverseFinanceAdjustment, FinanceAdjustmentError } from '@/lib/commercial/financeAdjustments';

type Ctx = { params: Promise<{ id: string }> };
type Body = { reversalFinancialPeriodId?: string; reason?: string };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }

  if (!body.reversalFinancialPeriodId || typeof body.reason !== 'string') {
    return NextResponse.json({ error: 'Reversal period and reason are required.' }, { status: 400 });
  }

  try {
    const adjustment = await reverseFinanceAdjustment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      financeAdjustmentId: id,
      reversalFinancialPeriodId: body.reversalFinancialPeriodId,
      reason: body.reason,
    });
    return NextResponse.json({ adjustment });
  } catch (error) {
    if (error instanceof FinanceAdjustmentError) {
      if (error.code === 'NOT_FOUND') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      const status = error.code === 'INVALID_AMOUNT' ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
