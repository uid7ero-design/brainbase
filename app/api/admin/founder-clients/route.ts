import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logFounderReadAccessed } from '@/lib/admin/auditLog';
import { CRM_MAX_PAGE, loadFounderClientOverview } from '@/lib/founder/clientOverview';

// Founder OS client overview. Previously proxied to an external, unverified
// backend (NEXT_PUBLIC_API_URL) and silently returned an empty list when it
// was missing or unreachable. Now reads BrainBase's own records — see
// lib/founder/clientOverview.ts for the source map and the rules that keep
// registered organisations, prospects and billing customers apart.

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

export async function GET(req: NextRequest) {
  // SEC-1B2: requireRole() (lib/org.ts) re-reads the caller's current
  // role/organisation/status from the database on every call, so a
  // since-demoted, since-deactivated, or deleted super_admin's still-valid
  // JWT cannot read this cross-organisation founder data.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

  // The only request input is `crmPage`, a bounded page index into the HQ
  // CRM company list. It never selects an organisation: scope comes only
  // from the verified session. homeOrganisationId (never the impersonated
  // organisationId) is excluded from the client list, same rule as
  // app/clients/page.tsx; organisationId (the workspace currently selected)
  // only decides whether HQ CRM/Commercial links can open directly.
  const rawPage = new URL(req.url).searchParams.get('crmPage');
  let crmPage = 0;
  if (rawPage !== null) {
    if (!/^\d{1,5}$/.test(rawPage) || Number(rawPage) > CRM_MAX_PAGE) {
      return NextResponse.json({ error: 'Invalid crmPage' }, { status: 400 });
    }
    crmPage = Number(rawPage);
  }

  const overview = await loadFounderClientOverview({
    homeOrganisationId: session.homeOrganisationId,
    activeOrganisationId: session.organisationId,
    crmPage,
  });

  // SEC-1B2 audit: records that this founder tool was accessed and whether
  // the primary source (organisations) loaded — never the payload itself.
  {
    const { ipAddress, userAgent } = requestMeta(req);
    await logFounderReadAccessed({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      resource: 'founder_clients',
      source: overview.sources.organisations === 'ok' ? 'live' : 'fallback',
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
}
