import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

vi.setConfig({ testTimeout: 60_000 });

// Phase 2C.1 adds the PURE booking core and nothing that can write: no migration, no route, no screen, no caller. This file pins that the core is reachable from
// nowhere in the application yet, that no booking-writing route exists, and that the shared schema is exactly the one already approved (through 036).

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

const CORE_API = ['planOccurrences', 'evaluateSlotBooking', 'evaluateHeadcount', 'planSeriesEnrolments', 'bookingRefusal', 'refusalCodeFromSchedulingError'];

describe('the booking core is not reachable from the application', () => {
  const files = [...walk('app'), ...walk('lib'), ...walk('components')].filter(f => /\.(ts|tsx)$/.test(f));
  it('no application file uses the 2C.1 booking functions', () => {
    const users = files.filter(f => CORE_API.some(n => new RegExp(`\b${n}\b`).test(noTsComments(read(f)))));
    expect(users).toEqual([]);
  });
});

describe('there is still no booking-writing route', () => {
  const routes = walk('app/api/scheduling').filter(f => /route\.ts$/.test(f));
  it('no route under a reservation, occurrence, series or booking path exports a write method', () => {
    const offenders = routes
      .filter(f => /reservation|occurrence|series|booking|enrol|attendance/i.test(f))
      .filter(f => /export const (POST|PUT|PATCH|DELETE)\b/.test(noTsComments(read(f))));
    expect(offenders).toEqual([]);
  });
  it('no scheduling route anywhere calls a reservation, occurrence or series write', () => {
    const offenders = routes.filter(f => /\.(createOccurrence|cancelOccurrence|createSeries|addSeriesPause|setAttendance)\(|reservations\.(create|createAssigned|cancel)\(/.test(noTsComments(read(f))));
    expect(offenders).toEqual([]);
  });
});

describe('the shared schema is exactly the approved one', () => {
  it('has no migration beyond 036 and no rollback beyond 097', () => {
    const names = readdirSync(path.join(ROOT, 'packages/scheduling/sql'));
    const numbers = names.map(n => Number(n.slice(0, 3))).filter(Number.isFinite);
    expect(Math.max(...numbers)).toBe(97);
    expect(names.filter(n => /^0(3[7-9]|[4-8]\d)_/.test(n))).toEqual([]);
  });
  it('the Phase 2C availability-version prototype is a test fixture, not a migration', () => {
    const names = readdirSync(path.join(ROOT, 'packages/scheduling/sql'));
    expect(names.some(n => /availability_version/i.test(n))).toBe(false);
    expect(read('packages/scheduling-postgres/tests/support/prototype038AvailabilityVersion.sql')).toMatch(/THIS IS NOT A MIGRATION/);
  });
});
