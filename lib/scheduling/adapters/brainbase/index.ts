import {
  assertSameTenant,
  type CustomerRef,
  type SchedulingPermission,
  type TenantContext,
} from '@scheduling/core';

// BrainBase side of the scheduling ports (see packages/scheduling/README.md).
//
// Phase 1 scope: the mapping rules that are pure and certain today, plus a
// table of how each port will be satisfied. There is NO database access, no
// session lookup and no capability check here, deliberately: nothing in the
// application imports this module yet, and the scheduling capability is not
// enabled for any organisation. Phase 2+ adds the SQL-backed repositories
// next to this file.
//
// Direction of dependency: this adapter imports @scheduling/core. The core
// never imports anything from here (enforced by
// packages/scheduling/tests/boundary.test.ts).

/**
 * The capability key for lib/capabilities/requireCapability.ts. Phase 2B.0 stages
 * scripts/scheduling/120_brainbase_capability.sql, which registers this key in `modules`
 * WITHOUT any `organisation_modules` row (not applied anywhere yet), so every organisation
 * stays denied. The only reader is lib/scheduling/access.ts, reached only through lib/scheduling/route.ts.
 */
export const SCHEDULING_CAPABILITY_KEY = 'scheduling' as const;

/**
 * The timezone BrainBase uses when neither a schedule nor its organisation has
 * one configured. The core takes the fallback as a parameter (it hard-codes no
 * region), so existing organisations that never set a timezone resolve to this
 * at read time without any backfill.
 */
export const BRAINBASE_FALLBACK_TIMEZONE = 'Australia/Adelaide' as const;

export type BrainBaseRole = 'super_admin' | 'admin' | 'manager' | 'viewer' | 'analyst';

// Mirrors the existing LD Tennis gates: dashboard session/enrolment routes
// require 'manager' to write; reads are available to any signed-in role.
// 'analyst' is deliberately absent so it fails closed, matching roleGte()
// in lib/session.ts (an unrecognised role is denied every privileged action).
// Customer-identifying audit detail is limited to the roles that can manage; a viewer sees the audit trail without it.
const MANAGER_PERMISSIONS: readonly SchedulingPermission[] = ['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity'];

const ROLE_PERMISSIONS: Readonly<Partial<Record<BrainBaseRole, readonly SchedulingPermission[]>>> = {
  viewer: ['scheduling.view'],
  manager: MANAGER_PERMISSIONS,
  admin: MANAGER_PERMISSIONS,
  super_admin: MANAGER_PERMISSIONS,
};

export function permissionsForRole(role: string): readonly SchedulingPermission[] {
  return ROLE_PERMISSIONS[role as BrainBaseRole] ?? [];
}

/**
 * Builds the core's TenantContext from values the caller has ALREADY
 * authenticated (an OrgSession from lib/org.ts requireSession/requireRole).
 * It performs no authentication of its own, so it must never be fed values
 * taken from a request body or query string.
 */
export function staffTenantContext(session: {
  organisationId: string;
  userId: string;
  role: string;
  timezone: string | null | undefined;
}): TenantContext {
  if (!session.organisationId) throw new Error('organisationId is required');
  const granted = new Set(permissionsForRole(session.role));
  return {
    organisationId: session.organisationId,
    // The organisation's timezone setting is nullable; fall back to the platform default.
    // This is the organisation-level zone; a schedule's own override is applied on top of it
    // with resolveScheduleTimezone() when a specific schedule is in play.
    timezone: session.timezone || BRAINBASE_FALLBACK_TIMEZONE,
    actor: { kind: 'staff', userId: session.userId },
    can: permission => granted.has(permission),
  };
}

/**
 * Tenant for the unauthenticated public booking surface. The organisation
 * must come from a trusted source (a route slug resolved server-side, or a
 * fixed deployment setting such as the one app/api/tennis/book uses today),
 * never from the request body.
 */
export function publicTenantContext(organisationId: string, timezone: string | null | undefined): TenantContext {
  if (!organisationId) throw new Error('organisationId is required');
  return {
    organisationId,
    timezone: timezone || BRAINBASE_FALLBACK_TIMEZONE,
    actor: { kind: 'public' },
    can: () => false,
  };
}

/** A row of the CRM `contacts` table, as far as scheduling cares. */
export interface ContactRow {
  id: string;
  organisation_id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * contacts -> core CustomerRef. Asserts the row belongs to the tenant before
 * mapping, so a query that forgot its organisation filter fails loudly here
 * instead of leaking another organisation's customer into a reservation.
 */
export function contactToCustomerRef(tenant: TenantContext, row: ContactRow): CustomerRef {
  assertSameTenant(tenant, row.organisation_id);
  return {
    id: row.id,
    organisationId: row.organisation_id,
    displayName: row.name,
    email: row.email,
    phone: row.phone,
  };
}

/**
 * How each core port will be satisfied inside BrainBase. Documentation as
 * data so a test can pin that every port has an owner, and so a future
 * phase cannot silently drop one.
 */
export const BRAINBASE_PORT_MAPPING = {
  tenant: 'lib/org.ts requireSession/requireRole plus the organisation timezone setting, via staffTenantContext()',
  customers: 'CRM `crm_contacts` (approved Phase 2B decision 3; new customers are LEAD), linked by lib/scheduling/crmLink.ts; the LD Tennis `contacts` table is not touched',
  reservations: 'new scheduling_* tables via the shared Neon client (lib/db.ts), raw SQL',
  availability: 'new scheduling_* tables via the shared Neon client (lib/db.ts), raw SQL',
  payments: 'existing payments foundation (Stripe); optional until a later phase',
  notifications: 'existing email layer (lib/email); optional until a later phase',
  clock: 'system clock plus organisation timezone',
} as const;
