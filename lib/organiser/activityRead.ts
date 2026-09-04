import sql from '@/lib/db';

// Phase D.4.5D — item-scoped, tenant-safe, deletion-safe activity reads.
// Phase D.4.5E extends this module with a board-scoped sibling
// (listBoardActivity) for the board Activity feed — see that function's
// own header for what differs and what's shared.
//
// DELETION-SAFE BY CONSTRUCTION: organiser_activity.item_id AND board_id
// both carry no FK to organiser_items/organiser_boards (see the CREATE
// TABLE comment in app/api/admin/migrate/route.ts, step 40) specifically
// so a deleted item's OR a deleted board's history remains queryable.
// This module therefore never joins against or requires a live
// organiser_items/organiser_boards row for either read path — it queries
// organiser_activity directly, scoped by organisation_id (a real FK,
// always present) plus item_id or board_id (both indexed, both FK-free).
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

// ─── Board-scoped reads (Phase D.4.5E) ──────────────────────────────────────

export interface ListBoardActivityTrustedContext {
  organisationId: string;
  boardId: string;
  /** Opaque cursor from a prior page's next_cursor. Omit for the first page. */
  cursor?: string;
  /** Defaults to DEFAULT_LIMIT; must be a positive integer <= MAX_LIMIT. */
  limit?: number;
}

export type ListBoardActivityFailureCode = 'INVALID_BOARD_ID' | 'INVALID_CURSOR' | 'INVALID_LIMIT';

export type ListBoardActivityResult =
  | { ok: true; activity: OrganiserActivityEventDTO[]; next_cursor: string | null }
  | { ok: false; code: ListBoardActivityFailureCode; message: string };

/**
 * Lists organiser_activity rows for one board, newest first, bounded and
 * keyset-paginated — the board-wide answer to "what changed on this board".
 * Reuses every piece of listItemActivity's pagination machinery unchanged
 * (validateLimit, decodeCursor/encodeCursor, the ActivityRow shape, toDTO,
 * the millisecond-precision cursor comparison) — the only thing that
 * differs is the WHERE clause's scope column, which raw parameterized SQL
 * cannot express as a shared dynamic fragment without an unsafe identifier
 * interpolation, so it is duplicated here exactly as listItemActivity
 * already duplicates its own cursor/no-cursor query pair.
 *
 * SCOPE — deliberately NOT filtered to entity_type = 'item': board_id is
 * populated on every organiser_activity row regardless of entity type (see
 * the CREATE TABLE comment, step 40), and this endpoint's whole purpose is
 * "everything that happened on this board" — not just item events. Today
 * only item.created/updated/moved/deleted rows actually exist in
 * production (see the D.4.5A/D.4.5D audits — board/group/column/comment/
 * file/import instrumentation is deliberately not built yet), so in
 * practice every row returned IS an item event; this function does not
 * hard-code that assumption, so a future phase that instruments e.g.
 * group.created needs no change here — lib/organiser/activityFormat.ts's
 * describeBoardActivityEvent already degrades any unrecognised event_type
 * gracefully rather than crashing.
 *
 * DELETION-SAFE, NO BOARD-EXISTENCE CHECK: like listItemActivity, this
 * never joins against or requires organiser_boards. A deleted board's
 * history remains readable through this same query — there is no product
 * requirement in this phase that the board still exist (the feed is
 * accessed from within an already-open, already-live board in the UI; a
 * caller reaching this function with a stale/deleted boardId gets that
 * board's own historical activity, exactly as item history remains
 * readable after item deletion — not a security concern, since
 * organisation_id is still asserted directly).
 */
export async function listBoardActivity(context: ListBoardActivityTrustedContext): Promise<ListBoardActivityResult> {
  const { organisationId, boardId, cursor, limit: rawLimit } = context;

  if (!UUID_RE.test(boardId)) {
    return { ok: false, code: 'INVALID_BOARD_ID', message: 'boardId must be a valid identifier.' };
  }

  const limit = validateLimit(rawLimit);
  if (limit === null) {
    return { ok: false, code: 'INVALID_LIMIT', message: `limit must be a positive integer no greater than ${MAX_LIMIT}.` };
  }

  let cursorTuple: CursorTuple | null = null;
  if (cursor !== undefined) {
    cursorTuple = decodeCursor(cursor);
    if (!cursorTuple) {
      return {
        ok: false,
        code: 'INVALID_CURSOR',
        message: 'The pagination cursor provided is not valid. Request the first page again without a cursor.',
      };
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
            AND board_id = ${boardId}
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
            AND board_id = ${boardId}
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
