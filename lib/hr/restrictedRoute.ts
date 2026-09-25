import 'server-only';

import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import type { Role } from '@/lib/session';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type HrRestrictedRequestContext = {
  userId: string;
  organisationId: string;
  homeOrganisationId: string;
  role: Role;
};

export type HrRestrictedCaseAuthorization = {
  case: {
    id: string;
    organisationId: string;
  };
  via: 'live_case_grant' | 'super_admin';
};

export type AuthorizedRestrictedCaseRow = {
  id: string;
  organisationId: string;
  caseType: string;
  status: string;
  title: string;
  reference: string | null;
  openedBy: string;
  closedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type RestrictedCaseRouteAuthResult =
  | {
      ok: true;
      auth: HrRestrictedCaseAuthorization;
      ctx: HrRestrictedRequestContext;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export type RestrictedCaseRouteLookupResult =
  | {
      ok: true;
      case: AuthorizedRestrictedCaseRow;
      auth: HrRestrictedCaseAuthorization;
      ctx: HrRestrictedRequestContext;
    }
  | {
      ok: false;
      response: NextResponse;
    };

type ResolvedRestrictedCase = {
  case: AuthorizedRestrictedCaseRow;
  auth: HrRestrictedCaseAuthorization;
  ctx: HrRestrictedRequestContext;
};

type ResolveRestrictedCaseResult =
  | { ok: true; value: ResolvedRestrictedCase }
  | { ok: false };

export function restrictedCaseNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Restricted HR case not found.' },
    { status: 404 },
  );
}

function restrictedRequestContext(session: OrgSession): HrRestrictedRequestContext {
  return {
    userId: session.userId,
    organisationId: session.organisationId,
    homeOrganisationId: session.homeOrganisationId,
    role: session.role,
  };
}

/**
 * Single internal lookup shared by both public wrappers. Case existence,
 * active-organisation scoping and per-case grant authorization are resolved
 * by one SQL statement so an unauthorized case row never reaches route code.
 *
 * super_admin bypass is deliberately evaluated only inside a query already
 * constrained to session.organisationId. For every other role, only an exact
 * live (revoked_at IS NULL) grant for this case and session user authorizes.
 */
async function resolveRestrictedCase(
  session: OrgSession,
  caseId: string,
): Promise<ResolveRestrictedCaseResult> {
  if (!UUID_RE.test(caseId)) return { ok: false };

  const ctx = restrictedRequestContext(session);
  const isSuperAdmin = ctx.role === 'super_admin';

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
    WHERE c.id = ${caseId}::uuid
      AND c.organisation_id = ${ctx.organisationId}
      AND (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_restricted_case_access a
          WHERE a.organisation_id = c.organisation_id
            AND a.case_id = c.id
            AND a.user_id = ${ctx.userId}
            AND a.revoked_at IS NULL
        )
      )
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return { ok: false };

  const caseRow: AuthorizedRestrictedCaseRow = {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    caseType: row.case_type as string,
    status: row.status as string,
    title: row.title as string,
    reference: (row.reference as string | null) ?? null,
    openedBy: row.opened_by as string,
    closedAt: (row.closed_at as Date | string | null) ?? null,
    createdAt: row.created_at as Date | string,
    updatedAt: row.updated_at as Date | string,
  };

  const via: HrRestrictedCaseAuthorization['via'] = isSuperAdmin
    ? 'super_admin'
    : 'live_case_grant';

  return {
    ok: true,
    value: {
      case: caseRow,
      auth: {
        case: {
          id: caseRow.id,
          organisationId: caseRow.organisationId,
        },
        via,
      },
      ctx,
    },
  };
}

/** Authorization-only route wrapper. Every authorization failure maps to the
 * exact same canonical 404 response. */
export async function requireRestrictedCaseAccess(
  session: OrgSession,
  caseId: string,
): Promise<RestrictedCaseRouteAuthResult> {
  const resolved = await resolveRestrictedCase(session, caseId);
  if (!resolved.ok) {
    return { ok: false, response: restrictedCaseNotFoundResponse() };
  }

  return {
    ok: true,
    auth: resolved.value.auth,
    ctx: resolved.value.ctx,
  };
}

/** Authorization + case-row route wrapper. Uses the same single resolver as
 * requireRestrictedCaseAccess(), and therefore the same no-enumeration
 * behavior. */
export async function requireRestrictedCase(
  session: OrgSession,
  caseId: string,
): Promise<RestrictedCaseRouteLookupResult> {
  const resolved = await resolveRestrictedCase(session, caseId);
  if (!resolved.ok) {
    return { ok: false, response: restrictedCaseNotFoundResponse() };
  }

  return {
    ok: true,
    case: resolved.value.case,
    auth: resolved.value.auth,
    ctx: resolved.value.ctx,
  };
}
