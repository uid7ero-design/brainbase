import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { logHrEvent, logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  canManageRestrictedCaseAccess,
  restrictedActorFromSession,
} from '@/lib/hr/restrictedAccess';

const CASE_TYPES = new Set(['grievance', 'disciplinary', 'investigation', 'other']);
const CREATE_FIELDS = new Set(['case_type', 'title', 'reference']);

type RestrictedCaseRow = {
  id: string;
  organisation_id: string;
  case_type: string;
  status: string;
  title: string;
  reference: string | null;
  opened_by: string;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function publicCase(row: RestrictedCaseRow) {
  return {
    id: row.id,
    case_type: row.case_type,
    status: row.status,
    title: row.title,
    reference: row.reference,
    opened_by: row.opened_by,
    closed_at: row.closed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function requireRestrictedHrEntrySession() {
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
        response: NextResponse.json(
          { error: 'Unable to verify People access.' },
          { status: 503 },
        ),
      };
    }
    return { ok: false as const, response: forbidden() };
  }

  return { ok: true as const, session };
}

/**
 * Lists only restricted cases the caller may read in the active organisation.
 * General HR-administrator status, case participation and self-linkage are not
 * authorization inputs. Non-super-admin callers need an exact live per-case
 * access row; super_admin bypass remains active-organisation scoped.
 */
export async function GET(req: NextRequest) {
  const entry = await requireRestrictedHrEntrySession();
  if (!entry.ok) return entry.response;

  const { session } = entry;
  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      c.id,
      c.organisation_id,
      c.case_type,
      c.status,
      c.title,
      c.reference,
      c.opened_by,
      c.closed_at,
      c.created_at,
      c.updated_at
    FROM hr_restricted_cases c
    WHERE c.organisation_id = ${session.organisationId}
      AND (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_restricted_case_access a
          WHERE a.organisation_id = c.organisation_id
            AND a.case_id = c.id
            AND a.user_id = ${session.userId}
            AND a.revoked_at IS NULL
        )
      )
    ORDER BY c.created_at DESC, c.id DESC
  ` as RestrictedCaseRow[];

  if (rows.length > 0) {
    const actor = restrictedActorFromSession(session);
    const { ipAddress, userAgent } = extractRequestMeta(req);
    try {
      await Promise.all(rows.map(row => logRestrictedHrReadEvent(
        {
          organisationId: actor.organisationId,
          userId: actor.userId,
          ipAddress,
          userAgent,
        },
        {
          action: 'hr_restricted_case.read',
          resourceType: 'hr_restricted_case',
          resourceId: row.id,
          afterState: {
            status: row.status,
            opened_by: row.opened_by,
          },
        },
      )));
    } catch (err) {
      console.error('[hr/restricted-cases GET] read audit failed', err);
      return NextResponse.json(
        { error: 'Unable to record restricted HR access.' },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ cases: rows.map(publicCase) });
}

/**
 * Creates a restricted case without implicitly granting its creator read
 * access. HR administrators and super_admin may open cases; subsequent reads
 * still require the PR-2 per-case authorization contract.
 */
export async function POST(req: NextRequest) {
  const entry = await requireRestrictedHrEntrySession();
  if (!entry.ok) return entry.response;

  const { session } = entry;
  const ctx = await resolveHrAccessContext({
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  });
  if (!canManageRestrictedCaseAccess(session, ctx.isHrAdministrator)) {
    return forbidden();
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or unsupported field: ${unknownField}` },
      { status: 400 },
    );
  }

  const caseType = typeof body.case_type === 'string' ? body.case_type : '';
  if (!CASE_TYPES.has(caseType)) {
    return NextResponse.json({ error: 'Invalid case_type.' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400 });
  }

  let reference: string | null = null;
  if (body.reference !== undefined && body.reference !== null) {
    if (typeof body.reference !== 'string') {
      return NextResponse.json({ error: 'reference must be a string or null.' }, { status: 400 });
    }
    reference = body.reference.trim() || null;
  }

  const actor = restrictedActorFromSession(session);
  let rows: Array<Pick<RestrictedCaseRow, 'id' | 'status' | 'opened_by' | 'created_at'>>;
  try {
    rows = await sql`
      INSERT INTO hr_restricted_cases (
        organisation_id,
        case_type,
        title,
        reference,
        opened_by
      )
      VALUES (
        ${actor.organisationId},
        ${caseType},
        ${title},
        ${reference},
        ${actor.userId}
      )
      RETURNING id, status, opened_by, created_at
    ` as Array<Pick<RestrictedCaseRow, 'id' | 'status' | 'opened_by' | 'created_at'>>;
  } catch (err) {
    console.error('[hr/restricted-cases POST] insert failed', err);
    return NextResponse.json({ error: 'Could not create restricted HR case.' }, { status: 500 });
  }

  const created = rows[0];
  if (!created) {
    return NextResponse.json({ error: 'Could not create restricted HR case.' }, { status: 500 });
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);
  await logHrEvent(
    {
      organisationId: actor.organisationId,
      userId: actor.userId,
      ipAddress,
      userAgent,
    },
    {
      action: 'hr_restricted_case.created',
      resourceType: 'hr_restricted_case',
      resourceId: created.id,
      afterState: {
        status: created.status,
        opened_by: created.opened_by,
      },
    },
  );

  return NextResponse.json(
    {
      case: {
        id: created.id,
        status: created.status,
        created_at: created.created_at,
      },
    },
    { status: 201 },
  );
}
