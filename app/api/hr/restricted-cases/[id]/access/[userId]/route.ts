import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import {
  canManageRestrictedCaseAccess,
  restrictedActorFromSession,
} from '@/lib/hr/restrictedAccess';
import {
  isRestrictedCaseId,
  restrictedCaseNotFoundResponse,
} from '@/lib/hr/restrictedRoute';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { revokeRestrictedCaseAccess } from '@/lib/hr/restrictedAccessMutations';

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function forbiddenResponse() {
  return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: caseId, userId } = await params;

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
    return forbiddenResponse();
  }

  const ctx = await resolveHrAccessContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  });
  if (!canManageRestrictedCaseAccess(session, ctx.isHrAdministrator)) {
    return forbiddenResponse();
  }

  if (!isRestrictedCaseId(caseId)) return restrictedCaseNotFoundResponse();

  const targetUserId = userId.trim();
  if (!targetUserId) {
    return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
  }

  const actor = restrictedActorFromSession(session);
  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await revokeRestrictedCaseAccess({
      actor: {
        organisationId: actor.organisationId,
        userId: actor.userId,
        ipAddress,
        userAgent,
      },
      caseId,
      targetUserId,
    });

    if (result.outcome === 'case_not_found') return restrictedCaseNotFoundResponse();

    return NextResponse.json({
      revoked: true,
      already_revoked: result.outcome === 'already_revoked',
      user_id: targetUserId,
    });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/access/[userId] DELETE] revoke failed', err);
    return NextResponse.json(
      { error: 'Could not revoke restricted HR access.' },
      { status: 500 },
    );
  }
}
