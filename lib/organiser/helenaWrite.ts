import 'server-only';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
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
// Phase D.4.6K — CLOSES the prior known limitation (a stateless token could
// be replayed in a separate HTTP request within its validity window). Every
// signed token now carries a unique `jti`, and the confirm+execute path
// consumes it via an INSERT ... ON CONFLICT (jti) DO NOTHING into the
// durable organiser_action_confirmations ledger (migration step 44), in the
// SAME atomic writable-CTE statement as the comment/activity mutation — see
// proposeOrExecuteOrganiserComment's own comment below for the exact
// three-outcome design. The one-shot-per-request guard in
// app/api/chat/route.ts still closes the same-request/same-tool-loop case;
// the ledger now independently closes the cross-request case too, so a
// token is globally single-use regardless of which guard would have caught
// a given replay attempt.

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
  /** Phase D.4.6K — unique per-proposal identifier, minted server-side
   *  (randomUUID(), never derived from body/item), signed into the token,
   *  and never accepted from anywhere else. This is the sole identity the
   *  durable ledger keys on — the ledger stores this, never the raw token
   *  or the comment body itself. */
  jti: string;
}

async function signActionToken(payload: ActionTokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

type VerifyActionTokenResult =
  | { ok: true; itemId: string; body: string; jti: string; exp: number }
  // Phase D.4.6L — 'expired' is split out from every other verification
  // failure (wrong secret, malformed token, mismatched claim, malformed
  // jti) so the caller can narrate expiry distinctly ("please ask again")
  // from a genuinely invalid/tampered token, without narrowing security:
  // jose's own jwtVerify() already rejects an expired token outright
  // (JWTExpired is thrown only for a token whose SIGNATURE verified but
  // whose exp claim has passed) — this never accepts an expired token, it
  // only labels the rejection more specifically for display purposes.
  | { ok: false; reason: 'expired' | 'invalid' };

/** Verifies a confirmation token against the CURRENT trusted session and
 *  the specific action type this call site expects. Returns the decoded
 *  itemId/body/jti/exp ONLY when every check passes: valid signature,
 *  correct purpose, correct actionType, unexpired, well-formed jti, and
 *  organisationId/userId match the caller's own current session exactly
 *  (never the token's own claims alone — a token is worthless outside the
 *  exact session it was minted for). Never throws; every failure other than
 *  expiry (malformed token, wrong secret, mismatched claim, malformed jti)
 *  still collapses into the single 'invalid' reason, unchanged from before
 *  D.4.6K/L; the new outcome D.4.6K adds (already_used_confirmation) is
 *  determined later, by the ledger, only once a token has passed every
 *  check here. */
async function verifyActionToken(
  token: string,
  expected: { actionType: 'post_comment'; organisationId: string; userId: string },
): Promise<VerifyActionTokenResult> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const p = payload as unknown as ActionTokenPayload;
    if (p.purpose !== TOKEN_PURPOSE) return { ok: false, reason: 'invalid' };
    if (p.actionType !== expected.actionType) return { ok: false, reason: 'invalid' };
    if (p.organisationId !== expected.organisationId) return { ok: false, reason: 'invalid' };
    if (p.userId !== expected.userId) return { ok: false, reason: 'invalid' };
    if (typeof p.itemId !== 'string' || !UUID_RE.test(p.itemId)) return { ok: false, reason: 'invalid' };
    if (typeof p.body !== 'string' || p.body.length === 0) return { ok: false, reason: 'invalid' };
    if (typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return { ok: false, reason: 'invalid' };
    const exp = (payload as { exp?: number }).exp;
    if (typeof exp !== 'number') return { ok: false, reason: 'invalid' };
    return { ok: true, itemId: p.itemId, body: p.body, jti: p.jti, exp };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

const CLEANUP_BATCH_LIMIT = 500;

/**
 * Phase D.4.6L — best-effort, bounded pruning of long-expired ledger rows.
 * Deliberately decoupled from the propose/confirm mutation paths: never
 * part of the confirm+execute atomic statement (that statement's only job
 * is the single write action itself — see its own header), and any error
 * here is swallowed after one bounded log line so cleanup can never turn a
 * valid action into a failure.
 *
 * Safety margin is 1 day past expires_at — 720x the 2-minute token TTL —
 * so no row eligible for deletion can still be relevant to replay exclusion
 * (a token's own expiry, enforced independently by jwtVerify, already makes
 * it unusable long before its ledger row becomes eligible here). The
 * predicate reuses step 44's own idx_organiser_action_confirmations_expires_at
 * index — no new index required. The batch is bounded (LIMIT) so this is
 * always a small, fast statement regardless of ledger size.
 */
export async function pruneExpiredConfirmationsBestEffort(): Promise<void> {
  try {
    await sql`
      DELETE FROM organiser_action_confirmations
      WHERE expires_at < NOW() - INTERVAL '1 day'
      AND jti IN (
        SELECT jti
        FROM organiser_action_confirmations
        WHERE expires_at < NOW() - INTERVAL '1 day'
        ORDER BY expires_at
        LIMIT ${CLEANUP_BATCH_LIMIT}
      )
    `;
  } catch (err) {
    console.error('[Helena][Organiser confirmation ledger cleanup]', err);
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
  | {
      ok: false;
      reason:
        | 'invalid_item_id'
        | 'item_not_found'
        | 'invalid_body'
        | 'invalid_confirmation'
        // Phase D.4.6L — the token's signature/session/claims all verified,
        // but its exp claim has passed. Split out from invalid_confirmation
        // so the caller can narrate "please ask again" distinctly from a
        // genuinely tampered/malformed token — see verifyActionToken's own
        // header for why this doesn't weaken the security check itself.
        | 'expired_confirmation'
        // Phase D.4.6K — the token verified (signature/expiry/session all
        // valid) but its jti was already present in the durable ledger:
        // this exact confirmation has already executed once, in an earlier
        // request. Distinct from invalid_confirmation so the caller can
        // message it differently (D.4.6L: a deterministic, safe non-success
        // status — never GENERIC_ERROR).
        | 'already_used_confirmation';
    };

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
    if (!verified.ok) {
      return { ok: false, reason: verified.reason === 'expired' ? 'expired_confirmation' : 'invalid_confirmation' };
    }

    // Phase D.4.6K — ONE atomic statement performs, in order, all of:
    //   1. look up the target item (target_item) — read only, no lock held
    //      across a network round-trip;
    //   2. attempt to durably consume this exact jti (consumed) — but ONLY
    //      if target_item found a row. Gating the ledger INSERT on the item
    //      existing is what makes item_not_found leave the token unburned
    //      (see the module header / D.4.6K's own Failure-Atomicity
    //      decision): a token that never resulted in any mutation was never
    //      meaningfully "used", so it must remain available for a
    //      legitimate retry against the same predetermined item/body:
    //   3. insert the comment (inserted) — but ONLY if BOTH target_item AND
    //      consumed produced a row;
    //   4. insert the activity row — only if the comment insert produced a
    //      row.
    // The final SELECT is deliberately NOT gated on `inserted` existing (a
    // LEFT JOIN from a constant single-row source) so this query always
    // returns exactly one row, carrying enough information to distinguish
    // all three failure outcomes from the one success outcome:
    //   item_found=0                       -> item_not_found (token unburned)
    //   item_found=1, consumed=0           -> already_used_confirmation
    //     (the only way an INSERT ... ON CONFLICT (jti) DO NOTHING can
    //     return zero rows when target_item found a row is that this jti
    //     already exists in the ledger from an earlier, already-executed
    //     confirmation)
    //   item_found=1, consumed=1           -> executed (comment_id present)
    // Postgres itself provides the concurrency guarantee: two simultaneous
    // transactions racing on the same jti serialize against the ledger's
    // own UNIQUE/PRIMARY KEY constraint — the second to reach the conflict
    // sees the first's row (once committed) and its own INSERT returns zero
    // rows, exactly like the success/already-used distinction above. No
    // FOR UPDATE or advisory lock is needed; the unique index on jti IS the
    // concurrency control. If any part of this statement fails (e.g. a
    // future CHECK-constraint violation on the activity insert), Postgres
    // rolls back the ENTIRE statement — including the ledger consume — so a
    // transient failure can never permanently burn a token without the
    // mutation it was meant to authorize actually having committed.
    const rows = await sql`
      WITH target_item AS (
        SELECT id, board_id FROM organiser_items
        WHERE id = ${verified.itemId} AND organisation_id = ${organisationId}
      ),
      consumed AS (
        INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at)
        SELECT ${verified.jti}, ${organisationId}, ${userId}, 'post_comment', ${verified.itemId}, to_timestamp(${verified.exp})
        WHERE EXISTS (SELECT 1 FROM target_item)
        ON CONFLICT (jti) DO NOTHING
        RETURNING jti
      ),
      inserted AS (
        INSERT INTO organiser_item_updates (item_id, board_id, organisation_id, author_name, body)
        SELECT target_item.id, target_item.board_id, ${organisationId}, ${actorName}, ${verified.body}
        FROM target_item, consumed
        RETURNING id, item_id, board_id, body, created_at
      ),
      activity_row AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json, metadata_json
        )
        SELECT
          ${organisationId}, inserted.board_id, inserted.item_id, ${userId}, ${actorName},
          'comment.created', 'comment', inserted.id::text, NULL,
          jsonb_build_object('excerpt', organiser_activity_sanitise_scalar(to_jsonb(inserted.body))),
          jsonb_build_object('source', 'helena')
        FROM inserted
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM target_item)::int AS item_found,
        (SELECT count(*) FROM consumed)::int AS was_consumed,
        inserted.id AS comment_id, inserted.body AS comment_body, inserted.created_at AS comment_created_at
      FROM (SELECT 1) AS one_row
      LEFT JOIN inserted ON true
    `;

    const row = rows[0] as {
      item_found: number;
      was_consumed: number;
      comment_id: string | null;
      comment_body: string | null;
      comment_created_at: string | null;
    };

    if (row.item_found === 0) return { ok: false, reason: 'item_not_found' };
    if (row.was_consumed === 0) return { ok: false, reason: 'already_used_confirmation' };
    if (!row.comment_id) return { ok: false, reason: 'item_not_found' };

    return {
      ok: true,
      mode: 'executed',
      comment: { id: row.comment_id, body: row.comment_body ?? verified.body, created_at: row.comment_created_at ?? new Date().toISOString() },
    };
  }

  // ── PROPOSE ────────────────────────────────────────────────────────────
  if (!UUID_RE.test(params.itemId)) return { ok: false, reason: 'invalid_item_id' };

  const body = params.body.trim();
  if (body.length === 0 || body.length > MAX_BODY_LENGTH) return { ok: false, reason: 'invalid_body' };

  // Phase D.4.6L — opportunistic ledger maintenance, once per validated
  // propose call (deliberately after the zero-sql-for-invalid-input checks
  // above, so malformed input still never touches the database at all).
  // Never coupled to the confirm+execute atomic statement, and its outcome
  // (including any failure) never affects this proposal — see
  // pruneExpiredConfirmationsBestEffort's own header.
  await pruneExpiredConfirmationsBestEffort();

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
    // Phase D.4.6K — minted fresh on every proposal, never derived from
    // body/item (a resend of an identical proposal gets a different jti,
    // and therefore its own independent single-use slot in the ledger).
    jti: randomUUID(),
  });

  return {
    ok: true,
    mode: 'proposed',
    proposal: { item_id: params.itemId, item_name: itemName, body },
    confirmationToken,
  };
}
