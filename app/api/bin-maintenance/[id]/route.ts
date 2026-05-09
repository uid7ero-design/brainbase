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
    const job = await prisma.binMaintenanceJob.findFirst({
      where: { id, organisation_id: organisationId },
      include: {
        comments: { orderBy: { created_at: 'asc' } },
        attachments: { orderBy: { created_at: 'asc' } },
      },
    });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    console.error('[bin-maintenance/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const { organisationId } = session;

  const existing = await prisma.binMaintenanceJob.findFirst({ where: { id, organisation_id: organisationId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as {
    status?: string; assigned_to?: string; scheduled_date?: string;
    completed_date?: string; notes?: string; severity?: string;
    suburb?: string; address?: string; bin_type?: string; issue_type?: string;
  };

  const completedDate =
    body.status === 'COMPLETED' || body.status === 'CLOSED'
      ? new Date()
      : body.completed_date
        ? new Date(body.completed_date)
        : null;

  try {
    const job = await prisma.binMaintenanceJob.update({
      where: { id },
      data: {
        ...(body.status        ? { status:         body.status         as 'OPEN' | 'ASSIGNED' | 'SCHEDULED' | 'IN_PROGRESS' | 'ESCALATED' | 'COMPLETED' | 'CLOSED' } : {}),
        ...(body.severity      ? { severity:        body.severity       as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' } : {}),
        ...(body.bin_type      ? { bin_type:         body.bin_type       as 'GENERAL_WASTE' | 'RECYCLING' | 'ORGANICS' | 'BULK_WASTE' } : {}),
        ...(body.suburb        ? { suburb:           body.suburb }       : {}),
        ...(body.address       ? { address:          body.address }      : {}),
        ...(body.issue_type    ? { issue_type:        body.issue_type }   : {}),
        assigned_to:    'assigned_to'    in body ? body.assigned_to    ?? null : undefined,
        scheduled_date: 'scheduled_date' in body ? (body.scheduled_date ? new Date(body.scheduled_date) : null) : undefined,
        completed_date: completedDate !== null ? completedDate : undefined,
        notes:          'notes' in body ? body.notes ?? null : undefined,
      },
    });
    return NextResponse.json({ job });
  } catch (err) {
    console.error('[bin-maintenance/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let organisationId: string;
  try {
    const session = await getAuthSession();
    organisationId = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const existing = await prisma.binMaintenanceJob.findFirst({ where: { id, organisation_id: organisationId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await prisma.binMaintenanceJob.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[bin-maintenance/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
