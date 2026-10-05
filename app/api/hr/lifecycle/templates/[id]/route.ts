import { NextResponse } from 'next/server';
import {
  getLifecycleTemplate,
  lifecycleTemplateToJson,
} from '@/lib/hr/lifecycleTemplateQueries';
import {
  lifecycleTemplateNotFoundResponse,
  requireLifecycleTemplateAdmin,
} from '@/lib/hr/lifecycleTemplateRoute';
import { isLifecycleResourceId } from '@/lib/hr/lifecycleRoute';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireLifecycleTemplateAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  if (!isLifecycleResourceId(id)) return lifecycleTemplateNotFoundResponse();

  try {
    const template = await getLifecycleTemplate(
      admin.context.session.organisationId,
      id,
    );
    if (!template) return lifecycleTemplateNotFoundResponse();

    return NextResponse.json({
      template: lifecycleTemplateToJson(template),
    });
  } catch (err) {
    console.error('[hr/lifecycle/templates/[id] GET] read failed', err);
    return NextResponse.json(
      { error: 'Could not read lifecycle template.' },
      { status: 500 },
    );
  }
}
