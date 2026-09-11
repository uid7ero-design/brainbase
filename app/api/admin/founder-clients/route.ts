import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logFounderReadAccessed } from '@/lib/admin/auditLog';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

export async function GET(req: NextRequest) {
  // SEC-1B2: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // (lib/org.ts) re-reads the caller's current role/organisation/status
  // from the database on every call, so a since-demoted, since-
  // deactivated, or deleted super_admin's still-valid JWT can no longer
  // read this founder-only pipeline data.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

  let source: 'live' | 'fallback' = 'fallback';
  let payload: unknown = { clients: [] };

  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-clients`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        payload = await res.json();
        source = 'live';
      } else {
        console.warn('[founder-clients] backend responded', res.status, '— falling back to empty list');
      }
    } catch (err) {
      console.warn('[founder-clients] backend unreachable:', (err as Error).message, '— falling back to empty list');
    }
  }

  // SEC-1B2: audit — founder backend data access, previously entirely
  // unaudited. Records that this founder tool was accessed and whether
  // live backend data was returned — never the response payload itself.
  {
    const { ipAddress, userAgent } = requestMeta(req);
    await logFounderReadAccessed({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      resource: 'founder_clients',
      source,
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json(payload);
}
