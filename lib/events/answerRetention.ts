import 'server-only';
import sql from '@/lib/db';
import { logResponsesRedacted } from '@/lib/events/auditLog';
import type { DataCategory } from '@/lib/events/registrationQuestions';

// Registration-answer retention (ADR 0013 §4b). Removes answer VALUES once
// they are due; nothing else.
//
// When an answer is due (from the category snapshotted when it was given —
// never the live question):
//   STANDARD     12 months after the event ends
//   SENSITIVE    30 days after the event ends; cancelled event: 7 days after
//                cancellation (whichever is earlier)
//   THIRD_PARTY  7 days after the event ends; cancelled event: 7 days after
//                cancellation (whichever is earlier)
//   CONSENT      3 years after the event ends
// Cancellation time is events.cancelled_at, or updated_at for events
// cancelled before that column existed.
//
// Removal: answer := NULL and redacted_at := now. The row keeps only
// structure — question id, label/type/category/help-text snapshots,
// timestamps — so it still shows that an answer existed. No answer text is
// copied anywhere: not to another column, the audit log or the logs.
//
// Never touched: orders, payments, refunds, tickets/check-in, legal
// acceptance, audit history. A legal hold on the event or the order
// (answers_legal_hold IS NOT NULL) skips its answers entirely.
//
// Idempotent: only rows with redacted_at IS NULL are considered, and the
// removal is ONE statement that re-checks due-ness and holds, so a re-run,
// an overlapping run or a hold placed mid-run cannot double-remove or
// remove a held answer. 'dry-run' reports what is due and changes nothing.

export const RETENTION_POLICY: Record<DataCategory, { afterEnd: string; afterCancel: string | null }> = {
  STANDARD: { afterEnd: '12 months', afterCancel: null },
  SENSITIVE: { afterEnd: '30 days', afterCancel: '7 days' },
  THIRD_PARTY: { afterEnd: '7 days', afterCancel: '7 days' },
  CONSENT: { afterEnd: '3 years', afterCancel: null },
};

export type RetentionMode = 'dry-run' | 'enforce';

export type RetentionSummary = {
  mode: RetentionMode;
  due: number;                       // due and not held (removed in enforce mode)
  redacted: number;                  // actually removed this run (0 in dry-run)
  held: number;                      // due but skipped because of a legal hold
  by_category: Record<string, number>;
  events: number;                    // events with at least one due answer
  duration_ms: number;
};

const DEFAULT_BATCH = 1000;

