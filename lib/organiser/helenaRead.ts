import 'server-only';
import sql from '@/lib/db';
import type { Role } from '@/lib/session';
import { authorizeOrganiserRequest } from './authorize';
import {
  listBoardActivity,
  listItemActivity,
  type OrganiserActivityEventDTO,
} from './activityRead';
import { describeActivityEvent, describeBoardActivityEvent } from './activityFormat';

// Phase D.4.6B — server-side read foundation for a future Helena
// integration (D.4.6C+). This module is deliberately READ-ONLY and has no
// dependency on Anthropic/tool-calling types — it exists so D.4.6C can
// register tools that each do exactly:
//   authorizeHelenaOrganiserRead() -> trusted organisationId -> one helper
// and nothing else. No tool/model input schema is defined here; that is
// D.4.6C's job, once this foundation exists to build it on.
//
// TENANT BOUNDARY (repeated at every function below, not just here):
// organisationId is ALWAYS the caller's own already-authorized trusted
// value. Nothing in this file accepts organisationId from request/model
// input, resolves its own session independently per-call in a way a caller
// could spoof, or trusts a board/item id as proof of tenant membership —
// every query restates organisation_id directly in its own WHERE clause,
// matching the convention already established by activityRead.ts.

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ─── Helena Organiser authorization ─────────────────────────────────────────

export type HelenaOrganiserAuthResult =
  | { ok: true; organisationId: string; userId: string; role: Role }
  | { ok: false };

/**
 * The ONLY sanctioned source of organisationId for every helper in this
 * file. Takes no parameters — there is nothing for a caller (a future
 * Helena tool executor) to pass in that could override the resolved
 * organisation, which is the whole point: a future D.4.6C tool-input
 * schema must never define an organisationId/organisation_id field, and
 * this function's own signature makes that the natural (not merely
 * documented) shape for every call site to follow.
 *
 * Thin wrapper around the exact same authorizeOrganiserRequest('viewer')
 * every existing Organiser API route already calls — reused verbatim, not
 * reimplemented, so Helena can never enforce a different rule than the
 * Organiser UI itself (capability + 'viewer' role floor + the same
 * super_admin org_override resolution baked into requireSession()).
 *
 * On failure, returns only `{ ok: false }` — never which of
 * unauthenticated / wrong role / capability disabled / capability lookup
 * failure occurred. A future tool executor should map this to one generic,
 * unhelpful-to-probe denial message; it must never forward
 * authorizeOrganiserRequest's own Response (401/403/503) or its body to
 * model-visible output.
 */
export async function authorizeHelenaOrganiserRead(): Promise<HelenaOrganiserAuthResult> {
  const auth = await authorizeOrganiserRequest('viewer');
  if (!auth.ok) return { ok: false };
  const { session } = auth;
  return {
    ok: true,
    organisationId: session.organisationId,
    userId: session.userId,
    role: session.role,
  };
}

// ─── Shared bounds ───────────────────────────────────────────────────────────

const BOARD_DEFAULT_LIMIT = 20;
const BOARD_MAX_LIMIT = 50;
const ITEM_DEFAULT_LIMIT = 25;
const ITEM_MAX_LIMIT = 100;

/** Clamps an optional caller-supplied limit to (0, max]; non-finite/absent/invalid falls back to defaultValue. */
function clampLimit(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value <= 0) return defaultValue;
  return Math.min(value, max);
}

/** Escapes LIKE/ILIKE metacharacters in user-supplied search text so a
 *  literal '%' or '_' in the search term is matched literally, not as a
 *  wildcard. The value itself is still passed as a genuine SQL parameter
 *  by the tagged-template `sql` call (never string-concatenated) — this
 *  escaping is purely a correctness measure, not a SQL-injection guard. */
