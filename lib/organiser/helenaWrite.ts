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

// Phase D.4.6N — the sole canonical status vocabulary for
// organiser_items.status (a plain, non-enum TEXT column with no DB-level
// CHECK constraint — see its own migration comment, step 35). Mirrors
// app/organiser/page.tsx's own STATUS_OPTIONS constant EXACTLY; that file
// is the only other place this list is defined, and it is what actually
// renders as the status dropdown a human uses today, so these are proven
// canonical values, not invented ones. Deliberately duplicated here rather
// than imported: page.tsx is a client component and this is a
// 'server-only' module, and this list is small enough that duplication
// (this repo's own established convention for small format-structural
// literals — see e.g. inspectCsvWorksheet.ts/confirmWorksheet.ts's shared
// CSV_WORKSHEET_INDEX/NAME constants) is safer than adding a new shared
// import edge for four strings. Board-specific custom "status"-TYPE
// COLUMNS (organiser_columns, stored in items.custom_values) are a
// SEPARATE, unrelated per-board custom-field feature — never confused
// with this primary, global, non-customizable field.
export const ORGANISER_ITEM_STATUS_OPTIONS = ['Not Started', 'Working on it', 'Stuck', 'Done'] as const;
export type OrganiserItemStatus = (typeof ORGANISER_ITEM_STATUS_OPTIONS)[number];
function isValidOrganiserItemStatus(value: string): value is OrganiserItemStatus {
  return (ORGANISER_ITEM_STATUS_OPTIONS as readonly string[]).includes(value);
}

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

// ─────────────────────────────────────────────────────────────────────────
// Phase D.4.6N — Helena's SECOND (and, for this phase, LAST) Organiser
// write action: changing the status of one explicit existing item. Same
// propose/confirm+execute contract as proposeOrExecuteOrganiserComment
// above (see that function's own header for the shared design rationale);
// this is a deliberately SEPARATE function and a SEPARATE atomic SQL
// statement, not a generic "update any field" capability — desiredStatus
// is the only mutable value, and it is validated against
// ORGANISER_ITEM_STATUS_OPTIONS both at propose time (fail fast, zero SQL)
// and implicitly at confirm time (the token can never carry a value that
// didn't pass that same check when minted).
//
// STALE-STATE / LOST-UPDATE PROTECTION — the critical new property this
// phase adds beyond the comment action: the token binds not just the
// desired status but the EXACT current status observed at propose time
// (expectedCurrentStatus). At confirm time, the atomic statement locks the
// target row (FOR UPDATE) and only applies the UPDATE when the row's
// TRUE, currently-committed status still equals expectedCurrentStatus —
// if another actor changed the item's status in between, the UPDATE's own
// WHERE clause simply matches zero rows and nothing is overwritten. This
// mirrors the exact race-safe FOR UPDATE + MATERIALIZED CTE pattern
// already proven in app/api/organiser/items/[itemId]/route.ts's PATCH
// handler (see that route's own header) — that route's own COALESCE-based
// field merge doesn't need this extra guard for itself, but the pattern it
// established (lock, then compare/branch off the locked row) is exactly
// what's reused here.
//
// STALE-CONFIRMATION CONSUMPTION — deliberately asymmetric from
// item_not_found: the ledger `consumed` INSERT is gated ONLY on the target
// item existing (WHERE EXISTS target_item), never on the status actually
// matching. This means a stale-state attempt DOES burn its jti (the token
// becomes permanently unusable) even though it changes nothing — this is
// intentional (see the phase's own Step 11 requirement): if the row were
// left unconsumed, and the item's status later cycled back to
// expectedCurrentStatus within the token's own validity window, the exact
// same stale confirmation could unexpectedly become executable again. An
// item_not_found outcome still leaves the token unburned, unchanged from
// the comment action's own reasoning — a token that could never possibly
// have mutated anything was never meaningfully "used".

interface StatusChangeTokenPayload {
  purpose: typeof TOKEN_PURPOSE;
  actionType: 'change_status';
  organisationId: string;
  userId: string;
  itemId: string;
  /** Snapshot of the item's status AT PROPOSE TIME — the sole basis for
   *  the stale-state comparison at confirm time. Never re-derived from a
   *  fresh read at confirm time; it must be the exact value the user was
   *  shown when they were asked to approve this specific change. */
  expectedCurrentStatus: string;
  desiredStatus: string;
  jti: string;
}

