import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assertTablesAllowed, ALLOWED_TABLES, DB_SCHEMA } from '@/lib/hlna/dataEngine';

// HR-6 PR-1 — AI containment for the five restricted-case tables created by
// scripts/create-hr-restricted-cases.sql. Mirrors
// tests/containment/hrPeopleFoundationAiContainment.test.ts (HR-1's
// equivalent for hr_people/hr_teams/hr_administrators). No
// lib/hlna/dataEngine.ts change is made or needed: its DENIED_TABLE_PATTERNS
// (/^hr_/i) already rejects every hr_* table name. This file proves that
// protection holds for these five tables specifically (in every syntactic
// form the table-reference scanner recognises), that it covers every table
// the migration actually creates, and that no allowlist, model-prompt
// content or AI entry point in the codebase references them.

const RESTRICTED_TABLES = [
  'hr_restricted_cases',
  'hr_restricted_case_participants',
  'hr_restricted_case_access',
  'hr_restricted_case_notes',
  'hr_restricted_case_documents',
];

// Matches all five names (and any future hr_restricted_case* table).
const RESTRICTED_TABLE_RE = /hr_restricted_case/i;

const DENIED = /not accessible through this query engine/i;

function denied(sql: string) {
  expect(() => assertTablesAllowed(sql)).toThrow(DENIED);
}

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function listSourceFiles(relDir: string): string[] {
  const root = path.join(process.cwd(), relDir);
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push(entryPath);
        continue;
      }
      if (SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) files.push(entryPath);
    }
  }
  return files;
}

