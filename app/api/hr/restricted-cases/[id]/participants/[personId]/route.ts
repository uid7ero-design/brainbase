import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireSession, unauthorized } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { canManageRestrictedCaseAccess, restrictedActorFromSession } from '@/lib/hr/restrictedAccess';
import { isRestrictedCaseId, restrictedCaseNotFoundResponse } from '@/lib/hr/restrictedRoute';
import { removeRestrictedCaseParticipant } from '@/lib/hr/restrictedCaseContentMutations';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; personId: string }> },
) {
  const { id: caseId, personId: rawPersonId } = await params;
  let session;
  try {
    session = await requireSession();
  } catch {
    return unauthorized();
  }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    }
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  });
  if (!canManageRestrictedCaseAccess(session, ctx.isHrAdministrator)) return forbidden();
  if (!isRestrictedCaseId(caseId)) return restrictedCaseNotFoundResponse();

  const personId = rawPersonId.trim();
  if (!UUID_RE.test(personId)) {
    return NextResponse.json({ removed: true, already_removed: true, person_id: personId });
  }

  const actor = restrictedActorFromSession(session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await removeRestrictedCaseParticipant({
      actor: { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      caseId,
      personId,
    });
    if (result.outcome === 'case_not_found') return restrictedCaseNotFoundResponse();
    return NextResponse.json({
      removed: true,
      already_removed: result.outcome === 'already_removed',
      person_id: personId,
    });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/participants/[personId] DELETE] mutation failed', err);
    return NextResponse.json({ error: 'Could not remove restricted HR participant.' }, { status: 500 });
  }
}
