/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
// Neon proof for scripts/add-booking-capacity-guard.sql, run through the REAL Neon drivers.
//
// NOT part of CI. Run it only against a DISPOSABLE Neon branch with a throwaway role (never Production):
//   BK_URL=postgresql://<throwaway-role>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require \
//   NODE_PATH=$(pwd)/node_modules node scripts/tests/neon-booking-capacity-guard-proof.cjs
// The password is read from BK_URL; nothing secret is stored here. The script creates and drops its own
// scratch schema (bk_proof) and never touches public.* tables. Results from the 2026-10-21 run are recorded in
// docs/architecture/ld-tennis-booking-capacity-guard.md (section 5).

// Disposable-branch proof for the booking capacity guard, run through the REAL Neon drivers.
// Throwaway role on a throwaway branch; creates and drops its own scratch schema; never touches
// public.* tables. The migration text under test is the unmodified scripts/add-booking-capacity-guard.sql
// with only the schema name re-targeted.
const fs = require('fs');
const { neon, Pool, neonConfig } = require('@neondatabase/serverless');
try { neonConfig.webSocketConstructor = require('ws'); } catch (e) { /* Node 24 has a global WebSocket */ }

const NL = String.fromCharCode(10);
const POOLED = process.env.BK_URL;                 // ...-pooler host (PgBouncer, transaction mode)
const DIRECT = POOLED.split('-pooler').join('');   // direct compute host
const S = 'bk_proof';

// Strip comments first, THEN re-target the schema (comments contain the same words).
const stripped = fs.readFileSync((process.env.GUARD_SQL || require("path").join(__dirname, "..", "add-booking-capacity-guard.sql")), 'utf8').split(String.fromCharCode(13)).join('')
  .split(NL).filter(l => !l.trim().startsWith('--')).join(NL).replace("SET lock_timeout = '5s';", '');
let guardSql = stripped
  .split('public.bookings').join(S + '.bookings')
  .split('public.booking_capacity_guard').join(S + '.booking_capacity_guard')
  .split('FROM session_instances').join('FROM ' + S + '.session_instances')
  .split('FROM bookings').join('FROM ' + S + '.bookings');
if (guardSql.indexOf('public.') !== -1 || guardSql.indexOf('FROM ' + S + '.bookings') === -1 || guardSql.indexOf('FROM ' + S + '.session_instances') === -1) {
  throw new Error('guard retargeting failed');
}
const fnStart = guardSql.indexOf('CREATE OR REPLACE FUNCTION');
const fnEnd = guardSql.indexOf('$$;', guardSql.indexOf('AS $$') + 5) + 2;
const fnSql = guardSql.slice(fnStart, fnEnd);
const restSql = (guardSql.slice(0, fnStart) + guardSql.slice(fnEnd + 1)).split(';').map(x => x.trim()).filter(Boolean);

const log = (...a) => console.log(...a);
const ok = (name, cond, extra) => { log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };
const tally = arr => arr.reduce((a, x) => { a[x] = (a[x] || 0) + 1; return a; }, {});

