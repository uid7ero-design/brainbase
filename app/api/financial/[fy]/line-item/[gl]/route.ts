import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';

interface LineItem {
  gl: string;
  description: string;
  category: string;
  budget_fy: number;
  ytd_actual: number;
  commitments: number;
}

const EDITABLE_FIELDS = new Set(['budget_fy', 'ytd_actual', 'commitments', 'description', 'category']);

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

  const items = model.line_items as LineItem[];
  const idx   = items.findIndex(i => i.gl === gl);
  if (idx === -1) return NextResponse.json({ error: 'GL not found' }, { status: 404 });

  items[idx] = { ...items[idx], [body.field]: body.value };

  await prisma.financialModel.update({
    where: { id: model.id },
    data:  { line_items: items, last_edited_by: session.userId },
  });

  return NextResponse.json({ success: true });
}
