import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Essio integration B1 — real disposable-Postgres suite.
// Run ONLY via scripts/tests/verify-essio-integration-b1.sh, which creates a
// throwaway postgres:17-alpine container, applies the base schema + A0.1A +
// B1 + capability seed, and exports DATABASE_URL before vitest starts.
//
// Seam: lib/db's tagged-template client is replaced by a Prisma-backed
// equivalent (same approach as organiserConfirmationReplay.integration.test.ts).
// The B1 services cast every parameter explicitly, so no type inference shim
// is needed. checkCapability (lib/capabilities) runs unmodified on the same seam.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('essioIntegrationB1.integration.test.ts requires DATABASE_URL (run verify-essio-integration-b1.sh)');
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run against a DATABASE_URL that looks like a hosted/Production database.');
}
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) {
  throw new Error('Refusing to run against a non-localhost DATABASE_URL host.');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

async function seamSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
  return prisma.$queryRawUnsafe(text, ...values);
}
vi.doMock('@/lib/db', () => ({ default: seamSql }));

const q = <T = Record<string, unknown>>(text: string, ...params: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(text, ...params);
const exec = (text: string, ...params: unknown[]) => prisma.$executeRawUnsafe(text, ...params);

type Service = typeof import('@/lib/integrationCredentials/service');
type Links = typeof import('@/lib/organiser/externalLinks');
type Actor = typeof import('@/lib/organiser/systemActor');
let svc: Service;
let links: Links;
let actor: Actor;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const USER_A = 'user-a';
const BOARD_A = '11111111-1111-4111-8111-111111111111';
const BOARD_B = '22222222-2222-4222-8222-222222222222';
const FP_1 = createHash('sha256').update('payload-1').digest('hex');
const FP_2 = createHash('sha256').update('payload-2').digest('hex');

// Captured console output across the whole suite (secret-leak check).
const consoleOutput: string[] = [];
const issuedTokens: string[] = [];

async function newItem(org: string, board: string, name = 'Item'): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO organiser_items (board_id, organisation_id, name) VALUES ($1::uuid, $2, $3) RETURNING id::text AS id`,
    board, org, name,
  );
  return row.id;
}

async function setCapability(org: string, enabled: boolean) {
  await exec(
    `INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'essio_integration', $2)
     ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    org, enabled,
  );
}

async function issue(org: string, scopes: string[] = ['work:create', 'work:read', 'targets:read'], label = 'Essio') {
  const created = await svc.createIntegrationCredential({
    organisationId: org,
    integrationKey: 'essio',
    label,
    scopes,
    createdByUserId: null,
  });
  issuedTokens.push(created.token);
  return created;
}

