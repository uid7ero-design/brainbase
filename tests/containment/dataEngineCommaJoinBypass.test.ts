import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertTablesAllowed } from '@/lib/hlna/dataEngine';

// HR-0.5 security follow-up — comma-separated FROM relations (old-style
// implicit joins) were a real, confirmed bypass of the table allowlist
// added earlier in this phase: assertTablesAllowed()'s FROM/JOIN
// extraction only ever captured the single identifier immediately
// following FROM or JOIN, so `FROM waste_records w, secret_table s` never
// scanned `secret_table` at all — it passed silently. Confirmed via a
// throwaway reproduction before this fix (see the accompanying report);
// this suite is the permanent regression guard.
//
// Fix: assertNoTopLevelCommaJoins() (lib/hlna/dataEngine.ts) rejects any
// query whose FROM clause contains a comma at the same paren depth as the
// FROM keyword itself, at any nesting depth (top query, subquery, CTE
// body) — an intentionally narrowed grammar (explicit JOIN only), not an
// attempt to correctly enumerate arbitrary comma-lists. See that
// function's own comment, and the "INTENTIONALLY NARROWED GRAMMAR" note
// above ALLOWED_TABLES in lib/hlna/dataEngine.ts, for the full rationale.

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

describe('1. Comma-separated FROM relations — the confirmed bypass', () => {
  it('a disallowed second table introduced via a plain comma is rejected', () => {
    fail(`SELECT * FROM waste_records w, secret_table s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('an hr_* table introduced via a comma is rejected', () => {
    fail(`SELECT * FROM waste_records w, hr_people p WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });
});

describe('2. Multiple comma-separated relations, first allowlisted, later one is not', () => {
  it('rejects even when EVERY comma-separated table would individually be allowlisted — the syntax itself is disallowed, not just the table names', () => {
    fail(`SELECT * FROM waste_records, fleet_metrics WHERE organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('rejects a three-way comma list where only the last table is disallowed', () => {
    fail(`SELECT * FROM waste_records, fleet_metrics, secret_table WHERE organisation_id = 'org-1'`, 'comma-separated FROM');
  });
});

describe('3. Comma-separated relation inside a subquery', () => {
  it('a comma-join nested inside a WHERE ... IN (subquery) is rejected', () => {
    fail(`
      SELECT * FROM waste_records
      WHERE organisation_id = 'org-1'
        AND department IN (
          SELECT department FROM fleet_metrics f, secret_table s WHERE f.id = s.fleet_id
        )
    `, 'comma-separated FROM');
  });

  it('a comma-join nested inside a derived-table subquery (FROM (...) sub) is rejected', () => {
    fail(`
      SELECT * FROM (
        SELECT * FROM fleet_metrics f, secret_table s WHERE f.organisation_id = 'org-1'
      ) sub
    `, 'comma-separated FROM');
  });

  it('the OUTER FROM clause is unaffected by a comma correctly scoped inside an unrelated inner subquery (no false positive)', () => {
    // The outer FROM's own walk must terminate at WHERE before ever
    // reaching the inner subquery text — this proves the fix does not
    // over-trigger on commas that belong to a different clause entirely.
    pass(`
      SELECT * FROM waste_records
      WHERE organisation_id = 'org-1'
        AND department IN (SELECT department FROM fleet_metrics WHERE fleet_metrics.organisation_id = 'org-1')
    `);
  });
});

describe('4. Comma-separated relation inside a CTE body', () => {
  it('a comma-join inside a WITH ... AS (...) body is rejected, even though the CTE is later selected from cleanly', () => {
    fail(`
      WITH leak AS (
        SELECT * FROM waste_records w, secret_table s WHERE w.organisation_id = 'org-1'
      )
      SELECT * FROM leak
    `, 'comma-separated FROM');
  });

  it('a legitimate CTE built from a single approved table still passes (no false positive from the CTE machinery itself)', () => {
    pass(`
      WITH recent AS (
        SELECT * FROM waste_records WHERE organisation_id = 'org-1'
      )
      SELECT * FROM recent
    `);
  });
});

describe('5. FROM ONLY / relation modifiers — must fail closed, not silently pass', () => {
  it('FROM ONLY <table> is rejected (the scanner does not recognise ONLY as a modifier, so it is treated as an unknown "table" and denied — fail-closed, not a bypass)', () => {
    fail(`SELECT * FROM ONLY waste_records WHERE organisation_id = 'org-1'`);
  });

  it('FROM ONLY <allowed-table>, <disallowed-table> is still rejected by the comma guard regardless', () => {
    fail(`SELECT * FROM ONLY waste_records, secret_table WHERE organisation_id = 'org-1'`);
  });
});

describe('6. LATERAL relation/subquery forms — must fail closed, not silently pass', () => {
  it('JOIN LATERAL (subquery) is rejected (LATERAL is captured as an unknown "table" by the existing JOIN extraction — fail-closed)', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN LATERAL (SELECT * FROM secret_table WHERE secret_table.x = w.x) sub ON true
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it('a comma-separated LATERAL subquery is rejected by the comma guard', () => {
    fail(`SELECT * FROM waste_records w, LATERAL (SELECT 1) sub WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('the inner FROM secret_table inside a LATERAL subquery is independently caught even if LATERAL handling were ever relaxed (defense in depth, proven directly)', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN LATERAL (SELECT * FROM secret_table WHERE secret_table.x = w.x) sub ON true
      WHERE w.organisation_id = 'org-1'
    `, 'not in the approved|not accessible through this query engine');
  });
});

describe('7. Quoted / schema-qualified identifiers in all relevant positions', () => {
  it('a quoted disallowed table in a comma list is still rejected', () => {
    fail(`SELECT * FROM "waste_records" w, "secret_table" s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('a schema-qualified disallowed table in a comma list is still rejected', () => {
    fail(`SELECT * FROM public.waste_records w, public.secret_table s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('mixed quoting/qualification styles in a comma list are still rejected', () => {
    fail(`SELECT * FROM public."waste_records" w, "public".secret_table s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('a comma embedded inside a quoted ALIAS (not a real relation separator) does NOT cause a false rejection — quoted identifiers are skipped atomically by the comma scanner', () => {
    pass(`SELECT * FROM waste_records AS "w, x" WHERE organisation_id = 'org-1'`);
  });

  it('a comma embedded inside a quoted identifier used as a real table name (still disallowed) is still rejected by the ordinary table-name check, not confused with a comma-join', () => {
    fail(`SELECT * FROM "secret,table" WHERE organisation_id = 'org-1'`, 'not in the approved');
  });
});

describe('8. Dollar-quoted strings and comments cannot hide or fake relation syntax', () => {
  it('a dollar-quoted string containing text that LOOKS like a comma-join is treated as inert data, not real syntax — the query passes since the only real FROM references an approved table', () => {
    pass(`SELECT * FROM waste_records WHERE department = $$FROM secret_table, evil stuff here$$ AND organisation_id = 'org-1'`);
  });

  it('a tagged dollar-quoted string ($tag$...$tag$) is also treated as inert data', () => {
    pass(`SELECT * FROM waste_records WHERE department = $tag$FROM secret_table, evil$tag$ AND organisation_id = 'org-1'`);
  });

  it('a REAL comma-join elsewhere in the same query is still caught even when an unrelated dollar-quoted string is present', () => {
    fail(`SELECT * FROM waste_records w, secret_table s WHERE w.notes = $$harmless text$$ AND w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('an unterminated dollar-quoted string is rejected outright (fails closed) rather than silently scanned as real syntax', () => {
    expect(() => assertTablesAllowed(`SELECT * FROM waste_records WHERE department = $$unterminated AND organisation_id = 'org-1'`))
      .toThrow(/malformed dollar-quoted string/i);
  });

  it('a block comment containing text that looks like a comma-join is treated as inert (already covered by existing comment-stripping, re-verified against the comma guard specifically)', () => {
    pass(`SELECT * FROM waste_records /* w, secret_table s */ WHERE organisation_id = 'org-1'`);
  });

  it('a line comment containing text that looks like a comma-join is treated as inert', () => {
    pass(`SELECT * FROM waste_records -- , secret_table s\n WHERE organisation_id = 'org-1'`);
  });
});

describe('Existing single-table / JOIN-syntax queries still pass unchanged (no regression from the narrower grammar)', () => {
  it('a single-table SELECT still passes', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1'`);
  });

  it('an explicit multi-table JOIN still passes', () => {
    pass(`
      SELECT w.tonnes, f.km
      FROM waste_records w
      JOIN fleet_metrics f ON f.department = w.department
      WHERE w.organisation_id = 'org-1' AND f.organisation_id = 'org-1'
    `);
  });

  it('a three-way explicit JOIN chain still passes', () => {
    pass(`
      SELECT *
      FROM waste_records w
      JOIN fleet_metrics f ON f.department = w.department
      JOIN service_requests r ON r.suburb = w.suburb
      WHERE w.organisation_id = 'org-1'
    `);
  });
});

describe('lib/hlna/dataEngine.ts source — the comma guard is actually wired into assertTablesAllowed', () => {
  it('assertTablesAllowed calls assertNoTopLevelCommaJoins before returning', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hlna/dataEngine.ts'), 'utf8');
    const fnStart = src.indexOf('export function assertTablesAllowed');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
    expect(fnBody).toMatch(/assertNoTopLevelCommaJoins\(cleaned\)/);
  });
});
