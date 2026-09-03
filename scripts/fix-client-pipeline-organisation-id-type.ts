import { neon } from '@neondatabase/serverless';

// Phase C1.2 — client_pipeline / pipeline_messages organisation_id (and
// client_pipeline.submitted_by) TEXT/UUID type-mismatch fix.
//
// PREPARED MIGRATION ARTIFACT — NOT EXECUTED BY THIS PHASE.
//
// Context: app/api/pipeline/route.ts's ensureTable() (the function that
// actually created this table live, in production — CREATE TABLE IF NOT
// EXISTS, no FK) declared organisation_id/submitted_by as UUID.
// organisations.id and users.id are TEXT (cuid), not native uuid,
// everywhere else in this schema. A real session.organisationId (e.g.
// "cjld2cy...") is not valid UUID literal syntax, so any query comparing
// this column against a real session value — confirmed live in
// app/api/pipeline/route.ts, app/api/pipeline/[id]/messages/route.ts,
// app/api/admin/pipeline/route.ts (a JOIN, not just a WHERE), and both
// app/api/portal/pipeline/** routes — would fail with "invalid input
// syntax for type uuid" if the live column genuinely is UUID.
//
// This script's own source-level correctness does NOT depend on knowing
// the live column type in advance — every step below is a preflight-then-
// act pattern that inspects live information_schema state first and skips
// (rather than assumes) whatever doesn't need changing. This was written
// specifically because no DATABASE_URL / live database access was
// available during Phase C1 to confirm the current column type directly
// (see the Phase C1 report's Remaining Risks) — per this phase's explicit
// governing instruction, this script MUST run its own verification before
// mutating anything, rather than the author asserting what production
// currently looks like.
//
// Safety properties:
//   - UUID -> TEXT is the only type change ever performed, and is always
//     lossless (`col::text` is a total, non-failing cast for every valid
//     uuid value) — the reverse direction is never attempted.
//   - If a column is already TEXT (e.g. because a prior fix already ran,
//     or the live table never actually matched the DDL scripts), that
//     column's ALTER is skipped entirely — idempotent, safe to re-run.
//   - The two FK constraints (organisation_id -> organisations.id,
//     submitted_by -> users.id) are added ONLY if a preflight orphan-row
//     count is exactly zero for that column. A non-zero count is reported,
//     not silently worked around (no orphan rows are deleted or
//     reassigned by this script) — a human must review those specific
//     rows before a constraint can safely be added; this script will not
//     invent a resolution for them.
//   - Every mutating statement is preceded by a read-only preflight print.
//   - No row in client_pipeline or pipeline_messages is ever deleted or
//     have its data altered by this script — only column TYPE and
//     constraint DEFINITIONS change.
//
// Run manually (`npx tsx scripts/fix-client-pipeline-organisation-id-type.ts`
// with DATABASE_URL set) only after this phase's findings have been
// reviewed and migration execution has been explicitly authorized,
// following this repository's existing hand-written-SQL-migration
// convention (no prisma/migrations directory; prisma/schema.prisma is not
// affected, since neither client_pipeline nor pipeline_messages is a
// Prisma model).

type ColumnType = { column_name: string; data_type: string };

async function columnType(sql: ReturnType<typeof neon>, table: string, column: string): Promise<string | null> {
  const rows = (await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `) as ColumnType[];
  return rows[0]?.data_type ?? null;
}

async function fixColumnType(sql: ReturnType<typeof neon>, table: string, column: string) {
  const type = await columnType(sql, table, column);
  if (type === null) {
    console.log(`  ${table}.${column}: column does not exist — skipping (table may not be created yet; ensureTable()/the migrate-*.ts scripts handle fresh creation with the correct TEXT type already).`);
    return;
  }
  if (type !== 'uuid') {
    console.log(`  ${table}.${column}: already '${type}', not 'uuid' — nothing to change.`);
    return;
  }
  console.log(`  ${table}.${column}: currently 'uuid' — altering to TEXT (lossless ::text cast)...`);
  await sql.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT USING ${column}::text`);
  console.log(`  ${table}.${column}: altered to TEXT.`);
}

async function addFkIfClean(
  sql: ReturnType<typeof neon>,
  table: string,
  column: string,
  refTable: string,
  constraintName: string,
) {
  const type = await columnType(sql, table, column);
  if (type === null) {
    console.log(`  ${table}.${column}: column does not exist — skipping FK.`);
    return;
  }
  if (type === 'uuid') {
    console.log(`  ${table}.${column}: still 'uuid' (fixColumnType should have run first) — skipping FK until the type is corrected.`);
    return;
  }

  const existing = (await sql`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = ${table} AND constraint_name = ${constraintName}
  `) as unknown[];
  if (existing.length > 0) {
    console.log(`  ${table}.${column}: FK constraint '${constraintName}' already exists — skipping.`);
    return;
  }

  const orphans = (await sql.query(
    `SELECT COUNT(*)::int AS count FROM ${table} t
     WHERE t.${column} IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ${refTable} r WHERE r.id = t.${column})`
  )) as { count: number }[];
  const orphanCount = orphans[0]?.count ?? 0;

  if (orphanCount > 0) {
    console.warn(`  ${table}.${column}: ${orphanCount} row(s) reference a ${refTable}.id that does not exist — FK NOT added. These specific rows require human review before this constraint can be safely applied; this script does not delete or reassign them.`);
    return;
  }

  console.log(`  ${table}.${column}: 0 orphan rows — adding FK constraint '${constraintName}' -> ${refTable}(id)...`);
  await sql.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${column}) REFERENCES ${refTable}(id)`
  );
  console.log(`  ${table}.${column}: FK constraint added.`);
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log('=== Preflight: current column types ===');
  for (const [table, column] of [
    ['client_pipeline', 'organisation_id'],
    ['client_pipeline', 'submitted_by'],
    ['pipeline_messages', 'organisation_id'],
  ] as const) {
    const type = await columnType(sql, table, column);
    console.log(`  ${table}.${column}: ${type ?? '(column does not exist)'}`);
  }

  console.log('\n=== Step 1: correct UUID -> TEXT where needed ===');
  await fixColumnType(sql, 'client_pipeline', 'organisation_id');
  await fixColumnType(sql, 'client_pipeline', 'submitted_by');
  await fixColumnType(sql, 'pipeline_messages', 'organisation_id');

  console.log('\n=== Step 2: add missing FK constraints where the referencing data is clean ===');
  await addFkIfClean(sql, 'client_pipeline', 'organisation_id', 'organisations', 'client_pipeline_organisation_id_fkey');
  await addFkIfClean(sql, 'client_pipeline', 'submitted_by', 'users', 'client_pipeline_submitted_by_fkey');
  await addFkIfClean(sql, 'pipeline_messages', 'organisation_id', 'organisations', 'pipeline_messages_organisation_id_fkey');

  console.log('\n=== Done. Review any warnings above before considering this migration complete. ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
