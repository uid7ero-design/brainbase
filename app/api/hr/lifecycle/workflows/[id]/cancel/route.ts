import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  cancelLifecycleWorkflow,
} from '@/lib/hr/lifecycleWorkflowMutations';
import {
  lifecycleWorkflowToJson,
} from '@/lib/hr/lifecycleWorkflowQueries';
import {
  requireLifecycleWorkflowAdmin,
  requireLifecycleWorkflowContext,
} from '@/lib/hr/lifecycleWorkflowRoute';
import {
  isLifecycleResourceId,
  lifecycleNotFoundResponse,
  requireLifecycleWorkflow,
} from '@/lib/hr/lifecycleRoute';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireLifecycleWorkflowContext();
  if (!ctx.ok) return ctx.response;

  const adminError = requireLifecycleWorkflowAdmin(ctx.context);
  if (adminError) return adminError;

  const { id } = await params;
  if (!isLifecycleResourceId(id)) return lifecycleNotFoundResponse();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (Object.keys(body).length > 0) {
    return NextResponse.json(
      { error: 'This action does not accept request fields.' },
      { status: 400 },
    );
  }

  const resolved = await requireLifecycleWorkflow(ctx.context.session, id);
  if (!resolved.ok) return resolved.response;

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await cancelLifecycleWorkflow({
      actor: {
        organisationId: ctx.context.session.organisationId,
        userId: ctx.context.session.userId,
        isSuperAdmin: ctx.context.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      workflowId: id,
    });

    if (result.outcome === 'workflow_not_found') return lifecycleNotFoundResponse();
    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'already_completed') {
      return NextResponse.json(
        {
          error: 'A completed lifecycle workflow cannot be cancelled.',
          code: 'workflow_already_completed',
        },
        { status: 409 },
      );
    }

    const reread = await requireLifecycleWorkflow(ctx.context.session, id);
    if (!reread.ok) {
      throw new Error('Cancelled lifecycle workflow could not be re-read.');
    }

    return NextResponse.json({
      workflow: lifecycleWorkflowToJson(reread.workflow),
    });
  } catch (err) {
    console.error('[hr/lifecycle/workflows/[id]/cancel POST] cancellation failed', err);
    return NextResponse.json(
      { error: 'Could not cancel lifecycle workflow.' },
      { status: 500 },
    );
  }
}
