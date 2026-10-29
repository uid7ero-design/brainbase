// Essio integration B1 — integration keys, scopes and capability mapping.
// Design: docs/integrations/essio.md.

/** Integrations that may hold machine credentials. One today. */
export const INTEGRATION_KEYS = ['essio'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

/**
 * Capability (modules.key) that must be enabled for the credential's own
 * organisation before any integration request is authorised. A valid
 * credential alone is never sufficient.
 */
export const INTEGRATION_CAPABILITY: Readonly<Record<IntegrationKey, string>> = Object.freeze({
  essio: 'essio_integration',
});

/** Scopes that can be granted to a credential (mirrors the DB CHECK). */
export const GRANTABLE_INTEGRATION_SCOPES = ['work:create', 'work:read', 'targets:read'] as const;
export type IntegrationScope = (typeof GRANTABLE_INTEGRATION_SCOPES)[number];

/**
 * Reserved for timeline append (B4/M3E). Named so it cannot be repurposed,
 * but NOT grantable: createIntegrationCredential rejects it and the
 * integration_credentials_scopes_check constraint excludes it.
 */
export const RESERVED_INTEGRATION_SCOPES = ['work:append'] as const;
export type ReservedIntegrationScope = (typeof RESERVED_INTEGRATION_SCOPES)[number];

export function isIntegrationKey(value: unknown): value is IntegrationKey {
  return typeof value === 'string' && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

export function isGrantableIntegrationScope(value: unknown): value is IntegrationScope {
  return typeof value === 'string' && (GRANTABLE_INTEGRATION_SCOPES as readonly string[]).includes(value);
}

export function isReservedIntegrationScope(value: unknown): value is ReservedIntegrationScope {
  return typeof value === 'string' && (RESERVED_INTEGRATION_SCOPES as readonly string[]).includes(value);
}

export type ScopeNormalisationResult =
  | { ok: true; scopes: IntegrationScope[] }
  | { ok: false; code: 'invalid_scopes' | 'scope_reserved' | 'scope_unknown' };

/**
 * Validates requested scopes: a non-empty array of grantable scope strings.
 * Duplicates collapse; the result is in canonical (declaration) order.
 */
export function normaliseIntegrationScopes(input: unknown): ScopeNormalisationResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, code: 'invalid_scopes' };
  const requested = new Set<IntegrationScope>();
  for (const scope of input) {
    if (typeof scope !== 'string') return { ok: false, code: 'invalid_scopes' };
    if (isReservedIntegrationScope(scope)) return { ok: false, code: 'scope_reserved' };
    if (!isGrantableIntegrationScope(scope)) return { ok: false, code: 'scope_unknown' };
    requested.add(scope);
  }
  return { ok: true, scopes: GRANTABLE_INTEGRATION_SCOPES.filter((s) => requested.has(s)) };
}
