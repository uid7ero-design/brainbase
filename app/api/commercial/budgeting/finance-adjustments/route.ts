import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  createFinanceAdjustment,
  FinanceAdjustmentError,
  type FinanceAdjustmentType,
  type FinanceAdjustmentLineInput,
} from '@/lib/commercial/financeAdjustments';

type Body = {
  adjustmentType?: FinanceAdjustmentType;
  effectiveFinancialPeriodId?: string;
  referenceFinancialPeriodId?: string | null;
  currency?: string;
  description?: string;
  reasonCode?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  lines?: FinanceAdjustmentLineInput[];
};

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as Body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  if (
    !body.adjustmentType
    || !body.effectiveFinancialPeriodId
    || !body.currency
    || !body.description
    || !body.reasonCode
    || !Array.isArray(body.lines)
  ) {
    return NextResponse.json({ error: 'Invalid finance adjustment payload.' }, { status: 400 });
  }

  try {
    const adjustment = await createFinanceAdjustment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      adjustmentType: body.adjustmentType,
      effectiveFinancialPeriodId: body.effectiveFinancialPeriodId,
      referenceFinancialPeriodId: body.referenceFinancialPeriodId ?? null,
      currency: body.currency,
      description: body.description,
      reasonCode: body.reasonCode,
      sourceType: body.sourceType ?? null,
      sourceId: body.sourceId ?? null,
      lines: body.lines,
    });
    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (error) {
    if (error instanceof FinanceAdjustmentError) {
      const status = error.code === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
