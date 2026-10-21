/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script run outside the Next.js build, like the other scripts/tests/*.cjs proofs */
// Phase 2A manual-migration rehearsal against a DISPOSABLE Neon branch.
//
// Runs the migration package in the documented order over a DIRECT connection and prints the
// result of each step so it can be compared with the EXPECTED notes in the SQL files.
// Reads SCHED_DIRECT only (a postgres:// URL for a throwaway role on a throwaway branch).
// Never reads DATABASE_URL, so it cannot reach the application's database by accident.
//
//   SCHED_DIRECT=postgres://... node scripts/tests/rehearse-scheduling-2a-neon.cjs [--with-host]
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const url = process.env.SCHED_DIRECT;
if (!url) {
  console.error('SCHED_DIRECT is required');
  process.exit(2);
}
const root = path.resolve(__dirname, '../..');
const shared = f => fs.readFileSync(path.join(root, 'packages/scheduling/sql', f), 'utf8');
const host = f => fs.readFileSync(path.join(root, 'scripts/scheduling', f), 'utf8');
const withHost = process.argv.includes('--with-host');

const inventory = `SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public')::int AS tables,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')::int AS functions,
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)::int AS triggers,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'scheduling\\_%')::int AS scheduling_tables`;

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = async sql => (await c.query(sql)).rows;
  const out = [];
  const step = (name, ok, detail) => {
    out.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`);
  };
  const run = async (name, sql) => {
    try {
      await c.query(sql);
      step(name, true);
      return true;
    } catch (e) {
      step(name, false, { code: e.code, message: e.message });
      return false;
    }
  };

  const before = (await rows(inventory))[0];
  console.log('baseline', JSON.stringify(before));
  console.log('server', (await rows('select version()'))[0].version.slice(0, 40));

  const pre = await c.query(shared('001_preflight.sql'));
  step('001 preflight runs (read-only)', Array.isArray(pre) && pre.length >= 8, { statements: pre.length });
  const priv = pre[3].rows[0];
  step('preflight 4: role may create objects and the extension', priv.can_create_schema && priv.can_create_in_public && priv.can_create_extension, priv);

  await run('010 shared migration, first apply', shared('010_shared_schema.sql'));
  await run('010 shared migration, second apply (idempotent)', shared('010_shared_schema.sql'));
  const after = (await rows(inventory))[0];
  step('inventory delta is +13 tables, +11 functions, +16 triggers', after.tables === before.tables + 13 && after.functions === before.functions + 11 && after.triggers === before.triggers + 16, after);

  const ver = await c.query(shared('020_verify.sql'));
  step('020 verification runs', Array.isArray(ver) && ver.length >= 8, { statements: ver.length });
  step('verify 1: version marker 2a.1', ver[0].rows.length === 1 && ver[0].rows[0].version === '2a.1');
  step('verify 2: 13 tables, all empty but the marker', ver[1].rows.length === 13 && ver[1].rows.every(r => (r.table_name === 'scheduling_schema_migrations' ? r.row_count === '1' : r.row_count === '0')));
  step('verify 4: exclusion constraint definition', /EXCLUDE USING gist \(organisation_id WITH =, resource_id WITH =, during WITH &&\) WHERE \(\(released_at IS NULL\)\)/.test(ver[3].rows[0].definition));
  step('verify 5: btree_gist installed', ver[4].rows.length === 1, ver[4].rows[0]);
  step('verify 6: 16 triggers, all enabled', ver[5].rows.length === 16 && ver[5].rows.every(r => r.tgenabled === 'O'));
  step('verify 7: no foreign key to a host table before the host migration', ver[6].rows.length === 0);
  step('verify 8: no dependency on LD Tennis / CRM tables', ver[7].rows[0].legacy_dependencies === '0' || ver[7].rows[0].legacy_dependencies === 0);

  if (withHost) {
    await run('110 BrainBase host migration, first apply', host('110_brainbase_host.sql'));
    await run('110 second apply (idempotent)', host('110_brainbase_host.sql'));
    const fks = await rows(`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\\_%' AND confrelid::regclass::text NOT LIKE 'scheduling\\_%' ORDER BY 1`);
    step('host migration added exactly 3 FKs, all to organisations', fks.length === 3 && fks.every(r => r.ref === 'organisations'), fks);
    await run('190 host rollback', host('190_brainbase_host_rollback.sql'));
    const none = await rows(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text LIKE 'scheduling\\_%' AND confrelid::regclass::text NOT LIKE 'scheduling\\_%'`);
    step('host rollback removed them', none[0].n === 0);
    await run('110 re-apply after rollback', host('110_brainbase_host.sql'));
  }

  const failed = out.filter(o => !o.ok).length;
  console.log(failed === 0 ? '\nREHEARSAL STEPS: ALL PASS' : `\nREHEARSAL STEPS: ${failed} FAILED`);
  await c.end();
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