function escapeLikeMeta(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ─── List boards ─────────────────────────────────────────────────────────────

export interface HelenaBoardSummary {
  id: string;
  name: string;
  /** Preserves NULL accurately — organiser_boards.color has no NOT NULL constraint. */
  color: string | null;
}

export interface ListOrganiserBoardsParams {
  organisationId: string;
  search?: string;
  limit?: number;
}

/**
 * Bounded, tenant-scoped, read-only board list for entity resolution
 * (e.g. "Founder Tasks" -> board id) — never exposes organisation_id,
 * created_by, icon, position, or timestamps; only what a model needs to
 * name and reference a board in a later tool call.
 */
export async function listOrganiserBoards(params: ListOrganiserBoardsParams): Promise<HelenaBoardSummary[]> {
  const { organisationId } = params;
  const limit = clampLimit(params.limit, BOARD_DEFAULT_LIMIT, BOARD_MAX_LIMIT);
  const search = typeof params.search === 'string' ? params.search.trim() : '';

  const rows = (
    search
      ? await sql`
          SELECT id, name, color
          FROM organiser_boards
          WHERE organisation_id = ${organisationId}
            AND name ILIKE ${'%' + escapeLikeMeta(search) + '%'} ESCAPE '\\'
          ORDER BY position ASC, created_at ASC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id, name, color
          FROM organiser_boards
          WHERE organisation_id = ${organisationId}
          ORDER BY position ASC, created_at ASC
          LIMIT ${limit}
        `
  ) as { id: string; name: string; color: string | null }[];

  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

// ─── List items ──────────────────────────────────────────────────────────────

export interface HelenaItemSummary {
  id: string;
  name: string;
  /** null when the item has no group (organiser_items.group_id IS NULL). */
  group_name: string | null;
  status: string;
}

export interface ListOrganiserItemsParams {
  organisationId: string;
  boardId: string;
  search?: string;
  limit?: number;
}

/**
 * Bounded, board-AND-tenant-scoped item list. Deliberately filters by
 * organisation_id directly on organiser_items (never by boardId alone,
 * never via a separate board-existence pre-check) — a boardId belonging to
 * another organisation, or a well-formed UUID that doesn't exist at all,
 * both produce an identical empty result with no distinguishing signal,
 * matching the "no existence side channel" requirement.
 *
 * Excludes custom_values, notes, file/comment content, created_by, and any
 * tenant identifier — only what a model needs to name an item and quote
 * its status/group in a spoken answer.
 */
export async function listOrganiserItems(params: ListOrganiserItemsParams): Promise<HelenaItemSummary[]> {
  const { organisationId, boardId } = params;
  if (!UUID_RE.test(boardId)) return [];

  const limit = clampLimit(params.limit, ITEM_DEFAULT_LIMIT, ITEM_MAX_LIMIT);
  const search = typeof params.search === 'string' ? params.search.trim() : '';

  const rows = (
    search
      ? await sql`
          SELECT i.id, i.name, i.status, g.name AS group_name
          FROM organiser_items i
          LEFT JOIN organiser_groups g ON g.id = i.group_id
          WHERE i.organisation_id = ${organisationId}
            AND i.board_id = ${boardId}
            AND i.name ILIKE ${'%' + escapeLikeMeta(search) + '%'} ESCAPE '\\'
          ORDER BY i.position ASC, i.created_at ASC
          LIMIT ${limit}
        `
      : await sql`
          SELECT i.id, i.name, i.status, g.name AS group_name
          FROM organiser_items i
          LEFT JOIN organiser_groups g ON g.id = i.group_id
          WHERE i.organisation_id = ${organisationId}
            AND i.board_id = ${boardId}
          ORDER BY i.position ASC, i.created_at ASC
          LIMIT ${limit}
        `
  ) as { id: string; name: string; status: string; group_name: string | null }[];

  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, group_name: r.group_name ?? null }));
}

// ─── Live item name lookup (board activity accuracy) ─────────────────────────

export interface GetOrganiserItemNamesByIdsParams {
  organisationId: string;
  boardId: string;
  /** Item ids appearing on the current activity page — never an arbitrary/unbounded list. */
  itemIds: string[];
}

