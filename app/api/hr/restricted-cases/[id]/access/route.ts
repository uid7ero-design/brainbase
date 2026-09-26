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
import { grantRestrictedCaseAccess } from '@/lib/hr/restrictedAccessMutations';

const GRANT_FIELDS = new Set(['user_id']);

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function forbiddenResponse() {
  return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

function notEligibleResponse() {
  return NextResponse.json(
    {
      error: 'User is not eligible for restricted HR access.',
      code: 'restricted_hr_user_not_eligible',
    },
    { status: 400 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !GRANT_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or unsupported field: ${unknownField}` },
      { status: 400 },
    );
  }

  const targetUserId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id is required.' }, { status: 400 });
  }

  const actor = restrictedActorFromSession(session);
  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await grantRestrictedCaseAccess({
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
    if (result.outcome === 'target_not_eligible') return notEligibleResponse();
    if (result.outcome === 'already_granted') {
      return NextResponse.json(
        {
          granted: true,
          already_granted: true,
          user_id: targetUserId,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        granted: true,
        already_granted: false,
        user_id: targetUserId,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/access POST] grant failed', err);
    return NextResponse.json(
      { error: 'Could not grant restricted HR access.' },
      { status: 500 },
    );
  }
}
