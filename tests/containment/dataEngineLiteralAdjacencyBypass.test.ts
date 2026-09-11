import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertTablesAllowed, ALLOWED_TABLES } from '@/lib/hlna/dataEngine';

// HR-0.5 security follow-up (third round) — the block-comment adjacency
// fix (dataEngineCommentAdjacencyBypass.test.ts) closed one instance of a
// mechanical pattern in stripLiteralsAndComments(): deleting lexical
// content with NO replacement character, which can concatenate two
// otherwise-separate SQL tokens. During verification of that fix, the
// SAME pattern was confirmed present in two more branches of the same
// function:
//   - single-quoted string literals (`'...'`)
//   - dollar-quoted string literals (`$tag$...$tag$`)
// Empirically confirmed before this fix:
//   assertTablesAllowed(`SELECT * FROM'x'hr_people WHERE organisation_id = 'org-1'`)   // did not throw
//   assertTablesAllowed(`SELECT * FROM$$x$$hr_people WHERE organisation_id = 'org-1'`) // did not throw
//
// The security invariant this suite proves: removing literals/comments
// for analysis must never concatenate otherwise-separate SQL tokens, and
// the guard must not rely on Postgres separately rejecting whatever
// malformed adjacency the scanner's own stripping produces (see the
// "why this cannot introduce false acceptance" comment above
// ALLOWED_TABLES in lib/hlna/dataEngine.ts for the safety argument that
// justified this fix).
//
// A SEPARATE, genuinely distinct defect was also found and fixed while
// verifying this: unlike the block-comment and dollar-quote branches
// (which already threw on an unterminated construct), the single-quote
// branch had NO unterminated-literal check at all — an unterminated
// string silently swallowed everything to end-of-input, including any
// real FROM/JOIN text that followed, with no error. This now fails
// closed identically to the other two branches. See items 13 below.

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

describe('1-2. Single-quote adjacency after FROM/JOIN cannot bypass table enforcement', () => {
  it('1. FROM\'x\'hr_people does not bypass table enforcement', () => {
    fail(`SELECT * FROM'x'hr_people WHERE organisation_id = 'org-1'`);
  });

  it('2. JOIN\'x\'secret_table does not bypass table enforcement', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN'x'secret_table s ON w.id = s.id
      WHERE w.organisation_id = 'org-1'
    `);
  });
});

describe('3-4. Single-quoted adjacency in a subquery/CTE does not bypass enforcement', () => {
  it('3. single-quoted adjacency inside a WHERE...IN(subquery) does not bypass enforcement', () => {
    fail(`
      SELECT * FROM waste_records
      WHERE organisation_id = 'org-1'
        AND department IN (SELECT department FROM'x'hr_people)
    `);
  });

  it('3b. single-quoted adjacency inside a derived-table subquery does not bypass enforcement', () => {
    fail(`
      SELECT * FROM (
        SELECT * FROM'x'secret_table WHERE organisation_id = 'org-1'
      ) sub
    `);
  });

  it('4. single-quoted adjacency inside a WITH ... AS (...) CTE body does not bypass enforcement', () => {
    fail(`
      WITH leak AS (
        SELECT * FROM'x'hr_people WHERE organisation_id = 'org-1'
      )
      SELECT * FROM leak
    `);
  });
});

describe('5-6. Dollar-quote adjacency after FROM/JOIN cannot bypass table enforcement', () => {
  it('5. FROM$$x$$hr_people does not bypass enforcement', () => {
    fail(`SELECT * FROM$$x$$hr_people WHERE organisation_id = 'org-1'`);
  });

  it('6. JOIN$$x$$secret_table does not bypass enforcement', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN$$x$$secret_table s ON w.id = s.id
      WHERE w.organisation_id = 'org-1'
    `);
  });
});

describe('7. Tagged dollar-quote adjacency cannot bypass enforcement', () => {
  it('a tagged $tag$...$tag$ delimiter glued to FROM does not bypass enforcement', () => {
    fail(`SELECT * FROM$tag$x$tag$hr_people WHERE organisation_id = 'org-1'`);
  });

  it('a tagged $tag$...$tag$ delimiter glued to JOIN does not bypass enforcement', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN$body$x$body$secret_table s ON w.id = s.id
      WHERE w.organisation_id = 'org-1'
    `);
  });
});

describe('8-9. Dollar-quoted adjacency in a subquery/CTE cannot bypass enforcement', () => {
  it('8. dollar-quoted adjacency inside a subquery does not bypass enforcement', () => {
    fail(`
      SELECT * FROM (
        SELECT * FROM$$x$$secret_table WHERE organisation_id = 'org-1'
      ) sub
    `);
  });

  it('9. dollar-quoted adjacency inside a CTE body does not bypass enforcement', () => {
    fail(`
      WITH leak AS (
        SELECT * FROM$$x$$hr_people WHERE organisation_id = 'org-1'
      )
      SELECT * FROM leak
    `);
  });
});

describe('10-11. Allowed tables after zero-whitespace literal adjacency still pass (the fix must not over-reject)', () => {
  it('10a. FROM\'x\'waste_records (allowed table after single-quote adjacency) still passes', () => {
    pass(`SELECT * FROM'x'waste_records WHERE organisation_id = 'org-1'`);
  });

  it('10b. ordinary string literal in a WHERE predicate remains inert to relation scanning', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND department = 'General Waste'`);
  });

  it('10c. an escaped \'\' quote inside a string literal is still parsed correctly, not mistaken for a close', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND department = 'O''Brien Waste'`);
  });

  it('11a. FROM$$x$$waste_records (allowed table after dollar-quote adjacency) still passes', () => {
    pass(`SELECT * FROM$$x$$waste_records WHERE organisation_id = 'org-1'`);
  });

  it('11b. ordinary dollar-quoted literal in a WHERE predicate remains inert to relation scanning', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = $$hello world$$`);
  });
});

