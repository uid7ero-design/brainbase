import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { isValidCrmContactClassification } from '@/lib/crm/classification';

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }

  const companyId = req.nextUrl.searchParams.get('companyId');

  // Same conditional-SQL construction pattern already used for
  // companyId above. 'UNCLASSIFIED' is a UI-level sentinel (not one of
  // the six canonical values — see lib/crm/classification.ts) meaning
  // "classification IS NULL", matching the filter option the contact
  // list exposes. Any other, non-canonical value is never interpolated
  // into SQL — it's simply treated as "no filter" (same "ignore rather
  // than error" precedent this codebase already applies to stray/stale
  // fields elsewhere, e.g. crmContactsSchemaAlignment.test.ts), since a
  // malformed query string on a read-only list endpoint shouldn't 400.
  const classificationParam = req.nextUrl.searchParams.get('classification');
  let classificationClause = sql``;
  if (classificationParam === 'UNCLASSIFIED') {
    classificationClause = sql`AND ct.classification IS NULL`;
  } else if (isValidCrmContactClassification(classificationParam)) {
    classificationClause = sql`AND ct.classification = ${classificationParam}`;
  }

  const contacts = await sql`
    SELECT
      ct.*,
      c.name AS company_name,
      COUNT(DISTINCT a.id)::int AS activity_count
    FROM crm_contacts ct
    LEFT JOIN crm_companies  c ON c.id = ct.company_id
    LEFT JOIN crm_activities a ON a.contact_id = ct.id
    WHERE ct.organisation_id = ${session.organisationId}
      ${companyId ? sql`AND ct.company_id = ${companyId}` : sql``}
      ${classificationClause}
    GROUP BY ct.id, c.name
    ORDER BY ct.first_name, ct.last_name
  `;

  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }

  const body = await req.json();
  const { first_name, last_name, email, phone, job_title, company_id, notes, classification } = body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }
  // classification is optional (unclassified is valid) — null/undefined/''
  // all mean "no classification"; anything else must be one of the six
  // canonical values (lib/crm/classification.ts) or the request is
  // rejected outright, never silently interpolated into SQL.
  if (classification !== null && classification !== undefined && classification !== '' && !isValidCrmContactClassification(classification)) {
    return NextResponse.json({ error: 'Invalid classification.' }, { status: 400 });
  }
  const normalizedClassification = classification || null;

  const rows = await sql`
    INSERT INTO crm_contacts (
      organisation_id, created_by, first_name, last_name, email, phone, job_title, company_id, notes, classification
    ) VALUES (
      ${session.organisationId}, ${session.userId}, ${first_name.trim()}, ${last_name.trim()},
      ${email ?? null}, ${phone ?? null}, ${job_title ?? null}, ${company_id ?? null}, ${notes ?? null},
      ${normalizedClassification}
    )
    RETURNING *
  `;
  return NextResponse.json({ contact: rows[0] }, { status: 201 });
}
