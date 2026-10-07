import 'server-only';
import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import {
  INTEGRATION_CAPABILITY,
  isGrantableIntegrationScope,
  isIntegrationKey,
  normaliseIntegrationScopes,
  type IntegrationKey,
  type IntegrationScope,
} from './scopes';
import {
  formatIntegrationToken,
  generateIntegrationSecret,
  hashIntegrationSecret,
  parseIntegrationToken,
  verifyIntegrationSecret,
} from './token';

// Essio integration B1 — internal integration-credential service.
// Design: docs/integrations/essio.md.
//
// Internal layer only: no route calls this in B1. Callers that create,
// revoke or toggle credentials must already have authorised a super_admin
// (the future admin surface); authenticateIntegrationCredential is the
// machine-request gate future B2 routes will call.
//
// Invariants:
//   * The plaintext token exists only in createIntegrationCredential's
//     return value. It is never stored, logged, audited or put in an error.
//   * The organisation of an authenticated request comes ONLY from the
//     credential row. Nothing here accepts an organisation id from a caller
//     of authenticateIntegrationCredential.
//   * Integration access requires a valid, enabled, unrevoked credential
//     with the required scope AND the integration's capability enabled for
//     the credential's organisation.
//   * Lifecycle changes write their audit_logs row in the same statement as
//     the change (derived from RETURNING), with no secret material.

// ─── Types ────────────────────────────────────────────────────────────────

export type IntegrationCredentialStatus = 'active' | 'disabled' | 'revoked';

/** Credential metadata. Never contains the secret or its hash. */
export interface IntegrationCredentialSummary {
  id: string;
  organisationId: string;
  integrationKey: IntegrationKey;
  label: string;
  scopes: IntegrationScope[];
  status: IntegrationCredentialStatus;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
}

/** The authenticated machine identity of an integration request. */
export interface IntegrationPrincipal {
  readonly kind: 'integration';
  readonly credentialId: string;
  /** Derived from the credential row only. */
  readonly organisationId: string;
  readonly integrationKey: IntegrationKey;
  readonly scopes: readonly IntegrationScope[];
  readonly label: string;
}

export type IntegrationAuthFailureReason =
  | 'MALFORMED'
  | 'UNKNOWN_CREDENTIAL'
  | 'INVALID_SECRET'
  | 'REVOKED'
  | 'DISABLED'
  | 'MISSING_SCOPE'
  | 'CAPABILITY_DISABLED'
  | 'DATABASE_ERROR';

export type IntegrationAuthResult =
  | { ok: true; principal: IntegrationPrincipal }
  | { ok: false; reason: IntegrationAuthFailureReason };

export type IntegrationCredentialErrorCode =
  | 'invalid_organisation'
  | 'invalid_integration'
  | 'invalid_label'
  | 'invalid_scopes'
  | 'scope_reserved'
  | 'scope_unknown'
  | 'invalid_user'
  | 'invalid_credential_id'
  | 'not_found'
  | 'revoked';

/** Ordinary, caller-correctable failure. Message never contains secrets. */
export class IntegrationCredentialError extends Error {
  readonly code: IntegrationCredentialErrorCode;
  constructor(code: IntegrationCredentialErrorCode) {
    super(`Integration credential request rejected (${code})`);
    this.name = 'IntegrationCredentialError';
    this.code = code;
  }
}

/** Infrastructure failure. Never carries SQL or database error text. */
export class IntegrationCredentialDatabaseError extends Error {
  constructor() {
    super('Integration credential storage is unavailable');
    this.name = 'IntegrationCredentialDatabaseError';
  }
}

// ─── Internals ────────────────────────────────────────────────────────────

const MAX_LABEL_LENGTH = 120;
const LAST_USED_REFRESH_SECONDS = 300;
// Digest compared against when the credential id is unknown, so that path
// does the same hashing work as a real verification.
const UNKNOWN_CREDENTIAL_ID = '00000000-0000-4000-8000-000000000000';
const UNKNOWN_CREDENTIAL_HASH = hashIntegrationSecret(UNKNOWN_CREDENTIAL_ID, 'x'.repeat(43));

