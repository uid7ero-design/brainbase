import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

interface RafEntry {
  gl: string;
  description: string;
  contractor: string;
  base_value: number;
  escalation_pct: number;
}

const EDITABLE_FIELDS = new Set(['description', 'contractor', 'base_value', 'escalation_pct']);

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
  if (!body?.field || body.value === undefined) {
    return NextResponse.json({ error: 'field and value required' }, { status: 400 });
  }
  if (!EDITABLE_FIELDS.has(body.field)) {
    return NextResponse.json({ error: 'Field not editable' }, { status: 400 });
  }

  const model = await prisma.financialModel.findUnique({
    where: { organisation_id_financial_year: { organisation_id: orgId, financial_year: fy } },
  });
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const entries = model.rise_and_fall as unknown as RafEntry[];
  const idx     = entries.findIndex(e => e.gl === gl);

  if (idx === -1) {
    // Add new entry
    entries.push({ gl, description: '', contractor: '', base_value: 0, escalation_pct: 0, [body.field]: body.value } as RafEntry);
  } else {
    entries[idx] = { ...entries[idx], [body.field]: body.value };
  }

  await prisma.financialModel.update({
    where: { id: model.id },
    data:  { rise_and_fall: entries as unknown as Prisma.InputJsonValue, last_edited_by: session.userId },
  });

  return NextResponse.json({ success: true });
}
