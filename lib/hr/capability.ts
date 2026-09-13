import 'server-only';
import {
  checkCapability, requireCapability,
  type CapabilityCheckResult, type CapabilityEntitlement,
} from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';

// HR-2 — HR-specific People-module bypass for super_admin, deliberately
// NOT implemented by changing lib/capabilities/requireCapability.ts
// itself. That primitive is the canonical, transport-independent
// entitlement authority for every module/vertical in this codebase
// (CRM, Organiser, Events, Data Hub, Commercial...) — it explicitly
// never resolves organisationId or a session itself and is documented
// as deliberately role-agnostic. Baking a super_admin bypass into it
// would silently grant super_admin every OTHER module too, platform-
// wide, which is a materially larger and separately-reviewable policy
// decision this phase was not asked to make. This file exists so that
// decision stays scoped to HR alone, in one place, reused by every HR
// entry point (API routes and the People page's own server layout)
// rather than duplicated as a `role === 'super_admin'` check at each
// call site.
const HR_CAPABILITY_KEY = 'people';

function bypassesHrCapability(role: Role): boolean {
  return role === 'super_admin';
}

/**
 * Non-throwing HR capability check — the People-module-aware analogue
 * of checkCapability(), for callers (currently only app/people/layout.tsx)
 * that want a boolean-shaped result rather than a thrown error. A
 * super_admin resolves to `allowed: true` unconditionally, without ever
 * querying organisation_modules; every other role defers entirely to
 * the real checkCapability() result, unchanged from HR-1.
 */
export async function checkHrCapability(organisationId: string, role: Role): Promise<CapabilityCheckResult> {
  if (bypassesHrCapability(role)) {
    return { allowed: true, entitlement: { key: HR_CAPABILITY_KEY, config: {} } };
  }
  return checkCapability(organisationId, HR_CAPABILITY_KEY);
}

/**
 * Throwing HR capability check — the People-module-aware analogue of
 * requireCapability(), for every app/api/hr/** route. Throws the exact
 * same CapabilityAccessError/CapabilityDatabaseError types
 * requireCapability() would, for every role except super_admin, so
 * every existing route's try/catch (which distinguishes the two by
 * `instanceof`) keeps working with no other change.
 */
export async function requireHrCapability(organisationId: string, role: Role): Promise<CapabilityEntitlement | null> {
  if (bypassesHrCapability(role)) return null;
  return requireCapability(organisationId, HR_CAPABILITY_KEY);
}
