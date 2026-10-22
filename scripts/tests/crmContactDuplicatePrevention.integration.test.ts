import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

// Real-Postgres proof of the CRM duplicate-prevention change, run by scripts/tests/verify-crm-contact-duplicate-prevention.sh
// against a DISPOSABLE database. It reaches only the database named by CRM_TEST_DATABASE_URL, never DATABASE_URL.
//
// The REAL application code runs: syncEventOrderContact, executeEventContactBackfill, the CRM API route handlers
// (POST /api/crm/contacts, PUT /api/crm/contacts/[id]) and the capability lookup. Only two things are replaced: the
// database client (a pool onto the same disposable database that reproduces what @neondatabase/serverless does: lazy
// query objects, and sql.transaction([...]) as BEGIN; each statement; COMMIT on ONE connection at READ COMMITTED) and the
// session. Concurrency is FORCED, not hoped for: a holder transaction owns the identity lock while the writers under test
// are started and allowed to block, then commits the contact; the writers must then reuse it, not insert their own.

const TEST_URL = process.env.CRM_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => ({ org: 'org-a', user: 'user-a' }));

vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const pool = new P({ connectionString: process.env.CRM_TEST_DATABASE_URL, max: 60 });
  type Q = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]): Q => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
    return { text, values, then: (onF, onR) => pool.query(text, values).then(r => r.rows).then(onF, onR) };
  };
  // Neon's non-interactive transaction: the statements run in order on one connection inside one transaction.
  const transaction = async (queries: Q[]) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out: unknown[][] = [];
      for (const q of queries) out.push((await client.query(q.text, q.values)).rows);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
  return { default: Object.assign(tag, { transaction }) };
});
vi.mock('@/lib/org', () => ({
  requireSession: async () => ({ organisationId: state.org, userId: state.user, role: 'manager', name: 'Tester' }),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));

const { syncEventOrderContact } = await import('@/lib/crm/eventSync');
const { executeEventContactBackfill } = await import('@/lib/crm/eventBackfill');
const contactsRoute = await import('@/app/api/crm/contacts/route');
const contactRoute = await import('@/app/api/crm/contacts/[id]/route');

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const count = async (where: string) => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM crm_contacts WHERE ${where}`))[0].n);
const contactsFor = (org: string, email: string) => count(`organisation_id = '${org}' AND lower(btrim(email)) = '${email.toLowerCase()}'`);
const tableHash = async (table: string) => (await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${table} t`))[0].h;

