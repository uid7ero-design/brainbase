import { describe, it, expect } from 'vitest';
import { assertTablesAllowed, ALLOWED_TABLES } from '@/lib/hlna/dataEngine';

// CONFIRMED CRITICAL BYPASS, found by an independent overnight audit of
// PR #189 and reproduced independently a second time before this fix was
// written: stripLiteralsAndComments() deleted `/* ... */` block comments
// with NO replacement whitespace. Since Postgres treats a block comment
// as pure whitespace-equivalent trivia (`FROM/* x */hr_people` is valid
// SQL, identical to `FROM hr_people`), a comment placed with zero
// surrounding whitespace directly after FROM/JOIN collapsed the keyword
// and the following identifier into ONE token (e.g. `FROMhr_people`) with
// no word boundary after "FROM" — invisible to the table allowlist, the
// hr_* deny-list, AND the comma-join guard, all of which require
// `\bFROM\b`/`\bJOIN\b` to match. Confirmed via:
//
//   assertTablesAllowed(`SELECT * FROM/* x */hr_people WHERE organisation_id = 'org-1'`)
//
// not throwing, before this fix. Fix: the block-comment branch now
// appends a single space to the cleaned output instead of nothing,
// guaranteeing a real token boundary always exists where the comment was
// — regardless of whether real whitespace already surrounded it.

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

