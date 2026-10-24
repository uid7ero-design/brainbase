import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '@scheduling/core';
import { closePool, count, ensureSchema, getPool, hasDatabase, hostSqlFile, resetData, runScript, seedClass, seedOccurrence, seedOffering, seedResource, seedSchedule, sqlFile, uid } from './support/pgHarness';

// The database foundation itself: migration safety (additive, idempotent, reversible), tenant
// integrity, the reservation lifecycle and the guards, tested directly in SQL.

const q = (text: string, params: unknown[] = []) => getPool().query(text, params);

/** A stable fingerprint of everything in `public` that is NOT ours. Must never change. */
async function foreignInventory(): Promise<string> {
  const r = await q(`
    SELECT md5(string_agg(x, ',' ORDER BY x)) AS h, count(*)::int AS n FROM (
      SELECT 'rel:' || c.relname || ':' || c.relkind::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname NOT LIKE 'scheduling\\_%' ESCAPE '\\'
      UNION ALL SELECT 'fn:' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname NOT LIKE 'scheduling\\_%' ESCAPE '\\'
      UNION ALL SELECT 'col:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relname NOT LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'trg:' || t.tgname FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname NOT LIKE 'scheduling\\_%' ESCAPE '\\'
      UNION ALL SELECT 'con:' || con.conname FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname NOT LIKE 'scheduling\\_%' ESCAPE '\\'
    ) q`);
  return `${r.rows[0].n}:${r.rows[0].h}`;
}

/** Exact definitions of everything scheduling owns: a re-apply must reproduce them byte for byte. */
async function ownDefinitions(): Promise<string> {
  const r = await q(`
    SELECT md5(string_agg(x, E'\n' ORDER BY x)) AS h FROM (
      SELECT 'fn:' || pg_get_functiondef(p.oid) AS x FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'trg:' || pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'con:' || c.relname || ':' || con.conname || ':' || pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE c.relname LIKE 'scheduling\_%' ESCAPE '\'
      UNION ALL SELECT 'col:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relname LIKE 'scheduling\_%' ESCAPE '\'
    ) q`);
  return r.rows[0].h as string;
}

const FUNCTIONS = [
  'scheduling_cancel_occurrence', 'scheduling_hold_guard', 'scheduling_hold_serialise', 'scheduling_is_timezone', 'scheduling_occurrence_guard',
  'scheduling_occurrence_release_holds', 'scheduling_require_hold', 'scheduling_reservation_guard', 'scheduling_reservation_lifecycle',
  'scheduling_reservation_release_holds', 'scheduling_touch_updated_at',
];
/** Added by 030_resource_concurrency.sql (version 2b.2.1). */
const FUNCTIONS_030 = [
  'scheduling_hold_resource_state', 'scheduling_link_guard', 'scheduling_link_release_guard', 'scheduling_preset_allows_resource_kind', 'scheduling_resource_guard',
];
/** Added by 031_reservation_integrity.sql (version 2b.2.2). */
const FUNCTIONS_031 = [
  'scheduling_occurrence_integrity', 'scheduling_reservation_integrity', 'scheduling_resource_capacity_guard',
];

async function ownInventory(): Promise<{ tables: number; functions: number; triggers: number; constraints: number; indexes: number }> {
  const r = await q(`
    SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'scheduling\\_%' ESCAPE '\\')::int AS tables,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'scheduling\\_%' ESCAPE '\\')::int AS functions,
      (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'scheduling\\_%' ESCAPE '\\')::int AS triggers,
      (SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE c.relname LIKE 'scheduling\\_%' ESCAPE '\\')::int AS constraints,
      (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'scheduling\\_%' ESCAPE '\\')::int AS indexes`);
  return r.rows[0];
}

const pinnedIndexCount = 37; // set from the first clean apply; a new index must be added here on purpose

