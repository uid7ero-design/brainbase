import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertTablesAllowed, ALLOWED_TABLES } from '@/lib/hlna/dataEngine';

// HR-0.5 §2 — regression coverage for lib/hlna/dataEngine.ts's table
// allowlist. HR-0 confirmed the prior guards (SELECT-only, no write
// keywords, no semicolons, organisation_id text+literal presence) never
// restricted WHICH tables model-generated SQL could reference — this suite
// proves assertTablesAllowed() closes that gap, using source/static
// fixtures only (no HR table is created anywhere in this repo).

function pass(sql: string) {
  expect(() => assertTablesAllowed(sql)).not.toThrow();
}
function fail(sql: string, messageFragment?: string) {
  if (messageFragment) {
    expect(() => assertTablesAllowed(sql)).toThrowError(new RegExp(messageFragment, 'i'));
  } else {
    expect(() => assertTablesAllowed(sql)).toThrow();
  }
}

describe('assertTablesAllowed — approved queries pass', () => {
  it('approved single-table SELECT passes', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1'`);
  });

  it('approved multi-table JOIN passes', () => {
    pass(`
      SELECT w.tonnes, f.km
      FROM waste_records w
      JOIN fleet_metrics f ON f.department = w.department
      WHERE w.organisation_id = 'org-1' AND f.organisation_id = 'org-1'
    `);
  });

  it('every table named in DB_SCHEMA is present in ALLOWED_TABLES', () => {
    expect(ALLOWED_TABLES.has('waste_records')).toBe(true);
    expect(ALLOWED_TABLES.has('fleet_metrics')).toBe(true);
    expect(ALLOWED_TABLES.has('service_requests')).toBe(true);
    expect(ALLOWED_TABLES.has('metric_snapshots')).toBe(true);
  });

  it('a CTE built entirely from approved tables passes, and the CTE name itself is not treated as an unknown table', () => {
    pass(`
      WITH recent AS (
        SELECT * FROM waste_records WHERE organisation_id = 'org-1'
      )
      SELECT * FROM recent
    `);
  });

  it('a subquery referencing only approved tables passes', () => {
    pass(`
      SELECT * FROM (
        SELECT * FROM fleet_metrics WHERE organisation_id = 'org-1'
      ) sub
    `);
  });

  it('schema-qualified approved table names pass (only the base table name is checked)', () => {
    pass(`SELECT * FROM public.waste_records WHERE organisation_id = 'org-1'`);
  });

  it('quoted approved table names pass', () => {
    pass(`SELECT * FROM "waste_records" WHERE organisation_id = 'org-1'`);
  });

  it('a table name mentioned only inside a string literal does not cause a false rejection', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND department = 'hr_people'`);
  });

  it('a table name mentioned only inside a line comment does not cause a false rejection', () => {
    pass(`SELECT * FROM waste_records -- references hr_people here, but only in a comment\n WHERE organisation_id = 'org-1'`);
  });

  it('a table name mentioned only inside a block comment does not cause a false rejection', () => {
    pass(`SELECT * FROM waste_records /* hr_people */ WHERE organisation_id = 'org-1'`);
  });
});

describe('assertTablesAllowed — unapproved / unknown tables fail', () => {
  it('an entirely unknown table fails', () => {
    fail(`SELECT * FROM some_unknown_table WHERE organisation_id = 'org-1'`, 'not in the approved');
  });

  it('an hr_people reference fails, with an hr-specific error', () => {
    fail(`SELECT * FROM hr_people WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
  });

  it('an hr_ prefixed table fails even if it were hypothetically added to ALLOWED_TABLES (deny-list wins)', () => {
    const originallyHad = ALLOWED_TABLES.has('hr_people');
    ALLOWED_TABLES.add('hr_people');
    try {
      fail(`SELECT * FROM hr_people WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
    } finally {
      if (!originallyHad) ALLOWED_TABLES.delete('hr_people');
    }
  });

  it('an unknown table in a JOIN fails', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN hr_documents d ON d.organisation_id = w.organisation_id
      WHERE w.organisation_id = 'org-1'
    `, 'not accessible through this query engine');
  });

  it('an unknown table in a subquery fails', () => {
    fail(`
      SELECT * FROM (
        SELECT * FROM hr_administrators WHERE organisation_id = 'org-1'
      ) sub
    `, 'not accessible through this query engine');
  });

  it('an unknown table referenced only inside a CTE body fails, even though the CTE itself is later selected from', () => {
    fail(`
      WITH leak AS (
        SELECT * FROM hr_people WHERE organisation_id = 'org-1'
      )
      SELECT * FROM leak
    `, 'not accessible through this query engine');
  });

  it('an unknown table alongside an approved table in the same JOIN fails (one bad table is enough to reject)', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN some_unknown_table u ON u.id = w.id
      WHERE w.organisation_id = 'org-1'
    `, 'not in the approved');
  });
});

describe('assertTablesAllowed — aliases and schema-qualification do not bypass the check', () => {
  it('an alias on an unknown table does not disguise it', () => {
    fail(`SELECT * FROM hr_people hp WHERE hp.organisation_id = 'org-1'`, 'not accessible through this query engine');
  });

  it('an alias with AS on an unknown table does not disguise it', () => {
    fail(`SELECT * FROM hr_people AS hp WHERE hp.organisation_id = 'org-1'`, 'not accessible through this query engine');
  });

  it('schema-qualifying an unknown table does not disguise it', () => {
    fail(`SELECT * FROM public.hr_people WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
  });

  it('quoting an unknown table does not disguise it', () => {
    fail(`SELECT * FROM "hr_people" WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
  });

  it('mixed-case unknown table names are still caught (case-insensitive comparison)', () => {
    fail(`SELECT * FROM HR_PEOPLE WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
  });
});