/**
 * Bounded, board-AND-tenant-scoped id->name lookup for exactly the item ids
 * a caller already has in hand (the entity_id values on the current
 * activity page, never a full-board fetch) — this is deliberately NOT
 * listOrganiserItems with a large limit: a board can hold more live items
 * than any single activity page could ever reference, so paging through
 * "the first N items by position" could miss the very items the activity
 * page is about, while this lookup can never miss one (it asks for exactly
 * the ids it needs, capped at the caller's own activity-page size).
 *
 * Same "no existence side channel" behavior as listOrganiserItems: an id
 * that doesn't exist and an id that belongs to another organisation/board
 * both simply produce no row and no map entry — the caller (resolveItemLabel)
 * already treats "not in the map" as "fall back to a snapshot name, or the
 * generic label," so there is nothing to distinguish them for.
 *
 * Returns id+name only — no status/group/notes/custom fields — this is a
 * label lookup, not an item read.
 */
export async function getOrganiserItemNamesByIds(
  params: GetOrganiserItemNamesByIdsParams,
): Promise<Record<string, string>> {
  const { organisationId, boardId } = params;
  if (!UUID_RE.test(boardId)) return {};

  const uniqueIds = Array.from(new Set(params.itemIds)).filter((id) => UUID_RE.test(id));
  if (uniqueIds.length === 0) return {};

  const rows = (await sql`
    SELECT id, name
    FROM organiser_items
    WHERE organisation_id = ${organisationId}
      AND board_id = ${boardId}
      AND id = ANY(${uniqueIds}::uuid[])
  `) as { id: string; name: string }[];

  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.name;
  return map;
}

// ─── Current-location context resolution (Phase D.4.6D) ──────────────────────
//
// The browser may tell Helena which board/item the operator is CURRENTLY
// LOOKING AT (a navigation hint, e.g. "they have the WORK board open, with
// the 'Test 2' item drawer open") — but that hint is never authorization
// and never a source of truth. This resolver is the ONLY place a client-
// supplied boardId/itemId hint is turned into something Helena is allowed
// to reason about: every id is re-validated against organisation_id (and,
// for an item, its own board_id) on every single request, and the NAME
// returned is always the server's own canonical value — a client-supplied
// display name is never read by this function at all (there is no
// boardName/itemName parameter here on purpose; see helenaContextHint's
// own header in app/api/chat/route.ts for why names are resolved, not
// trusted).
//
// A hint that doesn't resolve (wrong tenant, deleted, malformed id, a
// board/item mismatch — see below) collapses to the exact same `null` a
// caller gets from sending no hint at all: there is no existence side
// channel here, matching every other Helena-Organiser read in this file.

export interface HelenaOrganiserBoardContext {
  id: string;
  name: string;
}

export interface HelenaOrganiserItemContext {
  id: string;
  name: string;
  /** The item's OWN canonical board id — always DB-derived, never the caller's hint. */
  boardId: string;
}

export interface HelenaOrganiserContext {
  board: HelenaOrganiserBoardContext | null;
  item: HelenaOrganiserItemContext | null;
}

export interface ResolveHelenaOrganiserContextParams {
  organisationId: string;
  /** Raw, unvalidated hint from the client — may be missing, malformed, or stale. */
  boardIdHint?: string;
  itemIdHint?: string;
}

const EMPTY_ORGANISER_CONTEXT: HelenaOrganiserContext = { board: null, item: null };

/**
 * Resolves a client-supplied {boardId?, itemId?} navigation hint into
 * trusted, tenant-scoped canonical entities, or nulls out whatever part of
 * the hint doesn't check out. Never throws.
 *
 * ITEM/BOARD RELATIONSHIP: if both hints are present, the item is only
 * honored when it genuinely belongs to the hinted board — a mismatch
 * (client says boardId=A, but the item's real board is B) drops the ITEM
 * only, never "corrects" the board to B (that would leak which board a
 * foreign/mismatched item actually lives on) and never drops the board
 * hint itself (a real, correctly-hinted board the user is genuinely
 * viewing stays valid even if the item hint was stale/wrong).
 *
 * If only itemId is hinted, its own board_id (already tenant-scoped by the
 * query below) is used to resolve the board — this is the one safe case
 * where the server derives boardId FROM validated data, never from the
 * client.
 */
