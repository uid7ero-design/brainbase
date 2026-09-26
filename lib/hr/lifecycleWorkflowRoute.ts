import 'server-only';

import { NextResponse } from 'next/server';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { requireSession, type OrgSession } from '@/lib/org';

export type LifecycleWorkflowRequestContext = {
  session: OrgSession;
  isHrAdministrator: boolean;
};

export type LifecycleWorkflowRequestResult =
  | { ok: true; context: LifecycleWorkflowRequestContext }
  | { ok: false; response: NextResponse };

export async function requireLifecycleWorkflowContext(): Promise<LifecycleWorkflowRequestResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }),
    };
  }

  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unable to verify People access.' },
          { status: 503 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }),
    };
  }

  const access = await resolveHrAccessContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  });

  return {
    ok: true,
    context: {
      session,
      isHrAdministrator: access.isHrAdministrator,
    },
  };
}

export function requireLifecycleWorkflowAdmin(
  context: LifecycleWorkflowRequestContext,
): NextResponse | null {
  if (context.isHrAdministrator) return null;
  return NextResponse.json(
    { error: 'HR administrator access is required.', code: 'hr_admin_required' },
    { status: 403 },
  );
}
