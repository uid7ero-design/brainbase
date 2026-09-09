import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import sql from '@/lib/db';
import { authorizeOrganiserRequest } from './authorize';

// Phase D.4.6I — the FIRST Helena Organiser write/action capability. This
// file is a deliberately separate module from helenaRead.ts: the read
// authorization boundary (authorizeHelenaOrganiserRead, 'viewer' floor) is
// never touched or weakened here. Every write in this file goes through its
// own, stricter authorization call (authorizeHelenaOrganiserWrite, 'manager'
// floor — one tier above the 'viewer' floor the human-facing comment route
// itself requires, a deliberate extra margin for this new AI-initiated
// write surface, not a bypass of anything).
//
// PROPOSE / CONFIRM+EXECUTE CONTRACT
// -----------------------------------------------------------------------
// There is exactly one Organiser write action in this phase: posting a
// comment on an existing item. It is modeled as ONE function with two
// outcomes, never two separately-exposed model tools:
//
//   - PROPOSE (no `confirmationToken` argument): validates the target item
//     and comment text, then returns a signed, short-lived, single-purpose
//     token that encodes EXACTLY the fields that were validated
//     (organisationId, userId, itemId, body) — and performs NO database
//     mutation and writes NO activity row.
//
//   - CONFIRM + EXECUTE (a `confirmationToken` argument is present): the
//     token is verified (signature, purpose, actionType, expiry, and that
//     its embedded organisationId/userId match the CURRENT authenticated
//     session). If valid, the mutation uses ONLY the itemId/body embedded
//     INSIDE the verified token — never whatever the model's current tool
//     call happens to say — so there is structurally nothing for the model
//     (or a compromised model output) to alter between proposal and
//     execution. A token that fails verification for any reason executes
//     nothing and writes no activity row.
//
// The `confirmationToken` value itself is never accepted from the model's
// tool-call arguments (see lib/organiser/helenaTools.ts's tool schema,
// which has no such field) — it can only arrive via a trusted, top-level
// request field the client sends outside the model's control, exactly like
// the existing organiserContext navigation hint (see
// resolveHelenaOrganiserContext's own header). This makes it structurally
// impossible for the model to confirm its own proposal within the same
// request/tool-loop — see app/api/chat/route.ts's own one-shot-per-request
// consumption logic for the other half of that guarantee.
//
// KNOWN LIMITATION (documented, not solved in this phase): the token is a
// stateless, self-contained JWT with a short (2 minute) expiry — there is
// no server-side "already consumed" ledger (adding one would require a new
// DB table/migration, which this phase's own scope explicitly forbids
// introducing silently). Within that narrow window, an identical repeated
// HTTP request carrying the same valid token would post a second identical
// comment. The one-shot-per-request guard in app/api/chat/route.ts closes
// the same-request/same-tool-loop duplication risk (the likeliest failure
// mode); a durable consumed-token ledger is future work if genuine
// cross-request replay protection is required.

const TOKEN_PURPOSE = 'organiser_action_confirm';
const TOKEN_TTL = '2m';
const MAX_BODY_LENGTH = 2000;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);

export type HelenaOrganiserWriteAuthResult =
  | { ok: true; organisationId: string; userId: string; actorName: string }
  | { ok: false };

/**
 * The ONLY sanctioned source of organisationId/userId for every Helena
 * Organiser WRITE action. Deliberately a separate function from
 * authorizeHelenaOrganiserRead() (helenaRead.ts) — that function's
 * 'viewer' floor is correct and unchanged for reads; writes require
 * 'manager', a strictly higher bar, enforced here and nowhere else. Takes
 * no parameters, same reasoning as the read equivalent: nothing a caller
 * could pass in could override the resolved organisation/actor.
 */
export async function authorizeHelenaOrganiserWrite(): Promise<HelenaOrganiserWriteAuthResult> {
  const auth = await authorizeOrganiserRequest('manager');
  if (!auth.ok) return { ok: false };
  const { session } = auth;
  return {
    ok: true,
    organisationId: session.organisationId,
    userId: session.userId,
    actorName: session.name,
  };
}

interface ActionTokenPayload {
  purpose: typeof TOKEN_PURPOSE;
  actionType: 'post_comment';
  organisationId: string;
  userId: string;
  itemId: string;
  body: string;
}

async function signActionToken(payload: ActionTokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

/** Verifies a confirmation token against the CURRENT trusted session and
 *  the specific action type this call site expects. Returns the decoded
 *  itemId/body ONLY when every check passes: valid signature, correct
 *  purpose, correct actionType, unexpired, and organisationId/userId match
 *  the caller's own current session exactly (never the token's own claims
 *  alone — a token is worthless outside the exact session it was minted
 *  for). Never throws; any failure (malformed token, wrong secret, expired,
 *  mismatched claim) returns null uniformly. */
async function verifyActionToken(
  token: string,
  expected: { actionType: 'post_comment'; organisationId: string; userId: string },
): Promise<{ itemId: string; body: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const p = payload as unknown as ActionTokenPayload;
    if (p.purpose !== TOKEN_PURPOSE) return null;
    if (p.actionType !== expected.actionType) return null;
    if (p.organisationId !== expected.organisationId) return null;
    if (p.userId !== expected.userId) return null;
    if (typeof p.itemId !== 'string' || !UUID_RE.test(p.itemId)) return null;
    if (typeof p.body !== 'string' || p.body.length === 0) return null;
    return { itemId: p.itemId, body: p.body };
  } catch {
    return null;
  }
}

