import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const { organisationId, userId } = session;

  const existing = await prisma.binMaintenanceJob.findFirst({ where: { id, organisation_id: organisationId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { comment } = await req.json() as { comment: string };
  if (!comment?.trim()) return NextResponse.json({ error: 'comment is required' }, { status: 400 });

  try {
    const newComment = await prisma.maintenanceComment.create({
      data: {
        maintenance_job_id: id,
        user_id:            userId,
        comment:            comment.trim(),
      },
    });
    return NextResponse.json({ comment: newComment }, { status: 201 });
  } catch (err) {
    console.error('[bin-maintenance/:id/comment POST]', err);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
