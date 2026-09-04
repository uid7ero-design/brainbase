import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { previewEventContactClassification, executeEventContactClassification } from '@/lib/crm/eventContactClassificationBackfill';

// Historical CRM contact classification — PREVIEW ONLY in this phase.
// Nested under the existing /api/crm/events-backfill route family and
// reusing its exact authorization model verbatim (not reimplemented):
// authenticated session, admin+ role, AND both the 'events' and 'crm'
// capabilities — this reads event_orders (Events data) and
// crm_activities/crm_contacts (CRM data), so both entitlements are
// required, matching the sibling route's own reasoning. organisation_id
// is NEVER read from the request — only from the authenticated session.
//
// GET only. There is deliberately no POST here — execution
// (an actual reclassification) is out of scope for this phase and does
// not exist anywhere in this route or the library module it calls.
async function authorize() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  if (!roleGte(session.role, 'admin')) {
    return { ok: false as const, response: forbidden() };
  }
  try {
    await requireCapability(session.organisationId, 'events');
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return { ok: false as const, response: NextResponse.json({ error: 'Unable to verify access.' }, { status: 503 }) };
    }
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

// GET — read-only preview. Never mutates crm_contacts, event_orders, or
// crm_activities. See lib/crm/eventContactClassificationBackfill.ts's
// previewEventContactClassification for the full eligibility logic.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const result = await previewEventContactClassification(auth.session.organisationId);
  return NextResponse.json(result);
}

// POST — actually reclassifies eligible contacts to EVENT_CONTACT.
// Deliberately reads NO request body at all: organisationId and the
// executing actor both come only from the authenticated session, and
// which contacts get touched is re-derived entirely server-side by
// executeEventContactClassification — there is no field anywhere a
// client could supply to select, exclude, or expand the set of rows
// this touches. Same authorization as GET; there is no separate
// "confirm" token — the manager UI's own preview-then-confirm flow is
// what stands between a GET and a POST here, matching every other
// destructive-ish action in this codebase (e.g. the sibling
// /api/crm/events-backfill route's own POST).
export async function POST() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const result = await executeEventContactClassification(auth.session.organisationId, auth.session.userId);
  return NextResponse.json({ success: true, ...result });
}
