import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logCrmClassificationMigrationExecuted } from '@/lib/admin/auditLog';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

// SEC-1B1: request metadata for audit logging — matches the identical
// helper already established in the other SEC-1A/SEC-1B1 admin routes.
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

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
export async function POST(req: NextRequest) {
  // SEC-1B1: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // re-reads the caller's current role/organisation assignment from the
  // database on every call, so a since-demoted, since-reassigned, or
  // deleted user's still-valid JWT can no longer trigger this migration.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

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

    // SEC-1B1: audit — this route was previously entirely unaudited.
    // Placed as the last statement before the success response, inside
    // the same try block as the migration statements above, so a thrown
    // exception (caught below) skips this call entirely.
    {
      const { ipAddress, userAgent } = requestMeta(req);
      await logCrmClassificationMigrationExecuted({
        actorUserId: session.userId,
        actorOrganisationId: session.organisationId,
        ipAddress,
        userAgent,
      });
    }

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