export async function resolveHelenaOrganiserContext(
  params: ResolveHelenaOrganiserContextParams,
): Promise<HelenaOrganiserContext> {
  const { organisationId } = params;

  let item: HelenaOrganiserItemContext | null = null;
  if (params.itemIdHint && UUID_RE.test(params.itemIdHint)) {
    const rows = (await sql`
      SELECT id, name, board_id
      FROM organiser_items
      WHERE organisation_id = ${organisationId}
        AND id = ${params.itemIdHint}
      LIMIT 1
    `) as { id: string; name: string; board_id: string }[];
    if (rows.length > 0) {
      item = { id: rows[0].id, name: rows[0].name, boardId: rows[0].board_id };
    }
  }

  let boardId = params.boardIdHint && UUID_RE.test(params.boardIdHint) ? params.boardIdHint : undefined;
  if (item) {
    if (boardId && boardId !== item.boardId) {
      // Board/item mismatch — the item hint is stale or wrong. Drop the
      // item, keep the (independently valid-looking) board hint as-is; it
      // still gets its own tenant-scoped resolution below.
      item = null;
    } else {
      boardId = item.boardId;
    }
  }

  let board: HelenaOrganiserBoardContext | null = null;
  if (boardId) {
    const rows = (await sql`
      SELECT id, name
      FROM organiser_boards
      WHERE organisation_id = ${organisationId}
        AND id = ${boardId}
      LIMIT 1
    `) as { id: string; name: string }[];
    if (rows.length > 0) {
      board = { id: rows[0].id, name: rows[0].name };
    } else {
      // The board itself doesn't resolve for this tenant (wrong tenant,
      // deleted, or a malformed-but-UUID-shaped hint) — an item that
      // claimed to belong to it can't be trusted either, though in
      // practice this only happens for a directly-hinted boardId, since an
      // item-derived boardId is already proven to exist via the item's own
      // organisation_id-scoped row.
      item = null;
    }
  }

  if (!board && !item) return EMPTY_ORGANISER_CONTEXT;
  return { board, item };
}

// ─── Activity window resolver ────────────────────────────────────────────────

export const ORGANISER_ACTIVITY_WINDOWS = ['today', 'yesterday', 'this_week', '7d', '30d'] as const;
export type OrganiserActivityWindow = (typeof ORGANISER_ACTIVITY_WINDOWS)[number];

export function isOrganiserActivityWindow(value: unknown): value is OrganiserActivityWindow {
  return typeof value === 'string' && (ORGANISER_ACTIVITY_WINDOWS as readonly string[]).includes(value);
}

/**
 * Defensive boundary helper for a future tool-input parser: validates an
 * arbitrary (e.g. model-supplied) value against the closed window enum,
 * falling back to `fallback` for anything else — including case mismatch,
 * extra whitespace, an absolute date string, or garbage. Never throws.
 * This is the only place in the Organiser Helena surface designed to
 * accept an untrusted `unknown` — resolveActivityWindow() itself only
 * accepts the narrow union type, so invalid values are rejected before
 * they can reach it (and therefore before they can reach SQL).
 */
