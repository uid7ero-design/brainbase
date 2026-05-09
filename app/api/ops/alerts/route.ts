import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

export async function GET() {
  let organisationId: string;
  try {
    const session = await getAuthSession();
    organisationId = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const alerts = await prisma.alert.findMany({
      where: { organisation_id: organisationId },
      orderBy: [{ severity: 'desc' }, { created_at: 'desc' }],
      take: 100,
    });
    return NextResponse.json({ alerts });
  } catch (err) {
    console.error('[ops/alerts GET]', err);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    title: string; description: string; severity?: string;
    module?: string; rule_key?: string; metadata?: Record<string, unknown>;
  };

  if (!body.title || !body.description) {
    return NextResponse.json({ error: 'title and description are required' }, { status: 400 });
  }

  try {
    const alert = await prisma.alert.create({
      data: {
        organisation_id: session.organisationId,
        title:           body.title,
        description:     body.description,
        severity:        (body.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') ?? 'MEDIUM',
        module:          (body.module as 'WASTE' | 'DUMPING' | 'FORECASTING' | 'MISSED_COLLECTIONS' | 'DEBTORS' | 'BIN_MAINTENANCE' | 'CONTRACTS' | 'OPERATIONS') ?? null,
        rule_key:        body.rule_key ?? null,
        metadata:        (body.metadata ?? {}) as never,
      },
    });
    return NextResponse.json({ alert }, { status: 201 });
  } catch (err) {
    console.error('[ops/alerts POST]', err);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