const post = (body: Record<string, unknown>) =>
  contactsRoute.POST(new NextRequest('http://bb.test/api/crm/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const put = (id: string, body: Record<string, unknown>) =>
  contactRoute.PUT(new NextRequest(`http://bb.test/api/crm/contacts/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const events = (i: number, email: string | null, phone: string | null = null, org = 'org-a') =>
  syncEventOrderContact({ organisationId: org, orderId: `order-${org}-${i}`, purchaserName: 'Pat Buyer', purchaserEmail: email, purchaserPhone: phone });
const seedOrder = (id: string, email: string | null, org = 'org-a') =>
  q('INSERT INTO event_orders (id, organisation_id, purchaser_name, purchaser_email, purchaser_phone) VALUES ($1,$2,$3,$4,NULL)', [id, org, 'Pat Buyer', email]);
const lockSql = (org: string, kind: string, id: string) => `SELECT pg_advisory_xact_lock(hashtext('${org}'), hashtext('${kind}:${id}'))`;

/** Holds the identity lock, lets `start()` launch writers that block on it, then commits `afterBlock` and releases. */
async function forcedOverlap<T>(org: string, kind: 'email' | 'phone', identity: string, start: () => Promise<T>[], afterBlock: string): Promise<T[]> {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(lockSql(org, kind, identity));
    const running = start();
    await new Promise(r => setTimeout(r, 1500)); // every writer has started and is blocked on the held lock
    await holder.query(afterBlock);
    await holder.query('COMMIT');
    return await Promise.all(running);
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
}

suite('CRM duplicate prevention (real Postgres, real application code)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 60 });
    await q(`CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE)`);
    await q(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id), name TEXT)`);
    await q(`CREATE TABLE IF NOT EXISTS modules (key TEXT PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS organisation_modules (organisation_id TEXT NOT NULL REFERENCES organisations(id), module_key TEXT NOT NULL REFERENCES modules(key), enabled BOOLEAN NOT NULL DEFAULT false, config JSONB NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (organisation_id, module_key))`);
    await q(`CREATE TABLE IF NOT EXISTS crm_companies (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`);
    await q(`CREATE TABLE IF NOT EXISTS crm_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id TEXT NOT NULL REFERENCES organisations(id),
      company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      email TEXT, phone TEXT, job_title TEXT, notes TEXT, created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), classification TEXT,
      CONSTRAINT crm_contacts_classification_check CHECK (classification IS NULL OR classification = ANY (ARRAY['CLIENT','LEAD','EVENT_CONTACT','SUPPLIER','PARTNER','OTHER'])))`);
    await q(`CREATE TABLE IF NOT EXISTS event_orders (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, purchaser_name TEXT, purchaser_email TEXT, purchaser_phone TEXT,
      crm_contact_id UUID, created_at TIMESTAMPTZ DEFAULT now())`);
  }, 60_000);

  afterAll(async () => { await pool?.end(); });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // the backfill's best-effort activity write has no events table here
    await q('DELETE FROM event_orders');
    await q('DELETE FROM crm_contacts');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    await q("INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a'),('org-b','Org B','org-b')");
    await q("INSERT INTO users (id, organisation_id, name) VALUES ('user-a','org-a','A'),('user-b','org-b','B')");
    await q("INSERT INTO modules (key, name, active) VALUES ('crm','CRM',true) ON CONFLICT (key) DO UPDATE SET active = true");
    await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ('org-a','crm',true),('org-b','crm',true)");
    state.org = 'org-a';
    state.user = 'user-a';
  });

  // ─── Negative control: the shape this change replaces still duplicates, so the forced tests below can detect the bug ───
  it('CONTROL: the previous single-statement shape (lock and read in one CTE) duplicates under forced overlap', async () => {
    const WAITERS = 6;
    const oldShape = (n: number) => pool.query(
      `WITH lock_cte AS (SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2)) AS locked),
        existing AS (SELECT c.id FROM crm_contacts c, lock_cte WHERE c.organisation_id = $1 AND lower(trim(c.email)) = $3 ORDER BY c.created_at ASC LIMIT 1),
        ins AS (INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) SELECT $1, 'Old', $4, $3 FROM lock_cte WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id)
       SELECT id FROM existing UNION ALL SELECT id FROM ins`,
      ['org-a', 'email:control@example.test', 'control@example.test', `Shape${n}`]);
    await forcedOverlap('org-a', 'email', 'control@example.test', () => Array.from({ length: WAITERS }, (_, i) => oldShape(i)),
      "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a','First','Writer','control@example.test')");
    const n = await contactsFor('org-a', 'control@example.test');
    console.log(`CONTROL old single-statement shape, forced overlap: ${WAITERS} waiters + 1 earlier writer -> ${n} contacts`);
    expect(n).toBe(1 + WAITERS);
  }, 30_000);

  // ─── Events sync ───
  describe('Events sync (real syncEventOrderContact)', () => {
    it('FORCED overlap on email: six waiting syncs reuse the committed contact; one contact, every order linked to it', async () => {
      const WAITERS = 6;
      await forcedOverlap('org-a', 'email', 'forced.sync@example.test', () => Array.from({ length: WAITERS }, (_, i) => events(i, 'forced.sync@example.test')),
        "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, classification) VALUES ('org-a','First','Writer','forced.sync@example.test','CLIENT')");
      expect(await contactsFor('org-a', 'forced.sync@example.test')).toBe(1);
      const linked = await q<{ crm_contact_id: string }>('SELECT DISTINCT crm_contact_id FROM event_orders');
      // event_orders rows are not seeded here, so link the check to the contact instead: the existing contact is untouched.
      const [c] = await q<{ first_name: string; classification: string }>("SELECT first_name, classification FROM crm_contacts WHERE organisation_id='org-a'");
      expect(c).toEqual({ first_name: 'First', classification: 'CLIENT' }); // matched contact never rewritten or reclassified
      expect(linked.length).toBeLessThanOrEqual(1);
    }, 30_000);

    it('FORCED overlap on a phone-only identity: one contact', async () => {
      await forcedOverlap('org-a', 'phone', '+61412345678', () => Array.from({ length: 5 }, (_, i) => events(100 + i, null, '+61 412 345 678')),
        "INSERT INTO crm_contacts (organisation_id, first_name, last_name, phone) VALUES ('org-a','First','Writer','+61412345678')");
      expect(await count("organisation_id = 'org-a' AND regexp_replace(trim(phone), '[^0-9+]', '', 'g') = '+61412345678'")).toBe(1);
    }, 30_000);

    it('natural race: 40 simultaneous syncs for one new customer create exactly one contact (email, mixed case and padding)', async () => {
      await Promise.all(Array.from({ length: 40 }, (_, i) => events(200 + i, i % 2 ? '  Natural.Race@Example.TEST ' : 'natural.race@example.test')));
      expect(await contactsFor('org-a', 'natural.race@example.test')).toBe(1);
    }, 60_000);

    it('tenant isolation: the same email in two organisations never contends and yields one contact in each', async () => {
      await Promise.all([
        ...Array.from({ length: 10 }, (_, i) => events(300 + i, 'shared@example.test', null, 'org-a')),
        ...Array.from({ length: 10 }, (_, i) => events(300 + i, 'shared@example.test', null, 'org-b')),
      ]);
      expect(await contactsFor('org-a', 'shared@example.test')).toBe(1);
      expect(await contactsFor('org-b', 'shared@example.test')).toBe(1);
    }, 30_000);

    it('different emails in parallel are not serialised into one: forty distinct customers, forty contacts', async () => {
      await Promise.all(Array.from({ length: 40 }, (_, i) => events(400 + i, `distinct.${i}@example.test`)));
      expect(await count("organisation_id = 'org-a'")).toBe(40);
    }, 60_000);

    it('existing data is preserved: a matched contact keeps its name, classification and timestamps', async () => {
      await q("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, classification) VALUES ('org-a','Original','Person','keep@example.test','SUPPLIER')");
      const before = await tableHash('crm_contacts');
      await Promise.all(Array.from({ length: 8 }, (_, i) => events(500 + i, 'KEEP@example.test')));
      expect(await tableHash('crm_contacts')).toBe(before);
    }, 30_000);

    it('no email and no phone still always inserts (unchanged, documented behaviour)', async () => {
      await events(600, null);
      await events(601, null);
      expect(await count("organisation_id = 'org-a'")).toBe(2);
    });

    it('capability disabled: nothing is written', async () => {
      await q("UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a'");
      await events(700, 'off@example.test');
      expect(await count("organisation_id = 'org-a'")).toBe(0);
    });
  });

  // ─── Events backfill ───
  describe('Events backfill (real executeEventContactBackfill)', () => {
    it('FORCED overlap: two backfill runs and a contact committed meanwhile leave exactly one contact; nothing fails', async () => {
      for (let i = 0; i < 4; i++) await seedOrder(`bo-${i}`, 'backfill.forced@example.test');
      const results = await forcedOverlap('org-a', 'email', 'backfill.forced@example.test', () => [executeEventContactBackfill('org-a'), executeEventContactBackfill('org-a')],
        "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a','First','Writer','backfill.forced@example.test')");
      expect(await contactsFor('org-a', 'backfill.forced@example.test')).toBe(1);
      for (const r of results) expect(r.failed).toBe(0);
      expect(await count("organisation_id = 'org-a' AND notes = 'Events / Historical Backfill'")).toBe(0); // the committed contact was reused, not re-created
      const unlinked = await q('SELECT count(*)::int AS n FROM event_orders WHERE crm_contact_id IS NULL');
      expect(unlinked[0].n).toBe(0);
    }, 60_000);

    it('natural race: two simultaneous backfill runs over the same orders create one contact and link every order', async () => {
      for (let i = 0; i < 6; i++) await seedOrder(`bn-${i}`, 'backfill.natural@example.test');
      const [a, b] = await Promise.all([executeEventContactBackfill('org-a'), executeEventContactBackfill('org-a')]);
      expect(a.failed + b.failed).toBe(0);
      expect(a.ambiguousSkipped + b.ambiguousSkipped).toBe(0);
      expect(await contactsFor('org-a', 'backfill.natural@example.test')).toBe(1);
      expect((await q<{ n: number }>('SELECT count(*)::int AS n FROM event_orders WHERE crm_contact_id IS NULL'))[0].n).toBe(0);
    }, 60_000);

    it('tenant isolation: backfilling org-a never reads or links org-b contacts or orders', async () => {
      await q("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-b','Other','Tenant','t@example.test')");
      await seedOrder('bt-a', 't@example.test', 'org-a');
      await seedOrder('bt-b', 't@example.test', 'org-b');
      const r = await executeEventContactBackfill('org-a');
      expect(r.createdNew).toBe(1);
      expect(await contactsFor('org-b', 't@example.test')).toBe(1);
      expect((await q<{ crm_contact_id: string | null }>("SELECT crm_contact_id FROM event_orders WHERE id = 'bt-b'"))[0].crm_contact_id).toBeNull();
    }, 30_000);
  });

  // ─── CRM API create (POST) ───
  describe('CRM API create (real POST /api/crm/contacts)', () => {
    const body = (email: string | null, extra: Record<string, unknown> = {}) => ({ first_name: 'Jane', last_name: 'Doe', email, ...extra });

    it('FORCED overlap: creates blocked behind a committed contact all get 409 DUPLICATE_EMAIL; nothing is written', async () => {
      const res = await forcedOverlap('org-a', 'email', 'api.forced@example.test', () => Array.from({ length: 6 }, (_, i) => post(body(i % 2 ? 'API.Forced@Example.test ' : 'api.forced@example.test'))),
        "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a','First','Writer','api.forced@example.test')");
      expect(res.map(r => r.status)).toEqual([409, 409, 409, 409, 409, 409]);
      const j = await res[0].json();
      expect(j.code).toBe('DUPLICATE_EMAIL');
      expect(await contactsFor('org-a', 'api.forced@example.test')).toBe(1);
    }, 30_000);

    it('natural race: twenty simultaneous creates of one email produce exactly one 201 and nineteen 409', async () => {
      const res = await Promise.all(Array.from({ length: 20 }, () => post(body('api.race@example.test'))));
      const statuses = res.map(r => r.status);
      expect(statuses.filter(s => s === 201)).toHaveLength(1);
      expect(statuses.filter(s => s === 409)).toHaveLength(19);
      expect(await contactsFor('org-a', 'api.race@example.test')).toBe(1);
    }, 60_000);

    it('a 201 response has the same shape as before (the created row, tenant, creator and classification)', async () => {
      const res = await post(body('shape@example.test', { classification: 'LEAD', job_title: 'CFO', notes: 'n', phone: '0400' }));
      expect(res.status).toBe(201);
      const { contact } = await res.json();
      expect(contact).toMatchObject({ organisation_id: 'org-a', created_by: 'user-a', first_name: 'Jane', last_name: 'Doe', email: 'shape@example.test', classification: 'LEAD', job_title: 'CFO', phone: '0400' });
      expect(typeof contact.id).toBe('string');
    });

    it('tenant isolation: the same email in another organisation is not a duplicate', async () => {
      expect((await post(body('tenant@example.test'))).status).toBe(201);
      state.org = 'org-b'; state.user = 'user-b';
      expect((await post(body('tenant@example.test'))).status).toBe(201);
      expect(await contactsFor('org-a', 'tenant@example.test')).toBe(1);
      expect(await contactsFor('org-b', 'tenant@example.test')).toBe(1);
    });

    it('different emails in parallel all succeed', async () => {
      const res = await Promise.all(Array.from({ length: 20 }, (_, i) => post(body(`api.distinct.${i}@example.test`))));
      expect(res.every(r => r.status === 201)).toBe(true);
    }, 30_000);

    it('a contact with no email is created as before, repeatedly (no identity to protect)', async () => {
      expect((await post(body(null))).status).toBe(201);
      expect((await post(body(null))).status).toBe(201);
      expect((await post(body('   '))).status).toBe(201);
      expect(await count("organisation_id = 'org-a'")).toBe(3);
    });

    it('the existing contact is never modified by a refused create', async () => {
      await q("INSERT INTO crm_contacts (organisation_id, first_name, last_name, email, classification) VALUES ('org-a','Original','Person','refuse@example.test','CLIENT')");
      const before = await tableHash('crm_contacts');
      expect((await post(body('Refuse@Example.Test', { classification: 'LEAD' }))).status).toBe(409);
      expect(await tableHash('crm_contacts')).toBe(before);
    });
  });

  // ─── CRM API edit (PUT) ───
  describe('CRM API edit (real PUT /api/crm/contacts/[id])', () => {
    const seed = async (org: string, first: string, email: string | null) =>
      (await q<{ id: string }>('INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ($1,$2,$3,$4) RETURNING id', [org, first, 'Person', email]))[0].id;
    const edit = (id: string, email: string | null, extra: Record<string, unknown> = {}) => put(id, { first_name: 'Edited', last_name: 'Person', email, ...extra });

    it('changing an email to one another contact has is refused with 409 and writes nothing', async () => {
      await seed('org-a', 'Holder', 'taken@example.test');
      const id = await seed('org-a', 'Mover', 'mover@example.test');
      const before = await tableHash('crm_contacts');
      const res = await edit(id, 'TAKEN@example.test ');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('DUPLICATE_EMAIL');
      expect(await tableHash('crm_contacts')).toBe(before);
    });

    it('FORCED overlap: an edit blocked behind a contact committed with the same email is refused', async () => {
      const id = await seed('org-a', 'Mover', 'forced.mover@example.test');
      const [res] = await forcedOverlap('org-a', 'email', 'forced.target@example.test', () => [edit(id, 'forced.target@example.test')],
        "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a','First','Writer','forced.target@example.test')");
      expect(res.status).toBe(409);
      expect((await q<{ email: string }>('SELECT email FROM crm_contacts WHERE id = $1', [id]))[0].email).toBe('forced.mover@example.test');
    }, 30_000);

    it('natural race: two contacts edited simultaneously to the same new email - exactly one succeeds', async () => {
      const a = await seed('org-a', 'A', 'a@example.test');
      const b = await seed('org-a', 'B', 'b@example.test');
      const res = await Promise.all([edit(a, 'both@example.test'), edit(b, 'both@example.test')]);
      expect(res.map(r => r.status).sort()).toEqual([200, 409]);
      expect(await contactsFor('org-a', 'both@example.test')).toBe(1);
    }, 30_000);

    it('saving a contact with an UNCHANGED email is never blocked, even when a duplicate pair already exists', async () => {
      const a = await seed('org-a', 'Pair1', 'pair@example.test');
      await seed('org-a', 'Pair2', 'Pair@Example.test');
      const res = await edit(a, ' PAIR@example.test', { notes: 'tidied' });
      expect(res.status).toBe(200);
      expect((await q<{ notes: string }>('SELECT notes FROM crm_contacts WHERE id = $1', [a]))[0].notes).toBe('tidied');
    });

    it('the same email in another organisation is not a conflict; cross-tenant ids are 404 and untouched', async () => {
      await seed('org-b', 'Other', 'cross@example.test');
      const mine = await seed('org-a', 'Mine', 'mine@example.test');
      expect((await edit(mine, 'cross@example.test')).status).toBe(200);
      const theirs = (await q<{ id: string }>("SELECT id FROM crm_contacts WHERE organisation_id = 'org-b'"))[0].id;
      const before = await tableHash('crm_contacts');
      expect((await edit(theirs, 'elsewhere@example.test')).status).toBe(404);
      expect(await tableHash('crm_contacts')).toBe(before);
    });

    it('clearing the email, and editing a contact that has none, work as before', async () => {
      const a = await seed('org-a', 'A', 'clear@example.test');
      expect((await edit(a, null)).status).toBe(200);
      expect((await q<{ email: string | null }>('SELECT email FROM crm_contacts WHERE id = $1', [a]))[0].email).toBeNull();
      expect((await edit(a, 'later@example.test')).status).toBe(200);
    });

    it('unknown id with an email is 404', async () => {
      expect((await edit('00000000-0000-0000-0000-000000000000', 'nobody@example.test')).status).toBe(404);
    });
  });

  // ─── Cross-path ───
  describe('across writers', () => {
    it('Events sync, backfill and the API created together for one new customer leave exactly one contact', async () => {
      for (let i = 0; i < 3; i++) await seedOrder(`mx-${i}`, 'mixed@example.test');
      const writers: Promise<unknown>[] = [
        ...Array.from({ length: 10 }, (_, i) => events(800 + i, 'mixed@example.test')),
        executeEventContactBackfill('org-a'),
        ...Array.from({ length: 10 }, () => post({ first_name: 'Jane', last_name: 'Doe', email: 'Mixed@example.test' })),
      ];
      await Promise.all(writers);
      expect(await contactsFor('org-a', 'mixed@example.test')).toBe(1);
    }, 60_000);

    it('FORCED overlap across all writers at once: one contact', async () => {
      for (let i = 0; i < 2; i++) await seedOrder(`mf-${i}`, 'mixedforced@example.test');
      await forcedOverlap('org-a', 'email', 'mixedforced@example.test', () => [
        ...Array.from({ length: 4 }, (_, i) => events(900 + i, 'mixedforced@example.test')),
        executeEventContactBackfill('org-a'),
        ...Array.from({ length: 4 }, () => post({ first_name: 'Jane', last_name: 'Doe', email: 'mixedforced@example.test' })),
      ] as Promise<unknown>[], "INSERT INTO crm_contacts (organisation_id, first_name, last_name, email) VALUES ('org-a','First','Writer','mixedforced@example.test')");
      expect(await contactsFor('org-a', 'mixedforced@example.test')).toBe(1);
    }, 60_000);
  });
});
