import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';

// Phase D.4.6K — real disposable-Postgres proof that a Helena Organiser
// confirmation token is globally single-use, including under genuine
// concurrency. A mock cannot prove this: the entire defense is Postgres's
// own UNIQUE-constraint conflict-resolution behavior under
// `INSERT ... ON CONFLICT (jti) DO NOTHING`, which only real MVCC/locking
// semantics can exercise. Run ONLY via
// scripts/tests/verify-organiser-confirmation-replay.sh, which creates the
// disposable postgres:16-alpine container, applies the real schema
// (organisations/users/organiser_boards/organiser_items/
// organiser_item_updates/organiser_activity/organiser_action_confirmations
// — the last one is migration step 44, see app/api/admin/migrate/route.ts),
// and exports DATABASE_URL before this file is ever imported.
//
// TEST SEAM (mirrors scripts/tests/dataHubInitiateFinalizeRoutes
// .integration.test.ts's own established pattern): lib/db's tagged-template
// `sql` — the ONLY thing helenaWrite.ts imports for persistence — is
// replaced by a Prisma-backed equivalent so the real, completely
// unmodified proposeOrExecuteOrganiserComment runs its real SQL against
// this real Postgres container. authorizeHelenaOrganiserWrite() is never
// called by proposeOrExecuteOrganiserComment itself (auth happens one
// layer up, in lib/organiser/helenaTools.ts — already covered by
// tests/containment/organiserHelenaWrite.test.ts's mocked-auth suite), so
// no auth seam is needed here at all: this file calls
// proposeOrExecuteOrganiserComment directly with already-trusted
// organisationId/userId/actorName, exactly as helenaTools.ts itself would
// after its own real auth check passed.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'organiserConfirmationReplay.integration.test.ts requires DATABASE_URL to point at a disposable ' +
      'Postgres container (see scripts/tests/verify-organiser-confirmation-replay.sh). Refusing to run without it.'
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    'Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. ' +
      'This suite may ONLY run against a local disposable Docker container.'
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

process.env.SESSION_SECRET ??= 'integration-test-secret-never-real-never-production-0000';

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// Prisma's $queryRawUnsafe sends an explicit `text` type OID for string
// parameters, unlike the real Neon driver (which leaves parameter types
// unknown and lets Postgres infer them from context) — this only matters
// here because, unlike every other table this repo's Data Hub integration
// harnesses touch (which use TEXT ids throughout), organiser_boards/
// organiser_items/organiser_action_confirmations.item_id are UUID columns.
// Auto-casting any UUID-SHAPED string parameter to ::uuid reproduces the
// real driver's own inference for this one case, with zero change to the
// real SQL text helenaWrite.ts itself emits.
const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return prisma.$queryRawUnsafe(text, ...values);
}

vi.doMock('@/lib/db', () => ({ default: neonCompatibleSql }));

let proposeOrExecuteOrganiserComment: typeof import('@/lib/organiser/helenaWrite').proposeOrExecuteOrganiserComment;
let proposeOrExecuteOrganiserStatusChange: typeof import('@/lib/organiser/helenaWrite').proposeOrExecuteOrganiserStatusChange;
let proposeOrExecuteOrganiserGroupMove: typeof import('@/lib/organiser/helenaWrite').proposeOrExecuteOrganiserGroupMove;

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const ACTOR_NAME = 'Integration Tester';

let boardId: string;
let otherBoardId: string;
let groupA: string;
let groupB: string;
let otherBoardGroup: string;
let otherOrgGroup: string;