export type ProposeOrExecuteCommentResult =
  | {
      ok: true;
      mode: 'proposed';
      proposal: { item_id: string; item_name: string; body: string };
      confirmationToken: string;
    }
  | {
      ok: true;
      mode: 'executed';
      comment: { id: string; body: string; created_at: string };
    }
  | { ok: false; reason: 'invalid_item_id' | 'item_not_found' | 'invalid_body' | 'invalid_confirmation' };

export interface ProposeOrExecuteCommentParams {
  organisationId: string;
  userId: string;
  actorName: string;
  itemId: string;
  body: string;
  /** Present ONLY when sourced from the trusted, non-model-controlled
   *  top-level request field (see app/api/chat/route.ts) — never from a
   *  model tool-call argument. */
  confirmationToken?: string;
}

/**
 * The single domain function behind Helena's one write tool. Reuses the
 * EXACT same atomic writable-CTE shape as the human-facing
 * POST /api/organiser/items/[itemId]/updates route (INSERT
 * organiser_item_updates + INSERT organiser_activity in one statement) —
 * this file introduces no new mutation logic of its own, only the
 * propose/confirm gate in front of that already-reviewed pattern. The one
 * intentional addition, metadata_json: {source:'helena'}, uses the
 * existing organiser_activity.metadata_json column (already JSONB NOT NULL
 * DEFAULT '{}') — no schema change.
 */
export async function proposeOrExecuteOrganiserComment(
  params: ProposeOrExecuteCommentParams,
): Promise<ProposeOrExecuteCommentResult> {
  const { organisationId, userId, actorName } = params;

  if (params.confirmationToken) {
    // ── CONFIRM + EXECUTE ──────────────────────────────────────────────
    // The model's CURRENT itemId/body arguments are deliberately never
    // consulted below this point — only the values embedded inside the
    // verified token are used for the mutation. There is nothing for a
    // materially-altered current tool call to change.
    const verified = await verifyActionToken(params.confirmationToken, {
      actionType: 'post_comment',
      organisationId,
      userId,
    });
    if (!verified) return { ok: false, reason: 'invalid_confirmation' };

    const itemRows = await sql`
      SELECT id, board_id FROM organiser_items
      WHERE id = ${verified.itemId} AND organisation_id = ${organisationId}
      LIMIT 1
    `;
    if (itemRows.length === 0) return { ok: false, reason: 'item_not_found' };
    const boardId = itemRows[0].board_id as string;

    const rows = await sql`
      WITH inserted AS (
        INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
        VALUES (${verified.itemId}, ${boardId}, ${organisationId}, ${actorName}, ${verified.body})
        RETURNING id, body, created_at
      ),
      activity_row AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json, metadata_json
        )
        SELECT
          ${organisationId}, ${boardId}, ${verified.itemId}, ${userId}, ${actorName},
          'comment.created', 'comment', inserted.id::text, NULL,
          jsonb_build_object('excerpt', organiser_activity_sanitise_scalar(to_jsonb(inserted.body))),
          jsonb_build_object('source', 'helena')
        FROM inserted
        RETURNING id
      )
      SELECT id, body, created_at FROM inserted
    `;
    if (rows.length === 0) return { ok: false, reason: 'item_not_found' };
    const row = rows[0] as { id: string; body: string; created_at: string };
    return { ok: true, mode: 'executed', comment: { id: row.id, body: row.body, created_at: row.created_at } };
  }

  // ── PROPOSE ────────────────────────────────────────────────────────────
  if (!UUID_RE.test(params.itemId)) return { ok: false, reason: 'invalid_item_id' };

  const body = params.body.trim();
  if (body.length === 0 || body.length > MAX_BODY_LENGTH) return { ok: false, reason: 'invalid_body' };

  const itemRows = await sql`
    SELECT id, name FROM organiser_items
    WHERE id = ${params.itemId} AND organisation_id = ${organisationId}
    LIMIT 1
  `;
  if (itemRows.length === 0) return { ok: false, reason: 'item_not_found' };
  const itemName = itemRows[0].name as string;

  const confirmationToken = await signActionToken({
    purpose: TOKEN_PURPOSE,
    actionType: 'post_comment',
    organisationId,
    userId,
    itemId: params.itemId,
    body,
  });

  return {
    ok: true,
    mode: 'proposed',
    proposal: { item_id: params.itemId, item_name: itemName, body },
    confirmationToken,
  };
}
