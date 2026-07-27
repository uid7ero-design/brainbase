/**
 * Best-effort trusted client IP for rate-limiting public routes. Trusts the
 * first entry of X-Forwarded-For, which is correct for this platform's
 * Vercel-fronted deployment (Vercel's edge sets this header itself and
 * prepends the real client IP) — not a general-purpose proxy-trust solution.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
