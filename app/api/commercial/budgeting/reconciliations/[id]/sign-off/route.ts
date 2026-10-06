import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  FinanceReconciliationError,
  signOffFinanceReconciliation,
} from '@/lib/commercial/financeReconciliation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }

  try {
    const reconciliation = await signOffFinanceReconciliation({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      reconciliationId: id,
      closeId: String(body.closeId ?? ''),
    });
    return NextResponse.json({ reconciliation });
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
