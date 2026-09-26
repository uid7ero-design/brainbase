import { NextRequest, NextResponse } from 'next/server';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { canExecuteLifecycleTask } from '@/lib/hr/lifecycleAccess';
import { completeLifecycleTask } from '@/lib/hr/lifecycleMutations';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  isLifecycleResourceId,
  lifecycleNotFoundResponse,
  requireLifecycleTask,
} from '@/lib/hr/lifecycleRoute';
import { requireSession } from '@/lib/org';

const COMPLETE_FIELDS = new Set(['action']);

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function forbiddenResponse() {
  return NextResponse.json(
    {
      error: 'You are not permitted to perform this lifecycle task action.',
      code: 'task_action_forbidden',
    },
    { status: 403 },
  );
}

function conflictResponse(code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status: 409 });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  let session;
  try {
    session = await requireSession();
  } catch {
    return unauthorizedResponse();
  }

  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return NextResponse.json(
        { error: 'Unable to verify People access.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (!isLifecycleResourceId(taskId)) return lifecycleNotFoundResponse();

  const resolved = await requireLifecycleTask(session, taskId);
  if (!resolved.ok) return resolved.response;

  if (!canExecuteLifecycleTask(resolved.auth.actor, resolved.auth.target)) {
    return forbiddenResponse();
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !COMPLETE_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or unsupported field: ${unknownField}` },
      { status: 400 },
    );
  }

  if (body.action !== 'complete') {
    return NextResponse.json(
      { error: 'action must be complete.' },
      { status: 400 },
    );
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await completeLifecycleTask({
      actor: {
        organisationId: session.organisationId,
        userId: session.userId,
        isSuperAdmin: session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      taskId,
    });

    if (result.outcome === 'task_not_found') return lifecycleNotFoundResponse();
    if (result.outcome === 'forbidden') return forbiddenResponse();

    if (result.outcome === 'already_completed') {
      return conflictResponse(
        'task_already_completed',
        'This task has already been completed.',
      );
    }

    if (result.outcome === 'already_submitted') {
      return conflictResponse(
        'task_already_submitted',
        'This task is already awaiting approval.',
      );
    }

    if (result.outcome === 'already_terminal') {
      return conflictResponse(
        'task_already_terminal',
        'This task is already in a terminal state.',
      );
    }

    if (result.outcome === 'workflow_not_active') {
      return conflictResponse(
        'workflow_not_active',
        'This lifecycle workflow is no longer active.',
      );
    }

    if (result.outcome === 'awaiting_approval') {
      return NextResponse.json(
        {
          task: {
            id: result.task.id,
            status: result.task.status,
            completed_by: null,
            completed_at: null,
          },
          workflow: {
            id: result.workflow.id,
            status: result.workflow.status,
            completed_at: null,
          },
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        task: {
          id: result.task.id,
          status: result.task.status,
          completed_by: result.task.completedBy,
          completed_at: iso(result.task.completedAt),
        },
        workflow: {
          id: result.workflow.id,
          status: result.workflow.status,
          completed_at: result.workflow.completedAt
            ? iso(result.workflow.completedAt)
            : null,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[hr/lifecycle/tasks/[id] PATCH] completion failed', err);
    return NextResponse.json(
      { error: 'Could not complete lifecycle task.' },
      { status: 500 },
    );
  }
}