async function signStatusChangeActionToken(payload: StatusChangeTokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

type VerifyStatusChangeActionTokenResult =
  | { ok: true; itemId: string; expectedCurrentStatus: string; desiredStatus: string; jti: string; exp: number }
  | { ok: false; reason: 'expired' | 'invalid' };

/** Deliberately a separate function from verifyActionToken (the
 *  post_comment verifier) rather than a shared generic — see this
 *  module's own D.4.6N header for why keeping the two action types'
 *  verification paths independent is the safer choice here. Same
 *  shape of checks: signature, purpose, actionType, session binding,
 *  well-formed jti, and (new for this action) that both status values
 *  are themselves still members of the canonical set — a token could
 *  never have been minted with an invalid one, so this also catches a
 *  token signed by a since-downgraded/incompatible build. */
async function verifyStatusChangeActionToken(
  token: string,
  expected: { organisationId: string; userId: string },
): Promise<VerifyStatusChangeActionTokenResult> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const p = payload as unknown as StatusChangeTokenPayload;
    if (p.purpose !== TOKEN_PURPOSE) return { ok: false, reason: 'invalid' };
    if (p.actionType !== 'change_status') return { ok: false, reason: 'invalid' };
    if (p.organisationId !== expected.organisationId) return { ok: false, reason: 'invalid' };
    if (p.userId !== expected.userId) return { ok: false, reason: 'invalid' };
    if (typeof p.itemId !== 'string' || !UUID_RE.test(p.itemId)) return { ok: false, reason: 'invalid' };
    if (typeof p.expectedCurrentStatus !== 'string' || !isValidOrganiserItemStatus(p.expectedCurrentStatus)) return { ok: false, reason: 'invalid' };
    if (typeof p.desiredStatus !== 'string' || !isValidOrganiserItemStatus(p.desiredStatus)) return { ok: false, reason: 'invalid' };
    if (typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return { ok: false, reason: 'invalid' };
    const exp = (payload as { exp?: number }).exp;
    if (typeof exp !== 'number') return { ok: false, reason: 'invalid' };
    return { ok: true, itemId: p.itemId, expectedCurrentStatus: p.expectedCurrentStatus, desiredStatus: p.desiredStatus, jti: p.jti, exp };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

export type ProposeOrExecuteStatusChangeResult =
  | {
      ok: true;
      mode: 'proposed';
      proposal: { item_id: string; item_name: string; current_status: string; desired_status: string };
      confirmationToken: string;
    }
  | {
      ok: true;
      mode: 'executed';
      item: { id: string; name: string; previous_status: string; new_status: string };
    }
  | {
      ok: false;
      reason:
        | 'invalid_item_id'
        | 'item_not_found'
        | 'invalid_status'
        // Phase D.4.6N — the requested status already equals the item's
        // current status. Deliberately never mints a token for this (see
        // the phase's own Step 7): a no-op has nothing to confirm, and
        // minting one anyway would just be an extra, pointless single-use
        // token consuming ledger space for zero effect.
        | 'noop_same_status'
        | 'invalid_confirmation'
        | 'expired_confirmation'
        | 'already_used_confirmation'
        // Phase D.4.6N — the token verified fully, but the item's TRUE
        // current status (read under FOR UPDATE at confirm time) no
        // longer matches expectedCurrentStatus. The jti IS still consumed
        // (see this module's own header) — nothing was overwritten.
        | 'stale_item_state';
    };

export interface ProposeOrExecuteStatusChangeParams {
  organisationId: string;
  userId: string;
  actorName: string;
  itemId: string;
  desiredStatus: string;
  /** Present ONLY when sourced from the trusted, non-model-controlled
   *  top-level request field (see app/api/chat/route.ts) — never from a
   *  model tool-call argument. Same trust boundary as
   *  ProposeOrExecuteCommentParams.confirmationToken. */
  confirmationToken?: string;
}

/**
 * The single domain function behind Helena's second write tool. Reuses
 * the exact same FOR UPDATE + MATERIALIZED CTE race-safety discipline
 * already proven in app/api/organiser/items/[itemId]/route.ts's PATCH
 * handler, combined with the exact same durable single-use ledger
 * mechanism proposeOrExecuteOrganiserComment already uses (ON CONFLICT
 * (jti) DO NOTHING against organiser_action_confirmations, migration step
 * 45's action_type expansion). event_type 'item.updated' is the EXISTING
 * canonical status-change activity event (already used by the human PATCH
 * route for any field change, including status) — no new event vocabulary
 * is introduced. metadata_json: {source: 'helena'} mirrors the comment
 * action's own convention.
 */
export async function proposeOrExecuteOrganiserStatusChange(
  params: ProposeOrExecuteStatusChangeParams,
): Promise<ProposeOrExecuteStatusChangeResult> {
  const { organisationId, userId, actorName } = params;

  if (params.confirmationToken) {
    // ── CONFIRM + EXECUTE ──────────────────────────────────────────────
    // The model's CURRENT itemId/desiredStatus arguments are deliberately
    // never consulted below this point — only the values embedded inside
    // the verified token are used, exactly mirroring the comment action's
    // own guarantee.
    const verified = await verifyStatusChangeActionToken(params.confirmationToken, { organisationId, userId });
    if (!verified.ok) {
      return { ok: false, reason: verified.reason === 'expired' ? 'expired_confirmation' : 'invalid_confirmation' };
    }

    // ONE atomic statement performs, in order:
    //   1. lock the target row (target_item, FOR UPDATE) — this is what
    //      makes the stale-state comparison below race-safe: if another
    //      transaction is mid-write on this exact row, this statement
    //      blocks until it commits, then re-reads the TRUE latest status
    //      (Postgres's own EvalPlanQual mechanism) rather than a stale
    //      pre-lock snapshot;
    //   2. attempt to durably consume this exact jti (consumed) — gated
    //      ONLY on the item existing, never on the status matching (see
    //      this module's own "STALE-CONFIRMATION CONSUMPTION" header for
    //      why a stale attempt must still burn its token);
    //   3. apply the UPDATE — gated on BOTH target_item/consumed existing
    //      AND target_item.status still equalling expectedCurrentStatus;
    //   4. insert the activity row — only if the UPDATE produced a row.
    // Every outcome is distinguishable from the single final SELECT:
    //   item_found=0                          -> item_not_found (token unburned)
    //   item_found=1, was_consumed=0          -> already_used_confirmation
    //   item_found=1, was_consumed=1, no row  -> stale_item_state (token burned)
    //   item_found=1, was_consumed=1, row     -> executed
    // If any part of this statement fails (e.g. a future CHECK-constraint
    // violation on the activity insert), Postgres rolls back the ENTIRE
    // statement — including the ledger consume and the status UPDATE — so
    // a transient failure can never leave a partial status change or a
    // permanently-burned token with nothing actually having committed.
    const rows = await sql`
      WITH target_item AS MATERIALIZED (
        SELECT id, board_id, name, status FROM organiser_items
        WHERE id = ${verified.itemId} AND organisation_id = ${organisationId}
        FOR UPDATE
      ),
      consumed AS (
        INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at)
        SELECT ${verified.jti}, ${organisationId}, ${userId}, 'change_status', ${verified.itemId}, to_timestamp(${verified.exp})
        WHERE EXISTS (SELECT 1 FROM target_item)
        ON CONFLICT (jti) DO NOTHING
        RETURNING jti
      ),
      updated AS (
        UPDATE organiser_items i
        SET status = ${verified.desiredStatus}, updated_at = NOW()
        FROM target_item, consumed
        WHERE i.id = target_item.id AND target_item.status = ${verified.expectedCurrentStatus}
        RETURNING i.id, i.board_id, i.name, i.status
      ),
      activity_row AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json, metadata_json
        )
        SELECT
          ${organisationId}, updated.board_id, updated.id, ${userId}, ${actorName},
          'item.updated', 'item', updated.id::text,
          jsonb_build_object('status', organiser_activity_sanitise_scalar(to_jsonb(${verified.expectedCurrentStatus}::text))),
          jsonb_build_object('status', organiser_activity_sanitise_scalar(to_jsonb(updated.status))),
          jsonb_build_object('source', 'helena')
        FROM updated
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM target_item)::int AS item_found,
        (SELECT count(*) FROM consumed)::int AS was_consumed,
        updated.id AS updated_id, updated.name AS item_name, updated.status AS new_status
      FROM (SELECT 1) AS one_row
      LEFT JOIN updated ON true
    `;

    const row = rows[0] as {
      item_found: number;
      was_consumed: number;
      updated_id: string | null;
      item_name: string | null;
      new_status: string | null;
    };

    if (row.item_found === 0) return { ok: false, reason: 'item_not_found' };
    if (row.was_consumed === 0) return { ok: false, reason: 'already_used_confirmation' };
    if (!row.updated_id) return { ok: false, reason: 'stale_item_state' };

    return {
      ok: true,
      mode: 'executed',
      item: {
        id: row.updated_id,
        name: row.item_name ?? '',
        previous_status: verified.expectedCurrentStatus,
        new_status: row.new_status ?? verified.desiredStatus,
      },
    };
  }

  // ── PROPOSE ────────────────────────────────────────────────────────────
  if (!UUID_RE.test(params.itemId)) return { ok: false, reason: 'invalid_item_id' };
  if (!isValidOrganiserItemStatus(params.desiredStatus)) return { ok: false, reason: 'invalid_status' };

  // Phase D.4.6N — same opportunistic ledger maintenance as the comment
  // action's own propose path (see pruneExpiredConfirmationsBestEffort's
  // own header) — deliberately after the zero-sql-for-invalid-input
  // checks above.
  await pruneExpiredConfirmationsBestEffort();

  const itemRows = await sql`
    SELECT id, name, status FROM organiser_items
    WHERE id = ${params.itemId} AND organisation_id = ${organisationId}
    LIMIT 1
  `;
  if (itemRows.length === 0) return { ok: false, reason: 'item_not_found' };
  const itemName = itemRows[0].name as string;
  const currentStatus = itemRows[0].status as string;

  if (currentStatus === params.desiredStatus) return { ok: false, reason: 'noop_same_status' };

  const confirmationToken = await signStatusChangeActionToken({
    purpose: TOKEN_PURPOSE,
    actionType: 'change_status',
    organisationId,
    userId,
    itemId: params.itemId,
    expectedCurrentStatus: currentStatus,
    desiredStatus: params.desiredStatus,
    // Phase D.4.6N — minted fresh on every proposal, never derived from
    // item/status (a resend of an identical proposal gets a different
    // jti, and therefore its own independent single-use slot in the
    // ledger) — same discipline as the comment action's own jti.
    jti: randomUUID(),
  });

  return {
    ok: true,
    mode: 'proposed',
    proposal: {
      item_id: params.itemId,
      item_name: itemName,
      current_status: currentStatus,
      desired_status: params.desiredStatus,
    },
    confirmationToken,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase D.4.6O — Helena's THIRD (and, for this phase, last) Organiser write
// action: moving one existing item to one existing destination group on
// the SAME board. Same propose/confirm+execute contract as the two actions
// above (see proposeOrExecuteOrganiserComment's own header).
//
// GROUP MODEL — organiser_groups.board_id is authoritative and
// independent of organiser_items.group_id's own FK target: the DB foreign
// key on group_id only proves the target group ROW exists somewhere,
// never that it belongs to the same board as the item. This is exactly
// why app/api/organiser/items/[itemId]/route.ts's own PATCH handler
// validates `g.board_id = old.board_id` explicitly (see that route's own
// `validation` CTE) — the identical check is reused here, at
// confirm-execute time, inside this action's own atomic statement.
// organiser_groups.name has NO uniqueness constraint per board, so a
// destination name that matches more than one group on the same board is
// never guessed — see 'ambiguous_destination' below. organiser_items.
// group_id is nullable (an item can be ungrouped; ON DELETE SET NULL when
// its group is deleted), so 'null' is an explicit, legitimate value for
// both the current AND destination side of this action.
//
// STALE-LOCATION PROTECTION (the headline new safety property, mirroring
// D.4.6N's stale-state guard) — the token binds expectedSourceGroupId,
// the item's group_id AT PROPOSE TIME (nullable). At confirm time, the
// atomic statement locks the target row (FOR UPDATE) and only applies the
// group_id UPDATE when the row's TRUE, currently-committed group_id
// (NULL-safe IS NOT DISTINCT FROM) still equals expectedSourceGroupId —
// if another actor moved the item in the interim, the UPDATE's own WHERE
// clause matches zero rows and nothing is overwritten.
//
// DESTINATION-RACE PROTECTION — the destination group is re-validated
// (exists, same organisation, same board as the item) INSIDE the same
// atomic confirm-time statement, never trusted merely because it passed
// validation at propose time — if the destination was deleted or (were it
// ever possible) reassigned to another board in the interim, the UPDATE's
// own WHERE clause matches zero rows and nothing is overwritten.
//
// STALE-CONFIRMATION CONSUMPTION — identical asymmetry to the status-
// change action: the ledger `consumed` INSERT is gated ONLY on the target
// item existing, never on the source-group or destination-group checks
// passing. A stale-location or destination-invalidated attempt DOES burn
// its jti; only item_not_found leaves it unburned — see this module's own
// "STALE-CONFIRMATION CONSUMPTION" header above for the full reasoning,
// unchanged here.
//
// ORDERING — position is deliberately never read, computed, or written by
// this action. This reuses exactly the canonical default the existing
// human PATCH route itself falls back to when a request doesn't specify
// position (`position = COALESCE(new, old.position)`) — omitting position
// entirely here has the identical effect, so the item keeps its existing
// position value untouched. No raw ordering value is ever exposed to the
// model.
//
// ACTIVITY — reuses the ALREADY-EXISTING 'item.moved' event_type (added in
// migration step 43, and already the exact event the human PATCH route
// emits for a group_id change) — no new vocabulary is introduced.

interface GroupMoveTokenPayload {
  purpose: typeof TOKEN_PURPOSE;
  actionType: 'move_group';
  organisationId: string;
  userId: string;
  itemId: string;
  boardId: string;
  /** Snapshot of the item's group_id AT PROPOSE TIME — null when the item
   *  was ungrouped. The sole basis for the stale-location comparison at
   *  confirm time; never re-derived from a fresh read at confirm time. */
  expectedSourceGroupId: string | null;
  destinationGroupId: string;
  /** Display-only snapshots (never the security check) — a group rename
   *  between propose and confirm is cosmetic, not a correctness issue. */
  sourceGroupName: string | null;
  destinationGroupName: string;
  jti: string;
}

async function signGroupMoveActionToken(payload: GroupMoveTokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

type VerifyGroupMoveActionTokenResult =
  | {
      ok: true;
      itemId: string;
      boardId: string;
      expectedSourceGroupId: string | null;
      destinationGroupId: string;
      sourceGroupName: string | null;
      destinationGroupName: string;
      jti: string;
      exp: number;
    }
  | { ok: false; reason: 'expired' | 'invalid' };

/** Deliberately a separate function from the other two verifiers — see
 *  this module's own D.4.6N header for why keeping each action type's
 *  verification path independent is the safer choice. Same shape of
 *  checks: signature, purpose, actionType, session binding, well-formed
 *  jti/ids; expectedSourceGroupId is allowed to be null (an ungrouped
 *  item) but if present must be UUID-shaped. */
async function verifyGroupMoveActionToken(
  token: string,
  expected: { organisationId: string; userId: string },
): Promise<VerifyGroupMoveActionTokenResult> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const p = payload as unknown as GroupMoveTokenPayload;
    if (p.purpose !== TOKEN_PURPOSE) return { ok: false, reason: 'invalid' };
    if (p.actionType !== 'move_group') return { ok: false, reason: 'invalid' };
    if (p.organisationId !== expected.organisationId) return { ok: false, reason: 'invalid' };
    if (p.userId !== expected.userId) return { ok: false, reason: 'invalid' };
    if (typeof p.itemId !== 'string' || !UUID_RE.test(p.itemId)) return { ok: false, reason: 'invalid' };
    if (typeof p.boardId !== 'string' || !UUID_RE.test(p.boardId)) return { ok: false, reason: 'invalid' };
    if (p.expectedSourceGroupId !== null && (typeof p.expectedSourceGroupId !== 'string' || !UUID_RE.test(p.expectedSourceGroupId))) {
      return { ok: false, reason: 'invalid' };
    }
    if (typeof p.destinationGroupId !== 'string' || !UUID_RE.test(p.destinationGroupId)) return { ok: false, reason: 'invalid' };
    if (p.sourceGroupName !== null && typeof p.sourceGroupName !== 'string') return { ok: false, reason: 'invalid' };
    if (typeof p.destinationGroupName !== 'string') return { ok: false, reason: 'invalid' };
    if (typeof p.jti !== 'string' || !UUID_RE.test(p.jti)) return { ok: false, reason: 'invalid' };
    const exp = (payload as { exp?: number }).exp;
    if (typeof exp !== 'number') return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      itemId: p.itemId,
      boardId: p.boardId,
      expectedSourceGroupId: p.expectedSourceGroupId,
      destinationGroupId: p.destinationGroupId,
      sourceGroupName: p.sourceGroupName,
      destinationGroupName: p.destinationGroupName,
      jti: p.jti,
      exp,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

export type ProposeOrExecuteGroupMoveResult =
  | {
      ok: true;
      mode: 'proposed';
      proposal: {
        item_id: string;
        item_name: string;
        source_group_id: string | null;
        source_group_name: string | null;
        destination_group_id: string;
        destination_group_name: string;
      };
      confirmationToken: string;
    }
  | {
      ok: true;
      mode: 'executed';
      item: {
        id: string;
        name: string;
        previous_group_name: string | null;
        new_group_name: string;
      };
    }
  | {
      ok: false;
      reason:
        | 'invalid_item_id'
        | 'item_not_found'
        | 'destination_not_found'
        // Phase D.4.6O — a name that matches more than one group on the
        // same board. Never guessed; the user must give a more specific
        // name or the proposal must be re-issued once disambiguated.
        | 'ambiguous_destination'
        // Phase D.4.6O — the named destination exists but belongs to a
        // DIFFERENT board than the item — this action is same-board
        // movement only, never a board move.
        | 'invalid_destination'
        // Phase D.4.6O — destination already equals the item's current
        // group. Deliberately never mints a token for this (mirrors
        // noop_same_status): a no-op has nothing to confirm.
        | 'noop_same_group'
        | 'invalid_confirmation'
        | 'expired_confirmation'
        | 'already_used_confirmation'
        // Phase D.4.6O — the token verified fully, but the item's TRUE
        // current group (read under FOR UPDATE at confirm time) no longer
        // matches expectedSourceGroupId. The jti IS still consumed (see
        // this module's own header) — nothing was overwritten.
        | 'stale_item_location';
    };

export interface ProposeOrExecuteGroupMoveParams {
  organisationId: string;
  userId: string;
  actorName: string;
  itemId: string;
  /** Plain destination-group name as the model/user expressed it — never
   *  an id the model could supply directly. Resolved server-side, at
   *  PROPOSE time only, to exactly one group scoped to the item's own
   *  board; the resolved id is what the confirmation token actually
   *  binds. */
  destinationGroupName: string;
  /** Present ONLY when sourced from the trusted, non-model-controlled
   *  top-level request field (see app/api/chat/route.ts) — never from a
   *  model tool-call argument. Same trust boundary as the other two
   *  actions' confirmationToken. */
  confirmationToken?: string;
}

/**
 * The single domain function behind Helena's third write tool. Reuses the
 * exact same FOR UPDATE + MATERIALIZED CTE race-safety discipline already
 * proven for status change, combined with the exact same durable
 * single-use ledger conflict-detection mechanism against
 * organiser_action_confirmations, migration step 46's action_type
 * expansion). event_type 'item.moved' is the EXISTING canonical
 * group-move activity event (already used by the human PATCH route for
 * any group_id change) — no new event vocabulary is introduced.
 */
export async function proposeOrExecuteOrganiserGroupMove(
  params: ProposeOrExecuteGroupMoveParams,
): Promise<ProposeOrExecuteGroupMoveResult> {
  const { organisationId, userId, actorName } = params;

  if (params.confirmationToken) {
    // ── CONFIRM + EXECUTE ──────────────────────────────────────────────
    // The model's CURRENT itemId/destinationGroupName arguments are
    // deliberately never consulted below this point — only the values
    // embedded inside the verified token are used, exactly mirroring the
    // other two actions' own guarantee.
    const verified = await verifyGroupMoveActionToken(params.confirmationToken, { organisationId, userId });
    if (!verified.ok) {
      return { ok: false, reason: verified.reason === 'expired' ? 'expired_confirmation' : 'invalid_confirmation' };
    }

    // ONE atomic statement performs, in order:
    //   1. lock the target row (target_item, FOR UPDATE) — race-safety
    //      foundation for the stale-location comparison below, identical
    //      in spirit to the status-change action's own target_item lock;
    //   2. compute dest_check — whether the destination group still
    //      exists in this organisation at all (dest_exists) AND, only if
    //      so, whether it still belongs to the item's own board
    //      (dest_same_board) — computed independently of whether
    //      target_item found a row, so it always resolves to a harmless
    //      false/false pair when the item itself is missing;
    //   3. attempt to durably consume this exact jti (consumed) — gated
    //      ONLY on the item existing, never on the source/destination
    //      checks passing (see this module's own "STALE-CONFIRMATION
    //      CONSUMPTION" header);
    //   4. apply the UPDATE — gated on target_item/consumed existing AND
    //      target_item.group_id still matching expectedSourceGroupId
    //      (NULL-safe) AND the destination still being valid;
    //   5. insert the activity row — only if the UPDATE produced a row.
    // Every outcome is distinguishable from the single final SELECT:
    //   item_found=0                                   -> item_not_found (token unburned)
    //   item_found=1, was_consumed=0                    -> already_used_confirmation
    //   item_found=1, consumed=1, !dest_exists          -> destination_not_found (token burned)
    //   item_found=1, consumed=1, dest_exists, !dest_same_board -> invalid_destination (token burned)
    //   item_found=1, consumed=1, dest valid, group mismatch    -> stale_item_location (token burned)
    //   item_found=1, consumed=1, dest valid, group matched     -> executed
    // If any part of this statement fails, Postgres rolls back the ENTIRE
    // statement — including the ledger consume and the group UPDATE — so
    // a transient failure can never leave a partial move or a
    // permanently-burned token with nothing actually having committed.
    const rows = await sql`
      WITH target_item AS MATERIALIZED (
        SELECT id, board_id, name, group_id FROM organiser_items
        WHERE id = ${verified.itemId} AND organisation_id = ${organisationId}
        FOR UPDATE
      ),
      dest_check AS (
        SELECT
          EXISTS (
            SELECT 1 FROM organiser_groups g
            WHERE g.id = ${verified.destinationGroupId} AND g.organisation_id = ${organisationId}
          ) AS dest_exists,
          EXISTS (
            SELECT 1 FROM organiser_groups g, target_item
            WHERE g.id = ${verified.destinationGroupId}
              AND g.organisation_id = ${organisationId}
              AND g.board_id = target_item.board_id
          ) AS dest_same_board
      ),
      consumed AS (
        INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at)
        SELECT ${verified.jti}, ${organisationId}, ${userId}, 'move_group', ${verified.itemId}, to_timestamp(${verified.exp})
        WHERE EXISTS (SELECT 1 FROM target_item)
        ON CONFLICT (jti) DO NOTHING
        RETURNING jti
      ),
      updated AS (
        UPDATE organiser_items i
        SET group_id = ${verified.destinationGroupId}, updated_at = NOW()
        FROM target_item, consumed, dest_check
        WHERE i.id = target_item.id
          AND target_item.group_id IS NOT DISTINCT FROM ${verified.expectedSourceGroupId}
          AND dest_check.dest_same_board
        RETURNING i.id, i.board_id, i.name, i.group_id
      ),
      activity_row AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json, metadata_json
        )
        SELECT
          ${organisationId}, updated.board_id, updated.id, ${userId}, ${actorName},
          'item.moved', 'item', updated.id::text,
          jsonb_build_object('group_id', organiser_activity_sanitise_scalar(to_jsonb(${verified.expectedSourceGroupId}::text))),
          jsonb_build_object('group_id', organiser_activity_sanitise_scalar(to_jsonb(updated.group_id))),
          jsonb_build_object('source', 'helena')
        FROM updated
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM target_item)::int AS item_found,
        (SELECT count(*) FROM consumed)::int AS was_consumed,
        (SELECT dest_exists FROM dest_check) AS dest_exists,
        (SELECT dest_same_board FROM dest_check) AS dest_same_board,
        updated.id AS updated_id, updated.name AS item_name
      FROM (SELECT 1) AS one_row
      LEFT JOIN updated ON true
    `;

    const row = rows[0] as {
      item_found: number;
      was_consumed: number;
      dest_exists: boolean;
      dest_same_board: boolean;
      updated_id: string | null;
      item_name: string | null;
    };

    if (row.item_found === 0) return { ok: false, reason: 'item_not_found' };
    if (row.was_consumed === 0) return { ok: false, reason: 'already_used_confirmation' };
    if (!row.updated_id) {
      if (!row.dest_exists) return { ok: false, reason: 'destination_not_found' };
      if (!row.dest_same_board) return { ok: false, reason: 'invalid_destination' };
      return { ok: false, reason: 'stale_item_location' };
    }

    return {
      ok: true,
      mode: 'executed',
      item: {
        id: row.updated_id,
        name: row.item_name ?? '',
        previous_group_name: verified.sourceGroupName,
        new_group_name: verified.destinationGroupName,
      },
    };
  }

  // ── PROPOSE ────────────────────────────────────────────────────────────
  if (!UUID_RE.test(params.itemId)) return { ok: false, reason: 'invalid_item_id' };
  const destinationGroupName = params.destinationGroupName.trim();
  if (destinationGroupName.length === 0) return { ok: false, reason: 'destination_not_found' };

  // Phase D.4.6O — same opportunistic ledger maintenance as the other two
  // actions' own propose path (see pruneExpiredConfirmationsBestEffort's
  // own header) — deliberately after the zero-sql-for-invalid-input
  // checks above.
  await pruneExpiredConfirmationsBestEffort();

  const itemRows = await sql`
    SELECT i.id, i.name, i.board_id, i.group_id, g.name AS source_group_name
    FROM organiser_items i
    LEFT JOIN organiser_groups g ON g.id = i.group_id
    WHERE i.id = ${params.itemId} AND i.organisation_id = ${organisationId}
    LIMIT 1
  `;
  if (itemRows.length === 0) return { ok: false, reason: 'item_not_found' };
  const item = itemRows[0] as { id: string; name: string; board_id: string; group_id: string | null; source_group_name: string | null };

  // Phase D.4.6O — board-scoped, case-insensitive EXACT name match (never
  // ILIKE wildcards, never a substring match) — this is what makes a
  // same-named group on a DIFFERENT board structurally invisible to this
  // lookup (it simply never matches, since board_id is part of the WHERE
  // clause), and what makes more than one same-named group on THIS board
  // surface as ambiguous_destination rather than an arbitrarily-picked
  // row.
  const destRows = await sql`
    SELECT id, name FROM organiser_groups
    WHERE organisation_id = ${organisationId}
      AND board_id = ${item.board_id}
      AND LOWER(name) = LOWER(${destinationGroupName})
  `;
  if (destRows.length === 0) return { ok: false, reason: 'destination_not_found' };
  if (destRows.length > 1) return { ok: false, reason: 'ambiguous_destination' };
  const destination = destRows[0] as { id: string; name: string };

  if (item.group_id === destination.id) return { ok: false, reason: 'noop_same_group' };

  const confirmationToken = await signGroupMoveActionToken({
    purpose: TOKEN_PURPOSE,
    actionType: 'move_group',
    organisationId,
    userId,
    itemId: params.itemId,
    boardId: item.board_id,
    expectedSourceGroupId: item.group_id,
    destinationGroupId: destination.id,
    sourceGroupName: item.source_group_name,
    destinationGroupName: destination.name,
    // Phase D.4.6O — minted fresh on every proposal, never derived from
    // item/group (a resend of an identical proposal gets a different
    // jti, and therefore its own independent single-use slot in the
    // ledger) — same discipline as the other two actions' own jti.
    jti: randomUUID(),
  });

  return {
    ok: true,
    mode: 'proposed',
    proposal: {
      item_id: params.itemId,
      item_name: item.name,
      source_group_id: item.group_id,
      source_group_name: item.source_group_name,
      destination_group_id: destination.id,
      destination_group_name: destination.name,
    },
    confirmationToken,
  };
}