describe('assertTablesAllowed — malformed/obfuscated comments fail closed', () => {
  it('an unterminated block comment is rejected', () => {
    expect(() => assertTablesAllowed(`SELECT * FROM waste_records /* unterminated WHERE organisation_id = 'org-1'`))
      .toThrow(/malformed comment/i);
  });

  it('a nested block comment is rejected rather than silently unwrapped', () => {
    expect(() => assertTablesAllowed(`SELECT * FROM waste_records /* outer /* inner */ still-outer */ WHERE organisation_id = 'org-1'`))
      .toThrow(/nested comments/i);
  });
});

describe('executeQuery — existing guards are preserved (HR-0.5 must not weaken them)', () => {
  it('multiple statements still fail', async () => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
    // Two harmless SELECTs (no write keyword involved) so this exercises
    // the semicolon/multi-statement guard specifically, not the separate
    // write-keyword guard.
    await expect(executeQuery(
      `SELECT * FROM waste_records WHERE organisation_id = 'org-1'; SELECT * FROM waste_records WHERE organisation_id = 'org-1';`,
      'org-1',
    )).rejects.toThrow(/multi-statement/i);
  });

  it('write statements still fail', async () => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
    await expect(executeQuery(`UPDATE waste_records SET tonnes = 0 WHERE organisation_id = 'org-1'`, 'org-1'))
      .rejects.toThrow(/only select/i);
  });

  it('missing organisation scoping still fails', async () => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
    await expect(executeQuery(`SELECT * FROM waste_records`, 'org-1'))
      .rejects.toThrow(/organisation_id/i);
  });

  it('a query referencing the correct org id but an unapproved table is rejected by the new table guard, not silently allowed through the existing guards', async () => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
    await expect(executeQuery(`SELECT * FROM hr_people WHERE organisation_id = 'org-1'`, 'org-1'))
      .rejects.toThrow(/not accessible through this query engine/i);
  });
});

describe('lib/hlna/dataEngine.ts source — structural guarantees', () => {
  function read(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
  }

  it('executeQuery calls assertTablesAllowed before executing, not just defining it unused', () => {
    const src = read('lib/hlna/dataEngine.ts');
    const execStart = src.indexOf('export async function executeQuery');
    expect(execStart).toBeGreaterThan(-1);
    const execBody = src.slice(execStart);
    expect(execBody).toMatch(/assertTablesAllowed\(clean\)/);
  });

  it('DB_SCHEMA is never referenced by the enforcement logic (prompt content is not a security boundary)', () => {
    const src = read('lib/hlna/dataEngine.ts');
    const allowlistSectionStart = src.indexOf('export const ALLOWED_TABLES');
    const allowlistSectionEnd = src.indexOf('// ─── Query execution');
    const allowlistSection = src.slice(allowlistSectionStart, allowlistSectionEnd);
    expect(allowlistSection).not.toMatch(/DB_SCHEMA/);
  });
});
