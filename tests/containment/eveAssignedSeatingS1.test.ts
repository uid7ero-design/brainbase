import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Eve assigned seating S1 — static containment. S1 ships the additive database foundation and pure
// domain helpers only. These checks pin that scope so a later change cannot quietly:
//   - turn the migration destructive or make it touch existing rows,
//   - weaken the rollback's refusal to drop real seating data,
//   - expose a live seat-selection / hold / assignment path before S3/S4 are reviewed.
// The behavioural proof is scripts/tests/verify-events-assigned-seating.sh (real PostgreSQL 16 + 17).

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, '');

const MIGRATION = 'scripts/create-events-assigned-seating.sql';
const ROLLBACK = 'scripts/rollback-events-assigned-seating.sql';
const SEATING_TABLES = [
  'seating_venues', 'seating_layouts', 'seating_layout_sections', 'seating_layout_groups', 'seating_layout_seats',
  'event_seating', 'event_ticket_type_sections', 'event_seats', 'event_seat_holds',
];

describe('assigned seating S1 migration', () => {
  const sql = stripSqlComments(read(MIGRATION));

  it('runs in one transaction with bounded lock waits and a version marker', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/^\s*COMMIT;\s*$/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(sql).toMatch(/INSERT INTO events_schema_migrations[\s\S]*'seating-s1'[\s\S]*ON CONFLICT \(version\) DO NOTHING/);
  });

  it('is additive: no drops, deletes, truncates or updates of existing data', () => {
    // Function bodies legitimately mention UPDATE/DELETE in trigger logic (TG_OP), so look only at
    // top-level statements outside $$ … $$ bodies.
    const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, '$$');
    expect(topLevel).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
    expect(topLevel).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(topLevel).not.toMatch(/\bTRUNCATE\b/i);
    expect(topLevel).not.toMatch(/^\s*UPDATE\s+/im);
    expect(topLevel).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\b/i);
  });

  it('adds only nullable / defaulted columns to existing tables', () => {
    const adds = [...sql.matchAll(/ALTER TABLE (event_ticket_types|event_attendees) ADD COLUMN IF NOT EXISTS ([^\n]+)/g)].map(m => `${m[1]}.${m[2].trim().replace(/;$/, "")}`);
    expect(adds).toEqual([
      "event_ticket_types.seating_mode text NOT NULL DEFAULT 'GENERAL_ADMISSION'",
      'event_attendees.event_seat_id    text',
      'event_attendees.seat_snapshot    jsonb',
      'event_attendees.seat_released_at timestamptz',
    ]);
  });

  it('creates exactly the approved tables (plus the version marker)', () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]).sort();
    expect(created).toEqual([...SEATING_TABLES, 'events_schema_migrations'].sort());
  });

  it('keeps the hard invariants in the database', () => {
    expect(sql).toMatch(/CONSTRAINT event_seat_holds_one_active_per_seat EXCLUDE USING gist\s*\(event_seat_id WITH =, tstzrange\(created_at, expires_at, '\[\)'\) WITH &&\) WHERE \(state = 'ACTIVE'\)/);
    expect(sql).toMatch(/expires_at <= hold_started_at \+ interval '20 minutes'/);
    expect(sql).toMatch(/renewal_count = 1 OR expires_at <= hold_started_at \+ interval '10 minutes'/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS event_attendees_active_seat_key\s+ON event_attendees \(event_seat_id\) WHERE event_seat_id IS NOT NULL AND seat_released_at IS NULL/);
    expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT \(event_id, event_session_id, layout_seat_id\)/);
    // GA rows never run the seat trigger: both attendee triggers are gated on the seat columns.
    expect(sql).toMatch(/event_attendees_seat_insert_guard BEFORE INSERT ON event_attendees\s+FOR EACH ROW WHEN \(NEW\.event_seat_id IS NOT NULL OR NEW\.seat_snapshot IS NOT NULL OR NEW\.seat_released_at IS NOT NULL\)/);
    expect(sql).toMatch(/event_ticket_types_seating_insert_guard BEFORE INSERT ON event_ticket_types\s+FOR EACH ROW WHEN \(NEW\.seating_mode <> 'GENERAL_ADMISSION'\)/);
  });
});

describe('assigned seating S1 rollback', () => {
  const sql = stripSqlComments(read(ROLLBACK));

  it('refuses before dropping anything while seating data exists', () => {
    const refusal = sql.indexOf('ROLLBACK_REFUSED');
    const firstDrop = sql.search(/\bDROP\b/);
    expect(refusal).toBeGreaterThan(-1);
    expect(firstDrop).toBeGreaterThan(refusal);
    for (const t of SEATING_TABLES) expect(sql).toContain(`'${t}'`);
    expect(sql).toMatch(/event_seat_id IS NOT NULL OR seat_snapshot IS NOT NULL OR seat_released_at IS NOT NULL/);
    expect(sql).toMatch(/seating_mode <> ''GENERAL_ADMISSION''/);
  });

  it('never uses CASCADE (a missed dependency fails loudly instead of dropping it)', () => {
    expect(sql).not.toMatch(/\bCASCADE\b/i);
  });

  it('drops btree_gist only when this migration installed it', () => {
    expect(sql).toMatch(/installed_btree_gist/);
    expect(sql).toMatch(/IF coalesce\(installed, false\) THEN[\s\S]*DROP EXTENSION IF EXISTS btree_gist/);
  });
});

describe('assigned seating S1 exposes no live path', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('no application code reads or writes the seating tables yet (S3/S4 add the routes)', () => {
    const files = ['app', 'lib', 'apps/eve/app', 'apps/eve/components', 'components']
      .map(d => path.join(ROOT, d))
      .flatMap(d => { try { return walk(d); } catch { return []; } });
    const pattern = new RegExp(`\\b(${SEATING_TABLES.join('|')})\\b`);
    const hits = files.filter(f => pattern.test(readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
