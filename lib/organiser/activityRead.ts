import sql from '@/lib/db';

// Phase D.4.5D — item-scoped, tenant-safe, deletion-safe activity reads.
//
// DELETION-SAFE BY CONSTRUCTION: organiser_activity.item_id carries no FK
// to organiser_items (see the CREATE TABLE comment in
// app/api/admin/migrate/route.ts, step 40) specifically so a deleted
// item's history remains queryable. This module therefore NEVER joins
// against or requires a live organiser_items row for its own existence —
// it queries organiser_activity directly, scoped by organisation_id (a
// real FK, always present) + item_id (indexed via
// idx_organiser_activity_item, FK-free) + entity_type = 'item'.
//
// TENANT BOUNDARY: every call restates organisation_id directly in its own
// WHERE clause from the caller's already-authorized trusted context — this
// module never resolves its own session and never accepts organisationId
// from anything the caller derived from request input.
//
// GET-only / read-only: this module has no write path of any kind.
// Activity remains append-only, written only by the item POST/PATCH/DELETE
// routes' own atomic writable-CTE instrumentation (see
// app/api/organiser/items/[itemId]/route.ts and
// app/api/organiser/boards/[boardId]/items/route.ts) — this module never
// writes a row itself.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface OrganiserActivityEventDTO {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: { user_id: string | null; name: string };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ListItemActivityTrustedContext {
  organisationId: string;
  itemId: string;
  /** Opaque cursor from a prior page's next_cursor. Omit for the first page. */
  cursor?: string;
  /** Defaults to DEFAULT_LIMIT; must be a positive integer <= MAX_LIMIT. */
  limit?: number;
}

export type ListItemActivityFailureCode = 'INVALID_ITEM_ID' | 'INVALID_CURSOR' | 'INVALID_LIMIT';

export type ListItemActivityResult =
  | { ok: true; activity: OrganiserActivityEventDTO[]; next_cursor: string | null }
  | { ok: false; code: ListItemActivityFailureCode; message: string };

function fail(
  code: ListItemActivityFailureCode,
  message: string,
): { ok: false; code: ListItemActivityFailureCode; message: string } {
  return { ok: false, code, message };
}

// ─── Keyset pagination cursor ───────────────────────────────────────────────
// Encodes ONLY the (created_at, id) ordering tuple — never authoritative for
// tenant/item identity. organisationId and itemId always come from the
// trusted context and are reasserted in the WHERE clause on every call
// regardless of what a cursor decodes to; a forged-but-well-formed cursor
// can therefore only reposition a caller within their OWN already-scoped
// result set, never permit cross-tenant or cross-item enumeration.

interface CursorTuple { createdAt: string; id: string }

function encodeCursor(tuple: CursorTuple): string {
  return Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorTuple | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes('createdAt') || !keys.includes('id')) return null;
  const { createdAt, id } = parsed as { createdAt: unknown; id: unknown };
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof createdAt !== 'string' || Number.isNaN(new Date(createdAt).getTime())) return null;
  return { createdAt, id };
}

function validateLimit(limit: number | undefined): number | null {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT) return null;
  return value;
}

interface ActivityRow {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string | null;
  actor_name: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

function toDTO(row: ActivityRow): OrganiserActivityEventDTO {
  return {
    id: row.id,
    event_type: row.event_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    actor: { user_id: row.actor_user_id, name: row.actor_name },
    before: row.before_json,
    after: row.after_json,
    metadata: row.metadata_json,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Lists organiser_activity rows for one item, newest first (created_at DESC,
 * id DESC tie-breaker), bounded and keyset-paginated. Scoped by
 * organisation_id + item_id + entity_type = 'item'. Deliberately never
 * joins against or requires a live organiser_items row — a deleted item's
 * history remains fully readable through this function, which is the
 * entire point of item_id/entity_id carrying no FK (see the CREATE TABLE
 * comment, app/api/admin/migrate/route.ts step 40).
 *
 * PRECISION: organiser_activity.created_at is a microsecond-precision
 * TIMESTAMPTZ, but a JS Date (and therefore the opaque cursor, built from
 * one via toISOString()) can only represent millisecond precision. Both the
 * ORDER BY and the WHERE-clause cursor comparison use the SAME
 * date_trunc('milliseconds', created_at) expression so they stay at
 * identical precision — otherwise a row created within the same
 * millisecond as the cursor boundary could fall strictly between the
 * cursor's truncated value and the next row's real value and be silently
 * skipped. Mirrors the identical fix already applied in
 * lib/data-hub/importBatch/read.ts's listImportBatches for the same
 * underlying reason.
 */
export async function listItemActivity(context: ListItemActivityTrustedContext): Promise<ListItemActivityResult> {
  const { organisationId, itemId, cursor, limit: rawLimit } = context;

  if (!UUID_RE.test(itemId)) {
    return fail('INVALID_ITEM_ID', 'itemId must be a valid identifier.');
  }

  const limit = validateLimit(rawLimit);
  if (limit === null) {
    return fail('INVALID_LIMIT', `limit must be a positive integer no greater than ${MAX_LIMIT}.`);
  }

  let cursorTuple: CursorTuple | null = null;
  if (cursor !== undefined) {
    cursorTuple = decodeCursor(cursor);
    if (!cursorTuple) {
      return fail(
        'INVALID_CURSOR',
        'The pagination cursor provided is not valid. Request the first page again without a cursor.',
      );
    }
  }

  const rows = (
    cursorTuple
      ? await sql`
          SELECT id, event_type, entity_type, entity_id, actor_user_id, actor_name,
                 before_json, after_json, metadata_json,
                 date_trunc('milliseconds', created_at) AS created_at
          FROM organiser_activity
          WHERE organisation_id = ${organisationId}
            AND item_id = ${itemId}
            AND entity_type = 'item'
            AND (date_trunc('milliseconds', created_at), id) < (${cursorTuple.createdAt}::timestamptz, ${cursorTuple.id})
          ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT id, event_type, entity_type, entity_id, actor_user_id, actor_name,
                 before_json, after_json, metadata_json,
                 date_trunc('milliseconds', created_at) AS created_at
          FROM organiser_activity
          WHERE organisation_id = ${organisationId}
            AND item_id = ${itemId}
            AND entity_type = 'item'
          ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
          LIMIT ${limit + 1}
        `
  ) as ActivityRow[];

  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next_cursor = hasNextPage && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;

  return { ok: true, activity: page.map(toDTO), next_cursor };
}