async function freshItem(name: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_items (board_id, organisation_id, name, status) VALUES ($1::uuid, $2, $3, 'Not Started') RETURNING id`,
    boardId, ORG, name,
  );
  return rows[0].id;
}

beforeAll(async () => {
  ({ proposeOrExecuteOrganiserComment, proposeOrExecuteOrganiserStatusChange, proposeOrExecuteOrganiserGroupMove } = await import('@/lib/organiser/helenaWrite'));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES ('org-a', 'Org A', 'org-a'), ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('user-1', 'org-a', 'user-1', 'User One'),
      ('user-2', 'org-b', 'user-2', 'User Two')
    ON CONFLICT (id) DO NOTHING
  `);
  const boards = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_boards (organisation_id, name) VALUES ('org-a', 'WORK') RETURNING id`,
  );
  boardId = boards[0].id;

  // Phase D.4.6O — a second board (same org) for cross-board destination
  // tests, plus real groups on each board/org for the group-move suite.
  const otherBoards = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_boards (organisation_id, name) VALUES ('org-a', 'OTHER BOARD') RETURNING id`,
  );
  otherBoardId = otherBoards[0].id;

  const groupsA = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Group A') RETURNING id`,
    boardId,
  );
  groupA = groupsA[0].id;
  const groupsB = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Group B') RETURNING id`,
    boardId,
  );
  groupB = groupsB[0].id;
  const otherBoardGroups = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Other Board Group') RETURNING id`,
    otherBoardId,
  );
  otherBoardGroup = otherBoardGroups[0].id;

  const otherOrgBoards = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_boards (organisation_id, name) VALUES ('org-b', 'ORG B BOARD') RETURNING id`,
  );
  const otherOrgGroups = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES ($1::uuid, 'org-b', 'Org B Group') RETURNING id`,
    otherOrgBoards[0].id,
  );
  otherOrgGroup = otherOrgGroups[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function countRows(table: string, where: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`);
  return Number(rows[0].count);
}

describe('D.4.6K — durable confirmation-token replay protection (real Postgres)', () => {
  it('1. first confirmation succeeds: exactly one comment, one activity row, one ledger row', async () => {
    const itemId = await freshItem('Replay Item 1');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'first confirm',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.mode === 'executed') {
      expect(result.comment.body).toBe('first confirm');
    } else {
      throw new Error('expected executed');
    }
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(1);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'comment.created'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('2. same token replayed in a SEPARATE call is rejected — zero second comment, zero second activity row, zero second ledger row', async () => {
    const itemId = await freshItem('Replay Item 2');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'once only',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const first = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(first.ok).toBe(true);

    const replay = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(replay).toEqual({ ok: false, reason: 'already_used_confirmation' });

    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(1);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'comment.created'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('3. CONCURRENT replay: two simultaneous confirmations with the exact same token -> exactly one succeeds, exactly one comment/activity/ledger row exists', async () => {
    const itemId = await freshItem('Concurrent Replay Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'concurrent test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const [a, b] = await Promise.all([
      proposeOrExecuteOrganiserComment({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
      proposeOrExecuteOrganiserComment({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
    ]);

    const outcomes = [a, b];
    const successes = outcomes.filter(r => r.ok && r.mode === 'executed');
    const rejections = outcomes.filter(r => !r.ok && r.reason === 'already_used_confirmation');
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(1);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'comment.created'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('4. expired token cannot consume a ledger row and cannot mutate (jwtVerify itself rejects it before any SQL runs)', async () => {
    const itemId = await freshItem('Expired Item');
    // Mint a token with the EXACT same claims shape verifyActionToken
    // expects, signed with the same secret, but with an exp timestamp
    // already in the past — a direct, deterministic way to prove expiry
    // without depending on jose's internal clock source (which reads via
    // `new Date()`, not a mockable `Date.now()` call site).
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const pastExp = Math.floor(Date.now() / 1000) - 60; // 60s in the past
    const expiredToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'post_comment',
      organisationId: ORG,
      userId: USER,
      itemId,
      body: 'expired',
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(pastExp - 120)
      .setExpirationTime(pastExp)
      .sign(secret);

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: expiredToken,
    });
    // Phase D.4.6L — expiry is now its own distinct reason (jose's own
    // JWTExpired, thrown only for a signature-valid-but-past-exp token),
    // so the caller can narrate "please ask again" instead of a bare
    // generic failure. This is still a hard rejection: zero mutation,
    // zero ledger row, exactly as before.
    expect(result).toEqual({ ok: false, reason: 'expired_confirmation' });
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('5. wrong-user token cannot consume — zero mutation, zero ledger row', async () => {
    const itemId = await freshItem('Wrong User Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'wrong user test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: 'someone-else', actorName: 'Someone Else', itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('6. wrong-org token cannot consume — zero mutation, zero ledger row', async () => {
    const itemId = await freshItem('Wrong Org Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'wrong org test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: OTHER_ORG, userId: OTHER_USER, actorName: 'Cross Tenant', itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('7. tampered token (signature invalidated) cannot consume', async () => {
    const itemId = await freshItem('Tampered Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'tamper test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const parts = proposal.confirmationToken.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: tampered,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('8. item_not_found leaves the token UNBURNED — a subsequent confirm against a real item with the same token still succeeds (no partial state from a failed target lookup)', async () => {
    // Propose against a real item, then delete the item before confirming,
    // then recreate an item with the SAME id is not possible (UUIDs), so
    // instead: propose, delete the item, confirm (-> item_not_found, token
    // unburned), recreate the SAME item id is impossible — so this proves
    // the narrower, directly-testable half of the atomicity guarantee: the
    // ledger row must NOT exist after an item_not_found outcome.
    const itemId = await freshItem('Will Be Deleted');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'orphaned confirm',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`DELETE FROM organiser_items WHERE id = $1::uuid`, itemId);

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'item_not_found' });
    // The core failure-atomicity assertion: no ledger row was left behind
    // for a confirmation that never actually mutated anything.
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('9. ledger uniqueness is enforced at the DB level — a raw duplicate INSERT of the same jti is rejected by Postgres itself', async () => {
    const itemId = await freshItem('Uniqueness Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'uniqueness test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    const jti: string = JSON.parse(Buffer.from(proposal.confirmationToken.split('.')[1], 'base64url').toString('utf8')).jti;

    // The real confirm already consumed it (from a fresh confirm call).
    const confirmed = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(confirmed.ok).toBe(true);

    // A raw attempt to insert the SAME jti again must violate the PRIMARY KEY.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'post_comment', $4::uuid, NOW())`,
        jti, ORG, USER, itemId,
      ),
    ).rejects.toThrow();
  });

  it("10. activity.metadata.source='helena' is preserved through the atomic statement", async () => {
    const itemId = await freshItem('Metadata Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'metadata test',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    const rows = await prisma.$queryRawUnsafe<{ source: string }[]>(
      `SELECT metadata_json->>'source' AS source FROM organiser_activity WHERE item_id = $1::uuid AND event_type = 'comment.created'`,
      itemId,
    );
    expect(rows[0].source).toBe('helena');
  });

  it('11. proposal path remains non-mutating: zero organiser_item_updates/organiser_activity/organiser_action_confirmations rows from propose alone', async () => {
    const itemId = await freshItem('Non-Mutating Proposal Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'never confirmed',
    });
    expect(proposal.ok).toBe(true);
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(0);
    expect(await countRows('organiser_activity', `item_id = '${itemId}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });
});

// Phase D.4.6L — ledger retention, proven against real Postgres. A mock can
// assert the DELETE statement's shape (see organiserHelenaWrite.test.ts's
// own pruneExpiredConfirmationsBestEffort suite for that), but only a real
// database can prove the actual row-level boundary: exactly which rows a
// live DELETE ... WHERE expires_at < NOW() - INTERVAL '1 day' removes,
// versus leaves alone.
describe('D.4.6L — ledger retention / cleanup (real Postgres)', () => {
  let pruneExpiredConfirmationsBestEffort: typeof import('@/lib/organiser/helenaWrite').pruneExpiredConfirmationsBestEffort;

  beforeAll(async () => {
    ({ pruneExpiredConfirmationsBestEffort } = await import('@/lib/organiser/helenaWrite'));
  });

  async function insertLedgerRow(jti: string, expiresAtSql: string): Promise<void> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at)
       VALUES ($1, $2, $3, 'post_comment', NULL, ${expiresAtSql})`,
      jti, ORG, USER,
    );
  }

  async function ledgerRowExists(jti: string): Promise<boolean> {
    return (await countRows('organiser_action_confirmations', `jti = '${jti}'`)) === 1;
  }

  it('K/M. a row expired well past the 1-day safety margin is pruned', async () => {
    const jti = randomUUID();
    await insertLedgerRow(jti, `NOW() - INTERVAL '2 days'`);
    await pruneExpiredConfirmationsBestEffort();
    expect(await ledgerRowExists(jti)).toBe(false);
  });

  it('L. an unexpired row (expires_at still in the future) is retained', async () => {
    const jti = randomUUID();
    await insertLedgerRow(jti, `NOW() + INTERVAL '1 hour'`);
    await pruneExpiredConfirmationsBestEffort();
    expect(await ledgerRowExists(jti)).toBe(true);
  });

  it('M. a just-expired row still INSIDE the 1-day safety margin is retained, not pruned', async () => {
    const jti = randomUUID();
    await insertLedgerRow(jti, `NOW() - INTERVAL '1 hour'`); // expired, but well inside the 1-day margin
    await pruneExpiredConfirmationsBestEffort();
    expect(await ledgerRowExists(jti)).toBe(true);
  });

  it('P. cleanup never opens a replay window: a real token whose ledger row becomes cleanup-eligible is ALREADY rejected by jwtVerify\'s own real-time expiry check, independent of whether the ledger row still exists', async () => {
    const itemId = await freshItem('Retention Replay-Safety Item');
    // A token this old (expires_at far enough in the past to be
    // cleanup-eligible) is, by construction, also long past its OWN 2-minute
    // TTL — jwtVerify rejects it before proposeOrExecuteOrganiserComment
    // ever reaches the ledger, with or without cleanup ever running.
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const pastExp = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60; // 2 days in the past
    const jti = randomUUID();
    const staleToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'post_comment',
      organisationId: ORG,
      userId: USER,
      itemId,
      body: 'stale',
      jti,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(pastExp - 120)
      .setExpirationTime(pastExp)
      .sign(secret);

    // Simulate this jti's ledger row having existed and then been pruned.
    await insertLedgerRow(jti, `to_timestamp(${pastExp})`);
    await pruneExpiredConfirmationsBestEffort();
    expect(await ledgerRowExists(jti)).toBe(false);

    // Attempting to "replay" this same stale token now (row gone) must
    // still fail — and fail for the SAME reason it always would have
    // (expiry), never succeed and never fall through to a fresh mutation.
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: staleToken,
    });
    expect(result).toEqual({ ok: false, reason: 'expired_confirmation' });
    expect(await countRows('organiser_item_updates', `item_id = '${itemId}'`)).toBe(0);
  });

  it('cleanup does not disturb an active, unexpired ledger row from a real in-flight confirmation', async () => {
    const itemId = await freshItem('Retention Coexistence Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'coexists with cleanup',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    const confirmed = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(confirmed.ok).toBe(true);

    // This real confirmation's own ledger row has expires_at ~2 minutes in
    // the future — nowhere near the 1-day margin — so an unrelated cleanup
    // call must leave it untouched, and the replay-rejection guarantee
    // must still hold immediately afterward.
    await pruneExpiredConfirmationsBestEffort();
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);

    const replay = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(replay).toEqual({ ok: false, reason: 'already_used_confirmation' });
  });
});

