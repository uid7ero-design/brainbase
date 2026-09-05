import { NextResponse } from 'next/server';
import { requireSession, roleGte, unauthorized, forbidden, type OrgSession } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

// Phase C2 — reusable authorization primitive for every future
// Commercial Suite route (Sales/Quotes/Invoicing/Purchasing/Expenses/
// Budgeting/Finance Intelligence). Modeled directly on
// lib/debtors/authorize.ts / lib/organiser/authorize.ts /
// lib/events/authorize.ts's identical, already-established shape — this
// is NOT a second authorization system, it is the same composed
// session -> capability -> role pattern, parametrized by which
// Commercial capability key a given route needs. Enforces, additively:
//   1. an authenticated session (401 if missing/invalid)
//   2. the calling organisation's entitlement for the specific
//      Commercial capability key this route needs (403 if not entitled,
//      503 if entitlement could not be determined)
//   3. a minimum role for the specific operation (403 if below minimum)
//
// Never resolves organisationId from anything other than
// requireSession()'s own DB-backed result.

export type CommercialCapabilityKey =
  | 'sales'
  | 'quotes'
  | 'invoicing'
  | 'purchasing'
  | 'expenses'
  | 'budgeting'
  | 'finance_intelligence';

// Minimum roles for the four operation classes named in the C2 brief
// (§12). These are reusable DEFAULTS, not final per-module policy — a
// future module is free to require a stricter floor for a specific
// action (e.g. a large discount approval requiring 'super_admin'), but
// must never go BELOW these without a fresh, evidence-based decision,
// matching this repository's fail-closed-by-default discipline.
//
//   view            — 'viewer'      (read-only, matches every existing
//                      read-gated route's floor: organiser, events,
//                      debtors KPI)
//   create/edit     — 'manager'     (mutating a document/catalogue row,
//                      matches Organiser's own create/edit floor)
//   approve         — 'admin'       (an approval/rejection decision is a
//                      higher-trust action than an ordinary edit — no
//                      existing precedent uses 'manager' for an approval
//                      gate anywhere in this codebase)
//   administer      — 'admin'       (org-level configuration — numbering
//                      prefixes, cost centres, tax codes — is an
//                      organisation's OWN top-level user's job, not
//                      BrainBase staff's; 'super_admin' remains reserved
//                      for cross-organisation platform administration,
//                      matching middleware.ts's own /admin,/clients gate)
export const COMMERCIAL_MIN_ROLE = {
  view: 'viewer' as Role,
  createEdit: 'manager' as Role,
  approve: 'admin' as Role,
  administer: 'admin' as Role,
};

export type CommercialAuthResult =
  | { ok: true; session: OrgSession }
  // Response, not NextResponse — lib/org.ts's unauthorized()/forbidden()
  // helpers return a plain Response, matching lib/debtors/authorize.ts's
  // own identical typing note.
  | { ok: false; response: Response };

export async function authorizeCommercialRequest(
  capabilityKey: CommercialCapabilityKey,
  minRole: Role,
): Promise<CommercialAuthResult> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  try {
    await requireCapability(session.organisationId, capabilityKey);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json({ error: `Unable to verify ${capabilityKey} access.` }, { status: 503 }),
      };
    }
    return { ok: false, response: forbidden() };
  }

  if (!roleGte(session.role, minRole)) {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, session };
}