interface CredentialRow {
  id: string;
  organisation_id: string;
  integration_key: string;
  label: string;
  scopes: string[];
  enabled: boolean;
  created_by: string | null;
  created_at: unknown;
  updated_at: unknown;
  revoked_at: unknown;
  revoked_by: string | null;
  last_used_at: unknown;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toSummary(row: CredentialRow): IntegrationCredentialSummary {
  const scopes = row.scopes.filter(isGrantableIntegrationScope);
  const revokedAt = iso(row.revoked_at);
  return {
    id: row.id,
    organisationId: row.organisation_id,
    integrationKey: row.integration_key as IntegrationKey,
    label: row.label,
    scopes,
    status: revokedAt ? 'revoked' : row.enabled ? 'active' : 'disabled',
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    revokedAt,
    revokedBy: row.revoked_by,
    lastUsedAt: iso(row.last_used_at),
  };
}

function normaliseLabel(label: unknown): string {
  if (typeof label !== 'string') throw new IntegrationCredentialError('invalid_label');
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) {
    throw new IntegrationCredentialError('invalid_label');
  }
  return trimmed;
}

function requireText(value: unknown, code: IntegrationCredentialErrorCode): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new IntegrationCredentialError(code);
  }
  return value;
}

function requireCredentialId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new IntegrationCredentialError('invalid_credential_id');
  }
  return value.toLowerCase();
}

async function runQuery<T>(query: () => Promise<unknown>): Promise<T[]> {
  try {
    return (await query()) as T[];
  } catch {
    throw new IntegrationCredentialDatabaseError();
  }
}

// ─── Create ───────────────────────────────────────────────────────────────

/**
 * Creates a credential and returns its plaintext token. This is the only
 * time the token is available: only a digest is stored.
 */
export async function createIntegrationCredential(input: {
  organisationId: string;
  integrationKey: IntegrationKey;
  label: string;
  scopes: readonly string[];
  createdByUserId: string | null;
}): Promise<{ credential: IntegrationCredentialSummary; token: string }> {
  const organisationId = requireText(input.organisationId, 'invalid_organisation');
  if (!isIntegrationKey(input.integrationKey)) throw new IntegrationCredentialError('invalid_integration');
  const label = normaliseLabel(input.label);
  const scopeResult = normaliseIntegrationScopes(input.scopes);
  if (!scopeResult.ok) throw new IntegrationCredentialError(scopeResult.code);
  const createdBy =
    input.createdByUserId === null ? null : requireText(input.createdByUserId, 'invalid_user');

  const [org] = await runQuery<{ ok: number }>(
    () => sql`SELECT 1 AS ok FROM organisations WHERE id = ${organisationId}::text`,
  );
  if (!org) throw new IntegrationCredentialError('invalid_organisation');
  if (createdBy !== null) {
    const [user] = await runQuery<{ ok: number }>(
      () => sql`SELECT 1 AS ok FROM users WHERE id = ${createdBy}::text`,
    );
    if (!user) throw new IntegrationCredentialError('invalid_user');
  }

  const id = randomUUID();
  const secret = generateIntegrationSecret();
  const secretHash = hashIntegrationSecret(id, secret);
  const auditId = randomUUID();
  const auditState = JSON.stringify({
    credential_id: id,
    integration_key: input.integrationKey,
    label,
    scopes: scopeResult.scopes,
  });

  const [row] = await runQuery<CredentialRow>(
    () => sql`
      WITH created AS (
        INSERT INTO integration_credentials (
          id, organisation_id, integration_key, label, secret_hash, scopes, created_by
        ) VALUES (
          ${id}::uuid, ${organisationId}::text, ${input.integrationKey}::text, ${label}::text,
          ${secretHash}::text, ${scopeResult.scopes}::text[], ${createdBy}::text
        )
        RETURNING *
      ), audited AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT ${auditId}::text, created.organisation_id, ${createdBy}::text,
               'integration_credential.created', 'integration_credential', created.id::text,
               NULL, ${auditState}::jsonb
        FROM created
        RETURNING id
      )
      SELECT created.id::text AS id, created.organisation_id, created.integration_key, created.label,
             created.scopes, created.enabled, created.created_by, created.created_at, created.updated_at,
             created.revoked_at, created.revoked_by, created.last_used_at
      FROM created, audited
    `,
  );
  if (!row) throw new IntegrationCredentialDatabaseError();
  return { credential: toSummary(row), token: formatIntegrationToken(id, secret) };
}

// ─── Read ─────────────────────────────────────────────────────────────────

export async function listIntegrationCredentials(organisationId: string): Promise<IntegrationCredentialSummary[]> {
  const org = requireText(organisationId, 'invalid_organisation');
  const rows = await runQuery<CredentialRow>(
    () => sql`
      SELECT id::text AS id, organisation_id, integration_key, label, scopes, enabled,
             created_by, created_at, updated_at, revoked_at, revoked_by, last_used_at
      FROM integration_credentials
      WHERE organisation_id = ${org}::text
      ORDER BY created_at, id
    `,
  );
  return rows.map(toSummary);
}

