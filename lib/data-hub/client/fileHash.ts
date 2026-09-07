// Data Hub 5A.3B — idempotency-key generation for the orchestrator.

/**
 * Generates a fresh idempotency key. Prefers `crypto.randomUUID()`
 * (available in every secure-context browser and in Node 19+); falls back
 * to a non-cryptographic RFC4122-shaped v4 UUID string when unavailable.
 * Idempotency keys need global uniqueness for this process's own
 * lifetime, not unpredictability — a fallback that is not
 * cryptographically random is an acceptable degradation here, unlike (say)
 * a session token.
 */
export function generateIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback: RFC4122-shaped v4 UUID via Math.random. Documented
  // non-cryptographic degradation — see this function's own header
  // comment.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
