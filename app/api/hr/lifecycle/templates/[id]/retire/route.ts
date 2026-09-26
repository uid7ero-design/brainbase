import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { retireLifecycleTemplate } from '@/lib/hr/lifecycleTemplateMutations';
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
    const result = await retireLifecycleTemplate({
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
    if (result.outcome !== 'retired' && result.outcome !== 'already_retired') {
      throw new Error(`Unexpected lifecycle template retirement outcome: ${result.outcome}`);
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
    console.error('[hr/lifecycle/templates/[id]/retire POST] retirement failed', err);
    return NextResponse.json(
      { error: 'Could not retire lifecycle template.' },
      { status: 500 },
    );
  }
}
