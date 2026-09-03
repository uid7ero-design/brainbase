import { neon } from '@neondatabase/serverless';

// Phase C1.1 — Debtors deduplication.
//
// modules/debtors/index.ts previously called
// `prisma.debtorAccount.createMany({ data: records, skipDuplicates: true })`
// with NO unique constraint on the table at all, so `skipDuplicates` was a
// silent no-op: every re-upload of the same debtor file appended a full new
// set of rows, and app/api/debtors/kpi/route.ts's unfiltered
// `WHERE organisation_id = ${orgId}` read silently summed every historical
// import together, inflating every KPI on re-upload.
//
// Natural key: (organisation_id, account_number) — the only field on this
// table that identifies a real-world account. There is no reporting-period/
// snapshot-date column anywhere on debtor_accounts, and the existing read
// path (app/api/debtors/kpi/route.ts) already queries ALL rows for an org
// unfiltered by any period — both facts together confirm this table was
// always intended as "current state per account", not a period-indexed
// historical ledger, so collapsing duplicates down to one row per
// (organisation_id, account_number) does not destroy genuinely distinct
// reporting snapshots; there is no snapshot dimension to lose.
//
// This script is idempotent and safe to run more than once:
//   1. For any (organisation_id, account_number) pair with more than one
//      row, deletes every row except the most recently updated one (ties
//      broken by id) — never deletes the sole row for a pair that has no
//      duplicate.
//   2. Creates a UNIQUE index on (organisation_id, account_number) — the
//      DDL modules/debtors/index.ts's new upsert-based import path
//      (INSERT ... ON CONFLICT (organisation_id, account_number)) requires
//      to exist. `CREATE UNIQUE INDEX IF NOT EXISTS` is itself idempotent.
//
// Blank/missing account_number rows: step 1 treats an empty string as just
// another value for dedup purposes — any org with more than one blank-
// account_number row (a real, historically-possible outcome of the bug this
// migration fixes) is collapsed to one, exactly like any other duplicate.
// Going forward, the corrected import path (modules/debtors/index.ts) skips
// — never inserts — a row with no account_number, since it cannot be safely
// deduplicated against future uploads; this script's dedup step only needs
// to clean up rows that already exist from before that fix.
//
// NOT run automatically — this is a prepared migration artifact only. Run
// manually against the target database (`npx tsx scripts/add-debtor-accounts-dedup.ts`
// with DATABASE_URL set), following this repository's existing hand-written-
// SQL-migration convention (no prisma/migrations directory; prisma/schema.prisma
// is updated separately to declare the resulting @@unique). Read-only
// preflight counts are printed before any DELETE executes.

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const [{ count: dupGroups }] = (await sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT organisation_id, account_number
      FROM debtor_accounts
      GROUP BY organisation_id, account_number
      HAVING COUNT(*) > 1
    ) g
  `) as { count: number }[];

  const [{ count: rowsToDelete }] = (await sql`
    SELECT COUNT(*)::int AS count FROM debtor_accounts a
    WHERE EXISTS (
      SELECT 1 FROM debtor_accounts b
      WHERE b.organisation_id = a.organisation_id
        AND b.account_number = a.account_number
        AND b.id <> a.id
        AND (b.updated_at, b.id) > (a.updated_at, a.id)
    )
  `) as { count: number }[];

  console.log(`Preflight: ${dupGroups} duplicate (organisation_id, account_number) group(s), ${rowsToDelete} row(s) will be deleted (keeping the most recently updated row per group).`);

  if (rowsToDelete > 0) {
    const deleted = await sql`
      DELETE FROM debtor_accounts a
      WHERE EXISTS (
        SELECT 1 FROM debtor_accounts b
        WHERE b.organisation_id = a.organisation_id
          AND b.account_number = a.account_number
          AND b.id <> a.id
          AND (b.updated_at, b.id) > (a.updated_at, a.id)
      )
    `;
    console.log(`Deleted ${(deleted as unknown[]).length ?? rowsToDelete} duplicate row(s).`);
  } else {
    console.log('No duplicates found — nothing to delete.');
  }

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS organisation_id_account_number
      ON debtor_accounts (organisation_id, account_number)
  `;
  console.log('Unique index organisation_id_account_number created (or already existed).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
