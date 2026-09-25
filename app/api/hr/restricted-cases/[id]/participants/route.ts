import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { forbidden, requireSession, unauthorized } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  canManageRestrictedCaseAccess,
  restrictedActorFromSession,
} from '@/lib/hr/restrictedAccess';
import {
  isRestrictedCaseId,
  requireRestrictedCase,
  restrictedCaseNotFoundResponse,
} from '@/lib/hr/restrictedRoute';
import { addRestrictedCaseParticipant } from '@/lib/hr/restrictedCaseContentMutations';

const ROLES = new Set(['subject', 'complainant', 'respondent', 'witness', 'other']);
const CREATE_FIELDS = new Set(['person_id', 'role_in_case']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type ParticipantRow = {
  id: string;
  case_id: string;
  person_id: string;
  role_in_case: string;
  created_at: Date | string;
};

async function entrySession() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 }),
      };
    }
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;

  const rows = await sql`
    SELECT id, case_id, person_id, role_in_case, created_at
    FROM hr_restricted_case_participants
    WHERE organisation_id = ${entry.session.organisationId}
      AND case_id = ${caseId}::uuid
    ORDER BY created_at ASC, id ASC
  ` as ParticipantRow[];

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    await Promise.all(rows.map(row => logRestrictedHrReadEvent(
      { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      {
        action: 'hr_restricted_case_participant.read',
        resourceType: 'hr_restricted_case_participant',
        resourceId: row.id,
        afterState: {
          case_id: row.case_id,
          person_id: row.person_id,
          role_in_case: row.role_in_case,
        },
      },
    )));
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/participants GET] read audit failed', err);
    return NextResponse.json({ error: 'Unable to record restricted HR access.' }, { status: 503 });
  }

  return NextResponse.json({
    participants: rows.map(row => ({
      id: row.id,
      person_id: row.person_id,
      role_in_case: row.role_in_case,
      created_at: row.created_at,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const ctx = await resolveHrAccessContext({
    organisationId: entry.session.organisationId,
    userId: entry.session.userId,
    role: entry.session.role,
  });
  if (!canManageRestrictedCaseAccess(entry.session, ctx.isHrAdministrator)) return forbidden();
  if (!isRestrictedCaseId(caseId)) return restrictedCaseNotFoundResponse();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });
  }

  const personId = typeof body.person_id === 'string' ? body.person_id.trim() : '';
  if (!personId) return NextResponse.json({ error: 'person_id is required.' }, { status: 400 });
  if (!UUID_RE.test(personId)) {
    return NextResponse.json(
      { error: 'Person is not eligible for this restricted HR case.', code: 'restricted_hr_person_not_eligible' },
      { status: 400 },
    );
  }

  const roleInCase = body.role_in_case === undefined ? 'subject' : body.role_in_case;
  if (typeof roleInCase !== 'string' || !ROLES.has(roleInCase)) {
    return NextResponse.json({ error: 'Invalid role_in_case.' }, { status: 400 });
  }

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await addRestrictedCaseParticipant({
      actor: { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      caseId,
      personId,
      roleInCase,
    });
    if (result.outcome === 'case_not_found') return restrictedCaseNotFoundResponse();
    if (result.outcome === 'person_not_found') {
      return NextResponse.json(
        { error: 'Person is not eligible for this restricted HR case.', code: 'restricted_hr_person_not_eligible' },
        { status: 400 },
      );
    }
    if (result.outcome === 'already_participant') {
      if (result.roleInCase !== roleInCase) {
        return NextResponse.json(
          { error: 'Participant already exists with a different role.', code: 'restricted_hr_participant_role_conflict' },
          { status: 409 },
        );
      }
      return NextResponse.json({
        participant: { id: result.participantId, person_id: personId, role_in_case: result.roleInCase },
        already_participant: true,
      });
    }
    return NextResponse.json({
      participant: { id: result.participantId, person_id: personId, role_in_case: result.roleInCase },
      already_participant: false,
    }, { status: 201 });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/participants POST] mutation failed', err);
    return NextResponse.json({ error: 'Could not add restricted HR participant.' }, { status: 500 });
  }
}
