import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

vi.setConfig({ testTimeout: 60_000 });

// Phase 2C.3b adds the STAFF facility-hire API and nothing else that can be reached: three route files behind two independent default-OFF gates, one handler module, one
// gate in the access guard, one forwarded transaction in the host executor. This file pins that shape so it cannot widen unnoticed: no public or customer path, no screen, no
// capability row, no migration, no change to the proven repository, nothing in LD Tennis or Eve.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const ROUTES: Record<string, string[]> = {
  'app/api/scheduling/reservations/route.ts': ['POST createReservation', 'GET findReservationByKey'],
  'app/api/scheduling/reservations/[reservationId]/route.ts': ['GET getReservation'],
  'app/api/scheduling/reservations/[reservationId]/cancel/route.ts': ['POST cancelReservation'],
  // Phase 2C.3c-B: the staff-only availability basis (a read). The viewer-level calendar API is NOT changed.
  'app/api/scheduling/reservations/basis/route.ts': ['GET readReservationBasis'],
};
const handlers = noTsComments(read('lib/scheduling/booking/reservations.ts'));

describe('the route set: exactly four files, every method behind both gates and scheduling.reserve', () => {
  it('there are no other route files under a reservations path, and no other method is exported', () => {
    const files = walk('app/api/scheduling/reservations').filter(f => /route\.ts$/.test(f)).sort();
    expect(files).toEqual(Object.keys(ROUTES).sort());
    for (const [file, expected] of Object.entries(ROUTES)) {
      const src = noTsComments(read(file));
      const exported = [...src.matchAll(/export\s+const\s+(\w+)\s*=\s*schedulingRoute\(\s*'([^']+)'\s*,\s*(\w+)\s*,\s*\{([^}]*)\}/g)];
      expect(exported.map(m => `${m[1]} ${m[3]}`).sort(), file).toEqual([...expected].sort());
      for (const m of exported) {
        expect(m[2], `${file} ${m[1]}`).toBe('scheduling.reserve'); // viewer, analyst and unknown roles are refused
        expect(m[4], `${file} ${m[1]}`).toMatch(/feature:\s*'staff_booking'/); // the kill switch and the organisation capability
      }
      expect(src, file).toMatch(/export const dynamic = 'force-dynamic'/);
      expect(src, file).not.toMatch(/export\s+(const|async function|function)\s+(PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
      expect(src, file).not.toMatch(/\bsql\b|@\/lib\/db|requireSession|cookies\(|headers\(/); // a route file is wiring only
    }
  });

  it('no public, customer, webhook or payment path exists for reservations, and no read of a list', () => {
    const everything = walk('app/api').filter(f => /route\.ts$/.test(f));
    expect(everything.filter(f => /public|customer|webhook|checkout|payment/i.test(f) && /scheduling/i.test(f))).toEqual([]);
    expect(everything.filter(f => /\/reservations\//.test(f) && !Object.keys(ROUTES).includes(f))).toEqual([]);
    expect(handlers).not.toMatch(/listFor|\.list\(|LIMIT|OFFSET/i);
  });
});

describe('the two gates, in order, in the one guard', () => {
  const access = noTsComments(read('lib/scheduling/access.ts'));
  it('the kill switch is checked BEFORE the session is read, and the organisation capability BEFORE the base capability', () => {
    const killSwitch = access.indexOf('staffBookingKillSwitchOn()');
    const session = access.indexOf('await requireSession()');
    const staffCap = access.indexOf('SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY)');
    const baseCap = access.indexOf('requireCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY)');
    expect(killSwitch).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(killSwitch);
    expect(staffCap).toBeGreaterThan(session);
    expect(baseCap).toBeGreaterThan(staffCap);
  });
  it('a denial of either gate answers 404 not_found; only a failure to determine the capability is a 503', () => {
    expect(access).toMatch(/const featureOff = \(\): Response => NextResponse\.json\(\{ error: 'not_found' \}, \{ status: 404 \}\)/);
    expect(access).toMatch(/if \(err instanceof CapabilityAccessError\) return \{ ok: false, response: featureOff\(\) \}/);
  });
  it('the switch must equal exactly "on", is read per call from the environment, and defaults to off', () => {
    const adapter = noTsComments(read('lib/scheduling/adapters/brainbase/index.ts'));
    expect(adapter).toMatch(/staffBookingKillSwitchOn = \(env: Readonly<Record<string, string \| undefined>> = process\.env\): boolean => env\[SCHEDULING_STAFF_BOOKING_ENV\] === 'on'/);
    expect(adapter).toContain("SCHEDULING_STAFF_BOOKING_ENV = 'SCHEDULING_STAFF_BOOKING'");
    expect(adapter).toContain("SCHEDULING_STAFF_BOOKING_CAPABILITY_KEY = 'scheduling.staff_booking'");
  });
  it('no code, script or SQL anywhere creates, enables or seeds the capability or the switch for anyone', () => {
    const files = [...walk('scripts'), ...walk('packages/scheduling/sql'), ...walk('lib'), ...walk('app'), ...walk('prisma')].filter(f => /\.(sql|ts|tsx|sh|cjs|mjs|js|prisma)$/.test(f));
    const mentions = files.filter(f => /staff_booking/.test(read(f)) && !/\.test\.ts$|\.integration\.test\.ts$/.test(f));
    expect(mentions.sort()).toEqual([...Object.keys(ROUTES), 'lib/scheduling/access.ts', 'lib/scheduling/adapters/brainbase/index.ts', 'lib/scheduling/booking/basis.ts', 'lib/scheduling/booking/reservations.ts', 'lib/scheduling/coachActions.ts', 'lib/scheduling/coachSquads.ts', 'lib/scheduling/route.ts', 'lib/scheduling/staffBookingVisibility.ts', 'scripts/tests/helpers/schedulingBrowserEnv.mjs'].sort()); // TypeScript only: the gate, the adapter, the guard option, the handlers' comment, the routes and (2C.3c UI slice 1) the page-level visibility helper and the DISPOSABLE browser harness helper
    // 2C.3c UI slice 1 (deliberate, reviewed change): the DISPOSABLE browser harness may register and entitle the capability for one synthetic organisation and may set the switch for its own test server
    // (opt-in, default off). It runs only against a throwaway Docker database and never against Production, Preview or Neon.
    for (const f of files.filter(f => /\.(sql|cjs|mjs|js)$/.test(f) && f !== 'scripts/tests/helpers/schedulingBrowserEnv.mjs')) expect(read(f), f).not.toMatch(/staff_booking|SCHEDULING_STAFF_BOOKING/);
    expect(read('vercel.json')).not.toMatch(/SCHEDULING_STAFF_BOOKING/);
  });
});

describe('the handlers take the organisation from the tenant and decide no booking rule', () => {
  it('imports no database, session, cookie, capability or Postgres package, and runs no SQL', () => {
    for (const forbidden of ['@/lib/db', '@/lib/org', '@/lib/session', 'next/headers', '@scheduling/postgres', '@/lib/capabilities', "/access'", "/runtime'"]) expect(handlers, forbidden).not.toContain(forbidden);
    expect(handlers).not.toMatch(/\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b|scheduling_[a-z_]+/);
  });
  it('reads no organisation from the request: the only organisation is context.tenant', () => {
    expect(handlers).not.toMatch(/organi[sz]ation_?id|body\.organi|searchParams\.get\('organi|params\.organi/i);
    expect(handlers).toMatch(/context\.hire\.createHire\(context\.tenant,/);
    expect(handlers).toMatch(/context\.persistence\.reservations\.getById\(context\.tenant,/);
    expect(handlers).toMatch(/cancel\(context\.tenant, \{ reservationId: id, cancelledBy: 'staff', reason, scope: 'this_occurrence' \}\)/);
  });
  it('cancels one occurrence only, as staff, and never deletes: the row and its history stay', () => {
    expect(handlers).not.toMatch(/this_and_future|DELETE|\.delete\(/);
  });
  it('the audit entry is written without an identity, an IP address or a user agent, and after the work', () => {
    expect(handlers).not.toMatch(/identity|ipAddress|userAgent|customerName|customerEmail|customerPhone/);
    expect(handlers.indexOf('await context.hire.createHire(')).toBeLessThan(handlers.indexOf("await audit(context, 'scheduling.reservation.created'"));
  });
  it('an unexpected error on create is reconciled by the ORIGINAL key: no new key, no second createHire, no bare rethrow (2C.3c-A)', () => {
    expect(handlers).not.toMatch(/randomUUID|newId|crypto\.|Math\.random/); // a key is only ever the client's
    expect((handlers.match(/context\.hire\.createHire\(/g) ?? []).length).toBe(1);
    expect(handlers).toMatch(/return reconcileCreate\(context, parsed\.request\)/);
    expect(handlers).toMatch(/findHireByKey\(context\.tenant, request\.idempotencyKey\)/);
    const create = handlers.slice(handlers.indexOf('export async function createReservation'), handlers.indexOf('async function reconcileCreate'));
    expect(create).not.toMatch(/throw err/); // the only rethrow the old handler had
  });
  it('error bodies are fixed sentences: no repository message is ever copied into a response', () => {
    expect(handlers).not.toMatch(/failure\.message|err\.message|error\.message|\.message\b/);
  });
});

describe('the proven repository and the database are untouched', () => {
  const repo = noTsComments(read('packages/scheduling-postgres/src/hireRepository.ts'));
  it('the lock order, the transaction-local timeouts and the single advisory lock are exactly the 2C.3a statement', () => {
    expect(repo).toMatch(/set_config\('lock_timeout', \$1, true\)/);
    expect(repo).toMatch(/set_config\('statement_timeout', \$2, true\)/);
    expect((repo.match(/pg_advisory_xact_lock/g) ?? []).length).toBe(1);
    expect(repo.indexOf('pg_advisory_xact_lock')).toBeLessThan(repo.indexOf('scheduling_availability_versions v, lk'));
    expect(read('packages/scheduling-postgres/tests/hireLockOrder.integration.test.ts')).toMatch(/40P01/);
  });
  it('no migration beyond 037 and no rollback beyond 098', () => {
    const numbers = readdirSync(path.join(ROOT, 'packages/scheduling/sql')).map(n => Number(n.slice(0, 3))).filter(Number.isFinite);
    expect(Math.max(...numbers)).toBe(98);
  });
  it('the host executor forwards transaction() only when the driver has one (never a stub)', () => {
    const runtime = noTsComments(read('lib/scheduling/runtime.ts'));
    expect(runtime).toMatch(/if \(typeof innerTransaction === 'function'\)/);
    expect(runtime).not.toMatch(/transaction:\s*(undefined|null|async \(\) =>)/);
    expect(runtime).toContain('innerTransaction.call(inner, statements)');
  });
});

describe('the availability basis handler (2C.3c-B): a read, tenant-only, allow-listed, no step', () => {
  const basis = noTsComments(read('lib/scheduling/booking/basis.ts'));
  it('imports no database, session, cookie, capability or Postgres package, runs no SQL and writes nothing', () => {
    for (const forbidden of ['@/lib/db', '@/lib/org', '@/lib/session', 'next/headers', '@scheduling/postgres', '@/lib/capabilities', "/access'", "/runtime'", '../audit']) expect(basis, forbidden).not.toContain(forbidden);
    expect(basis).not.toMatch(/\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b|scheduling_[a-z_]+/);
    expect(basis).not.toMatch(/createHire|cancel\(|\.insert|\.update|\.delete|recordSchedulingAudit/);
  });
  it('reads exactly offeringId, resourceId, from and to; no organisation, no step, no duration', () => {
    expect(basis).toMatch(/const ALLOWED = \['offeringId', 'resourceId', 'from', 'to'\] as const/);
    expect(basis).not.toMatch(/organi[sz]ation_?id|searchParams\.get\('(step|stepMinutes|duration|durationMinutes)'/i);
    expect(basis).toMatch(/context\.hire\.readHireOffer\(context\.tenant,/);
  });
  it('the response is an allow-list built field by field, never the repository object', () => {
    expect(basis).toMatch(/basis: o\.basis,/);
    expect(basis).not.toMatch(/\.\.\.o\b|\.\.\.result/);
  });
  it('the viewer-level calendar API and the booking-overlay API are not changed to carry a basis, and the route has no write method', () => {
    for (const f of ['lib/scheduling/config/calendar.ts', 'lib/scheduling/config/bookingOverlay.ts']) expect(noTsComments(read(f)), f).not.toMatch(/readHireOffer|readHireBasis|HireBasis|offeringToken|scheduleToken/);
    expect(read('app/api/scheduling/reservations/basis/route.ts')).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
  });
  it('the repository method is read-only: it never opens a transaction or writes, and the basis is read BEFORE the engine inputs', () => {
    const repo = noTsComments(read('packages/scheduling-postgres/src/hireRepository.ts'));
    const body = repo.slice(repo.indexOf('async readHireOffer('), repo.indexOf('async createHire('));
    expect(body.length).toBeGreaterThan(500);
    expect(body).not.toMatch(/transaction|INSERT|UPDATE|DELETE|pg_advisory|set_config/i);
    expect(body.indexOf('readBasisRow')).toBeGreaterThan(-1);
    expect(body.indexOf('readBasisRow')).toBeLessThan(body.indexOf('listRulesForOwners'));
  });
});

describe('nothing else is touched: no screen, no public booking, no recurrence, LD Tennis and Eve', () => {
  it('no component, page or hook calls the reservation API (the staff form is 2C.3c)', () => {
    const ui = [...walk('app'), ...walk('components'), ...walk('hooks')].filter(f => /\.(ts|tsx)$/.test(f) && !f.startsWith('app/api/'));
    expect(ui.filter(f => /api\/scheduling\/reservations/.test(read(f)))).toEqual([]);
  });
  it('LD Tennis and Eve code does not import the reservation handlers or the hire repository', () => {
    const files = [...walk('app/api/tennis'), ...walk('apps/eve'), ...walk('lib/scheduling/compatibility')].filter(f => /\.(ts|tsx)$/.test(f) && !/node_modules/.test(f));
    expect(files.filter(f => /booking\/reservations|PostgresHireRepository|createHire|api\/scheduling\/reservations/.test(noTsComments(read(f))))).toEqual([]);
  });
  it('no recurring generation is added to the booking module', () => {
    expect(handlers).not.toMatch(/series|recurr|rrule|generate/i);
  });
});