export async function runAnswerRetention(opts: { mode: RetentionMode; now?: Date; batchSize?: number }): Promise<RetentionSummary> {
  const started = Date.now();
  const now = (opts.now ?? new Date()).toISOString();
  const batch = Math.max(1, Math.min(opts.batchSize ?? DEFAULT_BATCH, 5000));

  // Due-ness is defined once, here, and used by both the report and the
  // removal so they can never disagree.
  const report = await sql`
    WITH due AS (
      SELECT r.id, r.organisation_id, r.event_id, r.data_category_snapshot AS category,
        (e.answers_legal_hold IS NOT NULL OR o.answers_legal_hold IS NOT NULL) AS held
      FROM event_registration_responses r
      JOIN events e ON e.id = r.event_id AND e.organisation_id = r.organisation_id
      JOIN event_orders o ON o.id = r.order_id AND o.organisation_id = r.organisation_id
      WHERE r.redacted_at IS NULL
        AND ${now}::timestamptz >= CASE r.data_category_snapshot
          WHEN 'SENSITIVE' THEN CASE WHEN e.status = 'CANCELLED'
            THEN LEAST(e.ends_at + interval '30 days', COALESCE(e.cancelled_at, e.updated_at) + interval '7 days')
            ELSE e.ends_at + interval '30 days' END
          WHEN 'THIRD_PARTY' THEN CASE WHEN e.status = 'CANCELLED'
            THEN LEAST(e.ends_at + interval '7 days', COALESCE(e.cancelled_at, e.updated_at) + interval '7 days')
            ELSE e.ends_at + interval '7 days' END
          WHEN 'CONSENT' THEN e.ends_at + interval '3 years'
          ELSE e.ends_at + interval '12 months'
        END
    )
    SELECT event_id, category, held, count(*)::int AS n FROM due GROUP BY event_id, category, held
  ` as { event_id: string; category: string; held: boolean; n: number }[];

  const byCategory: Record<string, number> = {};
  const dueEvents = new Set<string>();
  let due = 0, held = 0;
  for (const row of report) {
    if (row.held) { held += row.n; continue; }
    due += row.n;
    dueEvents.add(row.event_id);
    byCategory[row.category] = (byCategory[row.category] ?? 0) + row.n;
  }
  const events = dueEvents.size;

  let redacted = 0;
  if (opts.mode === 'enforce' && due > 0) {
    // One statement: re-checks due-ness and holds at the moment of removal.
    const removed = await sql`
      UPDATE event_registration_responses r
      SET answer = NULL, redacted_at = ${now}::timestamptz
      FROM events e, event_orders o
      WHERE r.id IN (
          SELECT r2.id FROM event_registration_responses r2
          JOIN events e2 ON e2.id = r2.event_id AND e2.organisation_id = r2.organisation_id
          JOIN event_orders o2 ON o2.id = r2.order_id AND o2.organisation_id = r2.organisation_id
          WHERE r2.redacted_at IS NULL AND e2.answers_legal_hold IS NULL AND o2.answers_legal_hold IS NULL
            AND ${now}::timestamptz >= CASE r2.data_category_snapshot
              WHEN 'SENSITIVE' THEN CASE WHEN e2.status = 'CANCELLED'
                THEN LEAST(e2.ends_at + interval '30 days', COALESCE(e2.cancelled_at, e2.updated_at) + interval '7 days')
                ELSE e2.ends_at + interval '30 days' END
              WHEN 'THIRD_PARTY' THEN CASE WHEN e2.status = 'CANCELLED'
                THEN LEAST(e2.ends_at + interval '7 days', COALESCE(e2.cancelled_at, e2.updated_at) + interval '7 days')
                ELSE e2.ends_at + interval '7 days' END
              WHEN 'CONSENT' THEN e2.ends_at + interval '3 years'
              ELSE e2.ends_at + interval '12 months'
            END
          ORDER BY r2.id
          LIMIT ${batch}
        )
        AND e.id = r.event_id AND e.organisation_id = r.organisation_id
        AND o.id = r.order_id AND o.organisation_id = r.organisation_id
        AND r.redacted_at IS NULL AND e.answers_legal_hold IS NULL AND o.answers_legal_hold IS NULL
      RETURNING r.id, r.organisation_id, r.event_id, r.data_category_snapshot AS category
    ` as { id: string; organisation_id: string; event_id: string; category: string }[];

    redacted = removed.length;
    // Audit per event: ids and counts only.
    const perEvent = new Map<string, { organisationId: string; eventId: string; ids: string[]; byCategory: Record<string, number> }>();
    for (const row of removed) {
      const key = `${row.organisation_id}:${row.event_id}`;
      let entry = perEvent.get(key);
      if (!entry) { entry = { organisationId: row.organisation_id, eventId: row.event_id, ids: [], byCategory: {} }; perEvent.set(key, entry); }
      entry.ids.push(row.id);
      entry.byCategory[row.category] = (entry.byCategory[row.category] ?? 0) + 1;
    }
    for (const entry of perEvent.values()) {
      await logResponsesRedacted({ organisationId: entry.organisationId, eventId: entry.eventId, responseIds: entry.ids, byCategory: entry.byCategory });
    }
  }

  return { mode: opts.mode, due, redacted, held, by_category: byCategory, events, duration_ms: Date.now() - started };
}
