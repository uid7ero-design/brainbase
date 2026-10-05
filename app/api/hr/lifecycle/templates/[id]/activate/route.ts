import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { activateLifecycleTemplate } from '@/lib/hr/lifecycleTemplateMutations';
import {
  getLifecycleTemplate,
  lifecycleTemplateToJson,
} from '@/lib/hr/lifecycleTemplateQueries';
import {
  lifecycleTemplateNotFoundResponse,
  requireLifecycleTemplateAdmin,
} from '@/lib/hr/lifecycleTemplateRoute';
import { isLifecycleResourceId } from '@/lib/hr/lifecycleRoute';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireLifecycleTemplateAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  if (!isLifecycleResourceId(id)) return lifecycleTemplateNotFoundResponse();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (Object.keys(body).length > 0) {
    return NextResponse.json(
      { error: 'This action does not accept request fields.' },
      { status: 400 },
    );
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await activateLifecycleTemplate({
      actor: {
        organisationId: admin.context.session.organisationId,
        userId: admin.context.session.userId,
        isSuperAdmin: admin.context.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      templateId: id,
    });

    if (result.outcome === 'template_not_found') return lifecycleTemplateNotFoundResponse();
    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'active_version_exists') {
      return NextResponse.json(
        {
          error: 'Another version of this template is already active.',
          code: 'active_template_exists',
        },
        { status: 409 },
      );
    }
    if (result.outcome === 'invalid_transition') {
      return NextResponse.json(
        {
          error: 'This template cannot be activated from its current state.',
          code: 'invalid_template_transition',
        },
        { status: 409 },
      );
    }
    if (result.outcome !== 'activated' && result.outcome !== 'already_active') {
      throw new Error(`Unexpected lifecycle template activation outcome: ${result.outcome}`);
    }

    const template = await getLifecycleTemplate(
      admin.context.session.organisationId,
      id,
    );
    if (!template) return lifecycleTemplateNotFoundResponse();

    return NextResponse.json({
      template: lifecycleTemplateToJson(template),
    });
  } catch (err) {
    console.error('[hr/lifecycle/templates/[id]/activate POST] activation failed', err);
    return NextResponse.json(
      { error: 'Could not activate lifecycle template.' },
      { status: 500 },
    );
  }
}
