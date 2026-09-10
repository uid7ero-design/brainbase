import type { HrFieldTier } from './fieldTiers';

// HR-0.5 §5 — initial HR permission-helper SHAPE only.
//
// No hr_* tables or grants exist yet (that is HR-1+). This module defines
// the pure, server-side access-decision logic future HR routes will call
// once real person/grant data exists — it never queries a database itself;
// the caller resolves an HrAccessContext from real data (a future
// hr_people row, a future hr_administrators grant, etc.) and hands it in.
//
// Deliberately NOT derived from lib/session.ts's global Role/ROLE_ORDER
// hierarchy. HR-0 discovery found that hierarchy has no relationship
// scoping (a 'manager'-role user can see every employee, not just direct
// reports) and found super_admin/org-admin conflated with application
// administration, not HR-sensitivity administration — HrAccessContext
// below has no field for global role at all, so there is no code path by
// which holding super_admin (or any role) can, by itself, satisfy any
// function in this file. See this file's own tests for the explicit proof.
//
// HR-0's Critical Domain Rule applies throughout: selfPersonId is the
// caller's own HR person id ONLY if one has already been explicitly,
// auditably linked (a future hr_people.user_id relationship) — this module
// never infers a person from email/name, and a null selfPersonId (no
// linked person) is a normal, safely-handled case, not an error.

export type HrAccessContext = {
  organisationId: string;
  /** The signed-in user's own linked HR person id, or null if none. */
  selfPersonId: string | null;
  /** True only if an explicit, dedicated HR-administrator grant exists for
   *  this user in this org (a future hr_administrators row) — NEVER
   *  derived from role, and NEVER implied by super_admin or org-admin. */
  isHrAdministrator: boolean;
  /** True only if an explicit, narrower, per-case restricted-HR grant
   *  exists (HR-6). Always independent of isHrAdministrator in both
   *  directions — neither implies the other. */
  hasRestrictedHrAccess: boolean;
};

export type HrPersonTarget = {
  organisationId: string;
  personId: string;
  managerPersonId: string | null;
};

function sameOrg(a: { organisationId: string }, b: { organisationId: string }): boolean {
  return a.organisationId === b.organisationId;
}

function isSelf(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  return ctx.selfPersonId !== null && ctx.selfPersonId === target.personId;
}

function isDirectManager(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  return ctx.selfPersonId !== null
    && target.managerPersonId !== null
    && ctx.selfPersonId === target.managerPersonId;
}

/** Can the caller see this person's manager-safe/self-safe (internal-tier) fields at all? */
export function canViewPerson(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  if (!sameOrg(ctx, target)) return false;
  return isSelf(ctx, target) || isDirectManager(ctx, target) || ctx.isHrAdministrator;
}

/** Can the caller edit this person's record? Self-service edits are limited
 *  to non-restricted fields by canFieldBeShown()/route-level enforcement —
 *  this function only answers "may they attempt an edit at all". A direct
 *  manager never edits a report's record directly in this initial shape. */
export function canEditPerson(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  if (!sameOrg(ctx, target)) return false;
  return isSelf(ctx, target) || ctx.isHrAdministrator;
}

/** Confidential-tier fields (personal contact info, etc.) — deliberately
 *  narrower than canViewPerson(): a direct manager passes canViewPerson()
 *  but NOT this, matching the "manager-safe field subset" HR-0 recommended
 *  since no field-tier filtering exists anywhere in the codebase today. */
export function canViewConfidentialFields(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  if (!sameOrg(ctx, target)) return false;
  return isSelf(ctx, target) || ctx.isHrAdministrator;
}

/** Employment-status/manager/team changes — HR-administrator only, never
 *  self-service, never a plain direct-manager relationship. */
export function canManageEmployment(ctx: HrAccessContext, target: HrPersonTarget): boolean {
  if (!sameOrg(ctx, target)) return false;
  return ctx.isHrAdministrator;
}

/** Granting/revoking HR-administrator or restricted-HR status. HR-0.5 does
 *  not invent a separate "super HR admin" tier above this — a future phase
 *  may narrow it further if that proves necessary. */
export function canManageHrAccess(ctx: HrAccessContext): boolean {
  return ctx.isHrAdministrator;
}

/** Restricted-HR resources (HR-6: incidents/grievances/sensitive notes).
 *  Deliberately NOT `ctx.isHrAdministrator || ctx.hasRestrictedHrAccess` —
 *  restricted access must remain its own, separately-granted, narrower
 *  seam, never implied by the general HR-admin grant, and never implied
 *  by the target being the caller's own record (self-viewing one's own
 *  restricted case file is not assumed safe by default). */
export function canAccessRestrictedHr(ctx: HrAccessContext, target: { organisationId: string }): boolean {
  if (!sameOrg(ctx, target)) return false;
  return ctx.hasRestrictedHrAccess;
}

/** Field-tier-aware visibility check: combines canViewPerson() (may they
 *  see this person's record at all) with the specific field's tier. */
export function canFieldBeShown(ctx: HrAccessContext, target: HrPersonTarget, tier: HrFieldTier): boolean {
  if (!canViewPerson(ctx, target)) return false;
  if (tier === 'internal') return true;
  if (tier === 'confidential') return canViewConfidentialFields(ctx, target);
  return canAccessRestrictedHr(ctx, target);
}
