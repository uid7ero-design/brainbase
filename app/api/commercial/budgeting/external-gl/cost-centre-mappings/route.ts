import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  createExternalGlCostCentreMapping,
  ExternalGlError,
  listExternalGlCostCentreMappings,
  type ExternalGlMappingStatus,
} from '@/lib/commercial/externalGl';

function parseStatus(value: string | null): ExternalGlMappingStatus | null | 'INVALID' {
  if (!value) return null;
  return value === 'ACTIVE' || value === 'RETIRED' ? value : 'INVALID';
}

export async function GET(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get('status'));
  if (status === 'INVALID') {
    return NextResponse.json({ error: 'Invalid mapping status.' }, { status: 400 });
  }

  const mappings = await listExternalGlCostCentreMappings({
    organisationId: auth.session.organisationId,
    sourceSystemId: url.searchParams.get('sourceSystemId'),
    status,
  });
  return NextResponse.json(
    { mappings },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const mapping = await createExternalGlCostCentreMapping({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      sourceSystemId: String(body.sourceSystemId ?? ''),
      externalCostCentreCode: String(body.externalCostCentreCode ?? ''),
      costCentreId: String(body.costCentreId ?? ''),
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
