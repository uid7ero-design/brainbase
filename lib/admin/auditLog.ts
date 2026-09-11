import sql from '@/lib/db';

// SEC-1A — audit wiring for the two critical admin routes (impersonation,
// user administration), applying ADR-0003
// (docs/architecture/decisions/0003-commercial-audit-wiring-standard.md).
// Reuses the existing, already-live, generic audit_logs table — no new
// schema, no organiser_activity integration. Modeled directly on
// lib/commercial/auditLog.ts's shape, per ADR-0003 §6: "the two existing,
// now-proven shapes are the pattern to copy per-vertical... not a shared
// generic utility."
//
// Every mutation this file logs is HUMAN-INITIATED and already gated by
// requireRole('super_admin') (session + DB-current role/status/org) before
// the state change runs — per ADR-0003 §3, this makes a separate,
// best-effort (non-transactional) write the correct choice, exactly like
// the commercial/events verticals. Call these functions AFTER the real
// mutation has already committed successfully — never before.
//
// action namespace: '<resource_type>.<verb>', matching ADR-0003 §12.

async function insertAuditLog(entry: {
  organisationId: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      VALUES (
        ${crypto.randomUUID()}, ${entry.organisationId}, ${entry.userId},
        ${entry.action}, ${entry.resourceType}, ${entry.resourceId},
        ${entry.beforeState ? JSON.stringify(entry.beforeState) : null}::jsonb,
        ${entry.afterState ? JSON.stringify(entry.afterState) : null}::jsonb,
        ${entry.ipAddress}, ${entry.userAgent}
      )
    `;
  } catch (err) {
    console.error('[admin audit] audit_logs write failed (ignored — the underlying mutation remains valid)', err, { action: entry.action, resourceId: entry.resourceId });
  }
}

// ── Impersonation ────────────────────────────────────────────────────────
//
// audit_logs.organisation_id is set to the TARGET (impersonated)
// organisation for both events — "which tenant does this event pertain
// to" — with the actor's own home organisation additionally captured
// inside after_state/before_state, since the schema has only one
// organisation_id column but this action genuinely spans two tenants.

export async function logImpersonationStarted(params: {
  actorUserId: string;
  actorHomeOrganisationId: string;
  targetOrganisationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.targetOrganisationId,
    userId: params.actorUserId,
    action: 'impersonation.started',
    resourceType: 'impersonation',
    resourceId: params.targetOrganisationId,
    beforeState: null,
    afterState: {
      actor_home_organisation_id: params.actorHomeOrganisationId,
      target_organisation_id: params.targetOrganisationId,
    },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logImpersonationStopped(params: {
  actorUserId: string;
  actorHomeOrganisationId: string;
  targetOrganisationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.targetOrganisationId,
    userId: params.actorUserId,
    action: 'impersonation.stopped',
    resourceType: 'impersonation',
    resourceId: params.targetOrganisationId,
    beforeState: {
      actor_home_organisation_id: params.actorHomeOrganisationId,
      target_organisation_id: params.targetOrganisationId,
    },
    afterState: null,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

// ── User administration ──────────────────────────────────────────────────
//
// Never carries password/password_hash in before/after state — callers
// build their own before/after objects from an explicit safe-field list
// (name/role/organisation_id/email) and must never include either
// password field; a password change is represented only as the boolean
// marker `password_changed: true` on afterState, never the value or hash.

export async function logUserCreated(params: {
  actorUserId: string;
  actorOrganisationId: string;
  newUserId: string;
  after: { username: string; email: string | null; name: string; role: string; organisation_id: string };
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'user.created',
    resourceType: 'user',
    resourceId: params.newUserId,
    beforeState: null,
    afterState: params.after,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logUserUpdated(params: {
  actorUserId: string;
  actorOrganisationId: string;
  targetUserId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'user.updated',
    resourceType: 'user',
    resourceId: params.targetUserId,
    beforeState: params.before,
    afterState: params.after,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logUserRoleChanged(params: {
  actorUserId: string;
  actorOrganisationId: string;
  targetUserId: string;
  beforeRole: string;
  afterRole: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'user.role_changed',
    resourceType: 'user',
    resourceId: params.targetUserId,
    beforeState: { role: params.beforeRole },
    afterState: { role: params.afterRole },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logUserOrganisationChanged(params: {
  actorUserId: string;
  actorOrganisationId: string;
  targetUserId: string;
  beforeOrganisationId: string;
  afterOrganisationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'user.organisation_changed',
    resourceType: 'user',
    resourceId: params.targetUserId,
    beforeState: { organisation_id: params.beforeOrganisationId },
    afterState: { organisation_id: params.afterOrganisationId },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logUserDeleted(params: {
  actorUserId: string;
  actorOrganisationId: string;
  targetUserId: string;
  before: { username?: string; name?: string; role: string; organisation_id: string };
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'user.deleted',
    resourceType: 'user',
    resourceId: params.targetUserId,
    beforeState: params.before,
    afterState: null,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

// ── SEC-1B1: privileged migration/mutation tooling ───────────────────────
//
// None of these four events is organisation-scoped in the ordinary sense —
// three of the four routes (full schema migration, session-table migration,
// CRM classification migration) are platform-wide DDL, not tenant data, so
// there is no real "target organisation" to attribute the event to. Per the
// same reasoning already applied to impersonation events (HR-0.5/SEC-1A),
// organisation_id is set to the ACTOR's own organisation (audit_logs.
// organisation_id is NOT NULL with a real FK — the acting user's own row
// always satisfies it) — "which tenant does this belong to" is answered as
// "the operator who ran it", since these operations don't belong to any
// tenant's own data. logDemoSeedExecuted is the one genuinely org-scoped
// exception: the seed operation is scoped to and mutates exactly one real
// tenant's data, so organisation_id there is that tenant's real id.
//
// resource_id is a STABLE identifier naming *what* was run, not a random
// per-invocation id — these are singleton operations (there is exactly one
// "full schema migration" a caller can run), so a stable string lets a
// future query find every historical run of the same operation.

export async function logAdminMigrationExecuted(params: {
  actorUserId: string;
  actorOrganisationId: string;
  stepsCompleted: number;
  lastStep: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'admin_migration.executed',
    resourceType: 'schema_migration',
    resourceId: 'admin_migrate_full',
    beforeState: null,
    afterState: { stepsCompleted: params.stepsCompleted, lastStep: params.lastStep },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logSessionMigrationExecuted(params: {
  actorUserId: string;
  actorOrganisationId: string;
  results: string[];
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'session_migration.executed',
    resourceType: 'schema_migration',
    resourceId: 'admin_migrate_sessions',
    beforeState: null,
    afterState: { results: params.results },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logCrmClassificationMigrationExecuted(params: {
  actorUserId: string;
  actorOrganisationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.actorOrganisationId,
    userId: params.actorUserId,
    action: 'crm_classification_migration.executed',
    resourceType: 'schema_migration',
    resourceId: 'crm_contacts_classification',
    beforeState: null,
    afterState: { migration: 'crm_contacts.classification' },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function logDemoSeedExecuted(params: {
  actorUserId: string;
  organisationId: string;
  fileId: string;
  counts: { wasteRecords: number; fleetMetrics: number; serviceRequests: number };
  enabledModules: string[];
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await insertAuditLog({
    organisationId: params.organisationId,
    userId: params.actorUserId,
    action: 'demo_seed.executed',
    resourceType: 'demo_seed',
    resourceId: params.fileId,
    beforeState: null,
    afterState: { counts: params.counts, enabledModules: params.enabledModules },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}
