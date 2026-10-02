import 'server-only';
import sql from '@/lib/db';

// BrainBase Assurance — the ONE SQL definition of "open timeframe" and
// "due soon", used by both the dashboard and Deadlines so the two can never
// disagree. (Client-side badges use deadlineUrgency() in deadlineRules.ts,
// which applies the same DUE_SOON_DAYS window.)
//
// Aliases are a fixed allow-list interpolated via sql.unsafe(); no
// caller-supplied text is ever passed to sql.unsafe().

const ALLOWED_TIMEFRAME_ALIASES = new Set(['t']);

function alias(name: string) {
  if (!ALLOWED_TIMEFRAME_ALIASES.has(name)) throw new Error(`assurance deadlines: alias "${name}" is not allow-listed`);
  return sql.unsafe(name);
}

/** Timeframe row aliased `as` is still running (persisted status ACTIVE or OVERDUE). */
export function timeframeRunningSql(as = 't') {
  return sql`${alias(as)}.status IN ('ACTIVE', 'OVERDUE')`;
}

/** The due-soon cutoff: now() + 3 days (DUE_SOON_DAYS). */
export function dueSoonCutoffSql() {
  return sql`(now() + interval '3 days')`;
}
