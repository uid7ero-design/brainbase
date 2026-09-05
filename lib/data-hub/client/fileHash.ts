// Data Hub 5A.3B — optional client-side SHA-256 pre-computation.
//
// Passing `expectedSha256` on initiate lets finalize's own mandatory
// HASH_MISMATCH check (finalize.ts) catch a corrupted-in-transit upload
// deterministically. This is genuinely OPTIONAL — omitting it degrades
// gracefully (finalize simply skips that specific check, matching
// finalize.ts's own `if (expectedSha256 && ...)` guard) — so this helper
// never throws for an unsupported environment; it resolves `undefined`
// instead, and callers are expected to treat that as "don't send
// expectedSha256", not as an error.

/**
 * Computes the lowercase hex SHA-256 of a File/Blob using the Web Crypto
 * SubtleCrypto API. Resolves `undefined` (never throws) when
 * `crypto.subtle` is unavailable (e.g. a non-secure-context test
 * environment) — see this module's own header comment.
 */
export async function computeFileSha256(file: File | Blob): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

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
