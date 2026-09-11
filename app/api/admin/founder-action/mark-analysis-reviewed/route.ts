import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logFounderActionExecuted } from '@/lib/admin/auditLog';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

export async function POST(req: NextRequest) {
  // SEC-1B2: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // (lib/org.ts) re-reads the caller's current role/organisation/status
  // from the database on every call, so a since-demoted, since-
  // deactivated, or deleted super_admin's still-valid JWT can no longer
  // trigger this founder-pipeline mutation. `triggered_by` forwarded to
  // the backend is still session.userId — same value, now DB-confirmed
  // current before the call is made, so the backend contract/payload is
  // unchanged.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

  const body = await req.json() as { analysis_id?: string; org?: string; note?: string };

  let backendInvoked = false;
  let backendOk = false;
  let responsePayload: unknown = { ok: true, action: 'analysis_reviewed', analysis_id: body.analysis_id, org: body.org };

  if (BACKEND) {
    backendInvoked = true;
    try {
      const res = await fetch(`${BACKEND}/founder-action/mark-analysis-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, triggered_by: session.userId }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        responsePayload = await res.json();
        backendOk = true;
      } else {
        console.warn('[founder-action/mark-analysis-reviewed] backend responded', res.status);
      }
    } catch (err) {
      console.warn('[founder-action/mark-analysis-reviewed] backend unreachable:', (err as Error).message);
    }
  }

  // SEC-1B2: audit — state-changing external proxy action, previously
  // entirely unaudited. backendInvoked/backendOk record what actually
  // happened (a configured-but-unreachable backend still returns ok:true
  // to the client via the local fallback above — the audit is honest
  // about that rather than implying the external mutation succeeded).
  {
    const { ipAddress, userAgent } = requestMeta(req);
    await logFounderActionExecuted({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      action: 'mark-analysis-reviewed',
      backendInvoked,
      backendOk,
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json(responsePayload);
}
