import { neon } from '@neondatabase/serverless';

// Phase C1-DBS2 — Debtors additive typed-column foundation.
//
// Context (Phase C1-DBR/C1-DBD/C1-DBS): real rehearsal-data investigation
// established that a `debtor_accounts` row represents a source CHARGE LINE
// (one account, one financial year, one quarter, one charge type), not an
// account's current state. `account_number` alone is not a safe identifier
// — the same account legitimately recurs across financial years, quarters,
// and charge types, all currently buried, unindexed, inside the `metadata`
// JSONB column (populated only by the separate `scripts/ingest-from-
// folders.ts` ingestion path, not by the normal in-app importer). The one
// candidate real row-identifier the source workbook offers,
// `metadata.__md5Row`, was found (Phase C1-DBS) to be present but 0%
// populated across all 32,493 real rehearsal rows — it is NOT usable as an
// identifier and must not be treated as one anywhere in this script.
//
// This script does ONLY the following, and nothing else:
//   1. Adds six new, NULLABLE columns (financial_year, financial_quarter,
//      charge_type, invoice_date, source_book, source_charge_code).
//   2. Backfills them from the existing `metadata` JSONB for rows already
//      in the table.
//   3. Reports distribution/verification counts.
//
// It explicitly does NOT:
//   - add any UNIQUE constraint (the best-available identity —
//     organisation_id, account_number, financial_year, financial_quarter,
//     charge_type, invoice_date — remains duplicate-DETECTION only; real
//     residual collisions exist in real data and must stay representable —
//     see Phase C1-DBD's own investigation for the exact counts)
//   - delete, merge, or otherwise mutate any existing row's business
//     fields (outstanding_amount, original_amount, status, days_overdue,
//     aging_bucket, account_number, account_name, metadata itself)
//   - touch `debtor_accounts_organisation_id_account_number`-style
//     constraints, `debtor_account_summary`, KPI routes, the importer, or
//     any UI
//   - use metadata.__md5Row for anything
//
// Normalization rules (never guessed — an unrecognized source shape is
// left NULL, not approximated):
//   - financial_year: derived ONLY from a bookname matching the exact
//     shape `^(\d{2})(\d{2})MISC$` observed in real data (e.g. "2324MISC"
//     -> "2023-24"). A bookname with a different suffix or shape (a
//     plausible future case this script has no evidence for) is left
//     unmapped, not guessed at via a looser prefix match.
//   - financial_quarter: copied only when metadata.quarter exactly matches
//     `^Q[1-4]$`; anything else is left NULL and counted as unrecognized.
//   - charge_type: a direct promoted copy of metadata.chargecode (TEXT,
//     not an enum — no normalization mapping is evidenced for these codes
//     beyond making them a first-class column) whenever chargecode is
//     present and non-empty.
//   - invoice_date: parsed only when metadata.invoice_date matches a
//     strict ISO-8601-datetime-prefix shape (guaranteed by the ingestion
//     script's own `Date.prototype.toISOString()` output for every
//     genuinely valid value found in real data) — anything else is left
//     NULL and counted as invalid, never attempted as a cast that could
//     fail the whole statement.
//   - source_book / source_charge_code: VERBATIM copies of
//     metadata.bookname / metadata.chargecode, populated whenever the
//     source field is present and non-empty, regardless of whether the
//     corresponding derived field above could be parsed — no source
//     information is ever lost even for an unrecognized shape.
//
// Idempotent: every ALTER uses IF NOT EXISTS; every backfill UPDATE only
// touches rows where the target column is still NULL, so a second run
// changes nothing further already backfilled and safely re-attempts
// nothing that succeeded.
//
// NOT run automatically — a prepared migration artifact. Run manually
// (`npx tsx scripts/add-debtor-charge-line-columns.ts` or equivalent, with
// DATABASE_URL set) only against an explicitly approved target, following
// this repository's existing hand-written-SQL-migration convention.

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log('=== Preflight: current column state ===');
  const existingCols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'debtor_accounts'
      AND column_name IN ('financial_year','financial_quarter','charge_type','invoice_date','source_book','source_charge_code')
    ORDER BY column_name
  `;
  console.log('new columns already present before this run:', JSON.stringify(existingCols));

  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM debtor_accounts`;
  console.log('total debtor_accounts rows (preflight):', total);

  console.log('\n=== Step 1: add nullable columns (idempotent) ===');
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS financial_year TEXT`;
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS financial_quarter TEXT`;
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS charge_type TEXT`;
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMPTZ`;
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS source_book TEXT`;
  await sql`ALTER TABLE debtor_accounts ADD COLUMN IF NOT EXISTS source_charge_code TEXT`;
  console.log('columns added (or already existed).');

  console.log('\n=== Step 2: backfill source_book / source_charge_code (verbatim, lineage-preserving) ===');
  const sourceBookResult = await sql`
    UPDATE debtor_accounts
    SET source_book = metadata->>'bookname'
    WHERE source_book IS NULL AND metadata->>'bookname' IS NOT NULL AND metadata->>'bookname' <> ''
  `;
  console.log('source_book backfilled:', (sourceBookResult as unknown[]).length ?? 'n/a');

  const sourceChargeCodeResult = await sql`
    UPDATE debtor_accounts
    SET source_charge_code = metadata->>'chargecode'
    WHERE source_charge_code IS NULL AND metadata->>'chargecode' IS NOT NULL AND metadata->>'chargecode' <> ''
  `;
  console.log('source_charge_code backfilled:', (sourceChargeCodeResult as unknown[]).length ?? 'n/a');

  console.log('\n=== Step 3: backfill charge_type (direct promoted copy, no normalization mapping evidenced) ===');
  await sql`
    UPDATE debtor_accounts
    SET charge_type = metadata->>'chargecode'
    WHERE charge_type IS NULL AND metadata->>'chargecode' IS NOT NULL AND metadata->>'chargecode' <> ''
  `;

  console.log('\n=== Step 4: backfill financial_quarter (only exact Q1-Q4 shape) ===');
  await sql`
    UPDATE debtor_accounts
    SET financial_quarter = metadata->>'quarter'
    WHERE financial_quarter IS NULL AND metadata->>'quarter' ~ '^Q[1-4]$'
  `;

  console.log('\n=== Step 5: backfill financial_year (only exact NNNNMISC shape observed in real data) ===');
  await sql`
    UPDATE debtor_accounts
    SET financial_year = '20' || substring(metadata->>'bookname' from 1 for 2) || '-' || substring(metadata->>'bookname' from 3 for 2)
    WHERE financial_year IS NULL AND metadata->>'bookname' ~ '^[0-9]{4}MISC$'
  `;

  console.log('\n=== Step 6: backfill invoice_date (only strict ISO-8601-datetime-prefix shape, never a blind cast) ===');
  // Deliberately [0-9] rather than \d: \d is not a recognised JavaScript
  // string escape sequence, so `'\d'` silently collapses to the literal
  // character `d` inside a template/string literal (JS drops the
  // backslash on any escape it doesn't recognise) — the regex Postgres
  // would actually receive is `d{4}-d{2}-...`, which matches nothing.
  // Caught during this phase's own rehearsal run (invoice_date populated:
  // 0 on the first attempt) before being treated as final — see this
  // phase's report for the exact before/after evidence.
  await sql`
    UPDATE debtor_accounts
    SET invoice_date = (metadata->>'invoice_date')::timestamptz
    WHERE invoice_date IS NULL
      AND metadata->>'invoice_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
  `;

  console.log('\n=== Verification ===');
  const [{ total_after }] = await sql`SELECT COUNT(*)::int AS total_after FROM debtor_accounts`;
  console.log('total debtor_accounts rows (after — must equal preflight count):', total_after);

  const fyDist = await sql`SELECT financial_year, COUNT(*)::int AS c FROM debtor_accounts GROUP BY financial_year ORDER BY financial_year NULLS LAST`;
  console.log('financial_year distribution:', JSON.stringify(fyDist));

  const [{ unrecognized_bookname }] = await sql`
    SELECT COUNT(*)::int AS unrecognized_bookname FROM debtor_accounts
    WHERE financial_year IS NULL AND metadata->>'bookname' IS NOT NULL AND metadata->>'bookname' <> ''
  `;
  console.log('rows with a non-empty bookname that did NOT match the recognized shape (financial_year left NULL):', unrecognized_bookname);

  const fqDist = await sql`SELECT financial_quarter, COUNT(*)::int AS c FROM debtor_accounts GROUP BY financial_quarter ORDER BY financial_quarter NULLS LAST`;
  console.log('financial_quarter distribution:', JSON.stringify(fqDist));

  const [{ unrecognized_quarter }] = await sql`
    SELECT COUNT(*)::int AS unrecognized_quarter FROM debtor_accounts
    WHERE financial_quarter IS NULL AND metadata->>'quarter' IS NOT NULL AND metadata->>'quarter' <> ''
  `;
  console.log('rows with a non-empty quarter that did NOT match Q1-Q4 (financial_quarter left NULL):', unrecognized_quarter);

  const ctDist = await sql`SELECT charge_type, COUNT(*)::int AS c FROM debtor_accounts GROUP BY charge_type ORDER BY c DESC`;
  console.log('charge_type distribution:', JSON.stringify(ctDist));

  const [{ invoice_date_populated, invoice_date_invalid }] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE invoice_date IS NOT NULL)::int AS invoice_date_populated,
      COUNT(*) FILTER (WHERE invoice_date IS NULL AND metadata->>'invoice_date' IS NOT NULL AND metadata->>'invoice_date' <> '')::int AS invoice_date_invalid
    FROM debtor_accounts
  `;
  console.log('invoice_date populated:', invoice_date_populated, '| present-in-metadata-but-unparsed (invalid):', invoice_date_invalid);

  const [{ source_book_matches, source_charge_code_matches }] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE source_book IS NOT DISTINCT FROM NULLIF(metadata->>'bookname', ''))::int AS source_book_matches,
      COUNT(*) FILTER (WHERE source_charge_code IS NOT DISTINCT FROM NULLIF(metadata->>'chargecode', ''))::int AS source_charge_code_matches
    FROM debtor_accounts
  `;
  console.log('rows where source_book exactly matches metadata.bookname (verbatim preservation check):', source_book_matches, 'of', total_after);
  console.log('rows where source_charge_code exactly matches metadata.chargecode (verbatim preservation check):', source_charge_code_matches, 'of', total_after);

  const uniqueConstraints = await sql`
    SELECT indexname FROM pg_indexes WHERE tablename = 'debtor_accounts' AND indexdef ILIKE '%UNIQUE%'
  `;
  console.log('unique indexes/constraints on debtor_accounts (must be empty or pkey-only):', JSON.stringify(uniqueConstraints));

  const dupCheck = await sql`
    SELECT COUNT(*)::int AS residual_groups FROM (
      SELECT organisation_id, account_number, financial_year, financial_quarter, charge_type, invoice_date
      FROM debtor_accounts
      GROUP BY 1,2,3,4,5,6
      HAVING COUNT(*) > 1
    ) x
  `;
  console.log('residual duplicate groups under the 6-part detection key (expected to be non-zero, confirming collisions remain representable):', dupCheck[0].residual_groups);

  console.log('\n=== Done. No DELETE, no unique constraint, no row merges performed. ===');
}

main().catch(err => {
  console.error('MIGRATION ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
