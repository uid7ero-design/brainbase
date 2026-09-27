import 'server-only';

import { NextResponse } from 'next/server';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { requireSession, type OrgSession } from '@/lib/org';

export type LifecycleTemplateAdminContext = {
  session: OrgSession;
  isHrAdministrator: boolean;
};

export type LifecycleTemplateAdminResult =
  | { ok: true; context: LifecycleTemplateAdminContext }
  | { ok: false; response: NextResponse };

export async function requireLifecycleTemplateAdmin(): Promise<LifecycleTemplateAdminResult> {
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

  const ctx = await resolveHrAccessContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  });

  if (!ctx.isHrAdministrator) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    context: {
      session,
      isHrAdministrator: true,
    },
  };
}

export function lifecycleTemplateNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Lifecycle resource not found.' },
    { status: 404 },
  );
}