describe.skipIf(!hasDatabase)('migration safety', () => {
  beforeAll(async () => {
    await q('CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, name TEXT, slug TEXT)');
    await q('CREATE TABLE IF NOT EXISTS phase2a_sentinel (id int primary key, note text)');
    await q("INSERT INTO phase2a_sentinel VALUES (1, 'must survive') ON CONFLICT DO NOTHING");
    await ensureSchema();
  });
  afterAll(async () => {
    await q('DROP TABLE IF EXISTS phase2a_sentinel');
    await closePool();
  });

  it('creates exactly the documented objects: 13 tables, 19 functions (11 + 5 from 030 + 3 from 031), 23 triggers (16 + 4 + 3)', async () => {
    const inv = await ownInventory();
    expect(inv.tables).toBe(13);
    expect(inv.functions).toBe(19);
    expect(inv.triggers).toBe(23);
  });

  it('is idempotent: applying it again changes nothing', async () => {
    const before = await ownInventory();
    const foreign = await foreignInventory();
    await runScript(sqlFile('010_shared_schema.sql'));
    await runScript(sqlFile('010_shared_schema.sql'));
    expect(await ownInventory()).toEqual(before);
    expect(await foreignInventory()).toBe(foreign);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2a.2'")).toBe(1);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2a.1'")).toBe(0);
  });

  it('re-applying reproduces every function, trigger, index, constraint and column definition byte for byte', async () => {
    const before = await ownDefinitions();
    await runScript(sqlFile('010_shared_schema.sql'));
    expect(await ownDefinitions()).toBe(before);
  });

  it('030 is idempotent byte for byte, and 091 removes exactly what 030 added (back to the 010 inventory) and nothing else, data untouched', async () => {
    const withBoth = await ownDefinitions();
    const inv = await ownInventory();
    await runScript(sqlFile('030_resource_concurrency.sql'));
    await runScript(sqlFile('030_resource_concurrency.sql'));
    expect(await ownDefinitions()).toBe(withBoth);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.1'")).toBe(1);

    await seedClass('org-091', { schedule: 's91', offering: 'o91', occurrence: 'c91' }, 5);
    const rows = await count('SELECT count(*) FROM scheduling_occurrences');
    await runScript(sqlFile('091_resource_concurrency_rollback.sql'));
    await runScript(sqlFile('091_resource_concurrency_rollback.sql')); // twice is harmless
    expect(await ownInventory()).toEqual({ ...inv, functions: inv.functions - 5, triggers: inv.triggers - 4 });
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.1'")).toBe(0);
    expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(rows); // no data touched

    await runScript(sqlFile('030_resource_concurrency.sql'));
    expect(await ownDefinitions()).toBe(withBoth); // re-applying after a rollback reproduces it exactly
  });

  it('031 is idempotent byte for byte, and 092 removes exactly what 031 added and nothing else, data untouched', async () => {
    const withAll = await ownDefinitions();
    const inv = await ownInventory();
    await runScript(sqlFile('031_reservation_integrity.sql'));
    await runScript(sqlFile('031_reservation_integrity.sql'));
    expect(await ownDefinitions()).toBe(withAll);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.2'")).toBe(1);

    await seedClass('org-092', { schedule: 's92', offering: 'o92', occurrence: 'c92' }, 5);
    const rows = await count('SELECT count(*) FROM scheduling_occurrences');
    await runScript(sqlFile('092_reservation_integrity_rollback.sql'));
    await runScript(sqlFile('092_reservation_integrity_rollback.sql')); // twice is harmless
    expect(await ownInventory()).toEqual({ ...inv, functions: inv.functions - 3, triggers: inv.triggers - 3 });
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.2'")).toBe(0);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.1'")).toBe(1); // 030 stays
    expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(rows); // no data touched

    await runScript(sqlFile('031_reservation_integrity.sql'));
    expect(await ownDefinitions()).toBe(withAll);
  });

  it('032 replaces only the reservation guard, is idempotent byte for byte, and 093 restores 031 exactly, data untouched', async () => {
    const at031 = await ownDefinitions();
    const inv = await ownInventory();
    await runScript(sqlFile('032_schedule_archive_ordering.sql'));
    const at032 = await ownDefinitions();
    await runScript(sqlFile('032_schedule_archive_ordering.sql'));
    expect(await ownDefinitions()).toBe(at032); // idempotent
    expect(at032).not.toBe(at031); // and it did change something: the one function
    expect(await ownInventory()).toEqual(inv); // no object added or dropped
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.3'")).toBe(1);
    const fn = (await q("SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'scheduling_reservation_integrity'")).rows[0].d as string;
    expect(fn).toMatch(/FROM scheduling_schedules s WHERE s\.id = sid AND s\.organisation_id = NEW\.organisation_id FOR SHARE/);

    await seedClass('org-093', { schedule: 's93', offering: 'o93', occurrence: 'c93' }, 5);
    const rows = await count('SELECT count(*) FROM scheduling_occurrences');
    await runScript(sqlFile('093_schedule_archive_ordering_rollback.sql'));
    await runScript(sqlFile('093_schedule_archive_ordering_rollback.sql')); // twice is harmless
    expect(await ownDefinitions()).toBe(at031); // 031 restored byte for byte
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.3'")).toBe(0);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.2'")).toBe(1); // 031 stays
    expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(rows); // no data touched
  });

  it('032 refuses to apply without 031', async () => {
    await runScript(sqlFile('092_reservation_integrity_rollback.sql'));
    await expect(runScript(sqlFile('032_schedule_archive_ordering.sql'))).rejects.toMatchObject({ code: 'SCVER' });
    await runScript(sqlFile('031_reservation_integrity.sql'));
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version IN ('2b.2.1','2b.2.2')")).toBe(2);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.3'")).toBe(0);
  });

  it('033 replaces only the occurrence guard, is idempotent byte for byte, and 094 restores 031 exactly, data untouched', async () => {
    await runScript(sqlFile('032_schedule_archive_ordering.sql'));
    const at032 = await ownDefinitions();
    const inv = await ownInventory();
    await runScript(sqlFile('033_occurrence_integrity.sql'));
    const at033 = await ownDefinitions();
    await runScript(sqlFile('033_occurrence_integrity.sql'));
    expect(await ownDefinitions()).toBe(at033); // idempotent
    expect(at033).not.toBe(at032); // and it did change something: the one function
    expect(await ownInventory()).toEqual(inv); // no object added or dropped
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.4'")).toBe(1);
    const fn = (await q("SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'scheduling_occurrence_integrity'")).rows[0].d as string;
    expect(fn).toMatch(/FROM scheduling_schedules s WHERE s\.id = sid AND s\.organisation_id = NEW\.organisation_id FOR SHARE/);

    await seedClass('org-094', { schedule: 's94', offering: 'o94', occurrence: 'c94' }, 5);
    const rows = await count('SELECT count(*) FROM scheduling_occurrences');
    await runScript(sqlFile('094_occurrence_integrity_rollback.sql'));
    await runScript(sqlFile('094_occurrence_integrity_rollback.sql')); // twice is harmless
    const fn031 = (await q("SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'scheduling_occurrence_integrity'")).rows[0].d as string;
    expect(fn031).not.toMatch(/scheduling_schedules/); // 031's function: no archive check
    expect(await ownDefinitions()).toBe(at032); // the schema is back at 032 exactly
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.4'")).toBe(0);
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.3'")).toBe(1); // 032 stays
    expect(await count('SELECT count(*) FROM scheduling_occurrences')).toBe(rows); // no data touched

    await runScript(sqlFile('093_schedule_archive_ordering_rollback.sql')); // back to the 031 baseline the next tests expect
  });

  it('033 refuses to apply without 032', async () => {
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.3'")).toBe(0);
    await expect(runScript(sqlFile('033_occurrence_integrity.sql'))).rejects.toMatchObject({ code: 'SCVER' });
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version = '2b.2.4'")).toBe(0);
  });

  it('031 refuses to apply without 030, and without the 2a.2 schema', async () => {
    await runScript(sqlFile('092_reservation_integrity_rollback.sql'));
    await runScript(sqlFile('091_resource_concurrency_rollback.sql'));
    await expect(runScript(sqlFile('031_reservation_integrity.sql'))).rejects.toMatchObject({ code: 'SCVER' });
    await runScript(sqlFile('030_resource_concurrency.sql'));
    await runScript(sqlFile('031_reservation_integrity.sql'));
    expect(await count("SELECT count(*) FROM scheduling_schema_migrations WHERE version IN ('2b.2.1','2b.2.2')")).toBe(2);
  });

  it('the object list is pinned: exactly these 19 functions and 13 tables, so an unexpected function, trigger or index change fails here', async () => {
    const fns = (await q("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'scheduling\_%' ESCAPE '\' ORDER BY 1")).rows.map(r => r.proname);
    expect(fns).toEqual([...FUNCTIONS, ...FUNCTIONS_030, ...FUNCTIONS_031].sort());
    const trg = (await q("SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'scheduling\_%' ESCAPE '\' ORDER BY 1")).rows.map(r => r.tgname);
    expect(trg).toHaveLength(23);
    expect(trg.every(n => /^scheduling_/.test(n))).toBe(true);
    const inv = await ownInventory();
    expect(inv.indexes).toBe(pinnedIndexCount);
  });

  it('is additive: it creates no foreign key to, and reads nothing from, any LD Tennis / CRM table', async () => {
    const r = await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\\_%' ESCAPE '\\'
                          AND confrelid::regclass::text NOT LIKE 'scheduling\\_%' ESCAPE '\\'`);
    expect(r.rows[0].n).toBe(0);
  });

  it('rolls back completely without touching anything that is not ours, refuses to destroy data without opt-in, and re-applies cleanly', async () => {
    const foreign = await foreignInventory();
    await resetData();
    await seedClass('org-r', { schedule: 's', offering: 'o', occurrence: 'c' }, 5);
    await q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id, customer_name, timezone,
              local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
             VALUES ('r', 'org-r', 's', 'classes_coaching', 1, 'o', 'occurrence', 'c', 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`);

    await expect(runScript(sqlFile('090_rollback.sql'))).rejects.toThrow(/rollback would destroy/);
    expect((await ownInventory()).tables).toBe(13); // the failed rollback changed nothing

    await runScript(`SET scheduling.rollback_confirm = 'yes';\n${sqlFile('090_rollback.sql')}`);
    const after = await ownInventory();
    expect(after).toEqual({ tables: 0, functions: 0, triggers: 0, constraints: 0, indexes: 0 });
    expect(await foreignInventory()).toBe(foreign);
    expect(await count('SELECT count(*) FROM phase2a_sentinel')).toBe(1);

    await runScript(sqlFile('090_rollback.sql')); // rolling back twice is harmless
    await runScript(sqlFile('010_shared_schema.sql'));
    expect((await ownInventory()).tables).toBe(13);
  });

  describe('BrainBase host migration (only the three organisation foreign keys)', () => {
    afterAll(async () => {
      await runScript(hostSqlFile('190_brainbase_host_rollback.sql'));
      await q("DELETE FROM organisations WHERE id LIKE 'host-%'");
    });

    it('adds exactly three foreign keys, idempotently, and reverses cleanly', async () => {
      await resetData(); // VALIDATE would (rightly) refuse rows whose organisation does not exist
      const own = await ownInventory();
      const foreignBefore110 = await foreignInventory();
      await runScript(hostSqlFile('110_brainbase_host.sql'));
      await runScript(hostSqlFile('110_brainbase_host.sql'));
      const fks = await q(`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint
                            WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\\_%' ESCAPE '\\' AND confrelid::regclass::text NOT LIKE 'scheduling\\_%' ESCAPE '\\' ORDER BY 1`);
      expect(fks.rows).toEqual([
        { t: 'scheduling_resources', ref: 'organisations' },
        { t: 'scheduling_schedules', ref: 'organisations' },
        { t: 'scheduling_settings', ref: 'organisations' },
      ]);
      expect((await ownInventory()).constraints).toBe(own.constraints + 3);
      expect(await foreignInventory()).toBe(foreignBefore110); // host tables, columns, indexes and triggers are untouched by the host migration

      // a scheduling row for an organisation that does not exist is now refused; a real one is fine
      await expect(seedSchedule('host-missing', uid('s'))).rejects.toMatchObject({ code: '23503' });
      // Use an organisation that already exists (a real BrainBase copy has several, with columns this
      // test must not know about); only the throwaway stub used on plain Postgres gets one inserted.
      let real = (await q('SELECT id FROM organisations LIMIT 1')).rows[0]?.id as string | undefined;
      if (!real) {
        await q("INSERT INTO organisations (id, name, slug) VALUES ('host-real', 'Real', 'host-real')");
        real = 'host-real';
      }
      await seedSchedule(real, uid('s'));

      await resetData();
      await runScript(hostSqlFile('190_brainbase_host_rollback.sql'));
      expect((await ownInventory()).constraints).toBe(own.constraints);
      await seedSchedule('host-missing', uid('s')); // a standalone-style tenant works again
      await resetData();
    });
  });
});

