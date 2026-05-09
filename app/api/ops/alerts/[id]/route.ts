import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let organisationId: string;
  try {
    const session = await getAuthSession();
    organisationId = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const alert = await prisma.alert.findFirst({
      where: { id, organisation_id: organisationId },
    });
    if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const history = await prisma.auditLog.findMany({
      where: { organisation_id: organisationId, resource_type: 'alert', resource_id: id },
      orderBy: { created_at: 'desc' },
      take: 30,
    });

    return NextResponse.json({ alert, history });
  } catch (err) {
    console.error('[ops/alerts/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch alert' }, { status: 500 });
  }
}
