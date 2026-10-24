import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { isValidCrmContactClassification } from '@/lib/crm/classification';
import { normalizeEmail } from '@/lib/crm/eventSync';
import { contactIdentityLock } from '@/lib/crm/contactIdentityLock';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  const rows = await sql`
    SELECT ct.*, c.name AS company_name
    FROM crm_contacts ct
    LEFT JOIN crm_companies c ON c.id = ct.company_id
    WHERE ct.id = ${id} AND ct.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const deals = await sql`
    SELECT id, title, value, stage, expected_close FROM crm_deals
    WHERE contact_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  const activities = await sql`
    SELECT a.*, u.name AS created_by_name FROM crm_activities a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.contact_id = ${id} AND a.organisation_id = ${session.organisationId}
    ORDER BY a.activity_date DESC LIMIT 30
  `;

  return NextResponse.json({ contact: rows[0], deals, activities });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  const body = await req.json();
  const { first_name, last_name, email, phone, job_title, company_id, notes, classification } = body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  // Same validation as POST /api/crm/contacts — see that route's own
  // comment. This is the ONLY place a human (via ContactForm.tsx) can
  // change an existing contact's classification; Events sync/backfill
  // never reach this route and never UPDATE classification themselves.
  if (classification !== null && classification !== undefined && classification !== '' && !isValidCrmContactClassification(classification)) {
    return NextResponse.json({ error: 'Invalid classification.' }, { status: 400 });
  }
  const normalizedClassification = classification || null;

  // Duplicate policy (same rule as POST /api/crm/contacts): an edit may not give a contact an email that
  // ANOTHER contact in this organisation already has; it is refused with 409 and nothing is written. Saving a
  // contact whose email is unchanged (ignoring case and surrounding spaces) is never blocked, so a duplicate pair
  // that already exists can still be edited and tidied. The check runs under the shared identity lock in a later
  // statement of the same transaction, so two simultaneous edits to the same new email cannot both succeed.
  const normEmail = normalizeEmail(typeof email === 'string' ? email : null);
  if (normEmail) {
    const [, guarded] = await sql.transaction([
      contactIdentityLock(session.organisationId, 'email', normEmail),
      sql`
        WITH conflict AS (
          SELECT c.id FROM crm_contacts c
          WHERE c.organisation_id = ${session.organisationId} AND lower(trim(c.email)) = ${normEmail} AND c.id <> ${id}
            AND EXISTS (SELECT 1 FROM crm_contacts tgt WHERE tgt.id = ${id} AND tgt.organisation_id = ${session.organisationId})
            AND NOT EXISTS (
              SELECT 1 FROM crm_contacts me
              WHERE me.id = ${id} AND me.organisation_id = ${session.organisationId} AND lower(trim(me.email)) = ${normEmail}
            )
          ORDER BY c.created_at ASC
          LIMIT 1
        ),
        upd AS (
          UPDATE crm_contacts SET
            first_name = ${first_name.trim()}, last_name = ${last_name.trim()},
            email = ${email ?? null}, phone = ${phone ?? null}, job_title = ${job_title ?? null},
            company_id = ${company_id ?? null}, notes = ${notes ?? null},
            classification = ${normalizedClassification},
            updated_at = NOW()
          WHERE id = ${id} AND organisation_id = ${session.organisationId}
            AND NOT EXISTS (SELECT 1 FROM conflict)
          RETURNING id
        )
        SELECT (SELECT id FROM conflict) AS conflict_id, (SELECT id FROM upd) AS updated_id
      `,
    ]);
    const outcome = (guarded as { conflict_id: string | null; updated_id: string | null }[])[0];
    if (outcome?.conflict_id) {
      return NextResponse.json(
        { error: 'Another contact with this email already exists.', code: 'DUPLICATE_EMAIL', existing_contact_id: outcome.conflict_id },
        { status: 409 },
      );
    }
    if (!outcome?.updated_id) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const updated = await sql`SELECT * FROM crm_contacts WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
    return NextResponse.json({ contact: updated[0] });
  }

  const rows = await sql`
    UPDATE crm_contacts SET
      first_name = ${first_name.trim()}, last_name = ${last_name.trim()},
      email = ${email ?? null}, phone = ${phone ?? null}, job_title = ${job_title ?? null},
      company_id = ${company_id ?? null}, notes = ${notes ?? null},
      classification = ${normalizedClassification},
      updated_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ contact: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  await sql`DELETE FROM crm_contacts WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
