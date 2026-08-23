import 'server-only';
import sql from '@/lib/db';

// Modular Platform Foundation Phase F.5B — the canonical, transport-
// independent server capability authority.
//
// This is an AUTHORIZATION-DATA primitive, not an authentication/
// session primitive (Phase F.5A). It deliberately does not resolve
// organisationId itself — it never calls getSession()/getAuthSession()/
// requireSession(), never inspects cookies, never resolves the
// super_admin org_override, and never reads request input. Callers
// (API routes, server actions, jobs, public organisation-scoped
// booking flows — e.g. app/api/tennis/book/route.ts, which has no
// authenticated session at all and resolves its organisation from a
// fixed env var) are responsible for obtaining a trusted
// `organisationId` however is appropriate for their own context, and
// pass it in explicitly. organisationId is treated as plain TEXT
// throughout — never cast to ::uuid — matching the Production-
// confirmed TEXT type of organisations.id (Phase F.1) and the
// TEXT-typed organisation_id/module_key columns of
// public.organisation_modules (Phase F.4).
//
// The canonical decision (Phase F.4/F.5A locked architecture):
//   modules.key = requested capability key
//   AND modules.active = true
//   AND organisation_modules.organisation_id = requested organisation
//   AND organisation_modules.module_key = modules.key
//   AND organisation_modules.enabled = true
// Anything less than that does not authorize access. No entitlement
// row, a disabled entitlement, a globally inactive capability, and an
// unknown capability key all fail closed identically from the caller's
// point of view (see CapabilityDenialReason) — this library never
// constructs an HTTP Response; mapping every ordinary denial to (e.g.)
// 403 is the future route layer's job, not this primitive's.
//
// Deliberately named "Capability", not "Module", in every exported
// identifier — an unrelated, pre-existing Prisma enum named `Module`
// (a waste/local-government dashboard-domain concept, confirmed still
// actively imported by services/persistence.ts in Phase F.5A) already
// occupies that name; reusing it here would create exactly the kind of
// ambiguous import this repository has already had to work around once
// (Phase F.4B's PlatformModule rename). The underlying database table
// is still literally named `modules` — only the application-facing
// vocabulary is Capability.
//
// Query strategy: two separate, sequential SELECTs (never a single
// JOIN) — a JOIN would silently collapse "capability doesn't exist",
// "capability is globally inactive", and "no entitlement row" into one
// indistinguishable empty result. Correctness (being able to tell these
// apart, even though only the CALLER of this file's result may ever
// observe the distinction) is prioritised over saving one query.
//
// Uses lib/db.ts's raw sql client — not Prisma Client. Prisma Client is
// confirmed (Phase F.5A) to be used only within one narrow, unrelated
// product vertical (bin-maintenance/financial/waste-kpi) in this
// repository; every general-purpose, organisation-scoped primitive
// (auth, organiser, CRM, Microsoft/Google integrations) uses lib/db.ts
// instead, and this primitive follows that dominant convention so it
// composes cleanly with everything it's meant to be used alongside.
//
// This file deliberately never reads organisations.plan and never
// queries any integration table (Microsoft/Google/Instagram connection
// state) — entitlement is independent of both commercial plan and
// external integrations, per the locked F.4/F.5A architecture.

export type CapabilityDenialReason =
  | 'UNKNOWN_CAPABILITY'
  | 'CAPABILITY_INACTIVE'
  | 'NO_ENTITLEMENT'
  | 'ENTITLEMENT_DISABLED'
  | 'DATABASE_ERROR';

export type CapabilityEntitlement = {
  key: string;
  config: Record<string, unknown>;
};

export type CapabilityCheckResult =
  | { allowed: true; entitlement: CapabilityEntitlement }
  | { allowed: false; reason: CapabilityDenialReason };

// Thrown by requireCapability() for an ORDINARY denial (unknown
// capability, globally inactive, no entitlement row, or a disabled
// entitlement). Identify via `instanceof CapabilityAccessError` —
// never by parsing `.message`. Carries the same non-sensitive
// `reason` a checkCapability() caller would have seen, for callers
// that want it (e.g. structured logging), but nothing about the
// underlying SQL/database.
export class CapabilityAccessError extends Error {
  reason: Exclude<CapabilityDenialReason, 'DATABASE_ERROR'>;
  constructor(reason: Exclude<CapabilityDenialReason, 'DATABASE_ERROR'>) {
    super('Capability access denied');
    this.name = 'CapabilityAccessError';
    this.reason = reason;
  }
}

