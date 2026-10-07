import { createHash, randomBytes } from 'crypto';
import { secureCompare } from '@/lib/secureCompare';

// Essio integration B1 — machine credential token format.
//
//   bbint_<credential id: 32 lowercase hex>_<secret: 43 base64url chars>
//
// The public part (credential id) selects exactly one integration_credentials
// row, so verification never scans credentials. The secret is 32 bytes from
// the CSPRNG (256 bits). Only a digest is stored:
//
//   secret_hash = sha256_hex('bbint:v1:' || <credential id, canonical UUID> || ':' || <secret>)
//
// A fast hash is appropriate because the secret is high-entropy random data,
// not a human password (no dictionary to slow down). Binding the credential id
// into the digest means a stored hash copied onto another row never verifies.
// Comparison uses lib/secureCompare (constant time).
//
// Nothing in this module logs, and no error it produces contains a token.

export const INTEGRATION_TOKEN_PREFIX = 'bbint';
export const INTEGRATION_HASH_VERSION = 1;
const SECRET_BYTES = 32;
const SECRET_LENGTH = 43; // base64url(32 bytes), unpadded
export const INTEGRATION_TOKEN_LENGTH = INTEGRATION_TOKEN_PREFIX.length + 1 + 32 + 1 + SECRET_LENGTH;

const TOKEN_RE = /^bbint_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export interface ParsedIntegrationToken {
  /** Canonical lowercase UUID of the credential row. */
  credentialId: string;
  secret: string;
}

export function canonicalCredentialId(id: string): string | null {
  const lower = id.toLowerCase();
  return UUID_RE.test(lower) ? lower : null;
}

export function generateIntegrationSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export function formatIntegrationToken(credentialId: string, secret: string): string {
  const id = canonicalCredentialId(credentialId);
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error('Cannot format integration token: invalid credential id or secret shape');
  }
  return `${INTEGRATION_TOKEN_PREFIX}_${id.replace(/-/g, '')}_${secret}`;
}

/** Strict parse. Anything that is not exactly the token shape returns null. */
export function parseIntegrationToken(raw: unknown): ParsedIntegrationToken | null {
  if (typeof raw !== 'string' || raw.length !== INTEGRATION_TOKEN_LENGTH) return null;
  const match = TOKEN_RE.exec(raw);
  if (!match) return null;
  const hex = match[1];
  const credentialId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { credentialId, secret: match[2] };
}

export function hashIntegrationSecret(credentialId: string, secret: string): string {
  const id = canonicalCredentialId(credentialId);
  if (!id) throw new Error('Cannot hash integration secret: invalid credential id');
  return createHash('sha256').update(`bbint:v${INTEGRATION_HASH_VERSION}:${id}:${secret}`, 'utf8').digest('hex');
}

export function verifyIntegrationSecret(credentialId: string, secret: string, storedHash: string): boolean {
  if (!HASH_RE.test(storedHash)) return false;
  const id = canonicalCredentialId(credentialId);
  if (!id) return false;
  return secureCompare(hashIntegrationSecret(id, secret), storedHash);
}

/**
 * Extracts a bearer token from an Authorization header value. Returns null
 * for anything that is not a single `Bearer <token>` of plausible length.
 * (For future B2 routes; no route uses it in B1.)
 */
export function parseBearerAuthorization(header: string | null | undefined): string | null {
  if (typeof header !== 'string' || header.length > 256) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  return match ? match[1] : null;
}