async function principalFor(token: string) {
  const result = await svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:create' });
  if (!result.ok) throw new Error(`expected authentication to succeed, got ${result.reason}`);
  return result.principal;
}

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
    });
  }
  svc = await import('@/lib/integrationCredentials/service');
  links = await import('@/lib/organiser/externalLinks');
  actor = await import('@/lib/organiser/systemActor');
  await setCapability(ORG_A, true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

// ─── Credential creation ─────────────────────────────────────────────────

describe('credential creation', () => {
  it('returns the plaintext token exactly once and stores only a bound digest', async () => {
    const { credential, token } = await issue(ORG_A);
    expect(token).toMatch(/^bbint_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(token.slice(6, 38)).toBe(credential.id.replace(/-/g, ''));
    expect(credential).toMatchObject({
      organisationId: ORG_A,
      integrationKey: 'essio',
      label: 'Essio',
      scopes: ['work:create', 'work:read', 'targets:read'],
      status: 'active',
    });
    expect(JSON.stringify(credential)).not.toContain(token.slice(39));
    expect(Object.keys(credential)).not.toContain('secretHash');

    const [stored] = await q<{ secret_hash: string }>(
      `SELECT secret_hash FROM integration_credentials WHERE id = $1::uuid`, credential.id,
    );
    const secret = token.slice(39);
    expect(stored.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.secret_hash).toBe(createHash('sha256').update(`bbint:v1:${credential.id}:${secret}`).digest('hex'));

    // Subsequent reads cannot recover the secret.
    const listed = await svc.listIntegrationCredentials(ORG_A);
    const got = await svc.getIntegrationCredential(ORG_A, credential.id);
    for (const view of [listed, got]) {
      const json = JSON.stringify(view);
      expect(json).not.toContain(secret);
      expect(json).not.toContain(stored.secret_hash);
    }

    // Audited atomically, without secret material.
    const [audit] = await q<{ action: string; organisation_id: string; user_id: string | null; after_state: unknown }>(
      `SELECT action, organisation_id, user_id, after_state FROM audit_logs WHERE resource_id = $1 ORDER BY created_at`,
      credential.id,
    );
    expect(audit).toMatchObject({ action: 'integration_credential.created', organisation_id: ORG_A, user_id: null });
    expect(JSON.stringify(audit.after_state)).not.toContain(secret);
    expect(JSON.stringify(audit.after_state)).not.toContain(stored.secret_hash);
  });

  it('generates a distinct secret every time', async () => {
    const a = await issue(ORG_A, ['work:read'], 'Read only');
    const b = await issue(ORG_A, ['work:read'], 'Read only');
    expect(a.token).not.toBe(b.token);
    expect(a.credential.id).not.toBe(b.credential.id);
  });

  it('rejects reserved, unknown, empty and malformed requests without writing anything', async () => {
    const [{ before }] = await q<{ before: bigint }>(`SELECT count(*) AS before FROM integration_credentials`);
    const base = { organisationId: ORG_A, integrationKey: 'essio' as const, label: 'x', createdByUserId: null };
    await expect(svc.createIntegrationCredential({ ...base, scopes: ['work:append'] })).rejects.toMatchObject({ code: 'scope_reserved' });
    await expect(svc.createIntegrationCredential({ ...base, scopes: ['admin:*'] })).rejects.toMatchObject({ code: 'scope_unknown' });
    await expect(svc.createIntegrationCredential({ ...base, scopes: [] })).rejects.toMatchObject({ code: 'invalid_scopes' });
    await expect(svc.createIntegrationCredential({ ...base, label: '   ', scopes: ['work:read'] })).rejects.toMatchObject({ code: 'invalid_label' });
    await expect(svc.createIntegrationCredential({ ...base, organisationId: 'org-missing', scopes: ['work:read'] })).rejects.toMatchObject({ code: 'invalid_organisation' });
    await expect(svc.createIntegrationCredential({ ...base, createdByUserId: 'nobody', scopes: ['work:read'] })).rejects.toMatchObject({ code: 'invalid_user' });
    await expect(
      svc.createIntegrationCredential({ ...base, integrationKey: 'other' as never, scopes: ['work:read'] }),
    ).rejects.toMatchObject({ code: 'invalid_integration' });
    const [{ after }] = await q<{ after: bigint }>(`SELECT count(*) AS after FROM integration_credentials`);
    expect(after).toBe(before);
  });

  it('records the creating user and collapses duplicate scopes', async () => {
    const created = await svc.createIntegrationCredential({
      organisationId: ORG_A, integrationKey: 'essio', label: 'Dup', scopes: ['work:read', 'work:read'], createdByUserId: USER_A,
    });
    issuedTokens.push(created.token);
    expect(created.credential).toMatchObject({ scopes: ['work:read'], createdBy: USER_A });
  });

  it('the database refuses ungrantable scopes, duplicates and malformed hashes directly', async () => {
    const insert = (scopes: string[], hash = 'a'.repeat(64)) =>
      exec(
        `INSERT INTO integration_credentials (organisation_id, integration_key, label, secret_hash, scopes)
         VALUES ($1, 'essio', 'direct', $2, $3::text[])`,
        ORG_A, hash, scopes,
      );
    await expectDbError(insert(['work:append']), /integration_credentials_scopes_check/);
    await expectDbError(insert(['work:read', 'work:read']), /integration_credentials_scopes_check/);
    await expectDbError(insert([]), /integration_credentials_scopes_check/);
    await expectDbError(insert(['work:read'], 'not-a-hash'), /integration_credentials_secret_hash_check/);
  });
});

// ─── Authentication ──────────────────────────────────────────────────────

describe('authentication', () => {
  it('a valid credential yields a typed principal whose organisation comes from the credential', async () => {
    const { credential, token } = await issue(ORG_A);
    const result = await svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:create' });
    expect(result).toEqual({
      ok: true,
      principal: {
        kind: 'integration',
        credentialId: credential.id,
        organisationId: ORG_A,
        integrationKey: 'essio',
        scopes: ['work:create', 'work:read', 'targets:read'],
        label: 'Essio',
      },
    });
    if (result.ok) expect(Object.isFrozen(result.principal)).toBe(true);
    const [row] = await q<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM integration_credentials WHERE id = $1::uuid`, credential.id,
    );
    expect(row.last_used_at).not.toBeNull();
  });

  it('rejects malformed tokens', async () => {
    const { token } = await issue(ORG_A);
    const malformed: unknown[] = [
      undefined, null, '', 42, {}, token.toUpperCase(), ` ${token}`, `${token} `, `${token}x`, token.slice(0, -1),
      token.replace('bbint_', 'bbinx_'), token.slice(0, 38) + '-' + token.slice(39), `Bearer ${token}`,
      'bbint_' + 'g'.repeat(32) + '_' + 'a'.repeat(43), token.slice(0, -1) + '=',
    ];
    for (const value of malformed) {
      expect(await svc.authenticateIntegrationCredential(value, { integrationKey: 'essio', scope: 'work:read' })).toEqual({
        ok: false,
        reason: 'MALFORMED',
      });
    }
  });

  it('rejects an unknown credential id and a wrong secret, indistinguishably in public', async () => {
    const { token } = await issue(ORG_A);
    const unknownId = `bbint_${randomUUID().replace(/-/g, '')}_${token.slice(39)}`;
    const otherSecret = Buffer.from(randomUUID() + randomUUID()).toString('base64url').slice(0, 43);
    const wrongSecret = `${token.slice(0, 39)}${otherSecret}`;
    const unknown = await svc.authenticateIntegrationCredential(unknownId, { integrationKey: 'essio', scope: 'work:read' });
    const wrong = await svc.authenticateIntegrationCredential(wrongSecret, { integrationKey: 'essio', scope: 'work:read' });
    expect(unknown).toEqual({ ok: false, reason: 'UNKNOWN_CREDENTIAL' });
    expect(wrong).toEqual({ ok: false, reason: 'INVALID_SECRET' });
    expect(svc.toPublicIntegrationAuthError('UNKNOWN_CREDENTIAL')).toEqual(svc.toPublicIntegrationAuthError('INVALID_SECRET'));
    expect(svc.toPublicIntegrationAuthError('REVOKED')).toEqual(svc.toPublicIntegrationAuthError('MALFORMED'));
    expect(svc.toPublicIntegrationAuthError('MISSING_SCOPE').status).toBe(403);
    expect(svc.toPublicIntegrationAuthError('CAPABILITY_DISABLED').status).toBe(403);
    expect(svc.toPublicIntegrationAuthError('DATABASE_ERROR').status).toBe(503);
  });

  it('a stored digest moved onto another credential never verifies (and the database forbids the move)', async () => {
    const a = await issue(ORG_A);
    const b = await issue(ORG_A);
    await expectDbError(
      exec(
        `UPDATE integration_credentials SET secret_hash = (SELECT secret_hash FROM integration_credentials WHERE id = $1::uuid) WHERE id = $2::uuid`,
        a.credential.id, b.credential.id,
      ),
      /immutable/,
    );
    // A token with A's secret but B's id fails: the id is bound into the digest.
    const swapped = `bbint_${b.credential.id.replace(/-/g, '')}_${a.token.slice(39)}`;
    expect(await svc.authenticateIntegrationCredential(swapped, { integrationKey: 'essio', scope: 'work:read' })).toEqual({
      ok: false,
      reason: 'INVALID_SECRET',
    });
  });

  it('disabled credentials are rejected until re-enabled; revoked ones permanently', async () => {
    const { credential, token } = await issue(ORG_A);
    const auth = () => svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:read' });

    await svc.setIntegrationCredentialEnabled({ organisationId: ORG_A, credentialId: credential.id, enabled: false, actorUserId: USER_A });
    expect(await auth()).toEqual({ ok: false, reason: 'DISABLED' });
    await svc.setIntegrationCredentialEnabled({ organisationId: ORG_A, credentialId: credential.id, enabled: true, actorUserId: USER_A });
    expect((await auth()).ok).toBe(true);

    const revoked = await svc.revokeIntegrationCredential({ organisationId: ORG_A, credentialId: credential.id, revokedByUserId: USER_A });
    expect(revoked).toMatchObject({ outcome: 'revoked', credential: { status: 'revoked', enabled: false, revokedBy: USER_A } });
    expect(await auth()).toEqual({ ok: false, reason: 'REVOKED' });
    expect(await svc.revokeIntegrationCredential({ organisationId: ORG_A, credentialId: credential.id, revokedByUserId: null })).toMatchObject({
      outcome: 'already_revoked',
    });
    await expect(
      svc.setIntegrationCredentialEnabled({ organisationId: ORG_A, credentialId: credential.id, enabled: true, actorUserId: USER_A }),
    ).rejects.toMatchObject({ code: 'revoked' });
    // Direct database attempts to un-revoke are refused too.
    await expectDbError(exec(`UPDATE integration_credentials SET enabled = true WHERE id = $1::uuid`, credential.id), /revoked/);
    await expectDbError(exec(`UPDATE integration_credentials SET revoked_at = NULL WHERE id = $1::uuid`, credential.id), /revoked/);

    const actions = await q<{ action: string }>(
      `SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY created_at, action`, credential.id,
    );
    expect(actions.map((a) => a.action).sort()).toEqual(
      ['integration_credential.created', 'integration_credential.disabled', 'integration_credential.enabled', 'integration_credential.revoked'].sort(),
    );
  });

  it('credentials are never deleted and their organisation cannot be changed', async () => {
    const { credential } = await issue(ORG_A);
    await expectDbError(exec(`DELETE FROM integration_credentials WHERE id = $1::uuid`, credential.id), /never deleted/);
    await expectDbError(
      exec(`UPDATE integration_credentials SET organisation_id = $1 WHERE id = $2::uuid`, ORG_B, credential.id),
      /immutable/,
    );
  });

  it('a credential lacking the required scope is rejected', async () => {
    const { token } = await issue(ORG_A, ['work:read']);
    expect(await svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:create' })).toEqual({
      ok: false,
      reason: 'MISSING_SCOPE',
    });
    expect((await svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:read' })).ok).toBe(true);
  });

  it('a valid credential is insufficient when essio_integration is not enabled for its organisation', async () => {
    const { token } = await issue(ORG_B); // ORG_B has no entitlement row
    const auth = () => svc.authenticateIntegrationCredential(token, { integrationKey: 'essio', scope: 'work:read' });
    expect(await auth()).toEqual({ ok: false, reason: 'CAPABILITY_DISABLED' });
    await setCapability(ORG_B, false);
    expect(await auth()).toEqual({ ok: false, reason: 'CAPABILITY_DISABLED' });
    await setCapability(ORG_B, true);
    expect((await auth()).ok).toBe(true);
    // Globally inactive capability denies every organisation.
    await exec(`UPDATE modules SET active = false WHERE key = 'essio_integration'`);
    expect(await auth()).toEqual({ ok: false, reason: 'CAPABILITY_DISABLED' });
    await exec(`UPDATE modules SET active = true WHERE key = 'essio_integration'`);
    await setCapability(ORG_B, false);
  });

  it('enabling the capability does not grant normal Organiser access or any credential', async () => {
    const [{ n }] = await q<{ n: bigint }>(
      `SELECT count(*) AS n FROM organisation_modules WHERE module_key = 'organiser'`,
    );
    expect(Number(n)).toBe(0);
  });
});

// ─── Tenant isolation ────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('authentication takes no organisation input; the principal organisation is the credential organisation', async () => {
    expect(svc.authenticateIntegrationCredential.length).toBe(2);
    await setCapability(ORG_B, true);
    const { token } = await issue(ORG_B);
    const principal = await principalFor(token);
    expect(principal.organisationId).toBe(ORG_B);
    // Mutating the returned principal is impossible (frozen).
    expect(() => {
      (principal as { organisationId: string }).organisationId = ORG_A;
    }).toThrow();
    await setCapability(ORG_B, false);
  });

  it('a credential from organisation B cannot attach organisation A work', async () => {
    await setCapability(ORG_B, true);
    const principalB = await principalFor((await issue(ORG_B)).token);
    const itemA = await newItem(ORG_A, BOARD_A);
    await expect(
      links.claimOrganiserItemExternalLink(principalB, {
        idempotencyKey: randomUUID(), externalRecommendationId: randomUUID(), sourceUrl: null,
        payloadFingerprint: FP_1, snapshot: {}, organiserItemId: itemA,
      }),
    ).rejects.toMatchObject({ code: 'invalid_organiser_item' });
    const [{ n }] = await q<{ n: bigint }>(
      `SELECT count(*) AS n FROM organiser_item_external_links WHERE organiser_item_id = $1::uuid`, itemA,
    );
    expect(Number(n)).toBe(0);
    await setCapability(ORG_B, false);
  });

  it('the database rejects cross-organisation item and credential references', async () => {
    const credA = (await issue(ORG_A)).credential.id;
    const credB = (await issue(ORG_B)).credential.id;
    const itemB = await newItem(ORG_B, BOARD_B);
    const insertLink = (org: string, item: string | null, cred: string) =>
      exec(
        `INSERT INTO organiser_item_external_links (organisation_id, organiser_item_id, source_system, idempotency_key,
           external_recommendation_id, payload_fingerprint, snapshot_json, credential_id)
         VALUES ($1, $2::uuid, 'essio', $3, 'rec', $4, '{}'::jsonb, $5::uuid)`,
        org, item, randomUUID(), FP_1, cred,
      );
    await expectDbError(insertLink(ORG_A, itemB, credA), /organiser_item_external_links_item_fkey/);
    await expectDbError(insertLink(ORG_A, null, credB), /organiser_item_external_links_credential_fkey/);
    // The same item cannot move to another organisation while linked.
    const itemA = await newItem(ORG_A, BOARD_A);
    await insertLink(ORG_A, itemA, credA);
    await expectDbError(exec(`UPDATE organiser_items SET organisation_id = $1 WHERE id = $2::uuid`, ORG_B, itemA), /organiser_item_external_links_item_fkey/);
  });

  it('a principal only sees its own organisation’s link identities', async () => {
    await setCapability(ORG_B, true);
    const principalA = await principalFor((await issue(ORG_A)).token);
    const principalB = await principalFor((await issue(ORG_B)).token);
    const key = randomUUID();
    await links.claimOrganiserItemExternalLink(principalA, {
      idempotencyKey: key, externalRecommendationId: 'rec-a', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {},
    });
    expect(await links.findOrganiserItemExternalLink(principalB, key)).toBeNull();
    expect(await links.findOrganiserItemExternalLink(principalA, key)).not.toBeNull();
    await setCapability(ORG_B, false);
  });
});

// ─── Idempotency foundation ──────────────────────────────────────────────

describe('external link identity (idempotency foundation)', () => {
  it('first claim is created; a retry with the same fingerprint replays; a different fingerprint conflicts', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      externalRecommendationId: 'rec-1',
      sourceUrl: 'https://essio.example/sites/s/recommendations/rec-1',
      payloadFingerprint: FP_1,
      snapshot: { schema: 'essio.recommendation-handoff', version: 1 },
    };
    const first = await links.claimOrganiserItemExternalLink(principal, input);
    expect(first).toMatchObject({
      outcome: 'created',
      link: {
        organisationId: ORG_A, sourceSystem: 'essio', idempotencyKey: key, payloadFingerprint: FP_1,
        credentialId: principal.credentialId, organiserItemId: null, itemState: 'unattached',
      },
    });
    const replay = await links.claimOrganiserItemExternalLink(principal, input);
    expect(replay).toMatchObject({ outcome: 'replayed', link: { id: first.link.id } });
    const conflict = await links.claimOrganiserItemExternalLink(principal, { ...input, payloadFingerprint: FP_2 });
    expect(conflict).toMatchObject({ outcome: 'fingerprint_conflict', link: { id: first.link.id, payloadFingerprint: FP_1 } });
    const [{ n, snapshot }] = await q<{ n: bigint; snapshot: unknown }>(
      `SELECT count(*) OVER () AS n, snapshot_json AS snapshot FROM organiser_item_external_links WHERE idempotency_key = $1`, key,
    );
    expect(Number(n)).toBe(1);
    expect(snapshot).toEqual(input.snapshot);
  });

  it('concurrent claims of one key produce exactly one identity', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        links.claimOrganiserItemExternalLink(principal, {
          idempotencyKey: key, externalRecommendationId: 'rec-c', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {},
        }),
      ),
    );
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(new Set(results.map((r) => r.link.id)).size).toBe(1);
  });

  it('the same key is independent per organisation; source system is part of the key and only essio is allowed', async () => {
    await setCapability(ORG_B, true);
    const principalA = await principalFor((await issue(ORG_A)).token);
    const principalB = await principalFor((await issue(ORG_B)).token);
    const key = randomUUID();
    const claim = (p: typeof principalA) =>
      links.claimOrganiserItemExternalLink(p, {
        idempotencyKey: key, externalRecommendationId: 'rec-x', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {},
      });
    const a = await claim(principalA);
    const b = await claim(principalB);
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.link.id).not.toBe(b.link.id);
    const [{ def }] = await q<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'organiser_item_external_links_idempotency_key'`,
    );
    expect(def).toBe('UNIQUE (organisation_id, source_system, idempotency_key)');
    await expectDbError(
      exec(
        `INSERT INTO organiser_item_external_links (organisation_id, source_system, idempotency_key, external_recommendation_id,
           payload_fingerprint, snapshot_json, credential_id) VALUES ($1, 'other', $2, 'r', $3, '{}'::jsonb, $4::uuid)`,
        ORG_A, key, FP_1, principalA.credentialId,
      ),
      /organiser_item_external_links_source_system_check/,
    );
    await setCapability(ORG_B, false);
  });

  it('validates claim input before touching the database', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const ok = { idempotencyKey: randomUUID(), externalRecommendationId: 'r', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {} };
    await expect(links.claimOrganiserItemExternalLink(principal, { ...ok, idempotencyKey: ' padded ' })).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    await expect(links.claimOrganiserItemExternalLink(principal, { ...ok, idempotencyKey: 'k'.repeat(129) })).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    await expect(links.claimOrganiserItemExternalLink(principal, { ...ok, payloadFingerprint: 'abc' })).rejects.toMatchObject({ code: 'invalid_payload_fingerprint' });
    await expect(links.claimOrganiserItemExternalLink(principal, { ...ok, sourceUrl: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_source_url' });
    await expect(links.claimOrganiserItemExternalLink(principal, { ...ok, snapshot: [] as never })).rejects.toMatchObject({ code: 'invalid_snapshot' });
    await expect(
      links.claimOrganiserItemExternalLink({ ...principal, integrationKey: 'other' as never }, ok),
    ).rejects.toMatchObject({ code: 'invalid_principal' });
  });
});

// ─── Deletion semantics ──────────────────────────────────────────────────

describe('Organiser item deletion', () => {
  it('the link survives a hard delete, records it, and a retry is recognised as the same request', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const item = await newItem(ORG_A, BOARD_A, 'To be deleted');
    const key = randomUUID();
    const input = { idempotencyKey: key, externalRecommendationId: 'rec-d', sourceUrl: null, payloadFingerprint: FP_1, snapshot: { a: 1 }, organiserItemId: item };
    const created = await links.claimOrganiserItemExternalLink(principal, input);
    expect(created.link).toMatchObject({ organiserItemId: item, itemState: 'linked' });

    await exec(`DELETE FROM organiser_items WHERE id = $1::uuid`, item);

    const [row] = await q<{ organisation_id: string; organiser_item_id: string | null; item_deleted_at: Date | null; snapshot_json: unknown }>(
      `SELECT organisation_id, organiser_item_id, item_deleted_at, snapshot_json FROM organiser_item_external_links WHERE id = $1::uuid`,
      created.link.id,
    );
    expect(row.organisation_id).toBe(ORG_A);
    expect(row.organiser_item_id).toBeNull();
    expect(row.item_deleted_at).not.toBeNull();
    expect(row.snapshot_json).toEqual({ a: 1 });

    const retry = await links.claimOrganiserItemExternalLink(principal, { ...input, organiserItemId: null });
    expect(retry).toMatchObject({ outcome: 'replayed', link: { id: created.link.id, itemState: 'item_deleted', organiserItemId: null } });

    // No replacement item can be attached to a deleted identity.
    const replacement = await newItem(ORG_A, BOARD_A, 'Replacement');
    await expectDbError(
      exec(`UPDATE organiser_item_external_links SET organiser_item_id = $1::uuid WHERE id = $2::uuid`, replacement, created.link.id),
      /cannot be replaced/,
    );
    await expectDbError(
      exec(`UPDATE organiser_item_external_links SET item_deleted_at = NULL WHERE id = $1::uuid`, created.link.id),
      /item_deleted_at/,
    );
  });

  it('links are never deleted, never re-pointed and their identity is immutable', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const item = await newItem(ORG_A, BOARD_A);
    const other = await newItem(ORG_A, BOARD_A);
    const { link } = await links.claimOrganiserItemExternalLink(principal, {
      idempotencyKey: randomUUID(), externalRecommendationId: 'rec-i', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {}, organiserItemId: item,
    });
    await expectDbError(exec(`DELETE FROM organiser_item_external_links WHERE id = $1::uuid`, link.id), /never deleted/);
    await expectDbError(exec(`UPDATE organiser_item_external_links SET organiser_item_id = $1::uuid WHERE id = $2::uuid`, other, link.id), /re-pointed/);
    await expectDbError(exec(`UPDATE organiser_item_external_links SET payload_fingerprint = $1 WHERE id = $2::uuid`, FP_2, link.id), /immutable/);
    await expectDbError(exec(`UPDATE organiser_item_external_links SET snapshot_json = '{"x":1}' WHERE id = $1::uuid`, link.id), /immutable/);
    await expectDbError(exec(`UPDATE organiser_item_external_links SET idempotency_key = 'k2' WHERE id = $1::uuid`, link.id), /immutable/);
    // An item belongs to at most one external request.
    await expect(
      links.claimOrganiserItemExternalLink(principal, {
        idempotencyKey: randomUUID(), externalRecommendationId: 'rec-j', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {}, organiserItemId: item,
      }),
    ).rejects.toMatchObject({ code: 'invalid_organiser_item' });
  });

  it('supports B2’s claim-then-create: one statement creates the item and attaches it once', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const { link } = await links.claimOrganiserItemExternalLink(principal, {
      idempotencyKey: randomUUID(), externalRecommendationId: 'rec-b2', sourceUrl: null, payloadFingerprint: FP_1, snapshot: {},
    });
    const attach = (itemId: string) =>
      q<{ id: string }>(
        `WITH claimed AS (
           UPDATE organiser_item_external_links SET organiser_item_id = $1::uuid
           WHERE id = $2::uuid AND organisation_id = $3 AND organiser_item_id IS NULL AND item_deleted_at IS NULL
           RETURNING organisation_id
         )
         INSERT INTO organiser_items (id, board_id, organisation_id, name)
         SELECT $1::uuid, $4::uuid, claimed.organisation_id, 'From Essio' FROM claimed
         RETURNING id::text AS id`,
        itemId, link.id, ORG_A, BOARD_A,
      );
    const firstItem = randomUUID();
    expect(await attach(firstItem)).toEqual([{ id: firstItem }]);
    expect(await attach(randomUUID())).toEqual([]); // already attached: no second item
    const found = await links.findOrganiserItemExternalLink(principal, link.idempotencyKey);
    expect(found).toMatchObject({ organiserItemId: firstItem, itemState: 'linked' });
  });
});

