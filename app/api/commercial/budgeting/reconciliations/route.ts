import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  listFinanceReconciliationQueue,
  type FinanceReconciliationStatus,
} from '@/lib/commercial/financeReconciliation';

function parseStatus(value: string | null): FinanceReconciliationStatus | null | 'INVALID' {
  if (!value) return null;
  if (value === 'PREPARED' || value === 'REVIEWED' || value === 'SIGNED_OFF' || value === 'STALE') {
    return value;
  }
  return 'INVALID';
}

export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get('status'));
  if (status === 'INVALID') {
    return NextResponse.json({ error: 'Invalid reconciliation status.' }, { status: 400 });
  }

  try {
    const reconciliations = await listFinanceReconciliationQueue({
      organisationId: auth.session.organisationId,
      sourceSystemId: url.searchParams.get('sourceSystemId'),
      status,
      financialPeriodId: url.searchParams.get('financialPeriodId'),
      currency: url.searchParams.get('currency'),
    });
    return NextResponse.json(
      { reconciliations },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'INVALID_INPUT') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
