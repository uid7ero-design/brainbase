import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { postFinanceAdjustment, FinanceAdjustmentError } from '@/lib/commercial/financeAdjustments';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const adjustment = await postFinanceAdjustment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      financeAdjustmentId: id,
    });
    return NextResponse.json({ adjustment });
  } catch (error) {
    if (error instanceof FinanceAdjustmentError) {
      if (error.code === 'NOT_FOUND') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}
