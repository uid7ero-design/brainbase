import { NextResponse } from 'next/server';
import sql from '@/lib/db';

// C6.9 TEMPORARY diagnostic — proves which database a Preview deployment
// is actually querying at runtime, without exposing DATABASE_URL, host,
// connection string, secrets, credentials, or row contents. Added to
// resolve a genuine ambiguity Vercel's own env-var metadata cannot
// disambiguate (a manually-edited DATABASE_URL and a Neon-integration
// resync are indistinguishable from the CLI/dashboard alone) — see the
// C6.9 gate's own read-only runtime-target investigation.
//
// FAILS CLOSED outside Preview: checked BEFORE any DB call, so this can
// never run — and never even attempt a connection — against Production
// or any other environment, regardless of how this route is reached.
//
// Returns ONLY: current_database/current_user (identity, not secrets —
// these are the connected role/db NAME, never a credential), two
// organisation-scoped row counts, and three booleans. No row contents,
// no connection info, no environment variable values of any kind.
//
// TEMPORARY: remove this file (or revert its commit) once the C6.9
// runtime-identity question is resolved — it is not part of the
// Purchasing remediation itself.
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const rows = await sql`
    SELECT
      current_database()  AS current_database,
      current_user        AS current_user,
      (SELECT count(*) FROM organisations) AS organisation_count,
      (SELECT count(*) FROM users)         AS user_count,
      EXISTS(SELECT 1 FROM organisations WHERE id = 'c69-test-org') AS c69_test_org_exists,
      EXISTS(SELECT 1 FROM users WHERE username = 'c69admin')       AS c69admin_exists,
      (SELECT count(*) FROM commercial_purchase_orders)             AS purchase_order_count
  `;
  const row = rows[0];

  return NextResponse.json({
    current_database: row.current_database,
    current_user: row.current_user,
    organisation_count: Number(row.organisation_count),
    user_count: Number(row.user_count),
    c69_test_org_exists: row.c69_test_org_exists,
    c69admin_exists: row.c69admin_exists,
    purchase_order_count: Number(row.purchase_order_count),
  });
}
