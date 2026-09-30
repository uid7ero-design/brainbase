// BrainBase Assurance — human-readable record references.
//
// Pure (no server imports) so it can be unit tested. References are
// unique per organisation at the DB level (…_org_reference_key); the
// services retry on the rare collision (isReferenceCollision below).
// There is deliberately no counter table: A0.1C..A0.1D define none and
// this phase adds no schema.

export const REFERENCE_PREFIX = {
  incident: 'INC',
  investigation: 'INV',
  inspection: 'INS',
  audit: 'AUD',
  auditTemplate: 'ATP',
  template: 'TPL',
  finding: 'FND',
  action: 'ACT',
  evidence: 'EVD',
} as const;
export type ReferenceKind = keyof typeof REFERENCE_PREFIX;

// Crockford base32 without I, L, O, U — unambiguous when read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateReference(kind: ReferenceKind, now: Date = new Date(), random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return `${REFERENCE_PREFIX[kind]}-${now.getUTCFullYear()}-${suffix}`;
}

/** True for a unique violation on one of the Assurance `*_org_reference_key` constraints. */
export function isReferenceCollision(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== '23505') return false;
  const text = `${typeof e.constraint === 'string' ? e.constraint : ''} ${typeof e.message === 'string' ? e.message : ''}`;
  return /_org_reference_key/.test(text);
}

/** Runs `attempt(reference)` up to 4 times, regenerating the reference only on a reference collision. */
export async function withFreshReference<T>(kind: ReferenceKind, attempt: (reference: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await attempt(generateReference(kind));
    } catch (err) {
      if (!isReferenceCollision(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