export function parseActivityWindow(
  value: unknown,
  fallback: OrganiserActivityWindow = '7d',
): OrganiserActivityWindow {
  return isOrganiserActivityWindow(value) ? value : fallback;
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic, UTC-only semantic window resolver. The model must never
 * supply (and this function never accepts) an absolute timestamp — only
 * one of the closed OrganiserActivityWindow values, translated here to a
 * concrete [start, end) range entirely server-side.
 *
 * "today"/"yesterday"/"this_week" use UTC calendar boundaries — documented
 * limitation until BrainBase has a real per-user/org timezone primitive
 * (none exists anywhere in this codebase today; not introduced by this
 * phase, see the D.4.6B report). "this_week" starts on the most recent UTC
 * Monday (ISO 8601 week start) at/before `now`. "7d"/"30d" are rolling
 * windows ending at `now` itself, not calendar-aligned.
 *
 * `now` is injectable specifically so tests never depend on wall-clock
 * time.
 */
export function resolveActivityWindow(
  window: OrganiserActivityWindow,
  now: Date = new Date(),
): { start: Date; end: Date } {
  switch (window) {
    case 'today': {
      const start = utcMidnight(now);
      return { start, end: new Date(start.getTime() + ONE_DAY_MS) };
    }
    case 'yesterday': {
      const todayStart = utcMidnight(now);
      return { start: new Date(todayStart.getTime() - ONE_DAY_MS), end: todayStart };
    }
    case 'this_week': {
      const todayStart = utcMidnight(now);
      // getUTCDay(): 0=Sun..6=Sat. Convert to days-since-Monday (Mon=0..Sun=6).
      const daysSinceMonday = (todayStart.getUTCDay() + 6) % 7;
      const start = new Date(todayStart.getTime() - daysSinceMonday * ONE_DAY_MS);
      return { start, end: new Date(start.getTime() + 7 * ONE_DAY_MS) };
    }
    case '7d': {
      const end = new Date(now.getTime());
      return { start: new Date(end.getTime() - 7 * ONE_DAY_MS), end };
    }
    case '30d': {
      const end = new Date(now.getTime());
      return { start: new Date(end.getTime() - 30 * ONE_DAY_MS), end };
    }
    default: {
      // Exhaustiveness guard — a future OrganiserActivityWindow member
      // added without a matching case here fails loudly at compile time
      // (never) and, defensively, at runtime too rather than silently
      // returning an unbounded/undefined range.
      const exhaustive: never = window;
      throw new Error(`resolveActivityWindow: unhandled window "${String(exhaustive)}"`);
    }
  }
}

// ─── Helena-safe activity shape ──────────────────────────────────────────────

export interface HelenaActivityRecord {
  summary: string;
  /** Pre-rendered "Label: before → after" / "Label: value" lines — never raw before_json/after_json. */
  diffs: string[];
  detail: string | null;
  actor_name: string | null;
  created_at: string;
  entity_type: string;
  event_type: string;
}

function renderDiffLine(d: { label: string; before: string | null; after: string }): string {
  return d.before !== null ? `${d.label}: ${d.before} → ${d.after}` : `${d.label}: ${d.after}`;
}

/**
 * Shapes listBoardActivity's DTOs into the bounded, model-safe record
 * Helena tools return. Reuses describeBoardActivityEvent verbatim for all
 * event-language/diff logic — this function does no interpretation of
 * event_type, before_json, or after_json itself, only re-packages the
 * formatter's already-safe output plus the few scalar fields (actor,
 * timestamp, entity/event type) a model needs. before_json/after_json,
 * organisation_id, and any file URL/token are never touched here because
 * they are never touched by describeBoardActivityEvent either.
 */
export function shapeBoardActivityForHelena(
  events: OrganiserActivityEventDTO[],
  groupNamesById: Record<string, string> = {},
  liveItemNamesById: Record<string, string> = {},
): HelenaActivityRecord[] {
  return events.map((ev) => {
    const desc = describeBoardActivityEvent(ev, groupNamesById, liveItemNamesById);
    return {
      summary: desc.summary,
      diffs: desc.diffs.map(renderDiffLine),
      detail: desc.detail ?? null,
      actor_name: ev.actor.name,
      created_at: ev.created_at,
      entity_type: ev.entity_type,
      event_type: ev.event_type,
    };
  });
}

/** Item-scoped sibling of shapeBoardActivityForHelena — reuses describeActivityEvent verbatim. */
export function shapeItemActivityForHelena(
  events: OrganiserActivityEventDTO[],
  groupNamesById: Record<string, string> = {},
): HelenaActivityRecord[] {
  return events.map((ev) => {
    const desc = describeActivityEvent(ev, groupNamesById);
    return {
      summary: desc.summary,
      diffs: desc.diffs.map(renderDiffLine),
      detail: desc.detail ?? null,
      actor_name: ev.actor.name,
      created_at: ev.created_at,
      entity_type: ev.entity_type,
      event_type: ev.event_type,
    };
  });
}

// Re-exported so a future D.4.6C tool executor can call
// listBoardActivity/listItemActivity directly (with start/end from
// resolveActivityWindow) without importing from two different modules for
// one logical "get bounded, shaped activity" operation. No new query logic
// lives here — this file only shapes what activityRead.ts already reads.
export { listBoardActivity, listItemActivity };
export type { OrganiserActivityEventDTO };
