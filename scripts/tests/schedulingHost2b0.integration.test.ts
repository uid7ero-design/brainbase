import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { staffTenantContext } from '@/lib/scheduling/adapters/brainbase';
import { findOrCreateCrmContact, type ContactSqlExecutor } from '@/lib/scheduling/crmLink';

// Phase 2B.0 real-Postgres proof (run by scripts/tests/verify-scheduling-phase2b0.sh against a DISPOSABLE database).
// It reaches only the database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL. The mocks below replace only
// the application's database client (with a pool onto that same disposable database) and its session; the capability
// lookup, the access gate, the CRM link wrapper and every SQL file under test are the REAL code.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const mocks = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }));

vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 10 });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    p.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values).then(r => r.rows);
  return { default: tag };
});
vi.mock('@/lib/org', () => ({
  requireSession: async () => {
    if (!mocks.session) throw new Error('Unauthorized');
    return mocks.session;
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

const { authorizeSchedulingRequest } = await import('@/lib/scheduling/access');

const ROOT = path.resolve(__dirname, '../..');
const sqlOf = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const HOST = (f: string) => `scripts/scheduling/${f}`;
const MANUAL = (f: string) => `scripts/scheduling/manual/${f}`;
const TEST_ORG_SLUG = 'zz-scheduling-internal-test';

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const db: ContactSqlExecutor = { query: async (text, params = []) => (await pool.query(text, [...params])).rows as never };
const apply = (rel: string) => pool.query(sqlOf(rel));

/** Runs a script that is expected to fail, on its own connection, and clears the aborted transaction. */
async function failure(rel: string): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query(sqlOf(rel));
    return '';
  } catch (e) {
    return (e as Error).message;
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

type Fn = { contact_id: string; outcome: string };
const callFn = async (org: string, email: string | null, first: string | null, last: string | null, phone: string | null = null, by: string | null = null) =>
  (await q<Fn>('SELECT * FROM brainbase_scheduling_find_or_create_contact($1, $2, $3, $4, $5, $6)', [org, email, first, last, phone, by]))[0];
const failCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
};
const contactsOf = (org: string) => q<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; classification: string | null; created_by: string | null; notes: string | null }>('SELECT * FROM crm_contacts WHERE organisation_id = $1 ORDER BY created_at, id', [org]);
const count = async (table: string, where = 'true') => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0].n);

const SCHED_TABLES = 'scheduling_resource_holds, scheduling_reservations, scheduling_series_pauses, scheduling_series, scheduling_occurrences, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_settings';

async function resetHost() {
  await pool.query(`TRUNCATE ${SCHED_TABLES} CASCADE`);
  await pool.query('DELETE FROM organisation_modules');
  await pool.query('DELETE FROM crm_contacts');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM organisations');
  await pool.query("DELETE FROM modules WHERE key = 'scheduling'");
  await apply(HOST('120_brainbase_capability.sql'));
  for (const id of ['org-a', 'org-b', 'org-c']) {
    await pool.query("INSERT INTO organisations (id, name, slug, updated_at) VALUES ($1, $2, $3, now())", [id, `Org ${id}`, id]);
  }
  await pool.query("INSERT INTO users (id, organisation_id, email, name, role) VALUES ('user-a', 'org-a', 'a@example.test', 'A', 'manager'), ('user-b', 'org-b', 'b@example.test', 'B', 'manager')");
}

const kindHashes = async () =>
  q<{ k: string; n: number; h: string }>(`
    WITH q AS (
      SELECT 'fn' AS k, p.proname::text AS nm, pg_get_functiondef(p.oid) AS x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'scheduling\\_%'
      UNION ALL SELECT 'trg', t.tgname::text, pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'scheduling\\_%'
      UNION ALL SELECT 'idx', indexname::text, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'scheduling\\_%'
      UNION ALL SELECT 'con', c.relname||'.'||con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname LIKE 'scheduling\\_%'
    ) SELECT k, count(*)::int AS n, md5(string_agg(k||':'||nm||':'||x, E'\\n' ORDER BY nm, x)) AS h FROM q GROUP BY k ORDER BY k`);

