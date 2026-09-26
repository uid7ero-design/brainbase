import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { validateLifecycleTemplatePayload } from '@/lib/hr/lifecycleTemplateDomain';
import { createLifecycleTemplateVersion } from '@/lib/hr/lifecycleTemplateMutations';
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
  const validation = validateLifecycleTemplatePayload(body, {
    requireFamilyFields: false,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await createLifecycleTemplateVersion({
      actor: {
        organisationId: admin.context.session.organisationId,
        userId: admin.context.session.userId,
        isSuperAdmin: admin.context.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      sourceTemplateId: id,
      input: validation.value,
    });

    if (result.outcome === 'template_not_found') {
      return lifecycleTemplateNotFoundResponse();
    }
    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome !== 'created') {
      throw new Error(`Unexpected lifecycle template version outcome: ${result.outcome}`);
    }

    const template = await getLifecycleTemplate(
      admin.context.session.organisationId,
      result.templateId,
    );
    if (!template) throw new Error('Created lifecycle template version could not be re-read.');

    return NextResponse.json(
      { template: lifecycleTemplateToJson(template) },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr/lifecycle/templates/[id]/versions POST] versioning failed', err);
    return NextResponse.json(
      { error: 'Could not create lifecycle template version.' },
      { status: 500 },
    );
  }
}