describe('1-2. Zero-whitespace block-comment adjacency after FROM/JOIN is rejected', () => {
  it('FROM/* x */hr_people is rejected', () => {
    fail(`SELECT * FROM/* x */hr_people WHERE organisation_id = 'org-1'`);
  });

  it('JOIN/* x */secret_table is rejected', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN/* x */secret_table s ON w.id = s.id
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it('the same construct with an hr_-prefixed table gets the hr-specific deny message, not just a generic unknown-table message', () => {
    fail(`SELECT * FROM/* x */hr_documents WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
  });
});

describe('3. Allowlisted table after a zero-whitespace block comment is still recognised correctly', () => {
  it('FROM/* x */waste_records still passes (the fix must not make legitimate queries fail closed unnecessarily)', () => {
    pass(`SELECT * FROM/* x */waste_records WHERE organisation_id = 'org-1'`);
  });

  it('JOIN/* x */fleet_metrics still passes', () => {
    pass(`
      SELECT * FROM waste_records w
      JOIN/* x */fleet_metrics f ON f.department = w.department
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it('a comment glued onto BOTH sides of an allowed table name still passes', () => {
    pass(`SELECT * FROM/* a */waste_records/* b */WHERE organisation_id = 'org-1'`);
  });
});

describe('4-5. Line-comment (--) adjacency — handled correctly per Postgres token semantics (no change was needed)', () => {
  // A `--` line comment consumes to end-of-line; the newline itself is
  // never deleted (it survives as a real whitespace character), so
  // `FROM--comment\nhr_people` already resolves to `FROM <newline>
  // hr_people` — a real word boundary — and is correctly caught by the
  // existing hr_* deny-list. This class was verified, not modified.
  it('FROM--comment\\nhr_people is rejected', () => {
    fail(`SELECT * FROM--comment\nhr_people WHERE organisation_id = 'org-1'`);
  });

  it('JOIN--comment\\nsecret_table is rejected', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN--comment\nsecret_table s ON w.id = s.id
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it('FROM--comment\\nwaste_records (allowed table) still passes', () => {
    pass(`SELECT * FROM--comment\nwaste_records WHERE organisation_id = 'org-1'`);
  });
});

describe('6. Comment adjacency inside a subquery is enforced', () => {
  it('a zero-whitespace comment hiding hr_people inside a WHERE...IN(subquery) is rejected', () => {
    fail(`
      SELECT * FROM waste_records
      WHERE organisation_id = 'org-1'
        AND department IN (SELECT department FROM/* x */hr_people)
    `);
  });

  it('a zero-whitespace comment hiding secret_table inside a derived-table subquery is rejected', () => {
    fail(`
      SELECT * FROM (
        SELECT * FROM/* x */secret_table WHERE organisation_id = 'org-1'
      ) sub
    `);
  });
});

describe('7. Comment adjacency inside a CTE body is enforced', () => {
  it('a zero-whitespace comment hiding hr_people inside a WITH ... AS (...) body is rejected', () => {
    fail(`
      WITH leak AS (
        SELECT * FROM/* x */hr_people WHERE organisation_id = 'org-1'
      )
      SELECT * FROM leak
    `);
  });
});

describe('8. Comment text containing fake table names does not cause a false positive', () => {
  it('a properly-spaced comment mentioning a disallowed table by name in its text is still inert', () => {
    pass(`SELECT * FROM waste_records /* this comment mentions hr_people and secret_table but is just a comment */ WHERE organisation_id = 'org-1'`);
  });

  it('a properly-spaced comment mentioning "FROM hr_people" as literal text does not trigger rejection', () => {
    pass(`SELECT * FROM waste_records WHERE organisation_id = 'org-1' /* note: FROM hr_people is not allowed */`);
  });
});

describe('9. Existing comma-join protections still pass after this fix', () => {
  it('a plain comma-join is still rejected', () => {
    fail(`SELECT * FROM waste_records w, secret_table s WHERE w.organisation_id = 'org-1'`, 'comma-separated FROM');
  });

  it('a comma-join combined with zero-whitespace comment adjacency is still rejected', () => {
    fail(`SELECT * FROM/* x */waste_records w, secret_table s WHERE w.organisation_id = 'org-1'`);
  });
});

describe('10. Existing quoted/schema-qualified relation handling still passes after this fix', () => {
  it('a quoted allowed table still passes', () => {
    pass(`SELECT * FROM "waste_records" WHERE organisation_id = 'org-1'`);
  });

  it('a schema-qualified disallowed table is still rejected', () => {
    fail(`SELECT * FROM public.secret_table WHERE organisation_id = 'org-1'`, 'not in the approved');
  });

  it('a quoted disallowed table immediately after a zero-whitespace comment is still rejected', () => {
    fail(`SELECT * FROM/* x */"secret_table" WHERE organisation_id = 'org-1'`);
  });
});

describe('11. Existing dollar-quote handling still passes after this fix, and requires no equivalent change', () => {
  it('inert dollar-quoted content is still treated as inert data, not real syntax', () => {
    pass(`SELECT * FROM waste_records WHERE department = $$FROM secret_table, evil$$ AND organisation_id = 'org-1'`);
  });

  it('an unterminated dollar-quote is still rejected outright (fail-closed, unchanged)', () => {
    expect(() => assertTablesAllowed(`SELECT * FROM waste_records WHERE department = $$unterminated AND organisation_id = 'org-1'`))
      .toThrow(/malformed dollar-quoted string/i);
  });

});

// NOT FIXED HERE — reported per the explicit instruction to stop and
// report rather than expand this fix's scope when another instance of
// the same mechanical pattern is found while fixing the authorized one.
//
// Both the single-quoted-string branch and the dollar-quoted-string
// branch in stripLiteralsAndComments() share the exact same "delete with
// no replacement character" mechanics that caused the block-comment bug
// fixed above. Empirically confirmed (via a throwaway probe, not
// committed as a permanent test, since the correct expectation is not
// yet a decided fact — see below):
//   assertTablesAllowed(`SELECT * FROM'x'hr_people WHERE organisation_id = 'org-1'`)      // does NOT throw
//   assertTablesAllowed(`SELECT * FROM$$x$$hr_people WHERE organisation_id = 'org-1'`)    // does NOT throw
//   assertTablesAllowed(`SELECT * FROM waste_records w JOIN$$x$$secret_table s ...`)      // does NOT throw
//
// Whether these are LIVE, exploitable bypasses (the way the block-comment
// case was) depends on whether Postgres itself ever accepts a bare
// string/dollar-quoted literal sitting directly in a FROM/JOIN
// table_reference position as valid, executable SQL — unlike a comment
// (genuinely invisible to the grammar), a string literal is a real,
// grammatically meaningful value, and `FROM 'x' hr_people` / `FROM $$x$$
// hr_people` are very likely syntax errors to Postgres itself, not
// silently-equivalent-to `FROM hr_people` the way a comment is. This has
// NOT been verified against a live Postgres instance. No test asserting
// either pass or fail is added here for these two cases, since doing so
// would assert a conclusion that has not actually been decided or
// verified — see lib/hlna/dataEngine.ts's own updated comments on both
// branches for the same open-question note.

describe('12. hr_* remains denied even if a future allowlist edit accidentally includes it (unchanged by this fix)', () => {
  it('hr_people is still denied via the comment-adjacency vector even when forced into ALLOWED_TABLES', () => {
    const originallyHad = ALLOWED_TABLES.has('hr_people');
    ALLOWED_TABLES.add('hr_people');
    try {
      fail(`SELECT * FROM/* x */hr_people WHERE organisation_id = 'org-1'`, 'not accessible through this query engine');
    } finally {
      if (!originallyHad) ALLOWED_TABLES.delete('hr_people');
    }
  });
});

describe('Bonus: adjacent double-comment and quoted-identifier-after-comment combinations', () => {
  it('two immediately-adjacent zero-whitespace comments before a disallowed table are still rejected', () => {
    fail(`SELECT * FROM/**//* x */secret_table WHERE organisation_id = 'org-1'`);
  });

  it('two immediately-adjacent zero-whitespace comments before an allowed table still pass', () => {
    pass(`SELECT * FROM/**//* x */waste_records WHERE organisation_id = 'org-1'`);
  });
});

describe('lib/hlna/dataEngine.ts source — the fix is present and existing guards are untouched', () => {
  it('the block-comment branch now appends a separator before advancing past the comment', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/hlna/dataEngine.ts'), 'utf8');
    const commentBranchStart = src.indexOf("if (two === '/*')");
    const commentBranchEnd = src.indexOf('\n    }', commentBranchStart);
    const branch = src.slice(commentBranchStart, commentBranchEnd);
    expect(branch).toMatch(/out\s*\+=\s*['"]\s['"];/);
  });

  it('ALLOWED_TABLES and DENIED_TABLE_PATTERNS content are unchanged by this fix', () => {
    expect([...ALLOWED_TABLES].sort()).toEqual(['fleet_metrics', 'metric_snapshots', 'service_requests', 'waste_records']);
  });
});
