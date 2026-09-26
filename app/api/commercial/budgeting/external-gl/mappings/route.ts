import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { createExternalGlAccountMapping, ExternalGlError } from '@/lib/commercial/externalGl';

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const mapping = await createExternalGlAccountMapping({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      sourceSystemId: String(body.sourceSystemId ?? ''),
      externalAccountCode: String(body.externalAccountCode ?? ''),
      externalAccountName: typeof body.externalAccountName === 'string' ? body.externalAccountName : null,
      budgetAccountId: String(body.budgetAccountId ?? ''),
      effectiveFrom: String(body.effectiveFrom ?? ''),
      effectiveTo: typeof body.effectiveTo === 'string' ? body.effectiveTo : null,
    });
    return NextResponse.json({ mapping }, { status: 201 });
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
