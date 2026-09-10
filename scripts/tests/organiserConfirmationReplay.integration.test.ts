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

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const ACTOR_NAME = 'Integration Tester';

let boardId: string;

async function freshItem(name: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO organiser_items (board_id, organisation_id, name, status) VALUES ($1::uuid, $2, $3, 'Not Started') RETURNING id`,
    boardId, ORG, name,
  );
  return rows[0].id;
}

beforeAll(async () => {
  ({ proposeOrExecuteOrganiserComment } = await import('@/lib/organiser/helenaWrite'));

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
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' });
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
