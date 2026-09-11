import { getClientIp } from '@/lib/clientIp';

// HR-0.5 §4 — a small, narrowly-scoped way for a future HR route to obtain
// safe request metadata for logHrEvent()'s optional ipAddress/userAgent
// fields, without inventing a new IP-resolution mechanism: reuses the
// existing lib/clientIp.ts helper (already trusted for Vercel's
// X-Forwarded-For behaviour) rather than duplicating its header logic.
//
// This does NOT thread request context through every existing audit
// caller in the codebase — HR-0 confirmed no vertical does that today, and
// fixing that platform-wide is explicitly out of this phase's scope. It
// only gives HR-1+ routes, which do have a live Request in hand, a single
// place to obtain the two optional fields their own audit calls may pass.

export type HrRequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function extractRequestMeta(req: Request): HrRequestMeta {
  const ip = getClientIp(req);
  return {
    // getClientIp() returns the literal string 'unknown' as a rate-limiting
    // key fallback — that placeholder is wrong for an audit column, where
    // "not available" should be a real NULL, not a fabricated value.
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: req.headers.get('user-agent'),
  };
}
