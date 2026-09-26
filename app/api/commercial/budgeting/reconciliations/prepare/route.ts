import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  FinanceReconciliationError,
  prepareFinanceReconciliation,
} from '@/lib/commercial/financeReconciliation';

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  try {
    const reconciliation = await prepareFinanceReconciliation({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      financialPeriodId: String(body.financialPeriodId ?? ''),
      sourceSystemId: String(body.sourceSystemId ?? ''),
      currency: String(body.currency ?? ''),
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return NextResponse.json({ reconciliation }, { status: 201 });
  } catch (error) {
    if (error instanceof FinanceReconciliationError) {
      if (error.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      const status = error.code === 'INVALID_INPUT' ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
