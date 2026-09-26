import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { importExternalGlEntry, ExternalGlError } from '@/lib/commercial/externalGl';

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await importExternalGlEntry({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      sourceSystemId: String(body.sourceSystemId ?? ''),
      externalEntryId: String(body.externalEntryId ?? ''),
      externalJournalId: typeof body.externalJournalId === 'string' ? body.externalJournalId : null,
      externalAccountCode: String(body.externalAccountCode ?? ''),
      externalCostCentreCode: typeof body.externalCostCentreCode === 'string' ? body.externalCostCentreCode : null,
      transactionDate: String(body.transactionDate ?? ''),
      accountingPeriodKey: typeof body.accountingPeriodKey === 'string' ? body.accountingPeriodKey : null,
      description: typeof body.description === 'string' ? body.description : null,
      currency: String(body.currency ?? ''),
      amountMinorUnits: String(body.amountMinorUnits ?? ''),
      sourcePayloadHash: String(body.sourcePayloadHash ?? ''),
      sourceLineageId: String(body.sourceLineageId ?? ''),
    });
    return NextResponse.json(result, { status: result.outcome === 'IMPORTED' ? 201 : 200 });
  } catch (error) {
    if (error instanceof ExternalGlError) {
      const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
