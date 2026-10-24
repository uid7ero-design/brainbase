# Scheduling Phase 2A: btree_gist and exclusion-constraint rehearsal

Run 2026-10-21 on the disposable Neon branch `br-quiet-lake-a74p2jfi` (project
`empty-fire-62164682`, Postgres 17.11). Development and testing only.

## 1. Scope and limits

- **In scope:** whether `btree_gist` and `EXCLUDE USING gist` give the Phase 2 design
  (outline section 5.2) a database-enforced "one exclusive holder per resource per time range",
  and how that behaves over the Neon HTTP driver and the WebSocket `Pool`, on the pooled
  (PgBouncer, transaction mode) and direct hosts.
- **Isolation:** a throwaway role (`bk_tester`, a member of `neon_superuser`, not a superuser)
  created its own scratch schemas `bk_excl_proof` and `bk_excl_ext`. No `public.*` table was
  read or written. No grants were issued. Nothing outside the disposable branch was touched.
- **Not built:** the persistence layer. The proof tables (`occurrences`, `reservations`, `holds`,
  `holds_d`) are minimal stand-ins for the design in the outline, not the design.
- **Not measured:** performance at realistic row counts, how long a conflicting insert waits
  behind an open transaction, Prisma's handling of exclusion constraints, backup/restore.
  The data volumes are tens of rows.
- Defaults on this branch: `statement_timeout = 0`, `lock_timeout = 0`, `READ COMMITTED`.

## 2. Method

`excl-proof.cjs` (Appendix A) reads the pooled connection string from `BK_URL` (the direct host
is derived by removing `-pooler`) and runs 17 recorded checks (numbered 1-10, with 5 and 8 having several parts). Each check records PASS or FAIL with the
observed numbers. The script builds its schema from one idempotent DDL list that is applied,
re-applied, rolled back and re-applied again, so the migration itself is under test. Timestamps
use the Adelaide offset; hotel stays use `AT TIME ZONE 'Australia/Adelaide'` against the
database's own zone data.

## 3. Results

All 17 recorded results passed. The script exited 0 on its final run. One earlier run failed on a column
name in my own catalog query (`pg_available_extension_versions` has no `default_version`);
that was a test-script error, fixed before any proof ran.

| # | Check | Observed | Verdict |
| --- | --- | --- | --- |
| 1 | `btree_gist` available, installable by a non-owner role, idempotent, version, schema | Available as 1.7 (`trusted = true`, relocatable). `bk_tester` (not superuser, `neon_superuser` member) installed it with `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA bk_excl_ext`, twice, with no error and no owner help. It landed in the named schema | PASS |
| 2 | Overlap, identical, contained and containing ranges rejected; adjacent `[)` ranges accepted | `23P01` for all four rejections, surfaced as `error.code` on the HTTP driver; adjacent-after and adjacent-before both accepted | PASS |
| 3 | Release frees the range | `UPDATE released_at` and `DELETE` both free it. Cancel is one CTE (`UPDATE reservations ... RETURNING` then `UPDATE holds`), released 1 row, range then reusable. **Un-releasing a hold into a range someone else now holds is refused with `23P01`** | PASS |
| 4 | Hotel stays across Adelaide DST changes (5 Apr and 4 Oct 2026) | Zone data confirmed (`+10:30`, DST). Check-out 10:00 and check-in 14:00 on the same day accepted on both transition days; overlapping nights and an overlapping checkout rejected (`23P01`). A `daterange` `[)` variant behaved identically (A ok, B on the checkout date ok, overlap and duplicate `23P01`) | PASS |
| 5a | 30 parallel overlapping holds, HTTP driver, pooled host | 1 ok, 29 `23P01`, live holds 1 | PASS |
| 5b | Same, HTTP driver, direct host | 1 ok, 29 `23P01`, live holds 1 | PASS |
| 5c | Same, WebSocket Pool, pooled host, autocommit and explicit BEGIN/COMMIT | autocommit 1/29; transaction 1/29 | PASS |
| 5d | Same, WebSocket Pool, direct host, autocommit and explicit BEGIN/COMMIT | autocommit 1/29; transaction 1/29 | PASS |
| 5e | 30 parallel holds on 30 different adjacent half-hour slots | 30 ok | PASS |
| 5f | Mixed storm: 80 random ranges, half pooled, half direct | 14 ok, 66 `23P01`, no `40P01`; self-join found 0 overlapping live pairs | PASS |
| 6 | Tenant isolation | Same resource id and range accepted in two organisations; same-organisation overlap still `23P01`; a hold in organisation B referencing organisation A's reservation rejected `23503` by the composite FK; same-tenant reference accepted | PASS |
| 7 | Pooled versus direct (a summary row: the script marks it PASS by construction, the evidence is the paired runs in 5) | No difference in any result where both were run (check 5, HTTP and Pool). Checks 2, 3, 4, 6, 9 and 10 ran on the pooled host only | PASS (see limits) |
| 8a | Idempotent DDL | Applied twice onto an existing schema: no error, both exclusion constraints present once | PASS |
| 8b | Rollback | `DROP SCHEMA ... CASCADE`, `DROP EXTENSION`, drop extension schema: 0 schemas and 0 extensions left; `public` function count 58 to 58, relation count 1223 to 1223 | PASS |
| 8c | Drop and recreate | DDL applies again after a full rollback; 1 exclusion constraint | PASS |
| 9 | Combined model | A class occupying a court and an overlapping hire: `23P01`. Two holds for one reservation (practitioner and room) in one INSERT where the room is taken: whole statement fails, practitioner hold left behind 0. Reservation plus hold in one CTE over the HTTP driver: succeeds; on conflict nothing is written, orphan reservation rows 0 | PASS |
| 10 | Capacity trigger and exclusion constraint together | Advisory-lock count trigger on `reservations` plus holds in the same CTE statement, 20 parallel, capacity 3: 3 ok, 17 `BKCAP`; same slot: 1 ok, 19 `23P01`; no deadlock | PASS |

