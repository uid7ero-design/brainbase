import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// Phase 2A adds the database FOUNDATION only: SQL files staged for manual execution and a
// persistence package nothing imports. These checks pin that by reading the repository, so
// enabling the module (Phase 2D) or touching LD Tennis has to change them deliberately.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noComments = (s: string) => s.replace(/--.*$/gm, '');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

describe('Phase 2A wires nothing into the application', () => {
  const appDirs = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib'];
  const sources = appDirs.filter(d => existsSync(path.join(ROOT, d))).flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mts)$/));

  it('no application code imports @scheduling/postgres', () => {
    // Phase 2B.1 (deliberate, reviewed change): the BrainBase runtime adapter is the ONE importer; the guard test pins that.
    const offenders = sources.filter(f => /@scheduling\/postgres|scheduling-postgres/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual(['lib/scheduling/runtime.ts']);
  });

  it('no application code references a scheduling_* table or either migration file', () => {
    // Phase 2B.0 (deliberate, reviewed change): lib/scheduling/crmLink.ts calls the ONE host function
    // brainbase_scheduling_find_or_create_contact (a function, not a table). Only that exact name is exempt, and only
    // in that exact file; schedulingPhase2b0Containment.test.ts pins it.
    const HOST_FUNCTION = 'brainbase_scheduling_find_or_create_contact';
    const offenders = sources
      .filter(f => {
        const text = rel(f) === 'lib/scheduling/crmLink.ts' ? readFileSync(f, 'utf8').split(HOST_FUNCTION).join('') : readFileSync(f, 'utf8');
        return /scheduling_[a-z_]+|010_shared_schema|110_brainbase_host/.test(text);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('no scheduling route, page or navigation entry exists', () => {
    // Phase 2B.1 (deliberate, reviewed change): app/api/scheduling holds exactly the status and audit foundation routes.
    for (const p of ['app/dashboard/scheduling', 'app/scheduling', 'app/book']) expect(existsSync(path.join(ROOT, p)), p).toBe(false);
    // Phase 2B.2b (deliberate, reviewed change): the configuration API adds offerings, resources and schedules.
    expect(readdirSync(path.join(ROOT, 'app/api/scheduling')).sort()).toEqual(['audit', 'offerings', 'resources', 'schedules', 'status']);
    expect(read('components/nav/navModel.ts')).not.toMatch(/scheduling/i);
  });

  it('the Prisma schema is untouched (scheduling tables are raw SQL, never Prisma models)', () => {
    expect(read('prisma/schema.prisma')).not.toMatch(/scheduling_/i);
  });

  it('no migration runner executes the scheduling SQL: it is manual (Neon SQL Editor) by design', () => {
    const runners = [...walk(path.join(ROOT, 'app'), /\.(ts|tsx)$/), ...walk(path.join(ROOT, 'lib'), /\.ts$/)];
    const offenders = runners.filter(f => /readFileSync\([^)]*\.sql/.test(readFileSync(f, 'utf8')) && /scheduling/i.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('Phase 2A SQL package is exactly what was reviewed', () => {
  it('ships exactly the shared files and the BrainBase host files, nothing else', () => {
    // Phase 2B.2 (deliberate, reviewed change) adds 030 (resource concurrency) and its rollback 091; both are pinned below.
    expect(readdirSync(path.join(ROOT, 'packages/scheduling/sql')).sort()).toEqual(['001_preflight.sql', '010_shared_schema.sql', '020_verify.sql', '030_resource_concurrency.sql', '090_rollback.sql', '091_resource_concurrency_rollback.sql']);
    // Phase 2B.0 (deliberate, reviewed change) adds 120/130 with their rollbacks and the manual/ folder; each is pinned
    // file by file in schedulingPhase2b0Containment.test.ts.
    expect(readdirSync(path.join(ROOT, 'scripts/scheduling')).sort()).toEqual([
      '110_brainbase_host.sql',
      '120_brainbase_capability.sql',
      '130_brainbase_crm_link.sql',
      '190_brainbase_host_rollback.sql',
      '191_brainbase_capability_rollback.sql',
      '192_brainbase_crm_link_rollback.sql',
      'manual',
    ]);
  });

  it('the BrainBase host migration adds exactly three foreign keys, all to organisations, and nothing else', () => {
    const host = noComments(read('scripts/scheduling/110_brainbase_host.sql'));
    const adds = [...host.matchAll(/ADD CONSTRAINT (\w+) FOREIGN KEY \((\w+)\) REFERENCES (\w+) \((\w+)\)/g)].map(m => m.slice(1, 5).join(' '));
    expect(adds).toEqual([
      'scheduling_settings_organisation_fk organisation_id organisations id',
      'scheduling_schedules_organisation_fk organisation_id organisations id',
      'scheduling_resources_organisation_fk organisation_id organisations id',
    ]);
    // Only scheduling tables are altered; no CRM or LD Tennis table is named at all.
    for (const t of [...host.matchAll(/ALTER TABLE (?:IF EXISTS )?(\w+)/g)].map(m => m[1])) expect(t).toMatch(/^scheduling_/);
    expect(host).not.toMatch(/\b(crm_contacts|contacts|bookings|sessions|session_instances|client_pipeline)\b/);
    expect(host).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  });

  it('the host rollback removes only the three constraints and the host version marker', () => {
    const rb = noComments(read('scripts/scheduling/190_brainbase_host_rollback.sql'));
    expect([...rb.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map(m => m[1])).toEqual([
      'scheduling_settings_organisation_fk',
      'scheduling_schedules_organisation_fk',
      'scheduling_resources_organisation_fk',
    ]);
    expect(rb).not.toMatch(/\bDROP TABLE\b/i);
  });

  it('the shared migration touches no LD Tennis, CRM or other BrainBase table (no read, write or reference)', () => {
    const shared = noComments(read('packages/scheduling/sql/010_shared_schema.sql'));
    // pg_timezone_names is a system catalogue view; everything else must be scheduling_*
    const reads = [...shared.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(m => m[1]).filter(t => !/^(scheduling_|pg_)/.test(t) && !/^(c|r|o|h|occ|res|hold|c)$/i.test(t) && !/^(old|new)$/i.test(t));
    expect(reads.filter(t => !['the', 'a', 'it'].includes(t))).toEqual([]);
  });

  it('030 (resource concurrency) is additive: scheduling_* objects only, no table change, no data change but its version marker', () => {
    const sql = noComments(read('packages/scheduling/sql/030_resource_concurrency.sql'));
    // objects it creates
    expect([...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)/g)].map(m => m[1]).sort()).toEqual([
      'scheduling_hold_resource_state', 'scheduling_link_guard', 'scheduling_link_release_guard', 'scheduling_preset_allows_resource_kind', 'scheduling_resource_guard',
    ]);
    expect([...sql.matchAll(/CREATE OR REPLACE TRIGGER (\w+) \w+ (?:UPDATE OF [\w, ]+|INSERT|DELETE) ON (\w+)/g)].map(m => `${m[1]} on ${m[2]}`).sort()).toEqual([
      'scheduling_holds_resource_state on scheduling_resource_holds',
      'scheduling_offering_resources_guard on scheduling_offering_resources',
      'scheduling_offering_resources_release_guard on scheduling_offering_resources',
      'scheduling_resources_guard on scheduling_resources',
    ]);
    // it never alters, drops, truncates or deletes, and writes exactly one row: the version marker
    expect(sql).not.toMatch(/\b(ALTER TABLE|DROP TABLE|DROP FUNCTION|DROP TRIGGER|TRUNCATE|DELETE FROM|CREATE TABLE|UPDATE\s+\w+\s+SET)\b/i);
    expect([...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1])).toEqual(['scheduling_schema_migrations']);
    // it reads only scheduling_* tables
    const reads = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(m => m[1]).filter(t => !/^(scheduling_|pg_)/.test(t) && !/^(old|new)$/i.test(t));
    expect(reads).toEqual([]);
    // every function takes the per-resource advisory lock before it reads what it guards, and bounds its waits
    for (const fn of sql.split('CREATE OR REPLACE FUNCTION ').slice(1)) {
      if (/^scheduling_preset_allows_resource_kind/.test(fn)) continue;
      expect(fn.slice(0, fn.indexOf('$$;', 20))).toMatch(/lock_timeout = '5s'/);
      expect(fn).toMatch(/pg_advisory_xact_lock\(hashtextextended\('scheduling_resource:'/);
    }
    // no host table is named: a standalone database can apply it
    expect(sql).not.toMatch(/\b(organisations|users|crm_contacts|contacts|bookings|sessions|audit_logs)\b/);
  });

  it('091 removes exactly what 030 added and touches no data', () => {
    const rb = noComments(read('packages/scheduling/sql/091_resource_concurrency_rollback.sql'));
    expect([...rb.matchAll(/DROP TRIGGER IF EXISTS (\w+)/g)].map(m => m[1]).sort()).toEqual([
      'scheduling_holds_resource_state', 'scheduling_offering_resources_guard', 'scheduling_offering_resources_release_guard', 'scheduling_resources_guard',
    ]);
    expect([...rb.matchAll(/DROP FUNCTION IF EXISTS (\w+)/g)].map(m => m[1]).sort()).toEqual([
      'scheduling_hold_resource_state', 'scheduling_link_guard', 'scheduling_link_release_guard', 'scheduling_preset_allows_resource_kind', 'scheduling_resource_guard',
    ]);
    expect(rb).not.toMatch(/\b(DROP TABLE|TRUNCATE|ALTER TABLE|INSERT INTO)\b/i);
    expect([...rb.matchAll(/DELETE FROM (\w+)[^;]*;/g)].map(m => m[0].replace(/\s+/g, ' '))).toEqual(["DELETE FROM scheduling_schema_migrations WHERE version = '2b.2.1';"]);
  });

  it('the integration tests can only reach a database named by SCHEDULING_TEST_DATABASE_URL, never DATABASE_URL', () => {
    const dir = path.join(ROOT, 'packages/scheduling-postgres/tests');
    for (const f of walk(dir, /\.ts$/)) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, rel(f)).not.toMatch(/process\.env\.DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL/);
    }
    expect(read('packages/scheduling-postgres/tests/support/pgHarness.ts')).toContain('SCHEDULING_TEST_DATABASE_URL');
  });

  it('the path aliases for the new package exist in tsconfig and both vitest configs', () => {
    expect(read('tsconfig.json')).toContain('"@scheduling/postgres"');
    expect(read('vitest.config.ts')).toContain("'@scheduling/postgres'");
    expect(read('vitest.integration.config.ts')).toContain("'@scheduling/postgres'");
  });
});

describe('LD Tennis is not touched', () => {
  const tennisFiles = [
    'app/api/tennis/book/route.ts',
    'app/api/dashboard/enrolments/route.ts',
    'app/api/dashboard/sessions/route.ts',
    'app/api/bookings/route.ts',
    'lib/tennisRecurrence.ts',
  ].filter(f => existsSync(path.join(ROOT, f)));

  it('no LD Tennis booking, session or recurrence file mentions the scheduling tables or packages', () => {
    expect(tennisFiles.length).toBeGreaterThan(0);
    for (const f of tennisFiles) expect(read(f), f).not.toMatch(/scheduling_|@scheduling\//);
  });
});