// ─── System actor ────────────────────────────────────────────────────────

describe('system actor', () => {
  it('is "Essio" with no user id, and fits organiser_activity as-is', async () => {
    const principal = await principalFor((await issue(ORG_A)).token);
    const essio = actor.essioSystemActor(principal);
    expect(essio).toEqual({ kind: 'system', actorUserId: null, actorName: 'Essio', source: 'essio', credentialId: principal.credentialId });
    const fields = actor.systemActorActivityFields(essio);
    expect(fields).toEqual({ actorUserId: null, actorName: 'Essio', metadata: { source: 'essio', credential_id: principal.credentialId } });
    expect(actor.systemActorAuditFields(essio)).toEqual({ userId: null, sourceState: { source: 'essio', credential_id: principal.credentialId } });

    const item = await newItem(ORG_A, BOARD_A);
    await exec(
      `INSERT INTO organiser_activity (organisation_id, board_id, item_id, actor_user_id, actor_name, event_type, entity_type, entity_id, metadata_json)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, 'item.created', 'item', $3, $6::jsonb)`,
      ORG_A, BOARD_A, item, fields.actorUserId, fields.actorName, JSON.stringify(fields.metadata),
    );
    const [row] = await q<{ actor_user_id: string | null; actor_name: string; metadata_json: unknown }>(
      `SELECT actor_user_id, actor_name, metadata_json FROM organiser_activity WHERE item_id = $1::uuid`, item,
    );
    expect(row).toEqual({ actor_user_id: null, actor_name: 'Essio', metadata_json: { source: 'essio', credential_id: principal.credentialId } });
    const [{ users }] = await q<{ users: bigint }>(`SELECT count(*) AS users FROM users WHERE lower(name) LIKE '%essio%' OR lower(username) LIKE '%essio%'`);
    expect(Number(users)).toBe(0);
  });

  it('refuses to build an Essio actor from anything but an Essio integration principal', () => {
    expect(() => actor.essioSystemActor({ kind: 'user' as never, integrationKey: 'essio', credentialId: 'x' })).toThrow();
    expect(() => actor.essioSystemActor({ kind: 'integration', integrationKey: 'other' as never, credentialId: 'x' })).toThrow();
  });
});

