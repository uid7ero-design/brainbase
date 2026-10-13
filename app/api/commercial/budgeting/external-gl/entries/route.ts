import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getExternalGlEntryByIdentity, importExternalGlEntry, ExternalGlError } from '@/lib/commercial/externalGl';

export async function GET(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const query = new URL(req.url).searchParams;
  const source = query.get('sourceSystemId')?.trim();
  const identity = query.get('externalEntryId')?.trim();
  if (!source || !identity || source.length > 300 || identity.length > 300) return NextResponse.json({ error: 'Choose a source and external entry identity of up to 300 characters.' }, { status: 400 });
  const entry = await getExternalGlEntryByIdentity(auth.session.organisationId, source, identity);
  return NextResponse.json({ entry }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  }
  const amountMinorUnits = body.amountMinorUnits;
  if (typeof amountMinorUnits !== 'string'
    && !(typeof amountMinorUnits === 'number' && Number.isSafeInteger(amountMinorUnits))) {
    return NextResponse.json({ error: 'amountMinorUnits must be an integer decimal string or a safe integer number.' }, { status: 400 });
  }
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
      amountMinorUnits,
      sourcePayloadHash: String(body.sourcePayloadHash ?? ''),
      sourceLineageId: String(body.sourceLineageId ?? ''),
    });
    return NextResponse.json(result, { status: result.outcome === 'IMPORTED' ? 201 : 200 });
  } catch (error) {
    if (error instanceof ExternalGlError) {
      if (error.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      const status = error.code === 'INVALID_INPUT' ? 400 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
