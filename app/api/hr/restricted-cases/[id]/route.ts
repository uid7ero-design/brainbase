import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { restrictedActorFromSession } from '@/lib/hr/restrictedAccess';
import { requireRestrictedCase } from '@/lib/hr/restrictedRoute';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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
      return NextResponse.json(
        { error: 'Unable to verify People access.' },
        { status: 503 },
      );
    }
    return forbidden();
  }

  const result = await requireRestrictedCase(session, id);
  if (!result.ok) return result.response;

  const actor = restrictedActorFromSession(session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    await logRestrictedHrReadEvent(
      {
        organisationId: actor.organisationId,
        userId: actor.userId,
        ipAddress,
        userAgent,
      },
      {
        action: 'hr_restricted_case.read',
        resourceType: 'hr_restricted_case',
        resourceId: result.case.id,
        afterState: {
          status: result.case.status,
          opened_by: result.case.openedBy,
        },
      },
    );
  } catch (err) {
    console.error('[hr/restricted-cases/[id] GET] read audit failed', err);
    return NextResponse.json(
      { error: 'Unable to record restricted HR access.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    case: {
      id: result.case.id,
      case_type: result.case.caseType,
      status: result.case.status,
      title: result.case.title,
      reference: result.case.reference,
      opened_by: result.case.openedBy,
      closed_at: result.case.closedAt,
      created_at: result.case.createdAt,
      updated_at: result.case.updatedAt,
    },
  });
}
