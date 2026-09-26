import { NextRequest, NextResponse } from 'next/server';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { canApproveLifecycleTask } from '@/lib/hr/lifecycleAccess';
import { recordLifecycleTaskApproval } from '@/lib/hr/lifecycleMutations';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  isLifecycleResourceId,
  lifecycleNotFoundResponse,
  requireLifecycleTask,
} from '@/lib/hr/lifecycleRoute';
import { requireSession } from '@/lib/org';

const FIELDS = new Set(['decision', 'comment']);

function forbiddenResponse() {
  return NextResponse.json(
    { error: 'You are not permitted to approve this lifecycle task.', code: 'approval_forbidden' },
    { status: 403 },
  );
}
function conflictResponse(code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status: 409 });
}
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  let session;
  try { session = await requireSession(); }
  catch { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }

  try { await requireHrCapability(session.organisationId, session.role); }
  catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (!isLifecycleResourceId(taskId)) return lifecycleNotFoundResponse();

  const resolved = await requireLifecycleTask(session, taskId);
  if (!resolved.ok) return resolved.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });
  }

  if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
    return NextResponse.json({ error: 'decision must be APPROVED or REJECTED.' }, { status: 400 });
  }
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') {
    return NextResponse.json({ error: 'comment must be a string or null.' }, { status: 400 });
  }

  if (resolved.auth.target.approvalType === 'NONE') {
    return conflictResponse('approval_not_required', 'This task does not require approval.');
  }

  if (!canApproveLifecycleTask(resolved.auth.actor, resolved.auth.target)) return forbiddenResponse();

  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await recordLifecycleTaskApproval({
      actor: {
        organisationId: session.organisationId,
        userId: session.userId,
        isSuperAdmin: session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      taskId,
      decision: body.decision,
      comment: typeof body.comment === 'string' ? body.comment.trim() || null : null,
    });

    if (result.outcome === 'task_not_found') return lifecycleNotFoundResponse();
    if (result.outcome === 'forbidden') return forbiddenResponse();
    if (result.outcome === 'approval_not_required') {
      return conflictResponse('approval_not_required', 'This task does not require approval.');
    }
    if (result.outcome === 'approval_no_longer_applicable') {
      return conflictResponse('approval_no_longer_applicable', 'This task is no longer awaiting approval.');
    }
    if (result.outcome === 'workflow_not_active') {
      return conflictResponse('workflow_not_active', 'This lifecycle workflow is no longer active.');
    }

    return NextResponse.json({
      approval: {
        id: result.approval.id,
        task_id: result.approval.taskId,
        workflow_id: result.approval.workflowId,
        person_id: result.approval.personId,
        approver_user_id: result.approval.approverUserId,
        decision: result.approval.decision,
        comment: result.approval.comment,
        decided_at: iso(result.approval.decidedAt),
      },
      task: {
        id: result.task.id,
        status: result.task.status,
        completed_at: result.task.completedAt ? iso(result.task.completedAt) : null,
      },
      workflow: {
        id: result.workflow.id,
        status: result.workflow.status,
        completed_at: result.workflow.completedAt ? iso(result.workflow.completedAt) : null,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[hr/lifecycle/tasks/[id]/approvals POST] mutation failed', err);
    return NextResponse.json({ error: 'Could not record lifecycle task approval.' }, { status: 500 });
  }
}