describe('12. String/comment content containing FROM, JOIN, commas, or fake table names does not generate false relation references', () => {
  it('a single-quoted string mentioning "FROM hr_people, secret_table" as literal text is inert', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = 'FROM hr_people, secret_table'`);
  });

  it('a dollar-quoted string mentioning "FROM hr_people, secret_table" as literal text is inert', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = $$FROM hr_people, secret_table$$`);
  });

  it('a block comment mentioning fake relation text is still inert (regression re-check)', () => {
    pass(`SELECT * FROM waste_records /* FROM hr_people, secret_table */ WHERE organisation_id = 'org-1'`);
  });
});

describe('13. Unterminated single/dollar literals fail closed', () => {
  it('an unterminated single-quoted string is now rejected (previously silently swallowed the rest of the query)', () => {
    fail(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = 'unterminated`, 'malformed string literal');
  });

  it('an unterminated single-quoted string that would otherwise swallow a real disallowed table reference is rejected', () => {
    fail(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = 'unterminated FROM secret_table`, 'malformed string literal');
  });

  it('an unterminated dollar-quoted string is still rejected (unchanged behavior, re-verified)', () => {
    fail(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' AND notes = $$unterminated`, 'malformed dollar-quoted string');
  });
});

describe('14. Block-comment adjacency regression remains fixed', () => {
  it('FROM/* x */hr_people is still rejected', () => {
    fail(`SELECT * FROM/* x */hr_people WHERE organisation_id = 'org-1'`);
  });
});

describe('15. Line-comment adjacency remains correct', () => {
  it('FROM--comment\\nhr_people is still rejected', () => {
    fail(`SELECT * FROM--comment\nhr_people WHERE organisation_id = 'org-1'`);
  });

  it('FROM--comment\\nwaste_records (allowed table) still passes', () => {
    pass(`SELECT * FROM--comment\nwaste_records WHERE organisation_id = 'org-1'`);
  });
});

describe('16. Comma-join rejection remains intact', () => {
  it('a plain comma-join is still rejected', () => {
    fail(`SELECT * FROM waste_records w, secret_table s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('a comma-join combined with literal adjacency is still rejected', () => {
    fail(`SELECT * FROM'x'waste_records w, secret_table s WHERE w.organisation_id = 'org-1'`);
  });
});

describe('17. Explicit JOINs over approved tables still pass', () => {
  it('a three-way explicit JOIN chain over approved tables still passes', () => {
    pass(`
      SELECT *
      FROM waste_records w
      JOIN fleet_metrics f ON f.department = w.department
      JOIN service_requests r ON r.suburb = w.suburb
      WHERE w.organisation_id = 'org-1'
    `);
  });
});

describe('18. hr_* remains unconditionally denied', () => {
  it('hr_people is denied via the literal-adjacency vector even when forced into ALLOWED_TABLES', () => {
    const originallyHad = ALLOWED_TABLES.has('hr_people');
    ALLOWED_TABLES.add('hr_people');
    try {
      fail(`SELECT * FROM'x'hr_people WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
    } finally {
      if (!originallyHad) ALLOWED_TABLES.delete('hr_people');
    }
  });

  it('ALLOWED_TABLES content itself is unchanged by this fix', () => {
    expect([...ALLOWED_TABLES].sort()).toEqual(['fleet_metrics', 'metric_snapshots', 'service_requests', 'waste_records']);
  });
});

describe('19. Unknown tables remain denied', () => {
  it('an entirely unknown table (not hr_*) is still rejected after literal-adjacency', () => {
    fail(`SELECT * FROM'x'some_unknown_table WHERE organisation_id = 'org-1'`, 'not in the approved');
  });
});

describe('20. Existing SELECT-only/write/multi-statement/org-scope protections remain unchanged', () => {
  it('multiple statements still fail', async () => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
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
});

describe('lib/hlna/dataEngine.ts source — the fixes are present', () => {
  it('the single-quote branch inserts a separator and checks for an unterminated literal', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hlna/dataEngine.ts'), 'utf8');
    const branchStart = src.indexOf('if (ch === "\'")');
    const branchEnd = src.indexOf('\n    }', branchStart);
    const branch = src.slice(branchStart, branchEnd);
    expect(branch).toMatch(/out\s*\+=\s*['"]\s['"];/);
    expect(branch).toMatch(/throw new Error\('Malformed string literal in query\.'\)/);
  });

  it('the dollar-quote branch inserts a separator', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hlna/dataEngine.ts'), 'utf8');
    const branchStart = src.indexOf("if (ch === '$')");
    const branchEnd = src.indexOf('\n    }', branchStart);
    const branch = src.slice(branchStart, branchEnd);
    expect(branch).toMatch(/out\s*\+=\s*['"]\s['"];/);
  });
});
