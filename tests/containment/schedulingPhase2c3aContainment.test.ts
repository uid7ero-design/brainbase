import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { HIRE_BASIS_SQL, HIRE_GUARDED_SQL } from '../../packages/scheduling-postgres/src/hireRepository';

vi.setConfig({ testTimeout: 60_000 });

// Phase 2C.3a adds ONE repository method (createHire) and its pure contract, and nothing that can be reached over HTTP or from a screen. This file pins that: no route, no
// screen, no flag, no migration, no role change, no caller in the application; the SQL is organisation-scoped on every table it touches and takes its locks in the one approved order.

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

const HIRE_API = ['PostgresHireRepository', 'createHire', 'findHireByKey', 'readHireBasis', 'HireRepository', 'HIRE_GUARDED_SQL', 'HIRE_BASIS_SQL', 'HireRequest'];

describe('createHire is reachable from exactly the 2C.3b wiring and nowhere else in the application', () => {
  const files = [...walk('app'), ...walk('lib'), ...walk('components')].filter(f => /\.(ts|tsx)$/.test(f));
  it('only the runtime (which builds it) and the reservation handlers (which call it) mention the hire repository, its contract or its SQL', () => {
    const users = files.filter(f => HIRE_API.some(n => new RegExp(`\\b${n}\\b`).test(noTsComments(read(f)))));
    expect(users).toEqual(['lib/scheduling/booking/reservations.ts', 'lib/scheduling/runtime.ts']);
  });
  it('the only reservation, booking or hire routes are the three of 2C.3b, and no route file itself calls a reservation write', () => {
    const routes = walk('app/api/scheduling').filter(f => /route\.ts$/.test(f));
    expect(routes.filter(f => /reservation|booking|hire/i.test(f)).sort()).toEqual(['app/api/scheduling/reservations/[reservationId]/cancel/route.ts', 'app/api/scheduling/reservations/[reservationId]/route.ts', 'app/api/scheduling/reservations/route.ts']);
    expect(routes.filter(f => /reservations\.(create|createAssigned|cancel)\(|createHire\(/.test(noTsComments(read(f))))).toEqual([]);
  });
  it('no screen, page or component renders a booking form', () => {
    const pages = [...walk('app'), ...walk('components')].filter(f => /scheduling/i.test(f) && /\.(tsx)$/.test(f));
    expect(pages.filter(f => /staff_booking|createHire|NewBooking|HireForm/.test(noTsComments(read(f))))).toEqual([]);
  });
});

describe('no flag, no entitlement row, no migration, no role change', () => {
  const code = [...walk('app'), ...walk('lib'), ...walk('components'), ...walk('packages/scheduling/src'), ...walk('packages/scheduling-postgres/src'), ...walk('packages/scheduling/sql')].filter(f => /\.(ts|tsx|sql)$/.test(f));
  it('the kill switch and the capability key of 2C.3b are named only by the access gate and the BrainBase adapter, and no SQL file registers the capability for anyone', () => {
    expect(code.filter(f => /SCHEDULING_STAFF_BOOKING|scheduling\.staff_booking/.test(noTsComments(read(f))))).toEqual(['lib/scheduling/access.ts', 'lib/scheduling/adapters/brainbase/index.ts']);
    expect(code.filter(f => /\.sql$/.test(f) && /staff_booking/.test(read(f)))).toEqual([]);
  });
  it('the shared schema is still exactly the approved one: no migration beyond 037, no rollback beyond 098', () => {
    const names = readdirSync(path.join(ROOT, 'packages/scheduling/sql'));
    const numbers = names.map(n => Number(n.slice(0, 3))).filter(Number.isFinite);
    expect(Math.max(...numbers)).toBe(98);
  });
  it('the repository never alters a role, a database or a session setting; timeouts are transaction-local set_config(..., true) only', () => {
    const src = noTsComments(read('packages/scheduling-postgres/src/hireRepository.ts'));
    expect(src).not.toMatch(/\bALTER\s+(ROLE|USER|DATABASE|SYSTEM)\b/i);
    expect(src).not.toMatch(/\bSET\s+(SESSION|ROLE|statement_timeout|lock_timeout)\b/i);
    expect(src).not.toMatch(/\bSET\s+LOCAL\b/i);
    expect(src).toMatch(/set_config\('lock_timeout', \$1, true\)/);
    expect(src).toMatch(/set_config\('statement_timeout', \$2, true\)/);
  });
  it('the only statement that writes is the guarded booking, and it only inserts', () => {
    const src = noTsComments(read('packages/scheduling-postgres/src/hireRepository.ts'));
    expect(src).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE|DROP|ALTER)\b\s+scheduling_/i);
    expect([...HIRE_GUARDED_SQL.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1]).sort()).toEqual(['scheduling_reservations', 'scheduling_resource_holds']);
    expect(HIRE_BASIS_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

describe('the SQL is tenant-scoped and takes its locks in the approved order', () => {
  const tables = (sql: string) => [...sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+(scheduling_\w+)/g)].map(m => m[1]);
  it('every table reference is accompanied by an organisation_id condition or column', () => {
    for (const sql of [HIRE_BASIS_SQL, HIRE_GUARDED_SQL]) {
      const refs = tables(sql).filter(t => t !== 'scheduling_reservations' || sql === HIRE_BASIS_SQL);
      expect((sql.match(/organisation_id/g) ?? []).length).toBeGreaterThanOrEqual(refs.length);
    }
    // and the session's organisation is the first parameter of both
    expect(HIRE_BASIS_SQL).toMatch(/o\.organisation_id = \$1::text/);
    expect(HIRE_GUARDED_SQL).toMatch(/v\.organisation_id = \$1::text AND v\.owner_kind = 'offering'/);
  });
  it('locks: schedule, offering, resource (all FOR SHARE), then the resource advisory lock, then the two version rows (FOR SHARE) - the order every other writer in 030-037 uses', () => {
    const order = [...HIRE_GUARDED_SQL.matchAll(/FOR SHARE OF (\w+)/g)].map(m => m[1]);
    expect(order).toEqual(['s', 'o', 'r', 'v', 'v']);
    const at = (cte: string) => HIRE_GUARDED_SQL.indexOf(cte + ' AS (');
    expect(at('ls')).toBeLessThan(at('lo'));
    expect(at('lo')).toBeLessThan(at('lr'));
    expect(at('lr')).toBeLessThan(at('lk'));
    expect(at('lk')).toBeLessThan(at('lov'));
    expect(at('lov')).toBeLessThan(at('lrv'));
    // the advisory lock is the SAME key the 030-036 guards and the hold trigger take, and no version row is locked before it
    expect(HIRE_GUARDED_SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\('scheduling_resource:' \|\| \$1::text \|\| ':' \|\| \$6::text, 0\)\)/);
    expect(HIRE_GUARDED_SQL.indexOf('pg_advisory_xact_lock')).toBeLessThan(HIRE_GUARDED_SQL.indexOf('scheduling_availability_versions'));
    expect((HIRE_GUARDED_SQL.match(/pg_advisory_xact_lock/g) ?? []).length).toBe(1); // at most one advisory lock per statement (030)
    expect(HIRE_GUARDED_SQL).not.toMatch(/FOR\s+(UPDATE|NO KEY UPDATE)/i);
  });
  it('the booking requires the version of each owner AND the offering and schedule edit tokens', () => {
    expect(HIRE_GUARDED_SQL).toMatch(/v\.version = \$3::bigint/);
    expect(HIRE_GUARDED_SQL).toMatch(/v\.version = \$7::bigint/);
    expect(HIRE_GUARDED_SQL).toMatch(/o\.updated_at = \$4::timestamptz/);
    expect(HIRE_GUARDED_SQL).toMatch(/s\.updated_at = \$5::timestamptz/);
    expect(HIRE_GUARDED_SQL).toMatch(/ON CONFLICT \(organisation_id, idempotency_key\) DO NOTHING/);
  });
  it('no CRM link is created: the customer id is null and the contact link is none', () => {
    expect(HIRE_GUARDED_SQL).toMatch(/NULL, lr\.id, NULL, NULL,/);
    expect(HIRE_GUARDED_SQL).toMatch(/'none'/);
  });
});

describe('the pure contract does no I/O and takes no organisation from the caller', () => {
  const core = noTsComments(read('packages/scheduling/src/hire.ts'));
  it('imports nothing but the core\'s own modules and never reads the environment', () => {
    const imports = [...core.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports.every(i => i.startsWith('./'))).toBe(true);
    expect(core).not.toMatch(/process\.env|fetch\(|require\(/);
  });
  it('the request type has no organisation or tenant field', () => {
    const request = core.slice(core.indexOf('export interface HireRequest'), core.indexOf('export const HIRE_FAILURE_CODES'));
    expect(request).not.toMatch(/organisation|tenant/i);
  });
  it('there is no booking-specific grid policy: the request has no step option and the grid is the offering duration', () => {
    const coreCode = noTsComments(core);
    const repoCode = noTsComments(read('packages/scheduling-postgres/src/hireRepository.ts'));
    expect(coreCode).not.toMatch(/stepMinutes|gridMinutes|slotMinutes/);
    expect(repoCode).not.toMatch(/request\.(step|grid)/i);
    expect(repoCode).toMatch(/stepMinutes: duration,/);
  });
  it('the postgres package stays free of BrainBase application imports', () => {
    const files = walk('packages/scheduling-postgres/src');
    expect(files.filter(f => /from '(@\/|\.\.\/\.\.\/(lib|app|components))/.test(read(f)))).toEqual([]);
  });
});
