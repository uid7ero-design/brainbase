import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * POST /api/admin/migrate/crm-contact-classification
 *
 * Targeted, single-purpose migration endpoint. Executes ONLY the already-
 * approved, already-audited migration semantics from
 * scripts/add-crm-contact-classification.sql (verbatim — not modified) —
 * nothing else. Added as an urgent, narrow alternative to
 * POST /api/admin/migrate, whose full legacy replay was found to fail on
 * an unrelated, pre-existing waste_records schema defect before ever
 * reaching the classification step, blocking Production from getting a
 * column the deployed application code already reads/writes. Fixing that
 * legacy defect is separate follow-up work, out of scope here.
 *
 * Additive-only and idempotent: nullable column, no default, a guarded
 * CHECK constraint, one tenant-scoped index. Never UPDATEs, DELETEs, or
 * INSERTs into crm_contacts — no existing row, and no existing
 * classification value, is ever touched by this endpoint.
 *
 * Same auth model as /api/admin/migrate: an authenticated super_admin
 * session, nothing else — no API key, no bypass header, no alternate
 * credential.
 */
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await sql`ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT`;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_classification_check'
        ) THEN
          ALTER TABLE crm_contacts
            ADD CONSTRAINT crm_contacts_classification_check
            CHECK (classification IS NULL OR classification IN (
              'CLIENT',
              'LEAD',
              'EVENT_CONTACT',
              'SUPPLIER',
              'PARTNER',
              'OTHER'
            ));
        END IF;
      END $$
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification ON crm_contacts(organisation_id, classification)`;

    return NextResponse.json({ success: true, migration: 'crm_contacts.classification' });
  } catch (err: unknown) {
    // Deliberately narrower than /api/admin/migrate's own error response
    // (which includes failedAfter + a stack trace) — this endpoint has
    // exactly one thing it can fail at, so a generic message is already
    // fully diagnostic, and there is no reason to expose stack/path
    // details for a single, well-known DDL sequence. Full detail still
    // goes to server logs.
    console.error('[migrate crm-contact-classification] failed', err);
    return NextResponse.json({ error: 'Migration failed.' }, { status: 500 });
  }
}