// ─── Secret hygiene (runs last) ──────────────────────────────────────────

describe('secret hygiene', () => {
  it('no issued secret appears anywhere in the database or in console output', async () => {
    expect(issuedTokens.length).toBeGreaterThan(10);
    const dumps = await q<{ dump: string }>(
      `SELECT (SELECT coalesce(string_agg(c::text, '|'), '') FROM integration_credentials c)
            || (SELECT coalesce(string_agg(a::text, '|'), '') FROM audit_logs a)
            || (SELECT coalesce(string_agg(l::text, '|'), '') FROM organiser_item_external_links l)
            || (SELECT coalesce(string_agg(x::text, '|'), '') FROM organiser_activity x) AS dump`,
    );
    const output = consoleOutput.join('\n');
    for (const token of issuedTokens) {
      const secret = token.slice(39);
      expect(dumps[0].dump).not.toContain(secret);
      expect(dumps[0].dump).not.toContain(token);
      expect(output).not.toContain(secret);
    }
  });

  it('error messages never include the presented token', async () => {
    const { token, credential } = await issue(ORG_A);
    const errors: string[] = [];
    for (const attempt of [
      () => svc.revokeIntegrationCredential({ organisationId: ORG_B, credentialId: credential.id, revokedByUserId: null }),
      () => svc.getIntegrationCredential(ORG_A, token),
      () => svc.createIntegrationCredential({ organisationId: ORG_A, integrationKey: 'essio', label: token.repeat(2), scopes: ['work:read'], createdByUserId: null }),
    ]) {
      try {
        await attempt();
      } catch (err) {
        errors.push(String((err as Error).message));
      }
    }
    expect(errors).toHaveLength(3);
    for (const message of errors) expect(message).not.toContain(token.slice(39));
  });
});
