import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, { params }: { params: Promise<{ fy: string; gl: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fy, gl: glEncoded } = await params;
  const gl    = decodeURIComponent(glEncoded);
  const orgId = session.organisationId;
  const body  = await req.json().catch(() => null);

  const model = await prisma.financialModel.findUnique({
    where: { organisation_id_financial_year: { organisation_id: orgId, financial_year: fy } },
  });
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const overrides = model.forecast_overrides as Record<string, number>;

  if (body?.value === null || body?.clear) {
    delete overrides[gl];
  } else if (body?.value !== undefined) {
    overrides[gl] = Number(body.value);
  } else {
    return NextResponse.json({ error: 'value required (or null to clear)' }, { status: 400 });
  }

  await prisma.financialModel.update({
    where: { id: model.id },
    data:  { forecast_overrides: overrides, last_edited_by: session.userId },
  });

  return NextResponse.json({ success: true });
}
