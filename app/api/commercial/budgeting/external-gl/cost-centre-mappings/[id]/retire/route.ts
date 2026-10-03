import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  retireExternalGlCostCentreMapping,
  ExternalGlError,
} from '@/lib/commercial/externalGl';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const mapping = await retireExternalGlCostCentreMapping({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      mappingId: id,
      effectiveTo: String(body.effectiveTo ?? ''),
    });
    return NextResponse.json({ mapping });
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