// A real import/require of an AI provider SDK — not a mere mention of a
// provider's name in prose.
const AI_SDK_IMPORT_RE = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)['"](?:@anthropic-ai\/[^'"]+|openai(?:\/[^'"]*)?|ollama(?:\/[^'"]*)?)['"]/;

describe('AI containment — the five HR-6 restricted-case tables are denied by dataEngine', () => {
  it.each(RESTRICTED_TABLES)('%s is denied in a plain organisation-scoped SELECT', (table) => {
    denied(`SELECT * FROM ${table} WHERE organisation_id = 'org-1'`);
  });

  it.each(RESTRICTED_TABLES)('%s is denied when schema-qualified, double-quoted, upper-cased or aliased', (table) => {
    denied(`SELECT * FROM public.${table} WHERE organisation_id = 'org-1'`);
    denied(`SELECT * FROM "${table}" WHERE organisation_id = 'org-1'`);
    denied(`SELECT * FROM ${table.toUpperCase()} WHERE organisation_id = 'org-1'`);
    denied(`SELECT * FROM ${table} AS t WHERE t.organisation_id = 'org-1'`);
  });

  it.each(RESTRICTED_TABLES)('%s is denied when JOINed alongside an approved table', (table) => {
    denied(`
      SELECT * FROM waste_records w
      JOIN ${table} r ON r.organisation_id = w.organisation_id
      WHERE w.organisation_id = 'org-1'
    `);
  });

  it.each(RESTRICTED_TABLES)('%s is denied inside a subquery and inside a CTE body', (table) => {
    denied(`SELECT * FROM (SELECT * FROM ${table} WHERE organisation_id = 'org-1') sub`);
    denied(`
      WITH leak AS (SELECT * FROM ${table} WHERE organisation_id = 'org-1')
      SELECT * FROM leak
    `);
  });

  it.each(RESTRICTED_TABLES)('%s is denied even if it were hypothetically added to ALLOWED_TABLES (the hr_ deny-list wins)', (table) => {
    const originallyHad = ALLOWED_TABLES.has(table);
    ALLOWED_TABLES.add(table);
    try {
      denied(`SELECT * FROM ${table} WHERE organisation_id = 'org-1'`);
    } finally {
      if (!originallyHad) ALLOWED_TABLES.delete(table);
    }
  });

  it.each(RESTRICTED_TABLES)('%s is rejected by executeQuery() itself, with a correct org id, before any database call', async (table) => {
    const { executeQuery } = await import('@/lib/hlna/dataEngine');
    await expect(executeQuery(`SELECT * FROM ${table} WHERE organisation_id = 'org-1'`, 'org-1'))
      .rejects.toThrow(DENIED);
  });

  it('none of the five tables is present in ALLOWED_TABLES', () => {
    for (const table of RESTRICTED_TABLES) {
      expect(ALLOWED_TABLES.has(table), `${table} must not be in ALLOWED_TABLES`).toBe(false);
    }
  });
});

describe('AI containment — every table the HR-6 PR-1 migrations create is covered', () => {
  it('scripts/create-hr-restricted-cases.sql creates exactly the five tables, and each one it creates is denied by assertTablesAllowed()', () => {
    const sql = stripSqlComments(readRepoFile('scripts/create-hr-restricted-cases.sql'));
    const created = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi)]
      .map(m => m[1].replace(/"/g, '').split('.').pop()!.toLowerCase());
    expect([...created].sort()).toEqual([...RESTRICTED_TABLES].sort());
    for (const table of created) {
      denied(`SELECT * FROM ${table} WHERE organisation_id = 'org-1'`);
    }
  });

  it('scripts/add-hr-people-tenant-unique.sql creates no table at all (it only adds a constraint to the already-denied hr_people)', () => {
    const sql = stripSqlComments(readRepoFile('scripts/add-hr-people-tenant-unique.sql'));
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).toMatch(/ALTER TABLE hr_people\s+ADD CONSTRAINT hr_people_organisation_id_id_key UNIQUE \(organisation_id, id\)/);
    denied(`SELECT * FROM hr_people WHERE organisation_id = 'org-1'`);
  });
});

describe('AI containment — no allowlist, model prompt or AI entry point exposes the five tables', () => {
  it('DB_SCHEMA (the runtime prompt content sent to the model) names none of the five tables, nor any hr_ table', () => {
    expect(DB_SCHEMA).not.toMatch(RESTRICTED_TABLE_RE);
    expect(DB_SCHEMA).not.toMatch(/\bhr_/i);
  });

  it('lib/hlna/dataEngine.ts\'s DB_SCHEMA template-literal source (not the surrounding comments) names none of the five tables', () => {
    const src = readRepoFile('lib/hlna/dataEngine.ts');
    // Same slicing as hrPeopleFoundationAiContainment.test.ts: just the
    // template-literal body, since the prose comment after it legitimately
    // uses hr_people as an illustrative example.
    const schemaStart = src.indexOf('export const DB_SCHEMA');
    const templateStart = src.indexOf('`', schemaStart);
    const templateEnd = src.indexOf('`.trim()', templateStart);
    expect(schemaStart).toBeGreaterThan(-1);
    expect(templateEnd).toBeGreaterThan(templateStart);
    expect(src.slice(templateStart, templateEnd)).not.toMatch(RESTRICTED_TABLE_RE);
  });

  it('lib/hlna/dataEngine.ts\'s ALLOWED_TABLES declaration (the enforced value, not prose) names none of the five tables, nor any hr_ table', () => {
    const src = readRepoFile('lib/hlna/dataEngine.ts');
    const declStart = src.indexOf('export const ALLOWED_TABLES');
    const declEnd = src.indexOf(';', declStart);
    expect(declStart).toBeGreaterThan(-1);
    const decl = src.slice(declStart, declEnd);
    expect(decl).not.toMatch(RESTRICTED_TABLE_RE);
    expect(decl).not.toMatch(/\bhr_/i);
  });

  it('lib/brain (RAG/vector search) still indexes markdown vault files only — never a database row — and names none of the five tables', () => {
    const src = readRepoFile('lib/brain/watcher.ts');
    expect(src).not.toMatch(RESTRICTED_TABLE_RE);
    expect(src).toMatch(/\.md/); // still a markdown-file walker, not a DB query
  });

  it('no file in any AI/agent entry-point directory references any of the five tables', () => {
    // The precedent's five directories, plus lib/hlna (the NL->SQL engine
    // itself), app/api/brain (the brain/RAG API) and app/api/speak (Helena
    // voice output).
    const candidateDirs = [
      'app/api/chat', 'app/api/hlna', 'app/api/agents', 'lib/agents', 'lib/brain',
      'lib/hlna', 'app/api/brain', 'app/api/speak',
    ];
    let scanned = 0;
    for (const dir of candidateDirs) {
      for (const file of listSourceFiles(dir)) {
        scanned++;
        expect(fs.readFileSync(file, 'utf8'), `${file} unexpectedly references an HR-6 restricted-case table`)
          .not.toMatch(RESTRICTED_TABLE_RE);
      }
    }
    expect(scanned).toBeGreaterThan(0);
  });

  it('no source file anywhere in app/ or lib/ that imports an AI SDK (discovered dynamically, not a fixed list) references any of the five tables', () => {
    const aiFiles = [...listSourceFiles('app'), ...listSourceFiles('lib')]
      .filter(file => AI_SDK_IMPORT_RE.test(fs.readFileSync(file, 'utf8')));
    // Sanity floor so this check can never pass vacuously: the known
    // Anthropic/OpenAI entry points (chat, hlna/*, agents/*, lib/agents/*,
    // reports, trial upload, organiser Helena tools) all import an SDK.
    expect(aiFiles.length).toBeGreaterThanOrEqual(10);
    for (const file of aiFiles) {
      expect(fs.readFileSync(file, 'utf8'), `${file} imports an AI SDK and references an HR-6 restricted-case table`)
        .not.toMatch(RESTRICTED_TABLE_RE);
    }
  });

  it('no HR route or HR library file (every file under app/api/hr and lib/hr, discovered dynamically) imports or names an AI provider', () => {
    const hrFiles = [...listSourceFiles('app/api/hr'), ...listSourceFiles('lib/hr')];
    // Includes the four route files the HR-1 precedent listed explicitly.
    for (const known of [
      'app/api/hr/people/route.ts',
      'app/api/hr/people/[id]/route.ts',
      'app/api/hr/teams/route.ts',
      'app/api/hr/administrators/route.ts',
    ]) {
      expect(hrFiles).toContain(path.join(process.cwd(), known));
    }
    for (const file of hrFiles) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${file} unexpectedly imports an AI SDK`).not.toMatch(AI_SDK_IMPORT_RE);
      expect(src, `${file} unexpectedly references an AI provider`).not.toMatch(/@anthropic-ai|openai|ollama/i);
    }
  });
});
