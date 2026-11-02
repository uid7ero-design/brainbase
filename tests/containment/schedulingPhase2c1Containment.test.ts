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
  it('has no migration beyond 037 and no rollback beyond 098', () => {
    const names = readdirSync(path.join(ROOT, 'packages/scheduling/sql'));
    const numbers = names.map(n => Number(n.slice(0, 3))).filter(Number.isFinite);
    expect(Math.max(...numbers)).toBe(98);
    expect(names.filter(n => /^0(3[8-9]|[4-8]\d)_/.test(n))).toEqual([]);
    expect(names.filter(n => /^099_|^1\d\d_/.test(n))).toEqual([]);
  });
  it('037 is additive: it creates its own table, functions and triggers and alters, drops or updates nothing that exists', () => {
    const sql = read('packages/scheduling/sql/037_availability_versions.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TRIGGER|CONSTRAINT)\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+scheduling_(offerings|resources|reservations|occurrences|schedules)\b/i);
    expect(sql).not.toMatch(/ld_tennis|ticketing|events?_|tennis/i);
    // The only tables it creates or writes are its own, plus the registry row.
    expect([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1])).toEqual(['scheduling_availability_versions']);
    expect([...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(['scheduling_availability_versions', 'scheduling_schema_migrations']);
  });
  it('every bump is an UPDATE of an existing row, so deleting an owner cannot recreate its version row', () => {
    const sql = read('packages/scheduling/sql/037_availability_versions.sql').replace(/--.*$/gm, '');
    const bump = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION scheduling_bump_availability_version_of'), sql.indexOf('CREATE OR REPLACE FUNCTION scheduling_bump_availability_version()'));
    expect(bump).toMatch(/UPDATE scheduling_availability_versions/);
    expect(bump).not.toMatch(/INSERT/);
  });
  it('the rollback is independent and removes everything 037 adds', () => {
    const sql = read('packages/scheduling/sql/098_availability_versions_rollback.sql').replace(/--.*$/gm, '');
    expect(sql).toMatch(/DROP TABLE IF EXISTS scheduling_availability_versions/);
    expect((sql.match(/DROP TRIGGER IF EXISTS/g) ?? []).length).toBe(7);
    expect((sql.match(/DROP FUNCTION IF EXISTS/g) ?? []).length).toBe(5);
    expect(sql).toMatch(/DELETE FROM scheduling_schema_migrations WHERE version = '2c\.3\.1'/);
  });
  it('the old prototype fixture is gone and no booking code reads the version table yet', () => {
    expect(() => read('packages/scheduling-postgres/tests/support/prototype038AvailabilityVersion.sql')).toThrow();
    for (const dir of ['app', 'lib', 'packages/scheduling/src', 'packages/scheduling-postgres/src']) {
      const offenders = walk(dir).filter(f => /\.(ts|tsx)$/.test(f)).filter(f => /scheduling_availability_versions/.test(read(f)));
      expect(offenders, dir).toEqual([]);
    }
  });
});
