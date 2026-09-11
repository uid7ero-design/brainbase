import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertTablesAllowed, ALLOWED_TABLES } from '@/lib/hlna/dataEngine';

// HR-1 — re-confirms, for the THREE concrete tables this phase actually
// creates (hr_people, hr_teams, hr_administrators), the exact protection
// HR-0.5's dataEngineTableAllowlist.test.ts already proved generically
// (via lib/hlna/dataEngine.ts's DENIED_TABLE_PATTERNS = [/^hr_/i\]). This
// file does not re-derive that mechanism — it proves HR-1 did not
// silently regress it, and that no HR-1 file adds any hr_* table to any
// AI allowlist/index anywhere else in the codebase.

function fail(sql: string) {
  expect(() => assertTablesAllowed(sql)).toThrow(/not accessible through this query engine/i);
}

describe('AI containment — the three real HR-1 tables are denied by dataEngine', () => {
  it('hr_people is denied', () => {
    fail(`SELECT * FROM hr_people WHERE organisation_id = 'org-1'`);
  });

  it('hr_teams is denied', () => {
    fail(`SELECT * FROM hr_teams WHERE organisation_id = 'org-1'`);
  });

  it('hr_administrators is denied', () => {
    fail(`SELECT * FROM hr_administrators WHERE organisation_id = 'org-1'`);
  });

  it('a JOIN pulling in hr_people alongside an approved table is denied', () => {
    fail(`
      SELECT * FROM waste_records w
      JOIN hr_people p ON p.organisation_id = w.organisation_id
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it('none of the three tables is present in ALLOWED_TABLES', () => {
    expect(ALLOWED_TABLES.has('hr_people')).toBe(false);
    expect(ALLOWED_TABLES.has('hr_teams')).toBe(false);
    expect(ALLOWED_TABLES.has('hr_administrators')).toBe(false);
  });
});

describe('AI containment — no HR-1 source file adds an hr_* table to any AI allowlist/index', () => {
  function readIfExists(relPath: string): string | null {
    const full = path.join(process.cwd(), relPath);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  }

  it('lib/hlna/dataEngine.ts\'s own DB_SCHEMA prompt content (the literal template string sent to the model, not the surrounding comments) mentions no hr_* table', () => {
    const src = readIfExists('lib/hlna/dataEngine.ts')!;
    // DB_SCHEMA is declared as `export const DB_SCHEMA = \`...\`.trim();` —
    // slice just the template-literal body itself. The region between it
    // and ALLOWED_TABLES is mostly a long prose comment explaining the
    // table-allowlist guard, which legitimately uses "hr_people" as a
    // running illustrative example of an adjacency bypass class — that
    // comment is not prompt content and must not make this check fail.
    const schemaStart = src.indexOf('export const DB_SCHEMA');
    const templateStart = src.indexOf('`', schemaStart);
    const templateEnd = src.indexOf('`.trim()', templateStart);
    const schemaBody = src.slice(templateStart, templateEnd);
    expect(schemaBody).not.toMatch(/hr_people|hr_teams|hr_administrators/);
  });

  it('lib/hlna/dataEngine.ts\'s ALLOWED_TABLES set itself contains no hr_* table (the actual enforced value, not prose)', () => {
    const src = readIfExists('lib/hlna/dataEngine.ts')!;
    const declStart = src.indexOf('export const ALLOWED_TABLES');
    const declEnd = src.indexOf(';', declStart);
    const decl = src.slice(declStart, declEnd);
    expect(decl).not.toMatch(/hr_people|hr_teams|hr_administrators/);
  });

  it('lib/brain (RAG/vector search) indexes markdown vault files only — never a database row — so it cannot ingest HR-1 data regardless of table name', () => {
    const src = readIfExists('lib/brain/watcher.ts');
    expect(src).not.toBeNull();
    expect(src).not.toMatch(/hr_people|hr_teams|hr_administrators/);
    expect(src).toMatch(/\.md/); // still a markdown-file walker, not a DB query
  });

  it('none of the four already-live AI/agent entry points (chat, hlna/*, agents/*, brain) references any HR-1 table', () => {
    const candidateDirs = ['app/api/chat', 'app/api/hlna', 'app/api/agents', 'lib/agents', 'lib/brain'];
    for (const dir of candidateDirs) {
      const full = path.join(process.cwd(), dir);
      if (!fs.existsSync(full)) continue;
      const stack = [full];
      while (stack.length) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const entryPath = path.join(current, entry.name);
          if (entry.isDirectory()) { stack.push(entryPath); continue; }
          if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
          const content = fs.readFileSync(entryPath, 'utf8');
          expect(content, `${entryPath} unexpectedly references an HR-1 table`).not.toMatch(/hr_people|hr_teams|hr_administrators/);
        }
      }
    }
  });

  it('no HR-1 route sends any hr_people/hr_teams field to an external AI provider (Anthropic/OpenAI/Ollama) — none of the HR-1 API route files import an AI SDK', () => {
    const hrRouteFiles = [
      'app/api/hr/people/route.ts',
      'app/api/hr/people/[id]/route.ts',
      'app/api/hr/teams/route.ts',
      'app/api/hr/administrators/route.ts',
    ];
    for (const file of hrRouteFiles) {
      const src = readIfExists(file)!;
      expect(src, `${file} unexpectedly references an AI provider`).not.toMatch(/@anthropic-ai|openai|ollama/i);
    }
  });
});
