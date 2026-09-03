import sql from '@/lib/db';

// Phase D.4.5B — Organiser activity/history foundation. See the D.4.5A audit
// report for the full design rationale. This file is SCHEMA + SHARED HELPER
// ONLY — nothing in the application calls organiserActivityInsertQuery or
// recordOrganiserActivity yet. No Organiser mutation route writes activity
// as of this phase; this file must remain behaviorally inert until a future
// phase (D.4.5C+) explicitly instruments a route.
//
// D.4.5B deliberately does NOT choose the final atomic instrumentation
// technique for PATCH-style routes. In particular, it does NOT encode a
// "SELECT old row -> later transaction containing UPDATE + activity INSERT"
// pattern anywhere below, because a pre-transaction SELECT can go stale
// under concurrent writes (the value read may no longer be the value the
// UPDATE actually replaces). organiserActivityInsertQuery() below returns an
// UNEXECUTED query object precisely so a future caller can compose it into
// whatever race-safe strategy D.4.5C selects (a single writable CTE, an
// UPDATE ... RETURNING-based capture, sql.transaction() where genuinely
// safe, or another mechanism) — this file does not assume or normalize any
// one of them.
//
// Filesystem note: organiser_item_files (attachment upload/delete) crosses
// Postgres and on-disk file state (fs.writeFile/fs.unlink — see
// app/api/organiser/items/[itemId]/files/**). A Postgres transaction cannot
// roll back a filesystem write, so file activity can NOT later be made
// fully atomic merely by wrapping it in sql.transaction(). File
// instrumentation is explicitly out of scope for this phase and for
// whatever technique D.4.5C picks for PATCH routes — it needs its own,
// separate, explicit design (tracked as future D.4.5D/E work). Nothing in
// this file touches organiser_item_files, fs.writeFile, or fs.unlink.

// ─── Event taxonomy ─────────────────────────────────────────────────────────
//
// Frozen at exactly 17 event types (the D.4.5A audit report's own taxonomy
// list is authoritative; its prose summary miscounted it as "14" — that
// count was wrong and is not preserved here). Deliberately does NOT include
// item.status_changed / item.priority_changed / item.owner_changed /
// item.due_date_changed, and does NOT include any position/reorder-specific
// type — those remain represented as changed keys inside a plain
// item.updated event's before/after payload, not as distinct taxonomy
// entries. Extending this union is a deliberate, reviewed decision, not a
// default a caller should reach for — hence a closed union, not `string`.
export type OrganiserEventType =
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'group.created'
  | 'group.updated'
  | 'group.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'
  | 'item.created'
  | 'item.updated'
  | 'item.moved'
  | 'item.deleted'
  | 'comment.created'
  | 'file.added'
  | 'file.deleted'
  | 'import.completed';

// The complete, ordered list backing the DB CHECK constraint in
// app/api/admin/migrate/route.ts (step 40) — kept here, not duplicated by
// hand a second time, so the TypeScript union and the SQL CHECK can be
// tested for exact parity (see tests/containment/organiserActivitySchema.test.ts).
export const ORGANISER_EVENT_TYPES: readonly OrganiserEventType[] = [
  'board.created', 'board.updated', 'board.deleted',
  'group.created', 'group.updated', 'group.deleted',
  'column.created', 'column.updated', 'column.deleted',
  'item.created', 'item.updated', 'item.moved', 'item.deleted',
  'comment.created',
  'file.added', 'file.deleted',
  'import.completed',
];

// ─── Entity taxonomy ────────────────────────────────────────────────────────
//
// The 7 approved entity types. No group_id/column_id first-class columns
// exist on organiser_activity (see the CREATE TABLE in
// app/api/admin/migrate/route.ts) — entity_type + entity_id + metadata_json
// are sufficient to identify a group/column-level event; board_id/item_id
// are the only entity associations that get their own column, because those
// are the two the read-side query patterns (item Activity tab, board
// Activity feed) actually need to filter on directly.
export type OrganiserEntityType =
  | 'board'
  | 'group'
  | 'item'
  | 'column'
  | 'file'
  | 'comment'
  | 'import';

export const ORGANISER_ENTITY_TYPES: readonly OrganiserEntityType[] = [
  'board', 'group', 'item', 'column', 'file', 'comment', 'import',
];

// ─── Activity entry ─────────────────────────────────────────────────────────
//
// organisationId/actorUserId/actorName are always supplied by the caller
// from its own already-authorized session (e.g. authorizeOrganiserRequest's
// result) — this module never resolves a session, never fetches a user, and
// never falls back to a default/implied tenant. There is no
// role/capability field here: activity recording is a pure data write, not
// an authorization decision — the caller is expected to have already
// enforced access via the existing authorizeOrganiserRequest gate before
// ever reaching this module.
export interface OrganiserActivityEntry {
  organisationId: string;
  boardId: string;
  itemId?: string | null;
  actorUserId?: string | null;
  /** Point-in-time display-name snapshot (e.g. session.name at the moment
   *  of the mutation) — never re-derived by joining to `users` later, so
   *  history stays readable even after the actor renames their account or
   *  is deleted. */
  actorName: string;
  eventType: OrganiserEventType;
  entityType: OrganiserEntityType;
  /** The affected row's own id, as text — never a foreign key (see the
   *  CREATE TABLE comment in app/api/admin/migrate/route.ts): activity must
   *  survive deletion of the entity it describes. */
  entityId: string;
  /** Field-level diff only — just the keys that actually changed, not a
   *  full row snapshot. Run through sanitiseActivityPayload before storage
   *  by organiserActivityInsertQuery; callers do not need to pre-sanitise. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Event-specific extras that aren't a "changed field" (e.g. an import's
   *  item/group counts, a file's name/size). Also sanitised before storage. */
  metadata?: Record<string, unknown> | null;
}