describe.skipIf(!hasDatabase)('tenant integrity (composite foreign keys)', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(resetData);

  it('the same ids can exist in two tenants without colliding (ids are unique per tenant)', async () => {
    for (const org of ['org-a', 'org-b']) await seedClass(org, { schedule: 'sched', offering: 'off', occurrence: 'occ' }, 5);
    expect(await count("SELECT count(*) FROM scheduling_offerings WHERE id = 'off'")).toBe(2);
  });

  it('an offering cannot point at another tenant\'s schedule', async () => {
    await seedSchedule('org-b', 'sched-b');
    await expect(seedOffering('org-a', 'off-a', 'sched-b')).rejects.toMatchObject({ code: '23503' });
  });

  it('an occurrence cannot use another tenant\'s resource, and a hold cannot cite another tenant\'s reservation', async () => {
    await seedClass('org-a', { schedule: 's', offering: 'o', occurrence: 'c' }, 5);
    await seedResource('org-b', 'court-b', 'court');
    await expect(seedOccurrence({ id: 'c2', org: 'org-a', offeringId: 'o', capacity: 2, resourceId: 'court-b', startsAt: '2026-12-08T05:30:00Z', endsAt: '2026-12-08T06:30:00Z' })).rejects.toMatchObject({ code: '23503' });
    await expect(q(`INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
                    VALUES ('h', 'org-a', 'court-b', tstzrange(now(), now() + interval '1 hour', '[)'), 'nope')`)).rejects.toMatchObject({ code: '23503' });
  });

  it('a hold cannot cover another tenant\'s resource even when its owner is a valid local occurrence (hold -> resource foreign key)', async () => {
    await seedClass('org-a', { schedule: 's', offering: 'o', occurrence: 'c' }, 5);
    await seedResource('org-b', 'court-b', 'court');
    await expect(q(`INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
                    VALUES ('h-x', 'org-a', 'court-b', tstzrange('2026-12-07T05:30Z', '2026-12-07T06:30Z', '[)'), 'c')`)).rejects.toMatchObject({ code: '23503', constraint: 'scheduling_holds_resource_fk' });
  });

  it('a hold cannot cite another tenant\'s occurrence (hold -> occurrence foreign key)', async () => {
    await seedClass('org-b', { schedule: 's', offering: 'o', occurrence: 'c-b' }, 5);
    await seedResource('org-a', 'court-a', 'court');
    await expect(q(`INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, occurrence_id)
                    VALUES ('h-y', 'org-a', 'court-a', tstzrange('2026-12-07T05:30Z', '2026-12-07T06:30Z', '[)'), 'c-b')`)).rejects.toMatchObject({ code: '23503', constraint: 'scheduling_holds_occurrence_fk' });
  });

  it('a reservation must pair an offering with the schedule it belongs to, and an occurrence with its own offering', async () => {
    await seedClass('org-a', { schedule: 's1', offering: 'o1', occurrence: 'c1' }, 5);
    await seedSchedule('org-a', 's2');
    await seedOffering('org-a', 'o2', 's2', { capacity: 5 });
    const insert = (schedule: string, offering: string, occurrence: string) =>
      q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id, customer_name, timezone,
          local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
         VALUES ($1, 'org-a', $2, 'classes_coaching', 1, $3, 'occurrence', $4, 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`, [uid('r'), schedule, offering, occurrence]);
    await expect(insert('s2', 'o1', 'c1')).rejects.toMatchObject({ code: '23503' }); // wrong schedule for the offering
    await expect(insert('s2', 'o2', 'c1')).rejects.toMatchObject({ code: '23503' }); // occurrence belongs to another offering
    await insert('s1', 'o1', 'c1');
  });
});

describe.skipIf(!hasDatabase)('multiple presets in one organisation', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(resetData);

  it('six schedules, one per preset, coexist and keep their own configuration', async () => {
    const keys = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;
    for (const k of keys) await seedSchedule('org-m', `s-${k}`, k, { publicSlug: k.replace(/_/g, '-') });
    const rows = (await q("SELECT id, preset_key, preset_version, cancellation_policy FROM scheduling_schedules WHERE organisation_id = 'org-m' ORDER BY id")).rows;
    expect(rows.map(r => r.preset_key).sort()).toEqual([...keys].sort());
    // editing one schedule's policy changes only that row
    await q(`UPDATE scheduling_schedules SET cancellation_policy = '{"customerCanCancel": false, "freeCancellationHoursBefore": null, "lateCancellationCharge": {"kind": "none"}}'::jsonb WHERE organisation_id = 'org-m' AND id = 's-appointments'`);
    const after = (await q("SELECT id, cancellation_policy FROM scheduling_schedules WHERE organisation_id = 'org-m' ORDER BY id")).rows;
    for (const r of after) {
      const was = rows.find(x => x.id === r.id)!;
      if (r.id === 's-appointments') expect(r.cancellation_policy).not.toEqual(was.cancellation_policy);
      else expect(r.cancellation_policy).toEqual(was.cancellation_policy);
    }
  });

  it('public slugs are unique per organisation but free across organisations', async () => {
    await seedSchedule('org-m', 's1', 'classes_coaching', { publicSlug: 'book' });
    await expect(seedSchedule('org-m', 's2', 'appointments', { publicSlug: 'book' })).rejects.toMatchObject({ code: '23505' });
    await seedSchedule('org-n', 's1', 'classes_coaching', { publicSlug: 'book' });
  });

  it('a schedule timezone override is validated against the database timezone list; null inherits', async () => {
    await seedSchedule('org-m', 's-perth', 'appointments', { timezone: 'Australia/Perth' });
    await seedSchedule('org-m', 's-inherit', 'appointments', { timezone: null });
    await expect(seedSchedule('org-m', 's-bad', 'appointments', { timezone: 'Mars/Olympus' })).rejects.toMatchObject({ code: '23514' });
  });
});

const resRow = (over: Record<string, unknown> = {}) => ({
  id: uid('r'), org: 'org-l', sched: 's', off: 'o', occ: 'c', name: 'Pat', email: 'pat@example.com', emailNorm: 'pat@example.com', party: 1,
  status: 'confirmed', start: '2026-12-07T05:30:00Z', end: '2026-12-07T06:30:00Z', ...over,
});
const insertReservation = (o: ReturnType<typeof resRow>) =>
  q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id, customer_name, customer_email, customer_email_normalised,
        timezone, local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, status, currency)
     VALUES ($1, $2, $3, 'classes_coaching', 1, $4, 'occurrence', $5, $6, $7, $8, 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', $9::timestamptz, $10::timestamptz, $11, $12, 'AUD')`,
    [o.id, o.org, o.sched, o.off, o.occ, o.name, o.email, o.emailNorm, o.start, o.end, o.party, o.status]);

describe.skipIf(!hasDatabase)('reservation lifecycle and snapshot constraints', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);
  beforeEach(async () => {
    await resetData();
    await seedClass('org-l', { schedule: 's', offering: 'o', occurrence: 'c' }, 5);
  });

  const update = (id: string, set: string, params: unknown[] = []) => q(`UPDATE scheduling_reservations SET ${set} WHERE organisation_id = 'org-l' AND id = $1`, [id, ...params]);
  const make = async (over: Record<string, unknown> = {}) => {
    const r = resRow(over);
    await insertReservation(r);
    return r.id;
  };

  it('allowed transitions: pending -> confirmed -> completed; confirmed -> no_show; any live -> cancelled', async () => {
    const a = await make({ status: 'pending', email: 'a@x.com', emailNorm: 'a@x.com' });
    await update(a, "status = 'confirmed'");
    await update(a, "status = 'completed'");
    const b = await make({ email: 'b@x.com', emailNorm: 'b@x.com' });
    await update(b, "status = 'no_show'");
    const c = await make({ status: 'pending', email: 'c@x.com', emailNorm: 'c@x.com' });
    await update(c, "status = 'cancelled'");
    expect((await q('SELECT cancelled_at FROM scheduling_reservations WHERE id = $1', [c])).rows[0].cancelled_at).not.toBeNull(); // set by the trigger
  });

  it('illegal transitions are refused with SCLIF: nothing leaves a terminal state or goes backwards', async () => {
    const cancelled = await make({ email: 'a@x.com', emailNorm: 'a@x.com' });
    await update(cancelled, "status = 'cancelled'");
    const done = await make({ email: 'b@x.com', emailNorm: 'b@x.com' });
    await update(done, "status = 'completed'");
    const live = await make({ email: 'c@x.com', emailNorm: 'c@x.com' });
    for (const [id, to] of [[cancelled, 'confirmed'], [cancelled, 'pending'], [done, 'cancelled'], [done, 'confirmed'], [live, 'pending']] as const) {
      await expect(update(id, `status = '${to}', cancelled_at = NULL`)).rejects.toMatchObject({ code: 'SCLIF' });
    }
  });

  it('a reservation cannot be created cancelled, completed or no_show', async () => {
    for (const status of ['cancelled', 'completed', 'no_show']) {
      await expect(insertReservation(resRow({ status }))).rejects.toMatchObject({ code: expect.stringMatching(/SCLIF|23514/) });
    }
  });

  it('the booking snapshot is immutable: customer, preset, version, window, party size, price', async () => {
    const id = await make();
    for (const set of ["customer_name = 'Someone Else'", "customer_email = 'x@y.com', customer_email_normalised = 'x@y.com'", "customer_phone = '0400'", 'preset_version = 2',
      "preset_key = 'event_capacity'", "timezone = 'Australia/Perth'", "starts_at = starts_at + interval '1 hour'", "ends_at = ends_at + interval '1 hour'", 'party_size = 2', 'price_cents = 10', "currency = 'USD'", "local_start_time = '09:00'"]) {
      await expect(update(id, set), set).rejects.toMatchObject({ code: 'SCIMM' });
    }
    const row = (await q('SELECT customer_name, party_size FROM scheduling_reservations WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ customer_name: 'Pat', party_size: 1 });
  });

  it('staff may link a customer-less booking to a customer later, but never re-point a linked one', async () => {
    const id = await make();
    await update(id, "customer_id = 'cust-1'");
    await expect(update(id, "customer_id = 'cust-2'")).rejects.toMatchObject({ code: 'SCIMM' });
    await expect(update(id, 'customer_id = NULL')).rejects.toMatchObject({ code: 'SCIMM' });
  });

  it('mutable fields still change: attendance, payment status, notes', async () => {
    const id = await make();
    await update(id, "attendance = 'attended', payment_status = 'paid', notes = 'bring racket'");
    expect((await q('SELECT attendance, payment_status, notes FROM scheduling_reservations WHERE id = $1', [id])).rows[0]).toEqual({ attendance: 'attended', payment_status: 'paid', notes: 'bring racket' });
  });

  it('the normalised email must really be lower(btrim(email)); a mismatch is a CHECK violation', async () => {
    await expect(insertReservation(resRow({ email: 'Pat@Example.com', emailNorm: 'Pat@Example.com' }))).rejects.toMatchObject({ code: '23514' });
    await insertReservation(resRow({ email: ' Pat@Example.com ', emailNorm: 'pat@example.com' }));
  });

  it('duplicate guards are partial: a cancelled booking does not block the same person again; a name never matches', async () => {
    const first = await make();
    await expect(insertReservation(resRow())).rejects.toMatchObject({ code: '23505', constraint: 'scheduling_reservations_dup_email_uk' });
    await insertReservation(resRow({ email: 'other@example.com', emailNorm: 'other@example.com', name: 'Pat' })); // same name, different person
    await update(first, "status = 'cancelled'");
    await insertReservation(resRow());
  });

  it('exactly one target (occurrence XOR resource) and a matching span kind', async () => {
    await expect(q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, customer_name, timezone,
      local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
      VALUES ('x', 'org-l', 's', 'classes_coaching', 1, 'o', 'occurrence', 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', now(), now() + interval '1 hour', 1, 'AUD')`)).rejects.toMatchObject({ code: '23514' });
  });

  it('a reservation window must match its occurrence (SCWIN) and a closed occurrence takes no bookings (SCCLS)', async () => {
    await expect(insertReservation(resRow({ start: '2026-12-07T06:30:00Z', end: '2026-12-07T07:30:00Z' }))).rejects.toMatchObject({ code: 'SCWIN' });
    await q("UPDATE scheduling_occurrences SET status = 'completed' WHERE id = 'c'");
    await expect(insertReservation(resRow())).rejects.toMatchObject({ code: 'SCCLS' });
  });

  it('an occurrence is immutable apart from status/capacity, cannot be reopened, and capacity cannot drop below the live headcount', async () => {
    await make({ party: 3, email: 'a@x.com', emailNorm: 'a@x.com' });
    await expect(q("UPDATE scheduling_occurrences SET starts_at = starts_at + interval '1 hour' WHERE id = 'c'")).rejects.toMatchObject({ code: 'SCIMM' });
    await expect(q('UPDATE scheduling_occurrences SET capacity = 2 WHERE id = \'c\'')).rejects.toMatchObject({ code: 'SCCAP' });
    await q('UPDATE scheduling_occurrences SET capacity = 3 WHERE id = \'c\'');
    await q("UPDATE scheduling_occurrences SET status = 'cancelled' WHERE id = 'c'");
    await expect(q("UPDATE scheduling_occurrences SET status = 'scheduled' WHERE id = 'c'")).rejects.toMatchObject({ code: 'SCLIF' });
  });

  describe('resource holds', () => {
    const slotInsert = (id: string, extra = '') =>
      q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, resource_id, customer_name, timezone,
          local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
         VALUES ($1, 'org-l', 's-hire', 'resource_hire', 1, 'o-hire', 'slot', 'court-1', 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD') ${extra}`, [id]);

    // 031 ties a reservation to the preset of its schedule and the resource to its offering, so each preset gets its own schedule here
    const OF: Record<string, [string, string]> = { resource_hire: ['s-hire', 'o-hire'], appointments: ['s-appt', 'o-appt'], accommodation: ['s-stay', 'o-stay'], classes_coaching: ['s', 'o'] };
    beforeEach(async () => {
      await seedResource('org-l', 'court-1', 'court');
      for (const [preset, [s, o]] of Object.entries(OF)) {
        if (preset === 'classes_coaching') continue;
        await seedSchedule('org-l', s, preset as never);
        await seedOffering('org-l', o, s, { capacity: null });
      }
      await seedResource('org-l', 'room-9', 'room');
      for (const [o, r] of [['o-hire', 'court-1'], ['o-stay', 'room-9'], ['o', 'court-1']]) await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', ['org-l', o, r]);
    });

    it('an exclusive reservation inserted WITHOUT a hold is refused at the end of the statement (SCHLD)', async () => {
      await expect(slotInsert('no-hold')).rejects.toMatchObject({ code: 'SCHLD' });
      expect(await count("SELECT count(*) FROM scheduling_reservations WHERE id = 'no-hold'")).toBe(0);
    });

    it('the preset decides the span: an appointment can only be a slot with a concrete resource, never an occurrence or a resourceless slot', async () => {
      const insert = (preset: string, span: string, target: string) =>
        q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, ${target.split('=')[0]}, customer_name, timezone,
            local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
           VALUES ('x', 'org-l', $3, $1, 2, $4, $2, ${target.split('=')[1]}, 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`, [preset, span, ...OF[preset]]);
      // an appointment as a headcount occurrence booking
      await expect(insert('appointments', 'occurrence', "occurrence_id='oc'")).rejects.toMatchObject({ code: '23514' });
      // an appointment slot with no resource (neither target set) is refused by the one-target rule
      await expect(
        q(`INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, customer_name, timezone,
            local_start_date, local_start_time, local_end_date, local_end_time, starts_at, ends_at, party_size, currency)
           VALUES ('y', 'org-l', 's-appt', 'appointments', 2, 'o-appt', 'slot', 'X', 'Australia/Adelaide', '2026-12-07', '16:00', '2026-12-07', '17:00', '2026-12-07T05:30:00Z', '2026-12-07T06:30:00Z', 1, 'AUD')`),
      ).rejects.toMatchObject({ code: '23514' });
      // a stay preset cannot be a slot, a headcount preset cannot be a slot
      await expect(insert('accommodation', 'slot', "resource_id='room-9'")).rejects.toMatchObject({ code: '23514' });
      await expect(insert('classes_coaching', 'slot', "resource_id='court-1'")).rejects.toMatchObject({ code: '23514' });
      expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
    });

    it('a hold must have exactly one owner and a half-open, bounded, non-empty range', async () => {
      const hold = (during: string, owner: string) =>
        q(`INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, ${owner}) VALUES ('h', 'org-l', 'court-1', ${during}, 'c')`);
      await expect(hold("tstzrange('2026-12-07T05:30Z', '2026-12-07T06:30Z', '[]')", 'occurrence_id')).rejects.toMatchObject({ code: '23514' }); // inclusive upper
      await expect(hold("tstzrange('2026-12-07T05:30Z', '2026-12-07T05:30Z', '[)')", 'occurrence_id')).rejects.toMatchObject({ code: '23514' }); // empty
      await expect(hold("tstzrange('2026-12-07T05:30Z', NULL, '[)')", 'occurrence_id')).rejects.toMatchObject({ code: '23514' }); // unbounded
      await expect(q(`INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during) VALUES ('h', 'org-l', 'court-1', tstzrange(now(), now() + interval '1 hour', '[)'))`)).rejects.toMatchObject({ code: '23514' }); // no owner
    });

    it('a hold\'s identity is immutable; only releasing it is allowed, and a release is final', async () => {
      await seedOccurrence({ id: 'c-court', org: 'org-l', offeringId: 'o', capacity: 2, resourceId: 'court-1', startsAt: '2026-12-08T05:30:00Z', endsAt: '2026-12-08T06:30:00Z' });
      const hold = (await q("SELECT id FROM scheduling_resource_holds WHERE occurrence_id = 'c-court'")).rows[0].id;
      await expect(q("UPDATE scheduling_resource_holds SET during = tstzrange('2026-12-09T05:30Z', '2026-12-09T06:30Z', '[)') WHERE id = $1", [hold])).rejects.toMatchObject({ code: 'SCIMM' });
      await expect(q("UPDATE scheduling_resource_holds SET resource_id = 'other' WHERE id = $1", [hold])).rejects.toMatchObject({ code: expect.stringMatching(/SCIMM|23503/) });
      await q('UPDATE scheduling_resource_holds SET released_at = now() WHERE id = $1', [hold]);
      await expect(q('UPDATE scheduling_resource_holds SET released_at = NULL WHERE id = $1', [hold])).rejects.toMatchObject({ code: 'SCREA' });
      await expect(q("UPDATE scheduling_resource_holds SET released_at = now() + interval '1 day' WHERE id = $1", [hold])).rejects.toMatchObject({ code: 'SCIMM' });
    });

    it('the exclusion constraint is partial: releasing a hold frees the range at the SQL level too', async () => {
      await seedOccurrence({ id: 'c-a', org: 'org-l', offeringId: 'o', capacity: 2, resourceId: 'court-1', startsAt: '2026-12-08T05:30:00Z', endsAt: '2026-12-08T06:30:00Z' });
      await expect(seedOccurrence({ id: 'c-b', org: 'org-l', offeringId: 'o', capacity: 2, resourceId: 'court-1', startsAt: '2026-12-08T06:00:00Z', endsAt: '2026-12-08T07:00:00Z' })).rejects.toMatchObject({ code: '23P01' });
      await q("UPDATE scheduling_occurrences SET status = 'cancelled' WHERE id = 'c-a'"); // trigger releases the hold
      await seedOccurrence({ id: 'c-b', org: 'org-l', offeringId: 'o', capacity: 2, resourceId: 'court-1', startsAt: '2026-12-08T06:00:00Z', endsAt: '2026-12-08T07:00:00Z' });
    });
  });
});