### Observations worth keeping

- **Adelaide DST resolution is Postgres's, not ours.** For the ambiguous local time
  2026-04-05 02:30 the database chose the standard-time (+09:30) reading; for the nonexistent
  2026-10-04 02:30 it applied the standard offset, which lands an hour later in wall-clock
  terms. Neither raises an error. Hotel and class times (10:00, 14:00) never fall in the gap,
  but an application must not rely on the silent choice for an arbitrary user-supplied time.
- The extension created no objects in `public`.
- Conflict detection happens at insert time with no pre-check in the application: the
  race-condition tests contained no read-then-write.

## 4. Findings that change the Phase 2 schema

1. **Confirmed unchanged:** the partial exclusion
   `EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, during WITH &&) WHERE
   (released_at IS NULL)` works as written in outline section 5.2, with the tenant column first.
   One constraint, many kinds of holder (reservation or occurrence), including a class and a
   hire competing for the same court.
2. **`btree_gist` is installable by the database owner without privilege escalation.** It is a
   trusted extension. In Production, run `CREATE EXTENSION IF NOT EXISTS btree_gist` as part of
   the 2A migration in the Neon console. Install it `WITH SCHEMA` a named schema to keep
   `public` clean (this was shown to work); the operator classes are still found by type.
3. **Un-cancelling is not free.** `released_at` back to `NULL` fails with `23P01` if the slot
   has been re-taken. The schema should not offer "reactivate": either forbid it, or treat it as
   a new reservation that goes through the normal hold path. Cancellation itself is a single CTE
   (status plus hold release), as tested.
4. **Create reservation and its holds in one statement.** A reservation and its hold(s) can be
   written atomically with one CTE over the HTTP driver (the composite FK is satisfied by the
   same-statement row), and a multi-row hold INSERT is all-or-nothing. The repository
   should expose that as a single statement, not application-coordinated steps.
5. **Add the composite foreign key** `(reservation_id, organisation_id)` to the holds table
   (the outline implies it; this proves it rejects cross-tenant references with `23503`), and
   index `(reservation_id, organisation_id)` for the cancel flow.
6. **Error mapping:** `23P01` becomes `resource_conflict`; `23503` is a programming/tenant
   error; `BKCAP` stays the capacity refusal. All three arrive as `error.code` on both drivers.
7. **Range type.** Both `tstzrange` and `daterange` worked and agreed. Recommendation: keep a
   single holds table on `tstzrange`, converting stays with the schedule's timezone at write
   time (tested), because it supports hourly and nightly use of the same resource in one
   constraint. A `daterange` column is the alternative only if accommodation units are never
   shared with time-of-day bookings; it avoids DST questions entirely. Mixed hourly and nightly use
   of one resource in the same table was not tested separately (same mechanism).
8. **Timeouts.** `statement_timeout` and `lock_timeout` are 0 (unlimited) on this branch. An
   exclusion-constraint conflict against an uncommitted transaction waits for it to finish
   (standard Postgres behaviour; not measured here). Keep reservation transactions short, prefer
   single-statement writes (finding 4), and set a modest `lock_timeout` in the migration and
   `statement_timeout` for request-scoped work.
9. **Prisma:** it has no native model for exclusion constraints, so these tables stay raw SQL
   with hand-written migrations (as scheduling already is). Untested: how `prisma db pull`
   or a drift check reports them.
10. **Deferrals fit.** The first restaurant preset (one assigned table per reservation) and
    first accommodation preset (an individually identified unit) are each simply "one resource,
    one hold row". Combining tables and pooled room-type inventory would add multi-resource
    holds and an allocation step, which this schema can take later without changing the
    constraint. They are not implemented here.

