import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { previewEventContactBackfill, executeEventContactBackfill } from '@/lib/crm/eventBackfill';

// Phase 6.2 — historical Events -> CRM contact backfill.
//
// Authorization (§11): authenticated session, admin+ role (stricter
// than the manager minimum every other Events/CRM mutation uses — a
// bulk operation that can create many CRM contacts at once warrants a
// higher bar than a single order edit), AND both the 'crm' and 'events'
// capabilities — this reads event_orders (Events data) and writes
// crm_contacts (CRM data), so both entitlements are required, not just
// one. organisation_id is NEVER read from the request — only from the
// authenticated session, exactly like every other route in this
// module; there is no request body field this route will ever honour
// for organisation identity.
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

// GET — dry-run preview only. Never mutates event_orders or
// crm_contacts. See lib/crm/eventBackfill.ts's previewEventContactBackfill
// for the full classification logic.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const result = await previewEventContactBackfill(auth.session.organisationId);
  return NextResponse.json(result);
}

// POST — actually links/creates CRM contacts for this organisation's
// unlinked event orders. Requires the same authorization as preview;
// there is no separate "confirm" token — the manager UI's own
// preview-then-confirm flow (§5/§8) is what stands between a GET and a
// POST here, matching every other destructive-ish action in this
// codebase (e.g. cancel/refund) that relies on the UI's confirm()
// prompt rather than a server-side one-time token.
export async function POST() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const result = await executeEventContactBackfill(auth.session.organisationId);
  return NextResponse.json(result);
}