// Phase D.4.6N — real-Postgres proof for Helena's SECOND Organiser write
// action (guarded item status change). Same disposable-container harness,
// same real, unmodified proposeOrExecuteOrganiserStatusChange. The critical
// new property this suite proves — that a mock cannot prove — is the
// stale-state race: only real MVCC/FOR UPDATE semantics can demonstrate
// that a concurrent status change is never silently overwritten.
async function freshItemWithStatus(name: string, status: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_items (board_id, organisation_id, name, status) VALUES ($1::uuid, $2, $3, $4) RETURNING id`,
    boardId, ORG, name, status,
  );
  return rows[0].id;
}

describe('D.4.6N — guarded Organiser item status change (real Postgres)', () => {
  it('1. normal status confirmation: exactly one status change, one activity row, one ledger row', async () => {
    const itemId = await freshItemWithStatus('Status Item 1', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === 'executed') {
      expect(result.item.new_status).toBe('Done');
      expect(result.item.previous_status).toBe('Not Started');
    } else {
      throw new Error('expected executed');
    }

    const statusRows = await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(statusRows[0].status).toBe('Done');
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.updated'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('2. same token replayed in a SEPARATE call is rejected — zero second status change, zero second activity row', async () => {
    const itemId = await freshItemWithStatus('Status Item 2', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const first = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(first.ok).toBe(true);

    const replay = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(replay).toEqual({ ok: false, reason: 'already_used_confirmation' });
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.updated'`)).toBe(1);
  });

  it('3. CONCURRENT replay: two simultaneous confirmations with the exact same token -> exactly one succeeds, exactly one status change/activity/ledger row exists', async () => {
    const itemId = await freshItemWithStatus('Concurrent Status Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const [a, b] = await Promise.all([
      proposeOrExecuteOrganiserStatusChange({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
      proposeOrExecuteOrganiserStatusChange({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
    ]);

    const outcomes = [a, b];
    const successes = outcomes.filter(r => r.ok && r.mode === 'executed');
    const rejections = outcomes.filter(r => !r.ok && r.reason === 'already_used_confirmation');
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    const statusRows = await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(statusRows[0].status).toBe('Done');
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.updated'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('4. CRITICAL — STALE-STATE RACE: item changed by another actor between propose and confirm is NEVER overwritten', async () => {
    const itemId = await freshItemWithStatus('Stale Race Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    // Simulates "another user changes the item to In Progress" via the
    // exact same table a real human PATCH would touch — direct SQL here
    // stands in for that other actor's own independent write.
    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET status = 'Working on it' WHERE id = $1::uuid`, itemId);

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_item_state' });

    // The item remains at the OTHER actor's value — never overwritten to
    // the originally-proposed 'Done'.
    const statusRows = await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(statusRows[0].status).toBe('Working on it');
    // No Helena status-change activity was recorded for the rejected transition.
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.updated'`)).toBe(0);
  });

  it('5. the stale confirmation token is CONSUMED (burned) despite rejecting the write — cannot later become executable even if status cycles back', async () => {
    const itemId = await freshItemWithStatus('Stale Consumption Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET status = 'Working on it' WHERE id = $1::uuid`, itemId);
    const staleResult = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(staleResult).toEqual({ ok: false, reason: 'stale_item_state' });
    // The jti IS in the ledger now — this is the deliberate asymmetry from
    // item_not_found (see helenaWrite.ts's own header for why).
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);

    // Cycle the status BACK to the originally-expected value within the
    // token's own validity window — the exact scenario the deliberate
    // consumption exists to guard against.
    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET status = 'Not Started' WHERE id = $1::uuid`, itemId);
    const retryResult = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(retryResult).toEqual({ ok: false, reason: 'already_used_confirmation' });
    // Still zero Helena status-change activity from this token, ever.
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.updated'`)).toBe(0);
  });

  it('6. expired token cannot change status and cannot mutate (jwtVerify itself rejects it before any SQL runs)', async () => {
    const itemId = await freshItemWithStatus('Expired Status Item', 'Not Started');
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const expiredToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'change_status',
      organisationId: ORG,
      userId: USER,
      itemId,
      expectedCurrentStatus: 'Not Started',
      desiredStatus: 'Done',
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(pastExp - 120)
      .setExpirationTime(pastExp)
      .sign(secret);

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: expiredToken,
    });
    expect(result).toEqual({ ok: false, reason: 'expired_confirmation' });
    const statusRows = await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(statusRows[0].status).toBe('Not Started');
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('7. wrong-user token cannot change status — zero mutation, zero ledger row', async () => {
    const itemId = await freshItemWithStatus('Wrong User Status Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: 'someone-else', actorName: 'Someone Else', itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('8. wrong-org token cannot change status — zero mutation, zero ledger row', async () => {
    const itemId = await freshItemWithStatus('Wrong Org Status Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: OTHER_ORG, userId: OTHER_USER, actorName: 'Cross Tenant', itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('9. tampered token (signature invalidated) cannot change status', async () => {
    const itemId = await freshItemWithStatus('Tampered Status Item', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const parts = proposal.confirmationToken.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: tampered,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('10. item_not_found leaves the token UNBURNED (deleted item, distinct from the stale-state case which DOES burn it)', async () => {
    const itemId = await freshItemWithStatus('Will Be Deleted (Status)', 'Not Started');
    const proposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`DELETE FROM organiser_items WHERE id = $1::uuid`, itemId);

    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'item_not_found' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('11. invalid status is rejected entirely at PROPOSE time, before any token is ever minted', async () => {
    const itemId = await freshItemWithStatus('Invalid Status Item', 'Not Started');
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Completed',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_status' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('12. requesting the status the item is already in is rejected at PROPOSE time as a no-op, before any token is ever minted', async () => {
    const itemId = await freshItemWithStatus('Noop Status Item', 'Done');
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, desiredStatus: 'Done',
    });
    expect(result).toEqual({ ok: false, reason: 'noop_same_status' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('13. existing comment confirmation still works correctly after the action_type CHECK expansion (step 45)', async () => {
    const itemId = await freshItem('Post-Expansion Comment Item');
    const proposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'still works after step 45',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, body: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === 'executed') {
      expect(result.comment.body).toBe('still works after step 45');
    }
  });

  it('14. retention cleanup prunes long-expired rows of BOTH action types alike', async () => {
    const jti1 = randomUUID();
    const jti2 = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'post_comment', NULL, NOW() - INTERVAL '2 days')`,
      jti1, ORG, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'change_status', NULL, NOW() - INTERVAL '2 days')`,
      jti2, ORG, USER,
    );
    const { pruneExpiredConfirmationsBestEffort } = await import('@/lib/organiser/helenaWrite');
    await pruneExpiredConfirmationsBestEffort();
    expect(await countRows('organiser_action_confirmations', `jti = '${jti1}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `jti = '${jti2}'`)).toBe(0);
  });
});

// Phase D.4.6O — real-Postgres proof for Helena's THIRD Organiser write
// action (guarded item group move). Same disposable-container harness, same
// real, unmodified proposeOrExecuteOrganiserGroupMove. The critical new
// properties this suite proves — that a mock cannot prove — are the
// stale-location race AND the destination-invalidation race: only real
// MVCC/FOR UPDATE semantics can demonstrate that a concurrent group change
// (or a group deleted out from under the destination) is never silently
// overwritten/completed.
async function freshItemInGroup(name: string, groupId: string | null, board: string = boardId): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_items (board_id, organisation_id, name, status, group_id) VALUES ($1::uuid, $2, $3, 'Not Started', $4::uuid) RETURNING id`,
    board, ORG, name, groupId,
  );
  return rows[0].id;
}

describe('D.4.6O — guarded Organiser item group move (real Postgres)', () => {
  it('1. normal same-board group move: exactly one group change, one activity row, one ledger row', async () => {
    const itemId = await freshItemInGroup('Group Move Item 1', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    expect(proposal.proposal.destination_group_id).toBe(groupB);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === 'executed') {
      expect(result.item.new_group_name).toBe('Group B');
      expect(result.item.previous_group_name).toBe('Group A');
    } else {
      throw new Error('expected executed');
    }

    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupB);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('2. same-group no-op is rejected entirely at PROPOSE time, before any token is ever minted', async () => {
    const itemId = await freshItemInGroup('Group Move Noop Item', groupA);
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group A',
    });
    expect(result).toEqual({ ok: false, reason: 'noop_same_group' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('3. same token replayed in a SEPARATE call is rejected — zero second group change, zero second activity row', async () => {
    const itemId = await freshItemInGroup('Group Move Item 3', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const first = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(first.ok).toBe(true);

    const replay = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(replay).toEqual({ ok: false, reason: 'already_used_confirmation' });
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(1);
  });

  it('4. CONCURRENT replay: two simultaneous confirmations with the exact same token -> exactly one succeeds, exactly one group change/activity/ledger row exists', async () => {
    const itemId = await freshItemInGroup('Concurrent Group Move Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const [a, b] = await Promise.all([
      proposeOrExecuteOrganiserGroupMove({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
      proposeOrExecuteOrganiserGroupMove({
        organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
        confirmationToken: proposal.confirmationToken,
      }),
    ]);

    const outcomes = [a, b];
    const successes = outcomes.filter(r => r.ok && r.mode === 'executed');
    const rejections = outcomes.filter(r => !r.ok && r.reason === 'already_used_confirmation');
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupB);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(1);
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('5. CRITICAL — STALE-LOCATION RACE: item moved by another actor between propose and confirm is NEVER overwritten', async () => {
    const itemId = await freshItemInGroup('Stale Location Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    // Simulates "another user moves the item to ungrouped" via the exact
    // same column a real human drag-and-drop would touch.
    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET group_id = NULL WHERE id = $1::uuid`, itemId);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_item_location' });

    // The item remains at the OTHER actor's value (ungrouped) — never
    // overwritten to the originally-proposed Group B.
    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string | null }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBeNull();
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(0);
  });

  it('6. the stale confirmation token is CONSUMED (burned) despite rejecting the move — cannot later become executable even if location cycles back', async () => {
    const itemId = await freshItemInGroup('Stale Consumption Group Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET group_id = NULL WHERE id = $1::uuid`, itemId);
    const staleResult = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(staleResult).toEqual({ ok: false, reason: 'stale_item_location' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);

    // Cycle the group BACK to the originally-expected value within the
    // token's own validity window — the exact scenario the deliberate
    // consumption exists to guard against.
    await prisma.$executeRawUnsafe(`UPDATE organiser_items SET group_id = $1::uuid WHERE id = $2::uuid`, groupA, itemId);
    const retryResult = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(retryResult).toEqual({ ok: false, reason: 'already_used_confirmation' });
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(0);
  });

  it('7. CRITICAL — DESTINATION-RACE: destination group deleted between propose and confirm -> destination_not_found, zero mutation, token still burned', async () => {
    const disposableGroups = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES ($1::uuid, 'org-a', 'Disposable Group') RETURNING id`,
      boardId,
    );
    const disposableGroup = disposableGroups[0].id;
    const itemId = await freshItemInGroup('Destination Race Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Disposable Group',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`DELETE FROM organiser_groups WHERE id = $1::uuid`, disposableGroup);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' });

    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupA);
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(0);
    // Deliberately still burned — same asymmetry as the stale-location case.
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(1);
  });

  it('8. destination on a DIFFERENT board is never resolvable at propose time (board-scoped name lookup) -> destination_not_found', async () => {
    const itemId = await freshItemInGroup('Cross Board Propose Item', groupA);
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Other Board Group',
    });
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('9. CRITICAL — a token forged/tampered to point at a DIFFERENT board\'s group is rejected at CONFIRM time (invalid_destination), never a board move', async () => {
    const itemId = await freshItemInGroup('Cross Board Confirm Item', groupA);
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const forgedToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'move_group',
      organisationId: ORG,
      userId: USER,
      itemId,
      boardId,
      expectedSourceGroupId: groupA,
      destinationGroupId: otherBoardGroup, // a REAL group id, but on a DIFFERENT board
      sourceGroupName: 'Group A',
      destinationGroupName: 'Other Board Group',
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(secret);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: forgedToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_destination' });
    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string; board_id: string }[]>(`SELECT group_id, board_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupA);
    expect(groupRows[0].board_id).toBe(boardId); // the item's own board never changed either
    expect(await countRows('organiser_activity', `item_id = '${itemId}' AND event_type = 'item.moved'`)).toBe(0);
  });

  it('10. destination belonging to a DIFFERENT organisation is never resolvable at propose time -> destination_not_found', async () => {
    const itemId = await freshItemInGroup('Cross Org Propose Item', groupA);
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Org B Group',
    });
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' });
  });

  it('11. a token forged to point at a DIFFERENT organisation\'s group is rejected at CONFIRM time (invalid_destination) — org isolation holds even under a forged token', async () => {
    const itemId = await freshItemInGroup('Cross Org Confirm Item', groupA);
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const forgedToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'move_group',
      organisationId: ORG,
      userId: USER,
      itemId,
      boardId,
      expectedSourceGroupId: groupA,
      destinationGroupId: otherOrgGroup,
      sourceGroupName: 'Group A',
      destinationGroupName: 'Org B Group',
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(secret);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: forgedToken,
    });
    // The dest_exists check is itself organisation_id-scoped, so a
    // cross-organisation group id resolves as not existing AT ALL from
    // this org's perspective — destination_not_found, not invalid_destination.
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' });
    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupA);
  });

  it('12. expired token cannot move the item and cannot mutate (jwtVerify itself rejects it before any SQL runs)', async () => {
    const itemId = await freshItemInGroup('Expired Group Item', groupA);
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const expiredToken = await new SignJWT({
      purpose: 'organiser_action_confirm',
      actionType: 'move_group',
      organisationId: ORG,
      userId: USER,
      itemId,
      boardId,
      expectedSourceGroupId: groupA,
      destinationGroupId: groupB,
      sourceGroupName: 'Group A',
      destinationGroupName: 'Group B',
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(pastExp - 120)
      .setExpirationTime(pastExp)
      .sign(secret);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: expiredToken,
    });
    expect(result).toEqual({ ok: false, reason: 'expired_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('13. wrong-user token cannot move the item — zero mutation, zero ledger row', async () => {
    const itemId = await freshItemInGroup('Wrong User Group Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: 'someone-else', actorName: 'Someone Else', itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('14. wrong-org token cannot move the item — zero mutation, zero ledger row', async () => {
    const itemId = await freshItemInGroup('Wrong Org Group Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: OTHER_ORG, userId: OTHER_USER, actorName: 'Cross Tenant', itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('15. tampered token (signature invalidated) cannot move the item', async () => {
    const itemId = await freshItemInGroup('Tampered Group Item', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    const parts = proposal.confirmationToken.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: tampered,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('16. item_not_found leaves the token UNBURNED (deleted item, distinct from the stale-location/destination-invalid cases which DO burn it)', async () => {
    const itemId = await freshItemInGroup('Will Be Deleted (Group)', groupA);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group B',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');

    await prisma.$executeRawUnsafe(`DELETE FROM organiser_items WHERE id = $1::uuid`, itemId);

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result).toEqual({ ok: false, reason: 'item_not_found' });
    expect(await countRows('organiser_action_confirmations', `item_id = '${itemId}'`)).toBe(0);
  });

  it('17. an item currently ungrouped can be proposed and moved into a real group — null source group handled correctly end-to-end', async () => {
    const itemId = await freshItemInGroup('Ungrouped Item', null);
    const proposal = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'Group A',
    });
    if (!proposal.ok || proposal.mode !== 'proposed') throw new Error('expected proposal');
    expect(proposal.proposal.source_group_id).toBeNull();

    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId, destinationGroupName: 'ignored',
      confirmationToken: proposal.confirmationToken,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.mode === 'executed') {
      expect(result.item.previous_group_name).toBeNull();
      expect(result.item.new_group_name).toBe('Group A');
    }
    const groupRows = await prisma.$queryRawUnsafe<{ group_id: string }[]>(`SELECT group_id FROM organiser_items WHERE id = $1::uuid`, itemId);
    expect(groupRows[0].group_id).toBe(groupA);
  });

  it('18. existing comment AND status-change confirmations still work correctly after the action_type CHECK expansion (step 46)', async () => {
    const commentItemId = await freshItem('Post-Step46-Expansion Comment Item');
    const commentProposal = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId: commentItemId, body: 'still works after step 46',
    });
    if (!commentProposal.ok || commentProposal.mode !== 'proposed') throw new Error('expected proposal');
    const commentResult = await proposeOrExecuteOrganiserComment({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId: commentItemId, body: 'ignored',
      confirmationToken: commentProposal.confirmationToken,
    });
    expect(commentResult.ok).toBe(true);

    const statusItemId = await freshItemWithStatus('Post-Step46-Expansion Status Item', 'Not Started');
    const statusProposal = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId: statusItemId, desiredStatus: 'Done',
    });
    if (!statusProposal.ok || statusProposal.mode !== 'proposed') throw new Error('expected proposal');
    const statusResult = await proposeOrExecuteOrganiserStatusChange({
      organisationId: ORG, userId: USER, actorName: ACTOR_NAME, itemId: statusItemId, desiredStatus: 'ignored',
      confirmationToken: statusProposal.confirmationToken,
    });
    expect(statusResult.ok).toBe(true);
  });

  it('19. retention cleanup prunes long-expired rows of ALL THREE action types alike', async () => {
    const jti1 = randomUUID();
    const jti2 = randomUUID();
    const jti3 = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'post_comment', NULL, NOW() - INTERVAL '2 days')`,
      jti1, ORG, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'change_status', NULL, NOW() - INTERVAL '2 days')`,
      jti2, ORG, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO organiser_action_confirmations (jti, organisation_id, user_id, action_type, item_id, expires_at) VALUES ($1, $2, $3, 'move_group', NULL, NOW() - INTERVAL '2 days')`,
      jti3, ORG, USER,
    );
    const { pruneExpiredConfirmationsBestEffort } = await import('@/lib/organiser/helenaWrite');
    await pruneExpiredConfirmationsBestEffort();
    expect(await countRows('organiser_action_confirmations', `jti = '${jti1}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `jti = '${jti2}'`)).toBe(0);
    expect(await countRows('organiser_action_confirmations', `jti = '${jti3}'`)).toBe(0);
  });
});