export async function getIntegrationCredential(
  organisationId: string,
  credentialId: string,
): Promise<IntegrationCredentialSummary | null> {
  const org = requireText(organisationId, 'invalid_organisation');
  const id = requireCredentialId(credentialId);
  const [row] = await runQuery<CredentialRow>(
    () => sql`
      SELECT id::text AS id, organisation_id, integration_key, label, scopes, enabled,
             created_by, created_at, updated_at, revoked_at, revoked_by, last_used_at
      FROM integration_credentials
      WHERE organisation_id = ${org}::text AND id = ${id}::uuid
    `,
  );
  return row ? toSummary(row) : null;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

/** Permanently revokes a credential. Idempotent for an already-revoked one. */
export async function revokeIntegrationCredential(input: {
  organisationId: string;
  credentialId: string;
  revokedByUserId: string | null;
}): Promise<{ outcome: 'revoked' | 'already_revoked'; credential: IntegrationCredentialSummary }> {
  const org = requireText(input.organisationId, 'invalid_organisation');
  const id = requireCredentialId(input.credentialId);
  const actor = input.revokedByUserId === null ? null : requireText(input.revokedByUserId, 'invalid_user');
  const auditId = randomUUID();

  const [row] = await runQuery<CredentialRow>(
    () => sql`
      WITH revoked AS (
        UPDATE integration_credentials
        SET enabled = false, revoked_at = now(), revoked_by = ${actor}::text, updated_at = now()
        WHERE organisation_id = ${org}::text AND id = ${id}::uuid AND revoked_at IS NULL
        RETURNING *
      ), audited AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT ${auditId}::text, revoked.organisation_id, ${actor}::text,
               'integration_credential.revoked', 'integration_credential', revoked.id::text,
               NULL, jsonb_build_object('credential_id', revoked.id::text, 'status', 'revoked')
        FROM revoked
        RETURNING id
      )
      SELECT revoked.id::text AS id, revoked.organisation_id, revoked.integration_key, revoked.label,
             revoked.scopes, revoked.enabled, revoked.created_by, revoked.created_at, revoked.updated_at,
             revoked.revoked_at, revoked.revoked_by, revoked.last_used_at
      FROM revoked, audited
    `,
  );
  if (row) return { outcome: 'revoked', credential: toSummary(row) };

  const existing = await getIntegrationCredential(org, id);
  if (!existing) throw new IntegrationCredentialError('not_found');
  return { outcome: 'already_revoked', credential: existing };
}

/** Reversible pause. A revoked credential cannot be re-enabled. */
export async function setIntegrationCredentialEnabled(input: {
  organisationId: string;
  credentialId: string;
  enabled: boolean;
  actorUserId: string | null;
}): Promise<IntegrationCredentialSummary> {
  const org = requireText(input.organisationId, 'invalid_organisation');
  const id = requireCredentialId(input.credentialId);
  const actor = input.actorUserId === null ? null : requireText(input.actorUserId, 'invalid_user');
  const enabled = input.enabled === true;
  const action = enabled ? 'integration_credential.enabled' : 'integration_credential.disabled';
  const auditId = randomUUID();

  const [row] = await runQuery<CredentialRow>(
    () => sql`
      WITH changed AS (
        UPDATE integration_credentials
        SET enabled = ${enabled}::boolean, updated_at = now()
        WHERE organisation_id = ${org}::text AND id = ${id}::uuid
          AND revoked_at IS NULL AND enabled IS DISTINCT FROM ${enabled}::boolean
        RETURNING *
      ), audited AS (
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT ${auditId}::text, changed.organisation_id, ${actor}::text,
               ${action}::text, 'integration_credential', changed.id::text,
               jsonb_build_object('enabled', NOT changed.enabled),
               jsonb_build_object('enabled', changed.enabled)
        FROM changed
        RETURNING id
      )
      SELECT changed.id::text AS id, changed.organisation_id, changed.integration_key, changed.label,
             changed.scopes, changed.enabled, changed.created_by, changed.created_at, changed.updated_at,
             changed.revoked_at, changed.revoked_by, changed.last_used_at
      FROM changed, audited
    `,
  );
  if (row) return toSummary(row);

  const existing = await getIntegrationCredential(org, id);
  if (!existing) throw new IntegrationCredentialError('not_found');
  if (existing.status === 'revoked') throw new IntegrationCredentialError('revoked');
  return existing; // already in the requested state
}

// ─── Authenticate ─────────────────────────────────────────────────────────

/**
 * Authenticates a machine request token for one integration and scope.
 *
 * 1. parse the public credential id   2. load exactly that credential
 * 3. verify the secret (constant time) 4. reject revoked / disabled
 * 5. derive the organisation from the credential only
 * 6. require the scope                 7. require the integration capability
 * 8. return a typed principal
 *
 * Never throws for ordinary failures. `reason` is for server-side handling
 * and logging only; routes must map it through toPublicIntegrationAuthError
 * so callers cannot tell an unknown credential from a wrong secret.
 */
export async function authenticateIntegrationCredential(
  rawToken: unknown,
  requirement: { integrationKey: IntegrationKey; scope: IntegrationScope },
): Promise<IntegrationAuthResult> {
  const parsed = parseIntegrationToken(rawToken);
  if (!parsed) return { ok: false, reason: 'MALFORMED' };

  let row: (CredentialRow & { secret_hash: string }) | undefined;
  try {
    [row] = (await sql`
      SELECT id::text AS id, organisation_id, integration_key, label, scopes, enabled, secret_hash,
             created_by, created_at, updated_at, revoked_at, revoked_by, last_used_at
      FROM integration_credentials
      WHERE id = ${parsed.credentialId}::uuid
    `) as (CredentialRow & { secret_hash: string })[];
  } catch {
    return { ok: false, reason: 'DATABASE_ERROR' };
  }

  if (!row || row.integration_key !== requirement.integrationKey) {
    verifyIntegrationSecret(UNKNOWN_CREDENTIAL_ID, parsed.secret, UNKNOWN_CREDENTIAL_HASH);
    return { ok: false, reason: 'UNKNOWN_CREDENTIAL' };
  }
  if (!verifyIntegrationSecret(parsed.credentialId, parsed.secret, row.secret_hash)) {
    return { ok: false, reason: 'INVALID_SECRET' };
  }
  if (row.revoked_at !== null && row.revoked_at !== undefined) return { ok: false, reason: 'REVOKED' };
  if (!row.enabled) return { ok: false, reason: 'DISABLED' };

  const organisationId = row.organisation_id;
  const scopes = row.scopes.filter(isGrantableIntegrationScope);
  if (!scopes.includes(requirement.scope)) return { ok: false, reason: 'MISSING_SCOPE' };

  const capability = await checkCapability(organisationId, INTEGRATION_CAPABILITY[requirement.integrationKey]);
  if (!capability.allowed) {
    return { ok: false, reason: capability.reason === 'DATABASE_ERROR' ? 'DATABASE_ERROR' : 'CAPABILITY_DISABLED' };
  }

  // Best-effort, throttled usage marker. Never affects the auth decision.
  try {
    await sql`
      UPDATE integration_credentials SET last_used_at = now()
      WHERE id = ${row.id}::uuid
        AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => ${LAST_USED_REFRESH_SECONDS}::int))
    `;
  } catch {
    // ignored
  }

  return {
    ok: true,
    principal: Object.freeze({
      kind: 'integration' as const,
      credentialId: row.id,
      organisationId,
      integrationKey: requirement.integrationKey,
      scopes: Object.freeze([...scopes]),
      label: row.label,
    }),
  };
}

export function hasIntegrationScope(principal: IntegrationPrincipal, scope: IntegrationScope): boolean {
  return principal.scopes.includes(scope);
}

/**
 * Public mapping for future routes. Credential problems are indistinguishable
 * (401); scope and capability are 403; infrastructure is 503.
 */
export function toPublicIntegrationAuthError(reason: IntegrationAuthFailureReason): {
  status: 401 | 403 | 503;
  code: 'invalid_credentials' | 'insufficient_scope' | 'integration_disabled' | 'unavailable';
  message: string;
} {
  switch (reason) {
    case 'MISSING_SCOPE':
      return { status: 403, code: 'insufficient_scope', message: 'The credential does not permit this operation.' };
    case 'CAPABILITY_DISABLED':
      return { status: 403, code: 'integration_disabled', message: 'This integration is not enabled for the organisation.' };
    case 'DATABASE_ERROR':
      return { status: 503, code: 'unavailable', message: 'The service is temporarily unavailable.' };
    default:
      return { status: 401, code: 'invalid_credentials', message: 'Invalid or inactive credentials.' };
  }
}
