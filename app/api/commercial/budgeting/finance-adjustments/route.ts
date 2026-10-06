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

function optionalText(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

function validLine(line: FinanceAdjustmentLineInput): boolean {
  return !!line && typeof line === 'object' && !Array.isArray(line)
    && typeof line.budgetAccountId === 'string' && !!line.budgetAccountId.trim()
    && typeof line.costCentreId === 'string' && !!line.costCentreId.trim()
    && [line.amountExclusiveCents, line.taxCents, line.amountInclusiveCents]
      .every(value => typeof value === 'string' || typeof value === 'number')
    && optionalText(line.sourceSupplierBillLineId) && optionalText(line.narrative);
}

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as Body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  if (
    typeof body.adjustmentType !== 'string'
    || !['PRIOR_PERIOD_RECLASSIFICATION', 'BUDGET_CLASSIFICATION_CORRECTION',
      'EXTERNAL_GL_TRUE_UP', 'MANUAL_FINANCE_ADJUSTMENT'].includes(body.adjustmentType)
    || typeof body.effectiveFinancialPeriodId !== 'string' || !body.effectiveFinancialPeriodId.trim()
    || typeof body.currency !== 'string' || !body.currency.trim()
    || typeof body.description !== 'string' || !body.description.trim()
    || typeof body.reasonCode !== 'string' || !body.reasonCode.trim()
    || !optionalText(body.referenceFinancialPeriodId)
    || !optionalText(body.sourceType) || !optionalText(body.sourceId)
    || !Array.isArray(body.lines)
    || !body.lines.every(validLine)
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