async function main() {
  const sqlP = neon(POOLED);
  const sqlD = neon(DIRECT);
  const q = (text, params) => sqlP.query(text, params || []);

  await q('DROP SCHEMA IF EXISTS ' + S + ' CASCADE');
  await q('CREATE SCHEMA ' + S);
  ok('role creates its own scratch schema (no grants needed)', true);
  const v = await q("SELECT version() AS v, current_setting('default_transaction_isolation') AS iso");
  log('     ', v[0].v.split(' on ')[0], '| default isolation:', v[0].iso);

  await q('CREATE TABLE ' + S + '.sessions (id text PRIMARY KEY, organisation_id text, name text, max_capacity int)');
  await q('CREATE TABLE ' + S + ".session_instances (id text PRIMARY KEY, session_id text REFERENCES " + S + ".sessions(id), organisation_id text, date date, max_capacity int NOT NULL, status text NOT NULL DEFAULT 'scheduled')");
  await q('CREATE TABLE ' + S + ".bookings (id text PRIMARY KEY, organisation_id text NOT NULL, client_name text NOT NULL, client_email text, status text NOT NULL DEFAULT 'pending_confirmation', session_id text, session_instance_id text REFERENCES " + S + '.session_instances(id))');
  await q('CREATE INDEX ON ' + S + '.bookings (session_instance_id)');
  await q('INSERT INTO ' + S + ".sessions VALUES ('s1','org','S',5)");

  let n = 0;
  const newInstance = async cap => { const id = 'i' + (++n); await q('INSERT INTO ' + S + ".session_instances (id, session_id, organisation_id, date, max_capacity) VALUES ($1,'s1','org','2026-12-07',$2)", [id, cap]); return id; };
  const live = async id => Number((await q('SELECT COUNT(*)::int AS c FROM ' + S + ".bookings WHERE session_instance_id=$1 AND status<>'cancelled'", [id]))[0].c);
  // The application's exact shape: separate HTTP statements, count then insert.
  const appBooking = async (sql, inst, cap, who, skipPrecheck) => {
    if (!skipPrecheck) {
      const c = Number((await sql.query('SELECT COUNT(*)::int AS c FROM ' + S + ".bookings WHERE session_instance_id=$1 AND status<>'cancelled'", [inst]))[0].c);
      if (c >= cap) return 'full';
    }
    try {
      await sql.query('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ($1,'org',$2,'confirmed',$3)", ['b' + (++n), who, inst]);
      return 'ok';
    } catch (e) { return e.code === 'BKCAP' ? 'BKCAP' : 'ERR:' + e.code + ':' + e.message; }
  };

  // 1. CONTROL: no guard, real Neon HTTP driver on the pooled host.
  const cap = 5, N = 30;
  let inst = await newInstance(cap);
  let res = await Promise.all(Array.from({ length: N }, (_, i) => appBooking(sqlP, inst, cap, 'c' + i)));
  let liveN = await live(inst);
  log('     control (no guard) outcomes:', JSON.stringify(tally(res)), 'live =', liveN, 'capacity =', cap);
  ok('CONTROL: without the guard the race overbooks on the Neon HTTP driver (pooled host)', liveN > cap, 'live=' + liveN + ' > capacity=' + cap);

  // 2. Apply the real migration twice (idempotency).
  const applyGuard = async () => { await q(fnSql); for (const st of restSql) await q(st); };
  await applyGuard();
  await applyGuard();
  const trg = await q("SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='" + S + ".bookings'::regclass AND NOT tgisinternal");
  ok('migration applies twice (idempotent); exactly one trigger, enabled', trg.length === 1 && trg[0].tgname === 'bookings_capacity_guard' && trg[0].tgenabled === 'O');

  // 3. GUARD with the application's exact flow, both hosts.
  for (const [label, sql] of [['pooled host', sqlP], ['direct host', sqlD]]) {
    inst = await newInstance(cap);
    res = await Promise.all(Array.from({ length: N }, (_, i) => appBooking(sql, inst, cap, 'g' + i)));
    liveN = await live(inst);
    const t = tally(res);
    log('     guard on, ' + label + ', outcomes:', JSON.stringify(t), 'live =', liveN);
    ok('GUARD (' + label + '): never exceeds capacity', liveN === cap, 'live=' + liveN);
    ok('GUARD (' + label + '): refusals arrive as full (pre-check) or error.code === BKCAP, never another error', Object.keys(t).every(k => ['ok', 'full', 'BKCAP'].indexOf(k) !== -1));
  }

  // 4. Insert storm with the pre-check removed: the trigger alone must hold the line.
  inst = await newInstance(3);
  res = await Promise.all(Array.from({ length: 40 }, (_, i) => appBooking(sqlP, inst, 3, 's' + i, true)));
  liveN = await live(inst);
  log('     insert storm (no pre-check), outcomes:', JSON.stringify(tally(res)), 'live =', liveN);
  ok('GUARD alone holds: 40 parallel inserts into a capacity-3 instance', liveN === 3 && tally(res).BKCAP === 37);

  // 5. Semantics.
  inst = await newInstance(1);
  await q('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ('hist1','org','h','cancelled',$1)", [inst]);
  await q('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ('live1','org','l','confirmed',$1)", [inst]);
  let code = null;
  try { await q('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ('live2','org','l2','confirmed',$1)", [inst]); } catch (e) { code = e.code; }
  ok('cancelled rows do not count; a second live row is refused with SQLSTATE BKCAP on NeonDbError', code === 'BKCAP', 'code=' + code);
  await q('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status) VALUES ('solo','org','s','pending_confirmation')");
  ok('bookings without an instance are not limited', true);
  await q('UPDATE ' + S + ".bookings SET status='cancelled' WHERE id='live1'");
  await q('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ('live3','org','l3','confirmed',$1)", [inst]);
  ok('cancelling frees the place', (await live(inst)) === 1);

  // 6. Deadlock check: reconcile-style UPDATEs and cancels alongside inserts.
  inst = await newInstance(3);
  const work = [];
  for (let i = 0; i < 24; i++) {
    work.push(appBooking(sqlP, inst, 3, 'd' + i));
    if (i % 3 === 0) {
      work.push(sqlP.query('UPDATE ' + S + '.session_instances SET max_capacity = 3 WHERE id=$1', [inst]).then(() => 'upd'));
      work.push(sqlP.query('UPDATE ' + S + ".bookings SET status='cancelled' WHERE session_instance_id=$1 AND client_name='d0'", [inst]).then(() => 'cxl'));
    }
  }
  const out = await Promise.allSettled(work);
  const bad = out.filter(o => o.status === 'rejected' || String(o.value).indexOf('ERR') === 0);
  ok('no deadlock or unexpected error with concurrent UPDATEs and cancels', bad.length === 0, JSON.stringify(bad.map(b => b.value || String(b.reason))));
  ok('and the count stays within capacity', (await live(inst)) <= 3);

  // 7. The alternative: interactive transactions need a second, WebSocket driver. Compare the lock alone.
  await q('ALTER TABLE ' + S + '.bookings DISABLE TRIGGER bookings_capacity_guard');
  for (const [label, url] of [['pooled host', POOLED], ['direct host', DIRECT]]) {
    const pool = new Pool({ connectionString: url, max: 20 });
    inst = await newInstance(cap);
    const one = async who => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query('SELECT max_capacity FROM ' + S + '.session_instances WHERE id=$1 FOR UPDATE', [inst]);
        const cnt = Number((await c.query('SELECT COUNT(*)::int AS c FROM ' + S + ".bookings WHERE session_instance_id=$1 AND status<>'cancelled'", [inst])).rows[0].c);
        if (cnt >= r.rows[0].max_capacity) { await c.query('ROLLBACK'); return 'full'; }
        await c.query('INSERT INTO ' + S + ".bookings (id, organisation_id, client_name, status, session_instance_id) VALUES ($1,'org',$2,'confirmed',$3)", ['t' + (++n), who, inst]);
        await c.query('COMMIT'); return 'ok';
      } catch (e) { try { await c.query('ROLLBACK'); } catch (e2) { /* ignore */ } return 'ERR:' + (e.code || e.message); }
      finally { c.release(); }
    };
    const rr = await Promise.all(Array.from({ length: 30 }, (_, i) => one('w' + i)));
    const lv = await live(inst);
    log('     interactive transaction via WebSocket Pool (' + label + '), outcomes:', JSON.stringify(tally(rr)), 'live =', lv);
    ok('INTERACTIVE TX (' + label + ', SELECT FOR UPDATE) also holds capacity', lv === cap && !rr.some(x => String(x).indexOf('ERR') === 0));
    await pool.end();
  }
  await q('ALTER TABLE ' + S + '.bookings ENABLE TRIGGER bookings_capacity_guard');

  await q('DROP SCHEMA ' + S + ' CASCADE');
  log('scratch schema dropped');
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
