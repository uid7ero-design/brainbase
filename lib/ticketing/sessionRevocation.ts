import 'server-only';
import sql from '@/lib/db';

// Revokes every open Eve (ticketing) session of a user. Returned as an
// UNEXECUTED query so the password-change paths can run it in the SAME
// transaction as the password write: either both happen or neither does, and a
// failure surfaces to the caller instead of leaving stale Eve sessions active.
// BrainBase's own session semantics are untouched.
export function revokeUserSessionsQuery(userId: string, reason: 'PASSWORD_CHANGE' | 'ADMIN' = 'PASSWORD_CHANGE') {
  return sql`
    UPDATE ticketing_sessions SET revoked_at = NOW(), revoked_reason = ${reason}
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `;
}