suite('Phase 2B.0 on real Postgres', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 70, idleTimeoutMillis: 60_000 });
    pool.on('error', () => undefined);
    // The proof script applied 010 and 110 already; re-applying is the idempotency check and keeps the suite self-contained.
    await apply('packages/scheduling/sql/010_shared_schema.sql');
    await apply(HOST('110_brainbase_host.sql'));
    await apply(HOST('130_brainbase_crm_link.sql'));
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    mocks.session = null;
    await resetHost();
  });

  // ─── 120: the capability exists for nobody ───────────────────────────────────

  describe('120 capability registration', () => {
    it('registers one active row and entitles no organisation', async () => {
      expect(await q("SELECT key, name, active FROM modules WHERE key = 'scheduling'")).toEqual([{ key: 'scheduling', name: 'Scheduling & Bookings', active: true }]);
      expect(await count('organisation_modules')).toBe(0);
      expect(await count('scheduling_schema_migrations', "version = '2b.0-capability'")).toBe(1);
    });

    it('is idempotent and never overwrites an edited row', async () => {
      await q("UPDATE modules SET active = false, name = 'Edited' WHERE key = 'scheduling'");
      await apply(HOST('120_brainbase_capability.sql'));
      await apply(HOST('120_brainbase_capability.sql'));
      expect(await q("SELECT name, active FROM modules WHERE key = 'scheduling'")).toEqual([{ name: 'Edited', active: false }]);
      expect(await count('modules', "key = 'scheduling'")).toBe(1);
      expect(await count('organisation_modules')).toBe(0);
    });

    it('fails loudly, changing nothing, when the registry tables are missing', async () => {
      await q('ALTER TABLE organisation_modules RENAME TO om_hidden');
      try {
        await q("DELETE FROM modules WHERE key = 'scheduling'");
        expect(await failure(HOST('120_brainbase_capability.sql'))).toMatch(/capability registry tables/);
        expect(await count('modules', "key = 'scheduling'")).toBe(0);
      } finally {
        await q('ALTER TABLE om_hidden RENAME TO organisation_modules');
      }
    });

    it('the rollback refuses while an entitlement exists, then removes only the registry row and marker', async () => {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true)");
      expect(await failure(HOST('191_brainbase_capability_rollback.sql'))).toMatch(/still holds 1 row/);
      expect(await count('modules', "key = 'scheduling'")).toBe(1);
      await q("DELETE FROM organisation_modules WHERE module_key = 'scheduling'");
      await apply(HOST('191_brainbase_capability_rollback.sql'));
      expect(await count('modules', "key = 'scheduling'")).toBe(0);
      expect(await count('modules')).toBe(0);
      expect(await count('scheduling_schema_migrations', "version = '2b.0-capability'")).toBe(0);
      expect(await count('scheduling_schema_migrations', "version IN ('2a.2', '2a.1-brainbase')")).toBe(2);
    });
  });

  // ─── Capability and role isolation, through the REAL gate and the REAL capability lookup ─

  describe('capability and role isolation', () => {
    const session = (organisationId: string, role: string, home = organisationId) => ({ userId: `u-${organisationId}`, organisationId, homeOrganisationId: home, role, name: 'T' });
    const status = async (s: ReturnType<typeof session> | null, permission: 'scheduling.view' | 'scheduling.manage' | 'scheduling.reserve' | 'scheduling.attendance') => {
      mocks.session = s;
      const r = await authorizeSchedulingRequest(permission);
      return r.ok ? 200 : r.response.status;
    };

    it('every organisation is denied until a row exists, whatever its role', async () => {
      for (const org of ['org-a', 'org-b', 'org-c', 'org-unknown']) {
        for (const role of ['viewer', 'manager', 'admin', 'super_admin']) expect(await status(session(org, role), 'scheduling.view'), `${org}/${role}`).toBe(403);
      }
      expect(await status(null, 'scheduling.view')).toBe(401);
    });

    it('entitling org-a admits only org-a, with the role matrix on top (evidence matrix)', async () => {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true), ('org-c', 'scheduling', false)");
      const rows: string[] = [];
      const cases: [string, string, 'scheduling.view' | 'scheduling.manage' | 'scheduling.reserve' | 'scheduling.attendance', number][] = [
        ['org-a', 'viewer', 'scheduling.view', 200],
        ['org-a', 'viewer', 'scheduling.reserve', 403],
        ['org-a', 'viewer', 'scheduling.manage', 403],
        ['org-a', 'analyst', 'scheduling.view', 403],
        ['org-a', 'manager', 'scheduling.reserve', 200],
        ['org-a', 'manager', 'scheduling.manage', 200],
        ['org-a', 'admin', 'scheduling.attendance', 200],
        ['org-a', 'super_admin', 'scheduling.manage', 200],
        ['org-b', 'admin', 'scheduling.view', 403],
        ['org-b', 'super_admin', 'scheduling.view', 403],
        ['org-c', 'admin', 'scheduling.view', 403],
        ['org-unknown', 'admin', 'scheduling.view', 403],
      ];
      for (const [org, role, permission, want] of cases) {
        const got = await status(session(org, role), permission);
        rows.push(`${org.padEnd(11)} ${role.padEnd(11)} ${permission.padEnd(21)} -> ${got}`);
        expect(got, `${org}/${role}/${permission}`).toBe(want);
      }
      console.log(`CAP-EVIDENCE entitled=[org-a] disabled=[org-c] none=[org-b]\n${rows.map(r => `CAP-EVIDENCE ${r}`).join('\n')}`);
    });

    it('an impersonating super_admin gets the IMPERSONATED organisation entitlement, never their home one', async () => {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true)");
      expect(await status(session('org-b', 'super_admin', 'org-a'), 'scheduling.view')).toBe(403); // home org-a is entitled, impersonated org-b is not
      expect(await status(session('org-a', 'super_admin', 'org-b'), 'scheduling.view')).toBe(200); // impersonating the entitled org
    });

    it('a globally inactive or unregistered capability denies even an enabled organisation', async () => {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true)");
      expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(200);
      await q("UPDATE modules SET active = false WHERE key = 'scheduling'");
      expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(403);
      await q("UPDATE modules SET active = true WHERE key = 'scheduling'");
      await q("UPDATE organisation_modules SET enabled = false WHERE module_key = 'scheduling'");
      expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(403);
      await q("DELETE FROM organisation_modules WHERE module_key = 'scheduling'");
      await q("DELETE FROM modules WHERE key = 'scheduling'");
      expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(403);
    });

    it('fails closed with 503 when entitlement cannot be read, and for a malformed config', async () => {
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true)");
      await q('ALTER TABLE organisation_modules RENAME TO om_hidden');
      try {
        expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(503);
      } finally {
        await q('ALTER TABLE om_hidden RENAME TO organisation_modules');
      }
      await q("UPDATE organisation_modules SET config = '[]'::jsonb WHERE module_key = 'scheduling'");
      expect(await status(session('org-a', 'admin'), 'scheduling.view')).toBe(503);
    });
  });

  // ─── 130: CRM find-or-create ─────────────────────────────────────────────────

  describe('130 CRM find-or-create: behaviour', () => {
    it('creates a LEAD from structured names, preserving them verbatim apart from edge whitespace', async () => {
      const r = await callFn('org-a', ' Zoe.Q@Example.com ', '  Zoë  ', "O'Brien  Núñez\t", ' 0412 345 678 ', 'user-a');
      expect(r.outcome).toBe('created');
      const [c] = await contactsOf('org-a');
      expect(c).toMatchObject({ id: r.contact_id, first_name: 'Zoë', last_name: "O'Brien  Núñez", email: 'Zoe.Q@Example.com', phone: '0412 345 678', classification: 'LEAD', created_by: 'user-a', notes: null });
      expect(await contactsOf('org-b')).toEqual([]);
    });

    it('matches by normalised email (case and edge spaces) and returns the existing contact UNCHANGED', async () => {
      const [{ id }] = await q<{ id: string }>("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, phone, notes, classification) VALUES ('org-a', 'Existing', 'Person', '  Sam@Example.COM ', '111', 'keep me', 'CLIENT') RETURNING id");
      const before = JSON.stringify(await contactsOf('org-a'));
      for (const variant of ['sam@example.com', 'SAM@EXAMPLE.COM', '  Sam@Example.com  ']) {
        const r = await callFn('org-a', variant, 'Different', 'Names', '999', 'user-a');
        expect(r).toEqual({ contact_id: id, outcome: 'matched' });
      }
      expect(JSON.stringify(await contactsOf('org-a'))).toBe(before);
    });

    it('a match needs no names at all', async () => {
      const [{ id }] = await q<{ id: string }>("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a', 'A', 'B', 'x@example.test') RETURNING id");
      expect(await callFn('org-a', 'x@example.test', null, null)).toEqual({ contact_id: id, outcome: 'matched' });
      expect(await callFn('org-a', 'x@example.test', '', '   ')).toEqual({ contact_id: id, outcome: 'matched' });
    });

    it('NEVER matches by name alone: same names, different or missing email, always a separate contact or a refusal', async () => {
      await q("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a', 'Sam', 'Lee', 'sam.lee@example.test')");
      const r = await callFn('org-a', 'someone.else@example.test', 'Sam', 'Lee');
      expect(r.outcome).toBe('created');
      expect(await count('crm_contacts', "organisation_id = 'org-a' AND first_name = 'Sam' AND last_name = 'Lee'")).toBe(2);
      for (const email of [null, '', '   ', 'no-at-sign', 'a b@c.d', 'a@b@c.d']) expect(await failCode(callFn('org-a', email, 'Sam', 'Lee')), String(email)).toBe('SCCEM');
      expect(await count('crm_contacts', "organisation_id = 'org-a'")).toBe(2);
    });

    it('refuses blank structured names when it must create, and creates nothing (including tab, newline and no-break-space names)', async () => {
      const blanks: (string | null)[] = [null, '', '   ', '\t', '\n \t', ' ', '   '];
      for (const blank of blanks) {
        expect(await failCode(callFn('org-a', 'new@example.test', blank, 'Lee')), `first=${JSON.stringify(blank)}`).toBe('SCCNM');
        expect(await failCode(callFn('org-a', 'new@example.test', 'Sam', blank)), `last=${JSON.stringify(blank)}`).toBe('SCCNM');
      }
      expect(await count('crm_contacts')).toBe(0);
    });

    it('a one-word name is the caller\'s business: with only one structured name nothing is created, nothing is invented', async () => {
      expect(await failCode(callFn('org-a', 'madonna@example.test', 'Madonna', null))).toBe('SCCNM');
      expect(await failCode(callFn('org-a', 'madonna@example.test', null, 'Madonna'))).toBe('SCCNM');
      expect(await count('crm_contacts')).toBe(0);
    });

    it('is organisation-scoped in both directions: a same-email contact in another organisation is never matched or touched', async () => {
      const [{ id: bId }] = await q<{ id: string }>("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, classification) VALUES ('org-b', 'Bee', 'Contact', 'shared@example.test', 'CLIENT') RETURNING id");
      const bBefore = JSON.stringify(await contactsOf('org-b'));
      const a = await callFn('org-a', 'shared@example.test', 'Aye', 'Person');
      expect(a.outcome).toBe('created');
      expect(a.contact_id).not.toBe(bId);
      expect((await contactsOf('org-a')).map(c => c.id)).toEqual([a.contact_id]);
      expect(JSON.stringify(await contactsOf('org-b'))).toBe(bBefore);
      const b = await callFn('org-b', 'SHARED@example.test', null, null);
      expect(b).toEqual({ contact_id: bId, outcome: 'matched' });
      console.log(`CRM-EVIDENCE isolation: org-a created ${a.contact_id}, org-b kept ${bId}; each organisation sees only its own contact for shared@example.test`);
    });

    it('with duplicates already present, returns the OLDEST and merges, edits and deletes nothing', async () => {
      const ids: string[] = [];
      for (const [i, ts] of ['2026-01-03', '2026-01-01', '2026-01-02'].entries()) {
        ids.push((await q<{ id: string }>("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, created_at) VALUES ('org-a', $1, 'Dup', 'dup@example.test', $2) RETURNING id", [`N${i}`, ts]))[0].id);
      }
      const before = JSON.stringify(await contactsOf('org-a'));
      for (let i = 0; i < 3; i++) expect(await callFn('org-a', 'dup@example.test', null, null)).toEqual({ contact_id: ids[1], outcome: 'matched' });
      expect(JSON.stringify(await contactsOf('org-a'))).toBe(before);
    });

    it('stores a blank phone as NULL and a missing creator as NULL', async () => {
      await callFn('org-a', 'p@example.test', 'P', 'Q', '   ', null);
      expect(await contactsOf('org-a')).toMatchObject([{ phone: null, created_by: null }]);
    });

    it('reports an unknown organisation or user as a foreign-key error and leaves nothing behind (and releases its lock)', async () => {
      expect(await failCode(callFn('org-missing', 'z@example.test', 'Z', 'Z'))).toBe('23503');
      expect(await failCode(callFn('org-a', 'z@example.test', 'Z', 'Z', null, 'user-missing'))).toBe('23503');
      expect(await failCode(callFn('', 'z@example.test', 'Z', 'Z'))).toBe('SCCOR');
      expect(await failCode(callFn(null as never, 'z@example.test', 'Z', 'Z'))).toBe('SCCOR');
      expect(await count('crm_contacts')).toBe(0);
      expect((await callFn('org-a', 'z@example.test', 'Z', 'Z')).outcome).toBe('created');
    });

    it('refuses REPEATABLE READ and SERIALIZABLE, where its post-lock read would use a stale snapshot', async () => {
      for (const level of ['REPEATABLE READ', 'SERIALIZABLE']) {
        const c = await pool.connect();
        try {
          await c.query(`BEGIN ISOLATION LEVEL ${level}`);
          const err = await c.query("SELECT * FROM brainbase_scheduling_find_or_create_contact('org-a', 'iso@example.test', 'I', 'S')").then(
            () => null,
            (e: { code?: string }) => e.code,
          );
          expect(err, level).toBe('SCISO');
        } finally {
          await c.query('ROLLBACK');
          c.release();
        }
      }
      expect(await count('crm_contacts')).toBe(0);
    });

    it('touches no LD Tennis table: the contacts sentinel is byte-identical after every operation above', async () => {
      const before = JSON.stringify(await q('SELECT * FROM contacts ORDER BY id'));
      await callFn('org-a', 'ld@example.test', 'L', 'D');
      await callFn('org-a', 'ld@example.test', 'L', 'D');
      await failCode(callFn('org-a', 'bad', 'L', 'D'));
      expect(JSON.stringify(await q('SELECT * FROM contacts ORDER BY id'))).toBe(before);
    });
  });

  // ─── The typed wrapper against the real function ─────────────────────────────

  describe('the TypeScript wrapper on real Postgres', () => {
    const tenant = (role = 'manager') => staffTenantContext({ organisationId: 'org-a', userId: 'user-a', role, timezone: null });

    it('links by email, creates only from structured names, and otherwise saves the booking unlinked', async () => {
      expect(await findOrCreateCrmContact(db, tenant(), { email: 'walkin@example.test', firstName: 'Sam', lastName: null })).toEqual({ kind: 'unlinked', reason: 'names_required' });
      expect(await findOrCreateCrmContact(db, tenant(), { email: 'walkin@example.test', firstName: 'Sam', lastName: '   ' })).toEqual({ kind: 'unlinked', reason: 'names_required' });
      expect(await findOrCreateCrmContact(db, tenant(), { email: null, firstName: 'Sam', lastName: 'Lee' })).toEqual({ kind: 'unlinked', reason: 'email_required' });
      expect(await count('crm_contacts')).toBe(0);
      const created = await findOrCreateCrmContact(db, tenant(), { email: 'walkin@example.test', firstName: 'Sam', lastName: 'Lee' });
      expect(created).toMatchObject({ kind: 'linked', outcome: 'created' });
      const matched = await findOrCreateCrmContact(db, tenant(), { email: 'WALKIN@example.test' });
      expect(matched).toEqual({ ...created, outcome: 'matched' });
      expect(await contactsOf('org-a')).toMatchObject([{ first_name: 'Sam', last_name: 'Lee', classification: 'LEAD', created_by: 'user-a' }]);
    });

    it('maps a lock timeout to a retryable error and writes nothing', async () => {
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query("SELECT pg_advisory_xact_lock(hashtext('org-a'), hashtext('email:slow@example.test'))");
        const started = Date.now();
        await expect(findOrCreateCrmContact(db, tenant(), { email: 'slow@example.test', firstName: 'S', lastName: 'L' })).rejects.toMatchObject({ name: 'CrmLinkError', reason: 'contention_timeout', retryable: true });
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThan(4_000);
        expect(waited).toBeLessThan(12_000);
        console.log(`CRM-EVIDENCE lock timeout: a waiter gave up after ${waited} ms with a retryable error and created nothing`);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      expect(await count('crm_contacts')).toBe(0);
    }, 20_000);
  });

  // ─── Concurrent contact creation ─────────────────────────────────────────────

  describe('130 CRM find-or-create: concurrency', () => {
    const variants = (email: string) => [email, email.toUpperCase(), ` ${email} `, email.replace(/^./, c => c.toUpperCase())];

    it('40 simultaneous bookings by one new customer create exactly ONE contact (10 rounds, varied case and spacing)', async () => {
      const summary: string[] = [];
      for (let round = 0; round < 10; round++) {
        const email = `race${round}@example.test`;
        const results = await Promise.all(Array.from({ length: 40 }, (_, i) => callFn('org-a', variants(email)[i % 4], `First${i}`, `Last${i}`, null, 'user-a')));
        const ids = new Set(results.map(r => r.contact_id));
        const created = results.filter(r => r.outcome === 'created').length;
        expect(ids.size, `round ${round}`).toBe(1);
        expect(created, `round ${round}`).toBe(1);
        expect(await count('crm_contacts', `organisation_id = 'org-a' AND lower(btrim(email)) = '${email}'`)).toBe(1);
        summary.push(`${created} created / ${results.length - created} matched`);
      }
      console.log(`CRM-EVIDENCE concurrency: 10 rounds x 40 simultaneous calls, one new email per round -> ${[...new Set(summary)].join('; ')}; 10 contacts in total`);
      expect(await count('crm_contacts')).toBe(10);
    }, 60_000);

    it('different emails do not block each other: 40 distinct customers at once create 40 contacts', async () => {
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => callFn('org-a', `distinct${i}@example.test`, `F${i}`, `L${i}`)));
      expect(results.every(r => r.outcome === 'created')).toBe(true);
      expect(new Set(results.map(r => r.contact_id)).size).toBe(40);
      expect(await count('crm_contacts')).toBe(40);
      console.log(`CRM-EVIDENCE no false serialisation: 40 distinct emails created 40 contacts in ${Date.now() - started} ms`);
    }, 30_000);

    it('the same email in two organisations at once yields one contact in EACH, never one shared contact', async () => {
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => callFn(i % 2 ? 'org-a' : 'org-b', 'both@example.test', `F${i}`, `L${i}`)));
      const byOrg = (org: string) => new Set(results.filter((_, i) => (i % 2 ? 'org-a' : 'org-b') === org).map(r => r.contact_id));
      expect(byOrg('org-a').size).toBe(1);
      expect(byOrg('org-b').size).toBe(1);
      expect([...byOrg('org-a')][0]).not.toBe([...byOrg('org-b')][0]);
      expect(await count('crm_contacts', "organisation_id = 'org-a'")).toBe(1);
      expect(await count('crm_contacts', "organisation_id = 'org-b'")).toBe(1);
    }, 30_000);

    it('the wrapper under the same race: 30 simultaneous calls, one contact, one "created"', async () => {
      const tenant = staffTenantContext({ organisationId: 'org-a', userId: 'user-a', role: 'admin', timezone: null });
      const results = await Promise.all(Array.from({ length: 30 }, () => findOrCreateCrmContact(db, tenant, { email: 'wrapped@example.test', firstName: 'W', lastName: 'R' })));
      expect(results.every(r => r.kind === 'linked')).toBe(true);
      expect(results.filter(r => r.kind === 'linked' && r.outcome === 'created')).toHaveLength(1);
      expect(await count('crm_contacts')).toBe(1);
    }, 30_000);

    it('serialises with the Events CRM sync: a waiter reuses a contact the Events path commits while holding the same lock', async () => {
      const events = await pool.connect();
      try {
        await events.query('BEGIN');
        await events.query("SELECT pg_advisory_xact_lock(hashtext('org-a'), hashtext('email:' || 'shared.buyer@example.test'))");
        const waiting = callFn('org-a', 'Shared.Buyer@example.test', 'Sched', 'Booker');
        await new Promise(r => setTimeout(r, 800));
        expect(await count('crm_contacts')).toBe(0); // the scheduling call is blocked, not racing
        await events.query("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, notes, classification) VALUES ('org-a', 'Event', 'Buyer', 'shared.buyer@example.test', 'Events / Event Booking', 'EVENT_CONTACT')");
        await events.query('COMMIT');
        const r = await waiting;
        expect(r.outcome).toBe('matched');
        expect(await count('crm_contacts')).toBe(1);
        expect((await contactsOf('org-a'))[0]).toMatchObject({ id: r.contact_id, first_name: 'Event', classification: 'EVENT_CONTACT' });
        console.log('CRM-EVIDENCE cross-feature: a scheduling call blocked on the Events lock, then reused the Events contact (1 contact, classification untouched)');
      } finally {
        await events.query('ROLLBACK').catch(() => undefined);
        events.release();
      }
    }, 20_000);

    it('negative control: the same race WITHOUT the lock creates duplicates, so the tests above can detect a missing lock', async () => {
      await q(`CREATE OR REPLACE FUNCTION naive_find_or_create_for_test(p_org text, p_email text) RETURNS uuid LANGUAGE plpgsql AS $$
               DECLARE v uuid; BEGIN
                 SELECT id INTO v FROM crm_contacts WHERE organisation_id = p_org AND lower(btrim(email)) = lower(btrim(p_email)) LIMIT 1;
                 IF FOUND THEN RETURN v; END IF;
                 PERFORM pg_sleep(0.15);
                 INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES (p_org, 'N', 'N', p_email) RETURNING id INTO v;
                 RETURN v; END $$`);
      try {
        await Promise.all(Array.from({ length: 12 }, () => q("SELECT naive_find_or_create_for_test('org-a', 'naive@example.test')")));
        const dupes = await count('crm_contacts', "email = 'naive@example.test'");
        expect(dupes).toBeGreaterThan(1);
        console.log(`CRM-EVIDENCE negative control: 12 simultaneous lock-free calls created ${dupes} duplicate contacts; the locked function created 1 in every round`);
      } finally {
        await q('DROP FUNCTION IF EXISTS naive_find_or_create_for_test(text, text)');
      }
    }, 30_000);
  });

  // ─── The internal test organisation: defined, tested here, never created elsewhere ───

  describe('internal test organisation scripts', () => {
    const otherOrgsHash = async () => JSON.stringify(await q('SELECT id, name, slug, plan, status FROM organisations WHERE slug <> $1 ORDER BY id', [TEST_ORG_SLUG]));

    it('create makes exactly one clearly named organisation, no user, no entitlement, and is idempotent', async () => {
      const others = await otherOrgsHash();
      await apply(MANUAL('internal-test-org-1-create.sql'));
      await apply(MANUAL('internal-test-org-1-create.sql'));
      const rows = await q<{ id: string; name: string; slug: string; plan: string; status: string; timezone: string | null }>('SELECT id, name, slug, plan, status, timezone FROM organisations WHERE slug = $1', [TEST_ORG_SLUG]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'ZZ Scheduling Internal Test (no customer data)', slug: TEST_ORG_SLUG, plan: 'TRIAL', status: 'ACTIVE', timezone: null });
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await count('users', `organisation_id = '${rows[0].id}'`)).toBe(0);
      expect(await count('crm_contacts', `organisation_id = '${rows[0].id}'`)).toBe(0);
      expect(await count('organisation_modules')).toBe(0);
      expect(await otherOrgsHash()).toBe(others);
    });

    it('enable entitles exactly the test organisation and nobody else; the real gate then admits only it', async () => {
      await apply(MANUAL('internal-test-org-1-create.sql'));
      await apply(MANUAL('internal-test-org-2-enable-capability.sql'));
      await apply(MANUAL('internal-test-org-2-enable-capability.sql'));
      const [{ id }] = await q<{ id: string }>('SELECT id FROM organisations WHERE slug = $1', [TEST_ORG_SLUG]);
      expect(await q('SELECT organisation_id, module_key, enabled FROM organisation_modules')).toEqual([{ organisation_id: id, module_key: 'scheduling', enabled: true }]);
      const gate = async (org: string) => {
        mocks.session = { userId: 'u', organisationId: org, homeOrganisationId: org, role: 'manager', name: 'T' };
        const r = await authorizeSchedulingRequest('scheduling.reserve');
        return r.ok ? 200 : r.response.status;
      };
      expect(await gate(id)).toBe(200);
      for (const other of ['org-a', 'org-b', 'org-c']) expect(await gate(other)).toBe(403);
    });

    it('enable refuses, writing nothing, when the capability is not registered, the test organisation is absent, or another organisation is already entitled', async () => {
      expect(await failure(MANUAL('internal-test-org-2-enable-capability.sql'))).toMatch(/expected exactly one internal test organisation, found 0/);
      await apply(MANUAL('internal-test-org-1-create.sql'));
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a', 'scheduling', true)");
      expect(await failure(MANUAL('internal-test-org-2-enable-capability.sql'))).toMatch(/exactly one organisation may be entitled to scheduling in Phase 2B, found 2/);
      expect(await count('organisation_modules')).toBe(1);
      await q("DELETE FROM organisation_modules");
      await q("UPDATE modules SET active = false WHERE key = 'scheduling'");
      expect(await failure(MANUAL('internal-test-org-2-enable-capability.sql'))).toMatch(/not registered and active/);
      expect(await count('organisation_modules')).toBe(0);
    });

    it('remove refuses while ANY scheduling row, CRM contact or user belongs to the test organisation, then removes only it', async () => {
      await apply(MANUAL('internal-test-org-1-create.sql'));
      await apply(MANUAL('internal-test-org-2-enable-capability.sql'));
      const [{ id }] = await q<{ id: string }>('SELECT id FROM organisations WHERE slug = $1', [TEST_ORG_SLUG]);
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-b', 'scheduling', false)");
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
      expect(await failure(MANUAL('internal-test-org-9-remove.sql'))).toMatch(/scheduling_settings still holds 1 row/);
      await q('DELETE FROM scheduling_settings WHERE organisation_id = $1', [id]);
      await q("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ($1, 'T', 'T', 't@example.test')", [id]);
      expect(await failure(MANUAL('internal-test-org-9-remove.sql'))).toMatch(/crm_contacts holds 1 row/);
      await q('DELETE FROM crm_contacts WHERE organisation_id = $1', [id]);
      await q("INSERT INTO users (id, organisation_id, email, name, role) VALUES ('u-test', $1, 't@example.test', 'T', 'manager')", [id]);
      expect(await failure(MANUAL('internal-test-org-9-remove.sql'))).toMatch(/users holds 1 row/);
      await q("DELETE FROM users WHERE id = 'u-test'");
      expect(await count('organisations', `slug = '${TEST_ORG_SLUG}'`)).toBe(1);

      const others = await otherOrgsHash();
      await apply(MANUAL('internal-test-org-9-remove.sql'));
      expect(await count('organisations', `slug = '${TEST_ORG_SLUG}'`)).toBe(0);
      expect(await q('SELECT organisation_id FROM organisation_modules')).toEqual([{ organisation_id: 'org-b' }]);
      expect(await otherOrgsHash()).toBe(others);
      await apply(MANUAL('internal-test-org-9-remove.sql')); // absent: a notice, not an error
    });
  });

  // ─── Rollbacks and the shared inventory ──────────────────────────────────────

  describe('130 rollback and the shared 2A inventory', () => {
    it('the rollback drops only the function and marker; contacts it created survive; re-apply restores it', async () => {
      await callFn('org-a', 'keep@example.test', 'Keep', 'Me');
      await apply(HOST('192_brainbase_crm_link_rollback.sql'));
      expect(await count('pg_proc', "proname = 'brainbase_scheduling_find_or_create_contact'")).toBe(0);
      expect(await count('scheduling_schema_migrations', "version = '2b.0-crm-link'")).toBe(0);
      expect(await count('crm_contacts', "email = 'keep@example.test'")).toBe(1);
      await apply(HOST('130_brainbase_crm_link.sql'));
      expect((await callFn('org-a', 'keep@example.test', null, null)).outcome).toBe('matched');
      expect(await count('scheduling_schema_migrations', "version = '2b.0-crm-link'")).toBe(1);
    });

    it('120 and 130 leave the shared scheduling inventory byte-identical (per-kind definition hashes)', async () => {
      const withHost = await kindHashes();
      await apply(HOST('192_brainbase_crm_link_rollback.sql'));
      await apply(HOST('191_brainbase_capability_rollback.sql'));
      const without = await kindHashes();
      await apply(HOST('120_brainbase_capability.sql'));
      await apply(HOST('130_brainbase_crm_link.sql'));
      expect(withHost).toEqual(without);
      const n = Object.fromEntries(withHost.map(r => [r.k, r.n]));
      expect(n).toEqual({ con: 106, fn: 11, idx: 37, trg: 16 });
      console.log(`CRM-EVIDENCE inventory: ${withHost.map(r => `${r.k} ${r.n} ${r.h}`).join(' | ')} (identical with and without 120/130)`);
    });

    it('the host function is the only addition outside the scheduling_* namespace', async () => {
      expect(await q("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname LIKE '%scheduling%' AND proname NOT LIKE 'scheduling\\_%' ORDER BY 1")).toEqual([{ proname: 'brainbase_scheduling_find_or_create_contact' }]);
    });
  });
});

