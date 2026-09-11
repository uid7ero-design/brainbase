import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logImpersonationStarted, logImpersonationStopped } from '@/lib/admin/auditLog';
import sql from '@/lib/db';

const OVERRIDE_COOKIE = 'org_override';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

// SEC-1A: request metadata for audit logging — 'unknown' (getClientIp's
// rate-limiting-oriented fallback) is normalised to a real null, since an
// audit column should record "not available", never a fabricated string.
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

/** GET — return current impersonation state */
export async function GET() {
  // SEC-1A: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // re-reads the caller's current status/role/organisation_id from the
  // users table on every call (lib/org.ts), so a since-disabled,
  // since-demoted, or deleted user's still-valid JWT is rejected here
  // immediately, not just on their next login. Read-only — no audit
  // event per SEC-1A §6 ("GET/read-only impersonation status does not
  // need audit logging").
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const jar   = await cookies();
  const orgId = jar.get(OVERRIDE_COOKIE)?.value ?? null;

  if (!orgId) return NextResponse.json({ orgId: null, orgName: null });

  // organisations.id is TEXT (confirmed Production schema — see
  // app/api/admin/orgs/route.ts's own identical fix, adminOrgSavePath
  // test suite), never uuid — an explicit ::uuid cast on one side of
  // an equality comparison against a TEXT column has no matching
  // operator in Postgres and fails outright, regardless of whether the
  // id string happens to be UUID-shaped (LD Tennis's is; a cuid like
  // City of Onkaparinga's is not, but even LD Tennis's genuinely
  // UUID-shaped id failed this comparison before this fix).
  const [org] = await sql`SELECT name FROM organisations WHERE id = ${orgId} LIMIT 1`;
  return NextResponse.json({ orgId, orgName: org?.name ?? null });
}

/** POST { orgId } — set override */
export async function POST(req: NextRequest) {
  // SEC-1A: same hardening as GET — see that handler's comment. Session
  // is captured (not discarded) because logImpersonationStarted() below
  // needs the DB-current actor id and home organisation, not JWT claims.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

  const { orgId } = await req.json() as { orgId: string };
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  // Existing target-organisation validation is preserved unchanged — the
  // request-supplied orgId only ever selects WHICH already-existing
  // organisation to impersonate; it never influences whether the caller
  // is authorized to impersonate at all (that's requireRole() above,
  // entirely independent of this request body).
  // See the GET handler's own comment — organisations.id is TEXT, no
  // ::uuid cast.
  const [org] = await sql`SELECT id, name FROM organisations WHERE id = ${orgId} LIMIT 1`;
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 });

  const jar = await cookies();
  jar.set(OVERRIDE_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  // SEC-1A: audit — impersonation start was previously unaudited entirely
  // (confirmed during SEC-1 discovery). Best-effort, after the state
  // change has already committed, per ADR-0003 §3/§11.
  const { ipAddress, userAgent } = requestMeta(req);
  await logImpersonationStarted({
    actorUserId: session.userId,
    actorHomeOrganisationId: session.homeOrganisationId,
    targetOrganisationId: org.id as string,
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ ok: true, orgId, orgName: org.name });
}

/** DELETE — clear override (back to own org) */
export async function DELETE(req: NextRequest) {
  // SEC-1A: same hardening as GET/POST.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

  const jar = await cookies();
  // Capture what was actually being impersonated BEFORE clearing it, so
  // the stop event names a real target org rather than nothing — and so
  // a DELETE call with no active impersonation (nothing to stop) does not
  // write a misleading "stopped" event for state that never changed.
  const previousOrgId = jar.get(OVERRIDE_COOKIE)?.value ?? null;
  jar.delete(OVERRIDE_COOKIE);

  if (previousOrgId) {
    const { ipAddress, userAgent } = requestMeta(req);
    await logImpersonationStopped({
      actorUserId: session.userId,
      actorHomeOrganisationId: session.homeOrganisationId,
      targetOrganisationId: previousOrgId,
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json({ ok: true });
}
