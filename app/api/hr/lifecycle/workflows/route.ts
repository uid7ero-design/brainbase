import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  lifecycleTaskToJson,
  lifecycleWorkflowToJson,
  getVisibleLifecycleTasksForWorkflow,
  listLifecycleWorkflows,
} from '@/lib/hr/lifecycleWorkflowQueries';
import {
  startLifecycleWorkflow,
} from '@/lib/hr/lifecycleWorkflowMutations';
import {
  requireLifecycleWorkflowAdmin,
  requireLifecycleWorkflowContext,
} from '@/lib/hr/lifecycleWorkflowRoute';
import {
  isLifecycleResourceId,
  lifecycleNotFoundResponse,
  requireLifecycleWorkflow,
} from '@/lib/hr/lifecycleRoute';

const TYPES = new Set(['onboarding', 'offboarding']);
const STATUSES = new Set(['ACTIVE', 'COMPLETED', 'CANCELLED']);
const START_FIELDS = new Set(['person_id', 'template_id', 'anchor_date']);

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export async function GET(req: NextRequest) {
  const ctx = await requireLifecycleWorkflowContext();
  if (!ctx.ok) return ctx.response;

  const search = new URL(req.url).searchParams;
  const lifecycleType = search.get('lifecycle_type');
  const status = search.get('status');
  const personId = search.get('person_id');

  if (lifecycleType && !TYPES.has(lifecycleType)) {
    return NextResponse.json(
      { error: 'lifecycle_type must be onboarding or offboarding.' },
      { status: 400 },
    );
  }
  if (status && !STATUSES.has(status)) {
    return NextResponse.json(
      { error: 'status must be ACTIVE, COMPLETED, or CANCELLED.' },
      { status: 400 },
    );
  }
  if (personId && !isLifecycleResourceId(personId)) {
    return NextResponse.json(
      { error: 'person_id must be a UUID.' },
      { status: 400 },
    );
  }

  const workflows = await listLifecycleWorkflows(ctx.context.session, {
    lifecycleType: lifecycleType as 'onboarding' | 'offboarding' | null,
    status: status as 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null,
    personId,
  });

  return NextResponse.json({
    workflows: workflows.map(lifecycleWorkflowToJson),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireLifecycleWorkflowContext();
  if (!ctx.ok) return ctx.response;

  const adminError = requireLifecycleWorkflowAdmin(ctx.context);
  if (adminError) return adminError;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !START_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or server-managed field: ${unknownField}` },
      { status: 400 },
    );
  }

  if (typeof body.person_id !== 'string' || !isLifecycleResourceId(body.person_id)) {
    return NextResponse.json({ error: 'person_id must be a UUID.' }, { status: 400 });
  }
  if (typeof body.template_id !== 'string' || !isLifecycleResourceId(body.template_id)) {
    return NextResponse.json({ error: 'template_id must be a UUID.' }, { status: 400 });
  }
  if (!isIsoDate(body.anchor_date)) {
    return NextResponse.json(
      { error: 'anchor_date must be an ISO date in YYYY-MM-DD format.' },
      { status: 400 },
    );
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await startLifecycleWorkflow({
      actor: {
        organisationId: ctx.context.session.organisationId,
        userId: ctx.context.session.userId,
        isSuperAdmin: ctx.context.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      personId: body.person_id,
      templateId: body.template_id,
      anchorDate: body.anchor_date,
    });

    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'person_not_found') {
      return NextResponse.json(
        { error: 'HR person not found.', code: 'person_not_found' },
        { status: 404 },
      );
    }
    if (result.outcome === 'template_not_found') {
      return lifecycleNotFoundResponse();
    }
    if (result.outcome === 'template_not_active') {
      return NextResponse.json(
        { error: 'The selected lifecycle template is not active.', code: 'template_not_active' },
        { status: 400 },
      );
    }
    if (result.outcome === 'workflow_already_active') {
      return NextResponse.json(
        {
          error: 'An active workflow of this lifecycle type already exists for this person.',
          code: 'workflow_already_active',
        },
        { status: 409 },
      );
    }

    const resolved = await requireLifecycleWorkflow(
      ctx.context.session,
      result.workflowId,
    );
    if (!resolved.ok) {
      throw new Error('Started lifecycle workflow could not be re-read.');
    }

    const tasks = await getVisibleLifecycleTasksForWorkflow(
      ctx.context.session,
      result.workflowId,
    );

    return NextResponse.json(
      {
        workflow: lifecycleWorkflowToJson(resolved.workflow),
        tasks: tasks.map(lifecycleTaskToJson),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr/lifecycle/workflows POST] start failed', err);
    return NextResponse.json(
      { error: 'Could not start lifecycle workflow.' },
      { status: 500 },
    );
  }
}
