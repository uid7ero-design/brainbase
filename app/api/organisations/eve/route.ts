import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden, roleGte } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { getOrganisationEveEnabled, setOrganisationEveEnabled } from '@/lib/organisations/eveEnablement';
import { logOrganisationEveEnabledChanged } from '@/lib/events/auditLog';

// Eve organiser allow-list — whether this organisation's published events may
// appear on Eve (eveevents.com.au). admin+ only, the same floor as the
// organisation branding settings (app/api/organisations/branding/route.ts):
// appearing on a public product is an organisation-level decision, not an
// event manager's. organisationId comes only from requireSession()'s
// DB-validated result (which resolves a super_admin's org_override), never
// from the request, so a caller can only ever read or change its own
// organisation.
//
// Not gated on the Events capability: the setting is harmless without it (Eve
// still refuses an organisation that is not Events-entitled), and the
// response reports entitlement so the settings page can say so.

async function requireAdmin() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  if (!roleGte(session.role, 'admin')) {
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

async function eventsEntitled(organisationId: string): Promise<boolean> {
  return (await checkCapability(organisationId, 'events')).allowed;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const eveEnabled = await getOrganisationEveEnabled(auth.session.organisationId);
  if (eveEnabled === null) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });
  return NextResponse.json({ eveEnabled, eventsEntitled: await eventsEntitled(auth.session.organisationId) });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  // A JSON boolean only — never a truthy string or number, so a malformed
  // client can never switch an organisation on by accident.
  if (typeof body?.eveEnabled !== 'boolean') {
    return NextResponse.json({ error: 'eveEnabled must be true or false.' }, { status: 400 });
  }

  const result = await setOrganisationEveEnabled(auth.session.organisationId, body.eveEnabled);
  if (!result) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 });
  if (result.before !== result.after) {
    await logOrganisationEveEnabledChanged({
      organisationId: auth.session.organisationId, userId: auth.session.userId, before: result.before, after: result.after,
    });
  }
  return NextResponse.json({ eveEnabled: result.after, eventsEntitled: await eventsEntitled(auth.session.organisationId) });
}
