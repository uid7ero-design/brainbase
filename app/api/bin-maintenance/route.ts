import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  let organisationId: string;
  try {
    const session = await getAuthSession();
    organisationId = session.organisationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status   = searchParams.get('status')   ?? undefined;
  const severity = searchParams.get('severity') ?? undefined;
  const suburb   = searchParams.get('suburb')   ?? undefined;
  const assigned = searchParams.get('assigned') ?? undefined;

  const skip = parseInt(searchParams.get('skip') ?? '0', 10) || 0;
  const take = Math.min(parseInt(searchParams.get('take') ?? '2000', 10) || 2000, 5000);

  const where = {
    organisation_id: organisationId,
    ...(status   ? { status:   status   as 'OPEN' | 'ASSIGNED' | 'SCHEDULED' | 'IN_PROGRESS' | 'ESCALATED' | 'COMPLETED' | 'CLOSED' } : {}),
    ...(severity ? { severity: severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' } : {}),
    ...(suburb   ? { suburb: { contains: suburb, mode: Prisma.QueryMode.insensitive } } : {}),
    ...(assigned === 'unassigned' ? { assigned_to: null } : assigned ? { assigned_to: assigned } : {}),
  };

  try {
    const [jobs, total] = await prisma.$transaction([
      prisma.binMaintenanceJob.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { created_at: 'desc' }],
        include: { comments: { orderBy: { created_at: 'desc' }, take: 1 } },
        skip,
        take,
      }),
      prisma.binMaintenanceJob.count({ where }),
    ]);
    return NextResponse.json({ jobs, total, skip, take });
  } catch (err) {
    console.error('[bin-maintenance GET]', err);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
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
    suburb: string; address: string; bin_type?: string; issue_type: string;
    severity?: string; assigned_to?: string; scheduled_date?: string; notes?: string;
  };

  if (!body.suburb || !body.address || !body.issue_type) {
    return NextResponse.json({ error: 'suburb, address, and issue_type are required' }, { status: 400 });
  }

  try {
    const job = await prisma.binMaintenanceJob.create({
      data: {
        organisation_id: session.organisationId,
        suburb:          body.suburb,
        address:         body.address,
        bin_type:        (body.bin_type as 'GENERAL_WASTE' | 'RECYCLING' | 'ORGANICS' | 'BULK_WASTE') ?? 'GENERAL_WASTE',
        issue_type:      body.issue_type,
        severity:        (body.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') ?? 'MEDIUM',
        assigned_to:     body.assigned_to ?? null,
        scheduled_date:  body.scheduled_date ? new Date(body.scheduled_date) : null,
        notes:           body.notes ?? null,
      },
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error('[bin-maintenance POST]', err);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
