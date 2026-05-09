import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthSession } from '@/lib/authSession';

const VALID_ACTIONS = ['investigating','assigned','escalated','monitoring','resolved','closed','note'] as const;
type ActionType = typeof VALID_ACTIONS[number];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { organisationId, userId, name } = session;
  const { id } = await params;
  const body = await req.json() as { action: ActionType; assignedTo?: string; text?: string };

  if (!VALID_ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Demo alerts use non-CUID slugs — return success without DB write
  const isCuid = /^[a-z0-9]{20,}$/.test(id);
  if (!isCuid) {
    return NextResponse.json({ ok: true, demo: true });
  }

  let alert;
  try {
    alert = await prisma.alert.findFirst({
      where: { id, organisation_id: organisationId },
    });
  } catch {
    return NextResponse.json({ ok: true, demo: true });
  }
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const before = { status: alert.status, metadata: alert.metadata };
  const meta: Record<string, unknown> =
    typeof alert.metadata === 'object' && alert.metadata !== null
      ? { ...(alert.metadata as Record<string, unknown>) }
      : {};

  let newStatus = alert.status;
  const now = new Date().toISOString();

  switch (body.action) {
    case 'investigating':
      newStatus = 'ACKNOWLEDGED';
      meta.workflow_state   = 'investigating';
      meta.acknowledged_at  = now;
      meta.acknowledged_by  = name;
      break;
    case 'assigned':
      newStatus = 'ACKNOWLEDGED';
      meta.workflow_state = 'assigned';
      meta.assigned_to    = body.assignedTo ?? null;
      meta.assigned_at    = now;
      meta.assigned_by    = name;
      break;
    case 'escalated':
      meta.workflow_state = 'escalated';
      meta.escalated_at   = now;
      meta.escalated_by   = name;
      break;
    case 'monitoring':
      meta.workflow_state = 'monitoring';
      break;
    case 'resolved':
      newStatus = 'RESOLVED';
      meta.workflow_state = 'resolved';
      meta.resolved_at    = now;
      meta.resolved_by    = name;
      break;
    case 'closed':
      newStatus = 'RESOLVED';
      meta.workflow_state = 'closed';
      meta.closed_at      = now;
      meta.closed_by      = name;
      break;
    case 'note': {
      const existing = Array.isArray(meta.notes) ? (meta.notes as unknown[]) : [];
      meta.notes = [...existing, { text: body.text, author: name, time: now }];
      break;
    }
  }

  try {
    await prisma.$transaction([
      prisma.alert.update({
        where: { id },
        data: {
          status:          newStatus,
          metadata:        meta as never,
          acknowledged_by: ['investigating','assigned'].includes(body.action) ? userId : undefined,
          acknowledged_at: ['investigating','assigned'].includes(body.action) ? new Date() : undefined,
          resolved_at:     ['resolved','closed'].includes(body.action) ? new Date() : undefined,
        },
      }),
      prisma.auditLog.create({
        data: {
          organisation_id: organisationId,
          user_id:         userId,
          action:          `alert_${body.action}`,
          resource_type:   'alert',
          resource_id:     id,
          before_state:    before as never,
          after_state:     { status: newStatus, metadata: meta } as never,
        },
      }),
    ]);
  } catch (err) {
    console.error('[ops/alerts/:id/action POST]', err);
    return NextResponse.json({ error: 'Failed to apply action' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: newStatus, workflowState: meta.workflow_state });
}