// ─── Payload sanitisation ───────────────────────────────────────────────────
//
// Deliberately small and shallow — organiser_activity is a minimal diff
// log, not a content mirror. Never mutates the caller's objects; always
// returns new values.

export const MAX_ACTIVITY_STRING_LENGTH = 200;
const TRUNCATION_SUFFIX = '…(truncated)';

/** Deterministically truncates a string to MAX_ACTIVITY_STRING_LENGTH,
 *  appending an explicit, visible suffix so a truncated value is never
 *  mistaken for a complete one. Strings at or under the limit are returned
 *  unchanged. */
export function truncateActivityString(value: string, maxLength: number = MAX_ACTIVITY_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}${TRUNCATION_SUFFIX}`;
}

/** Sanitises one changed-field value for storage in before_json/after_json/
 *  metadata_json. Strings are truncated (truncateActivityString); numbers,
 *  booleans, null, and undefined pass through unchanged; a plain object
 *  (e.g. one changed custom_values entry) has each of its OWN top-level
 *  values sanitised the same way, one level deep — this does not recurse
 *  into further nested objects/arrays, which are instead JSON.stringify'd
 *  and truncated as a single string rather than walked further. This is
 *  intentionally not a general-purpose deep serialiser; callers needing to
 *  diff a specific known shape should extract just the changed keys before
 *  calling this, not pass an entire large object and expect a smart diff. */
export function sanitiseActivityFieldValue(value: unknown): unknown {
  if (typeof value === 'string') return truncateActivityString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return truncateActivityString(JSON.stringify(value));

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (typeof v === 'string') {
      out[key] = truncateActivityString(v);
    } else if (v !== null && typeof v === 'object') {
      out[key] = truncateActivityString(JSON.stringify(v));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Sanitises a whole before/after/metadata payload object (each top-level
 *  value run through sanitiseActivityFieldValue). Returns null for a
 *  null/undefined input rather than an empty object, so "no diff" and "diff
 *  of nothing" stay distinguishable in before_json/after_json. Never
 *  mutates the input. */
export function sanitiseActivityPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    out[key] = sanitiseActivityFieldValue(payload[key]);
  }
  return out;
}

// ─── Insert query helper ────────────────────────────────────────────────────
//
// Returns an UNEXECUTED query (the same "query builder, not yet awaited"
// shape lib/tennisSchedule.ts's own auditLogInsertQuery already uses for
// composing into neon's sql.transaction()) — deliberately NOT awaited here,
// and deliberately NOT designed around any one future transaction strategy.
// A future caller may:
//   - await it directly for an intentionally best-effort write (see
//     recordOrganiserActivity below),
//   - include it as one element of an sql.transaction([...]) array alongside
//     an already-known-safe mutation query,
//   - or compose it into a single writable CTE / other race-safe pattern
//     D.4.5C selects for PATCH-style routes.
// This function makes no assumption about which; it only builds the query.
export function organiserActivityInsertQuery(entry: OrganiserActivityEntry) {
  const before = sanitiseActivityPayload(entry.before ?? null);
  const after = sanitiseActivityPayload(entry.after ?? null);
  const metadata = sanitiseActivityPayload(entry.metadata ?? null) ?? {};

  return sql`
    INSERT INTO organiser_activity (
      organisation_id, board_id, item_id, actor_user_id, actor_name,
      event_type, entity_type, entity_id, before_json, after_json, metadata_json
    ) VALUES (
      ${entry.organisationId}, ${entry.boardId}, ${entry.itemId ?? null},
      ${entry.actorUserId ?? null}, ${entry.actorName},
      ${entry.eventType}, ${entry.entityType}, ${entry.entityId},
      ${before !== null ? JSON.stringify(before) : null}::jsonb,
      ${after !== null ? JSON.stringify(after) : null}::jsonb,
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

// ─── Best-effort wrapper ────────────────────────────────────────────────────
//
// Executes organiserActivityInsertQuery and catches/logs its own failure —
// modeled directly on lib/events/auditLog.ts's insertAuditLog, which
// documents the exact same contract: "a failure to write an audit entry
// must never fail the underlying mutation it is describing."
//
// IMPORTANT — this is NOT a universal default:
//   - Best-effort (fire, catch, log, never throw) is appropriate ONLY for
//     flows that are deliberately non-atomic by design — e.g. a future
//     import.completed aggregate event written after a multi-row import
//     loop that is itself not wrapped in a single transaction (see the
//     D.4.5A audit's own analysis of why the import route can't practically
//     be made atomic). It must not be reached for automatically just
//     because it's convenient.
//   - A future mutation that IS wrapped in an atomic strategy (a single
//     UPDATE/INSERT, a writable CTE, an sql.transaction()) should compose
//     organiserActivityInsertQuery directly into that atomic strategy
//     instead of calling this wrapper — using recordOrganiserActivity there
//     would silently reintroduce the "mutation succeeded, history silently
//     didn't" gap the atomic strategy exists to close.
//   - This function has ZERO production callers as of D.4.5B. Whether and
//     where it gets called is a decision for whichever future phase
//     instruments a genuinely non-atomic flow (see the D.4.5A audit's
//     phasing plan) — it is not this phase's decision to make on their
//     behalf, and its mere existence here does not authorize using it for
//     every Organiser mutation.
export async function recordOrganiserActivity(entry: OrganiserActivityEntry): Promise<void> {
  try {
    await organiserActivityInsertQuery(entry);
  } catch (err) {
    console.error(
      '[organiser activity] write failed (ignored — the underlying mutation remains valid)',
      err,
      { eventType: entry.eventType, entityType: entry.entityType, entityId: entry.entityId },
    );
  }
}
