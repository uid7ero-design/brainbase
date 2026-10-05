import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { validateLifecycleTemplatePayload } from '@/lib/hr/lifecycleTemplateDomain';
import { createLifecycleTemplate } from '@/lib/hr/lifecycleTemplateMutations';
import {
  getLifecycleTemplate,
  lifecycleTemplateToJson,
  listLifecycleTemplates,
} from '@/lib/hr/lifecycleTemplateQueries';
import { requireLifecycleTemplateAdmin } from '@/lib/hr/lifecycleTemplateRoute';

const STATUSES = new Set(['DRAFT', 'ACTIVE', 'RETIRED']);
const TYPES = new Set(['onboarding', 'offboarding']);

export async function GET(req: NextRequest) {
  const admin = await requireLifecycleTemplateAdmin();
  if (!admin.ok) return admin.response;

  const search = new URL(req.url).searchParams;
  const lifecycleType = search.get('lifecycle_type');
  const status = search.get('status');
  const templateKey = search.get('template_key');

  if (lifecycleType && !TYPES.has(lifecycleType)) {
    return NextResponse.json(
      { error: 'lifecycle_type must be onboarding or offboarding.' },
      { status: 400 },
    );
  }
  if (status && !STATUSES.has(status)) {
    return NextResponse.json(
      { error: 'status must be DRAFT, ACTIVE, or RETIRED.' },
      { status: 400 },
    );
  }

  const templates = await listLifecycleTemplates({
    organisationId: admin.context.session.organisationId,
    lifecycleType: lifecycleType as 'onboarding' | 'offboarding' | null,
    status: status as 'DRAFT' | 'ACTIVE' | 'RETIRED' | null,
    templateKey: templateKey?.trim() || null,
  });

  return NextResponse.json({
    templates: templates.map(lifecycleTemplateToJson),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireLifecycleTemplateAdmin();
  if (!admin.ok) return admin.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const validation = validateLifecycleTemplatePayload(body, {
    requireFamilyFields: true,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const input = validation.value;
  if (!input.templateKey || !input.lifecycleType) {
    return NextResponse.json({ error: 'Invalid lifecycle template payload.' }, { status: 400 });
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await createLifecycleTemplate({
      actor: {
        organisationId: admin.context.session.organisationId,
        userId: admin.context.session.userId,
        isSuperAdmin: admin.context.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      input: {
        ...input,
        templateKey: input.templateKey,
        lifecycleType: input.lifecycleType,
      },
    });

    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'family_exists') {
      return NextResponse.json(
        {
          error: 'A lifecycle template family with this template_key already exists.',
          code: 'template_family_exists',
        },
        { status: 409 },
      );
    }
    if (result.outcome !== 'created') {
      throw new Error(`Unexpected lifecycle template creation outcome: ${result.outcome}`);
    }

    const template = await getLifecycleTemplate(
      admin.context.session.organisationId,
      result.templateId,
    );
    if (!template) throw new Error('Created lifecycle template could not be re-read.');

    return NextResponse.json(
      { template: lifecycleTemplateToJson(template) },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr/lifecycle/templates POST] creation failed', err);
    return NextResponse.json(
      { error: 'Could not create lifecycle template.' },
      { status: 500 },
    );
  }
}
