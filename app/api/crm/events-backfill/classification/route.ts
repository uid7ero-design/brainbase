import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { previewEventContactClassification } from '@/lib/crm/eventContactClassificationBackfill';

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