// Thrown by requireCapability() specifically when entitlement could
// NOT be determined because the lookup itself failed (a database/
// infrastructure problem), as distinct from an ordinary, successfully-
// determined denial. Deliberately a SEPARATE class from
// CapabilityAccessError (not a subclass) so callers can tell "customer
// isn't entitled" apart from "BrainBase couldn't currently determine
// entitlement" via instanceof alone — the operational distinction
// Phase F.5B explicitly requires not be erased. Never carries raw SQL
// or database error text.
export class CapabilityDatabaseError extends Error {
  constructor() {
    super('Capability lookup failed');
    this.name = 'CapabilityDatabaseError';
  }
}

type ModuleRow = { active: boolean };
type EntitlementRow = { enabled: boolean; config: unknown };

function isPlainConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Non-throwing capability check. Always resolves — never rejects — so
 * the fail-closed guarantee cannot be violated by a caller forgetting a
 * try/catch. A database/infrastructure failure resolves to
 * `{ allowed: false, reason: 'DATABASE_ERROR' }`, exactly like any
 * other denial shape, but distinguishable by `reason` for callers that
 * need to tell it apart from an ordinary "not entitled" outcome (e.g.
 * requireCapability() below, or structured logging/alerting).
 */
export async function checkCapability(
  organisationId: string,
  capabilityKey: string,
): Promise<CapabilityCheckResult> {
  let moduleRows: ModuleRow[];
  try {
    moduleRows = (await sql`
      SELECT active FROM modules WHERE key = ${capabilityKey} LIMIT 1
    `) as ModuleRow[];
  } catch {
    return { allowed: false, reason: 'DATABASE_ERROR' };
  }

  const moduleRow = moduleRows[0];
  if (!moduleRow) return { allowed: false, reason: 'UNKNOWN_CAPABILITY' };
  if (moduleRow.active !== true) return { allowed: false, reason: 'CAPABILITY_INACTIVE' };

  let entitlementRows: EntitlementRow[];
  try {
    entitlementRows = (await sql`
      SELECT enabled, config
      FROM organisation_modules
      WHERE organisation_id = ${organisationId} AND module_key = ${capabilityKey}
      LIMIT 1
    `) as EntitlementRow[];
  } catch {
    return { allowed: false, reason: 'DATABASE_ERROR' };
  }

  const entitlementRow = entitlementRows[0];
  if (!entitlementRow) return { allowed: false, reason: 'NO_ENTITLEMENT' };
  if (entitlementRow.enabled !== true) return { allowed: false, reason: 'ENTITLEMENT_DISABLED' };

  // Defensive against unexpected/malformed data even though the column
  // is JSONB NOT NULL DEFAULT '{}' — a genuinely malformed row (e.g. a
  // manually-edited value that isn't a JSON object) must fail closed
  // rather than silently proceeding with a guessed-at config.
  if (!isPlainConfigObject(entitlementRow.config)) {
    return { allowed: false, reason: 'DATABASE_ERROR' };
  }

  return {
    allowed: true,
    entitlement: { key: capabilityKey, config: entitlementRow.config },
  };
}

/**
 * Throwing convenience wrapper around checkCapability(). Returns the
 * entitlement on success. Throws CapabilityAccessError for any
 * ordinary denial (unknown/inactive/no-entitlement/disabled), or
 * CapabilityDatabaseError specifically when the lookup itself failed —
 * two distinct, instanceof-checkable error types, never a generic
 * Error and never an HTTP Response (this library is transport-
 * independent; mapping to 403 belongs to a future route/caller layer).
 */
export async function requireCapability(
  organisationId: string,
  capabilityKey: string,
): Promise<CapabilityEntitlement> {
  const result = await checkCapability(organisationId, capabilityKey);
  if (result.allowed) return result.entitlement;
  if (result.reason === 'DATABASE_ERROR') throw new CapabilityDatabaseError();
  throw new CapabilityAccessError(result.reason);
}
