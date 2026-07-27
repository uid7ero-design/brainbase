import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for secrets (bootstrap tokens, cron
 * secrets, etc.) — shared so every call site compares the same way rather
 * than reimplementing the equal-length-buffer trick independently.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a same-length comparison so a length mismatch doesn't
    // resolve in an observably faster branch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