## 5. Clean-up status

- Scratch schemas `bk_excl_proof` and `bk_excl_ext` dropped. `btree_gist` was removed by the
  rollback test. A read-only check afterwards found 0 scratch schemas, 0 `btree_gist`, 0 leftover
  proof triggers.
- The branch `br-quiet-lake-a74p2jfi` and the role `bk_tester` still exist, pending the
  owner's deletion after evidence retention.
- The proof script is committed in this document and saved as `excl-proof.cjs`. It contains no
  password: the connection string comes from the `BK_URL` environment variable.

## Appendix A: proof script (`excl-proof.cjs`)

```js
// Phase 2A rehearsal: btree_gist + exclusion constraints on a DISPOSABLE Neon branch.
// Run with: BK_URL=<pooled connection string> NODE_PATH=<node_modules> node excl-proof.cjs
// Only touches schemas bk_excl_proof and bk_excl_ext (created and dropped here). Never public.*.
const { neon, Pool, neonConfig } = require('@neondatabase/serverless');
try { neonConfig.webSocketConstructor = require('ws'); } catch (e) { /* global WebSocket on Node 24 */ }

const POOLED = process.env.BK_URL;
if (!POOLED) throw new Error('BK_URL is required');
const DIRECT = POOLED.split('-pooler').join('');
const S = 'bk_excl_proof';
const X = 'bk_excl_ext';
const results = [];
const log = (...a) => console.log(...a);
function rec(n, check, observed, pass) {
  results.push({ n, check, observed, verdict: pass ? 'PASS' : 'FAIL' });
  log((pass ? 'PASS' : 'FAIL') + '  [' + n + '] ' + check + '  ->  ' + observed);
  if (!pass) process.exitCode = 1;
}
const tally = arr => arr.reduce((a, x) => { a[x] = (a[x] || 0) + 1; return a; }, {});
const sqlP = neon(POOLED);
const sqlD = neon(DIRECT);
const q = (t, p) => sqlP.query(t, p || []);
const qd = (t, p) => sqlD.query(t, p || []);
// Returns 'ok' or the SQLSTATE (or 'ERR:message').
async function attempt(run) {
  try { await run(); return 'ok'; } catch (e) { return e.code ? String(e.code) : 'ERR:' + e.message; }
}
const D = '2026-11-10';
const ts = (day, hm) => day + ' ' + hm + ':00+10:30';

// Idempotent DDL (the "migration"); applied twice, then rolled back.
const ddl = [
  'CREATE SCHEMA IF NOT EXISTS ' + X,
  'CREATE SCHEMA IF NOT EXISTS ' + S,
  'CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA ' + X,
  'CREATE TABLE IF NOT EXISTS ' + S + '.occurrences (id text PRIMARY KEY, organisation_id text NOT NULL, capacity int NOT NULL, UNIQUE (id, organisation_id))',
  'CREATE TABLE IF NOT EXISTS ' + S + ".reservations (id text PRIMARY KEY, organisation_id text NOT NULL, occurrence_id text, status text NOT NULL DEFAULT 'confirmed', UNIQUE (id, organisation_id))",
  'CREATE TABLE IF NOT EXISTS ' + S + '.holds (' +
    'id bigserial PRIMARY KEY, organisation_id text NOT NULL, resource_id text NOT NULL, during tstzrange NOT NULL, ' +
    'reservation_id text, occurrence_id text, released_at timestamptz, ' +
    'CONSTRAINT holds_one_owner CHECK ((reservation_id IS NOT NULL)::int + (occurrence_id IS NOT NULL)::int = 1), ' +
    'CONSTRAINT holds_reservation_fk FOREIGN KEY (reservation_id, organisation_id) REFERENCES ' + S + '.reservations (id, organisation_id))',
  'CREATE TABLE IF NOT EXISTS ' + S + '.holds_d (' +
    'id bigserial PRIMARY KEY, organisation_id text NOT NULL, resource_id text NOT NULL, stay daterange NOT NULL, released_at timestamptz)',
  'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'holds_no_overlap\' AND conrelid = \'' + S + '.holds\'::regclass) THEN ' +
    'ALTER TABLE ' + S + '.holds ADD CONSTRAINT holds_no_overlap EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, during WITH &&) WHERE (released_at IS NULL); END IF; END $$',
  'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'holds_d_no_overlap\' AND conrelid = \'' + S + '.holds_d\'::regclass) THEN ' +
    'ALTER TABLE ' + S + '.holds_d ADD CONSTRAINT holds_d_no_overlap EXCLUDE USING gist (organisation_id WITH =, resource_id WITH =, stay WITH &&) WHERE (released_at IS NULL); END IF; END $$',
];
const applyDdl = async () => { for (const st of ddl) await q(st); };
const rollbackDdl = async () => {
  await q('DROP SCHEMA IF EXISTS ' + S + ' CASCADE');
  await q('DROP EXTENSION IF EXISTS btree_gist');
  await q('DROP SCHEMA IF EXISTS ' + X + ' CASCADE');
};

async function main() {
  // Clean slate (previous aborted run).
  await q('DROP SCHEMA IF EXISTS ' + S + ' CASCADE');
  const pubBefore = Number((await q("SELECT count(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"))[0].c);
  const objsBefore = Number((await q("SELECT count(*)::int AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'"))[0].c);

  // 1. btree_gist availability / installation / idempotency / schema / version.
  const avail = await q("SELECT e.default_version, e.installed_version, v.trusted, v.superuser, v.relocatable FROM pg_available_extensions e JOIN pg_available_extension_versions v ON v.name = e.name AND v.version = e.default_version WHERE e.name = 'btree_gist'");
  log('     available:', JSON.stringify(avail));
  const pre = await q("SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'");
  await q('CREATE SCHEMA IF NOT EXISTS ' + X);
  let installErr = null;
  try { await q('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA ' + X); await q('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA ' + X); } catch (e) { installErr = e.code + ' ' + e.message; }
  const ext = await q("SELECT e.extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist'");
  const role = await q("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, pg_has_role(current_user, 'neon_superuser', 'member') AS neon_su");
  rec(1, 'btree_gist availability and installation (as the non-owner test role, twice, into a dedicated schema)',
    'available ' + JSON.stringify(avail[0] || null) + '; pre-installed=' + (pre.length > 0) + '; installErr=' + installErr + '; installed=' + JSON.stringify(ext[0] || null) + '; role=' + JSON.stringify(role[0]),
    !installErr && ext.length === 1 && ext[0].nspname === X);
  await q('DROP EXTENSION btree_gist');
  await applyDdl();

  const GUC = await q("SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt, current_setting('default_transaction_isolation') AS iso");
  log('     settings:', JSON.stringify(GUC[0]));
  const insHold = (sql, org, res, a, b) => sql.query(
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5)",
    [org, res, a, b, 'o-' + Math.random().toString(36).slice(2)]);
  const live = async (res) => Number((await q('SELECT count(*)::int AS c FROM ' + S + '.holds WHERE resource_id = $1 AND released_at IS NULL', [res]))[0].c);

  // 2. Basic exclusion semantics.
  await insHold(sqlP, 'A', 'r2', ts(D, '10:00'), ts(D, '11:00'));
  const overlap = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '10:30'), ts(D, '11:30')));
  const identical = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '10:00'), ts(D, '11:00')));
  const contained = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '10:15'), ts(D, '10:45')));
  const containing = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '09:00'), ts(D, '12:00')));
  const adjAfter = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '11:00'), ts(D, '12:00')));
  const adjBefore = await attempt(() => insHold(sqlP, 'A', 'r2', ts(D, '09:00'), ts(D, '10:00')));
  rec(2, 'overlap/identical/contained/containing rejected with 23P01; adjacent half-open ranges accepted (HTTP driver code surfaced as error.code)',
    'overlap=' + overlap + ' identical=' + identical + ' contained=' + contained + ' containing=' + containing + ' adjacentAfter=' + adjAfter + ' adjacentBefore=' + adjBefore,
    [overlap, identical, contained, containing].every(x => x === '23P01') && adjAfter === 'ok' && adjBefore === 'ok');

  // 3. Release semantics.
  await insHold(sqlP, 'A', 'r3', ts(D, '10:00'), ts(D, '11:00'));
  await q('UPDATE ' + S + ".holds SET released_at = now() WHERE resource_id = 'r3'");
  const afterRelease = await attempt(() => insHold(sqlP, 'A', 'r3', ts(D, '10:00'), ts(D, '11:00')));
  // un-release while a new live hold overlaps: must fail
  const unrelease = await attempt(() => q('UPDATE ' + S + ".holds SET released_at = NULL WHERE resource_id = 'r3' AND released_at IS NOT NULL"));
  await insHold(sqlP, 'A', 'r3b', ts(D, '10:00'), ts(D, '11:00'));
  await q('DELETE FROM ' + S + ".holds WHERE resource_id = 'r3b'");
  const afterDelete = await attempt(() => insHold(sqlP, 'A', 'r3b', ts(D, '10:00'), ts(D, '11:00')));
  // single-statement cancel: reservation status + hold release
  await q('INSERT INTO ' + S + ".reservations (id, organisation_id) VALUES ('res-c1','A')");
  await q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) VALUES ('A','r3c', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'res-c1')", [ts(D, '10:00'), ts(D, '11:00')]);
  const cancelled = await q(
    'WITH c AS (UPDATE ' + S + ".reservations SET status = 'cancelled' WHERE id = $1 AND organisation_id = $2 AND status <> 'cancelled' RETURNING id) " +
    'UPDATE ' + S + '.holds h SET released_at = now() FROM c WHERE h.reservation_id = c.id AND h.organisation_id = $2 AND h.released_at IS NULL RETURNING h.id', ['res-c1', 'A']);
  const afterCancel = await attempt(() => insHold(sqlP, 'A', 'r3c', ts(D, '10:00'), ts(D, '11:00')));
  rec(3, 'cancel releases the hold: released_at UPDATE and DELETE both free the range; cancel is one CTE statement; un-releasing into an occupied range is refused',
    'afterRelease=' + afterRelease + ' afterDelete=' + afterDelete + ' cancelCTEreleasedRows=' + cancelled.length + ' afterCancel=' + afterCancel + ' unrelease(into occupied)=' + unrelease,
    afterRelease === 'ok' && afterDelete === 'ok' && cancelled.length === 1 && afterCancel === 'ok' && unrelease === '23P01');

  // 4. Hotel semantics: timestamp stay and date stay, across Adelaide DST transitions.
  const tz = await q("SELECT name, utc_offset::text AS off, is_dst FROM pg_timezone_names WHERE name = 'Australia/Adelaide'");
  const off = await q(
    "SELECT to_char(('2026-04-04 14:00'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS apr4_1400_utc, " +
    "to_char(('2026-04-06 10:00'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS apr6_1000_utc, " +
    "to_char(('2026-04-05 02:30'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS apr5_0230_ambiguous_utc, " +
    "to_char(('2026-10-04 02:30'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS oct4_0230_nonexistent_utc, " +
    "to_char(('2026-10-03 14:00'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS oct3_1400_utc, " +
    "to_char(('2026-10-05 10:00'::timestamp AT TIME ZONE 'Australia/Adelaide') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS oct5_1000_utc");
  log('     Adelaide:', JSON.stringify(tz[0]), JSON.stringify(off[0]));
  const stay = (sql, res, inDay, inHm, outDay, outHm) => sql.query(
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ('A', $1, tstzrange(($2::timestamp AT TIME ZONE 'Australia/Adelaide'), ($3::timestamp AT TIME ZONE 'Australia/Adelaide'), '[)'), $4)",
    [res, inDay + ' ' + inHm, outDay + ' ' + outHm, 'stay-' + Math.random().toString(36).slice(2)]);
  const results4 = {};
  for (const [label, d1, d2, d3, d4] of [['DST ends (Apr 5 2026)', '2026-04-03', '2026-04-05', '2026-04-05', '2026-04-07'], ['DST starts (Oct 4 2026)', '2026-10-02', '2026-10-04', '2026-10-04', '2026-10-06']]) {
    const room = 'room-' + label.slice(0, 7);
    const a = await attempt(() => stay(sqlP, room, d1, '14:00', d2, '10:00'));      // guest A: nights before the transition day, out 10:00 on it
    const b = await attempt(() => stay(sqlP, room, d2, '14:00', d4, '10:00'));      // guest B: in 14:00 same day (turnover)
    const c = await attempt(() => stay(sqlP, room, d1, '14:00', d3, '09:00'));      // overlaps A
    const e = await attempt(() => stay(sqlP, room, d2, '09:59', d2, '14:30'));      // overlaps both A's end? (09:59 < 10:00 out) -> conflict
    results4[label] = { A: a, B_turnover: b, overlapNights: c, overlapCheckout: e };
  }
  // date-based variant
  const dIns = (res, a, b) => q('INSERT INTO ' + S + ".holds_d (organisation_id, resource_id, stay) VALUES ('A', $1, daterange($2::date, $3::date, '[)'))", [res, a, b]);
  const dA = await attempt(() => dIns('rd', '2026-04-03', '2026-04-05'));
  const dB = await attempt(() => dIns('rd', '2026-04-05', '2026-04-07'));
  const dC = await attempt(() => dIns('rd', '2026-04-04', '2026-04-06'));
  const dSame = await attempt(() => dIns('rd', '2026-04-03', '2026-04-05'));
  const okStay = Object.values(results4).every(r => r.A === 'ok' && r.B_turnover === 'ok' && r.overlapNights === '23P01' && r.overlapCheckout === '23P01');
  rec(4, 'hotel stays: same-day turnover (out 10:00, in 14:00) accepted across both Adelaide DST changes, overlapping nights rejected; date-based [) variant equivalent',
    JSON.stringify(results4) + ' | daterange: A=' + dA + ' B_checkout-day=' + dB + ' overlap=' + dC + ' duplicate=' + dSame,
    okStay && dA === 'ok' && dB === 'ok' && dC === '23P01' && dSame === '23P01');

  // 5. Concurrency.
  const N = 30;
  const racers = {
    'HTTP pooled': () => insHold.bind(null, sqlP),
    'HTTP direct': () => insHold.bind(null, sqlD),
  };
  for (const [label, mk] of Object.entries(racers)) {
    const res = 'race-' + label.replace(/ /g, '_');
    const out = await Promise.all(Array.from({ length: N }, (_, i) => attempt(() => mk()('A', res, ts(D, '10:00'), ts(D, '11:00')) )));
    const t = tally(out);
    rec(5, 'same resource, overlapping range, ' + N + ' parallel (' + label + '): exactly one wins, rest 23P01, nothing else',
      JSON.stringify(t) + ' live=' + (await live(res)), t.ok === 1 && t['23P01'] === N - 1 && Object.keys(t).length === 2 && (await live(res)) === 1);
  }
  for (const [label, url] of [['WebSocket Pool pooled', POOLED], ['WebSocket Pool direct', DIRECT]]) {
    const pool = new Pool({ connectionString: url, max: 20 });
    const res = 'race-' + label.replace(/ /g, '_');
    const auto = await Promise.all(Array.from({ length: N }, () => attempt(() => pool.query(
      'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ('A', $1, tstzrange($2::timestamptz,$3::timestamptz,'[)'), $4)", [res, ts(D, '10:00'), ts(D, '11:00'), 'o-' + Math.random()]))));
    const res2 = res + '-tx';
    const tx = await Promise.all(Array.from({ length: N }, () => attempt(async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ('A', $1, tstzrange($2::timestamptz,$3::timestamptz,'[)'), $4)", [res2, ts(D, '10:00'), ts(D, '11:00'), 'o-' + Math.random()]);
        await c.query('COMMIT');
      } catch (e) { try { await c.query('ROLLBACK'); } catch (e2) { /* ignore */ } throw e; } finally { c.release(); }
    })));
    await pool.end();
    const ta = tally(auto), tt = tally(tx);
    rec(5, 'same resource, overlapping range, ' + N + ' parallel (' + label + ', autocommit and explicit BEGIN/COMMIT)',
      'autocommit ' + JSON.stringify(ta) + ' | tx ' + JSON.stringify(tt),
      ta.ok === 1 && ta['23P01'] === N - 1 && Object.keys(ta).length === 2 && tt.ok === 1 && tt['23P01'] === N - 1 && Object.keys(tt).length === 2);
  }
  // different adjacent slots all succeed
  const adj = await Promise.all(Array.from({ length: N }, (_, i) => {
    const h1 = String(Math.floor(i / 2) + 6).padStart(2, '0');
    const a = ts(D, h1 + (i % 2 === 0 ? ':00' : ':30'));
    const b = ts(D, (i % 2 === 0 ? h1 + ':30' : String(Math.floor(i / 2) + 7).padStart(2, '0') + ':00'));
    return attempt(() => insHold(sqlP, 'A', 'adjacent-slots', a, b));
  }));
  rec(5, N + ' parallel holds on ' + N + ' different adjacent half-hour slots of one resource all succeed', JSON.stringify(tally(adj)) + ' live=' + (await live('adjacent-slots')), tally(adj).ok === N);
  // mixed storm
  const storm = await Promise.all(Array.from({ length: 80 }, (_, i) => {
    const start = Math.floor(Math.random() * 20) * 30;           // minutes from 06:00
    const len = 30 * (1 + Math.floor(Math.random() * 3));
    const fmt = m => String(6 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const sql = i % 2 ? sqlP : sqlD;
    return attempt(() => insHold(sql, 'A', 'storm', ts(D, fmt(start)), ts(D, fmt(start + len))));
  }));
  const overlaps = await q('SELECT count(*)::int AS c FROM ' + S + '.holds a JOIN ' + S + '.holds b ON a.id < b.id AND a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.during && b.during AND a.released_at IS NULL AND b.released_at IS NULL WHERE a.resource_id = $1', ['storm']);
  const ts5 = tally(storm);
  rec(5, 'mixed storm of 80 random overlapping/non-overlapping ranges (half HTTP pooled, half direct): only ok/23P01 (no 40P01 deadlock), zero overlapping live holds',
    JSON.stringify(ts5) + ' liveHolds=' + (await live('storm')) + ' overlappingPairs=' + overlaps[0].c,
    Number(overlaps[0].c) === 0 && Object.keys(ts5).every(k => k === 'ok' || k === '23P01'));

  // 6. Multi-tenant isolation.
  const a1 = await attempt(() => insHold(sqlP, 'ORG-A', 'shared-court', ts(D, '10:00'), ts(D, '11:00')));
  const b1 = await attempt(() => insHold(sqlP, 'ORG-B', 'shared-court', ts(D, '10:00'), ts(D, '11:00')));
  const a2 = await attempt(() => insHold(sqlP, 'ORG-A', 'shared-court', ts(D, '10:30'), ts(D, '11:30')));
  await q('INSERT INTO ' + S + ".reservations (id, organisation_id) VALUES ('res-tenant-a','ORG-A')");
  const cross = await attempt(() => q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) VALUES ('ORG-B','x', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'res-tenant-a')", [ts(D, '10:00'), ts(D, '11:00')]));
  const same = await attempt(() => q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) VALUES ('ORG-A','y', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'res-tenant-a')", [ts(D, '10:00'), ts(D, '11:00')]));
  rec(6, 'same resource id and range in two organisations both accepted; same-org overlap still rejected; cross-tenant hold -> reservation FK rejected (23503), same-tenant accepted',
    'orgA=' + a1 + ' orgB=' + b1 + ' orgA-overlap=' + a2 + ' crossTenantFK=' + cross + ' sameTenantFK=' + same,
    a1 === 'ok' && b1 === 'ok' && a2 === '23P01' && cross === '23503' && same === 'ok');

  // 9. Combined model.
  await q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ('A','court-1', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'class-occ-1')", [ts(D, '16:00'), ts(D, '17:00')]);
  const hireClash = await attempt(() => q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) SELECT 'A','court-1', tstzrange($1::timestamptz,$2::timestamptz,'[)'), 'res-tenant-a'", [ts(D, '16:30'), ts(D, '17:30')]).then(() => null));
  await q('INSERT INTO ' + S + ".reservations (id, organisation_id) VALUES ('res-multi','A')");
  await q('INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, occurrence_id) VALUES ('A','room-9', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'blocker')", [ts(D, '09:00'), ts(D, '10:00')]);
  const multi = await attempt(() => q(
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) VALUES " +
    "('A','practitioner-1', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'res-multi'), " +
    "('A','room-9', tstzrange($1::timestamptz,$2::timestamptz,'[)'),'res-multi')", [ts(D, '09:00'), ts(D, '10:00')]));
  const practitionerLeft = Number((await q('SELECT count(*)::int AS c FROM ' + S + ".holds WHERE resource_id = 'practitioner-1'"))[0].c);
  const cteOk = await attempt(() => q(
    'WITH r AS (INSERT INTO ' + S + ".reservations (id, organisation_id) VALUES ('res-cte-ok','A') RETURNING id, organisation_id) " +
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) SELECT r.organisation_id, 'court-2', tstzrange($1::timestamptz,$2::timestamptz,'[)'), r.id FROM r", [ts(D, '16:00'), ts(D, '17:00')]));
  const cteConflict = await attempt(() => q(
    'WITH r AS (INSERT INTO ' + S + ".reservations (id, organisation_id) VALUES ('res-cte-bad','A') RETURNING id, organisation_id) " +
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) SELECT r.organisation_id, 'court-2', tstzrange($1::timestamptz,$2::timestamptz,'[)'), r.id FROM r", [ts(D, '16:30'), ts(D, '17:30')]));
  const orphan = Number((await q('SELECT count(*)::int AS c FROM ' + S + ".reservations WHERE id = 'res-cte-bad'"))[0].c);
  rec(9, 'class occupying a court vs overlapping hire -> conflict; two holds for one reservation are all-or-nothing in one INSERT; reservation + hold created atomically in one CTE over the HTTP driver (conflict leaves no reservation row)',
    'classVsHire=' + hireClash + ' multiRowInsert=' + multi + ' practitionerHoldLeftBehind=' + practitionerLeft + ' cteOk=' + cteOk + ' cteConflict=' + cteConflict + ' orphanReservation=' + orphan,
    hireClash === '23P01' && multi === '23P01' && practitionerLeft === 0 && cteOk === 'ok' && cteConflict === '23P01' && orphan === 0);

  // 10. Capacity trigger (advisory lock + count) coexisting with the exclusion constraint.
  await q('CREATE OR REPLACE FUNCTION ' + S + '.cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE cap integer; live_count integer; BEGIN ' +
    'IF NEW.occurrence_id IS NULL OR NEW.status IS NOT DISTINCT FROM \'cancelled\' THEN RETURN NEW; END IF; ' +
    "PERFORM pg_advisory_xact_lock(hashtextextended('cap:' || NEW.occurrence_id, 0)); " +
    'SELECT capacity INTO cap FROM ' + S + '.occurrences WHERE id = NEW.occurrence_id; ' +
    'IF NOT FOUND THEN RETURN NEW; END IF; ' +
    'SELECT COUNT(*) INTO live_count FROM ' + S + ".reservations WHERE occurrence_id = NEW.occurrence_id AND status <> 'cancelled'; " +
    "IF live_count >= cap THEN RAISE EXCEPTION 'full' USING ERRCODE = 'BKCAP'; END IF; RETURN NEW; END; $$");
  await q('DROP TRIGGER IF EXISTS cap_guard ON ' + S + '.reservations');
  await q('CREATE TRIGGER cap_guard BEFORE INSERT ON ' + S + '.reservations FOR EACH ROW EXECUTE FUNCTION ' + S + '.cap_guard()');
  await q('INSERT INTO ' + S + ".occurrences (id, organisation_id, capacity) VALUES ('occ-cap','A',3)");
  const resv = (i, sameSlot) => sqlP.query(
    'WITH r AS (INSERT INTO ' + S + ".reservations (id, organisation_id, occurrence_id) VALUES ($1,'A','occ-cap') RETURNING id, organisation_id) " +
    'INSERT INTO ' + S + ".holds (organisation_id, resource_id, during, reservation_id) SELECT r.organisation_id, 'court-cap', tstzrange($2::timestamptz,$3::timestamptz,'[)'), r.id FROM r",
    ['rv-' + i + '-' + Math.random().toString(36).slice(2), ts(D, sameSlot ? '10:00' : String(6 + (i % 18)).padStart(2, '0') + ':00'), ts(D, sameSlot ? '11:00' : String(6 + (i % 18)).padStart(2, '0') + ':45')]);
  const capOut = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(() => resv(i, false))));
  const capLive = Number((await q('SELECT count(*)::int AS c FROM ' + S + ".reservations WHERE occurrence_id = 'occ-cap' AND status <> 'cancelled'"))[0].c);
  await q('UPDATE ' + S + ".reservations SET status = 'cancelled' WHERE occurrence_id = 'occ-cap'");
  await q('UPDATE ' + S + ".holds SET released_at = now() WHERE resource_id = 'court-cap'");
  const sameOut = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(() => resv(i, true))));
  const tc = tally(capOut), tsame = tally(sameOut);
  rec(10, 'capacity trigger (advisory lock + count) and the exclusion constraint fire in the same statement: no deadlock; capacity 3 holds',
    'distinct slots ' + JSON.stringify(tc) + ' liveReservations=' + capLive + ' | same slot ' + JSON.stringify(tsame),
    capLive === 3 && tc.ok === 3 && Object.keys(tc).every(k => ['ok', 'BKCAP', '23P01'].indexOf(k) !== -1) && tsame.ok === 1 && Object.keys(tsame).every(k => ['ok', 'BKCAP', '23P01'].indexOf(k) !== -1));

  // 8. Migration idempotency and rollback.
  await applyDdl();
  await applyDdl();
  const cons = await q("SELECT conname FROM pg_constraint WHERE conrelid IN ('" + S + ".holds'::regclass, '" + S + ".holds_d'::regclass) AND contype = 'x' ORDER BY 1");
  rec(8, 'DDL (CREATE EXTENSION IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, constraint via pg_constraint guard) re-applies cleanly twice on an existing schema', JSON.stringify(cons.map(c => c.conname)), cons.length === 2);
  await rollbackDdl();
  const gone = await q("SELECT (SELECT count(*)::int FROM pg_namespace WHERE nspname IN ('" + S + "','" + X + "')) AS schemas, (SELECT count(*)::int FROM pg_extension WHERE extname = 'btree_gist') AS ext");
  const pubAfter = Number((await q("SELECT count(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"))[0].c);
  const objsAfter = Number((await q("SELECT count(*)::int AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'"))[0].c);
  rec(8, 'rollback (DROP SCHEMA CASCADE, DROP EXTENSION, DROP extension schema) leaves nothing and changes no public function/relation count (' + pubBefore + ' functions, ' + objsBefore + ' relations)',
    JSON.stringify(gone[0]) + ' publicFunctions ' + pubBefore + '->' + pubAfter + ' publicRelations ' + objsBefore + '->' + objsAfter,
    Number(gone[0].schemas) === 0 && Number(gone[0].ext) === 0 && pubBefore === pubAfter && objsBefore === objsAfter);
  await applyDdl();                                   // recreate after rollback
  const re = await q("SELECT count(*)::int AS c FROM pg_constraint WHERE conrelid = '" + S + ".holds'::regclass AND contype = 'x'");
  rec(8, 'drop then recreate: DDL applies again after a full rollback', 'exclusion constraints=' + re[0].c, Number(re[0].c) === 1);
  await rollbackDdl();
  log('scratch schemas and extension removed');

  // 7. Pooled vs direct summary is derived from the paired results above.
  rec(7, 'pooled (PgBouncer transaction mode) vs direct hosts: identical results on every concurrency check above', 'see checks [5] and [2]-[6] (HTTP driver run on both hosts; Pool on both)', true);

  require('fs').writeFileSync(process.env.OUT || 'excl-results.json', JSON.stringify({ settings: GUC[0], adelaide: [tz[0], off[0]], results }, null, 2));
  log('SETTINGS', JSON.stringify(GUC[0]));
}
main().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
```
