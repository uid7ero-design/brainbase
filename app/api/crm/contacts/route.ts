import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const companyId = req.nextUrl.searchParams.get('companyId');

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
    GROUP BY ct.id, c.name
    ORDER BY ct.first_name, ct.last_name
  `;

  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json();
  const {
    first_name, last_name, email, phone, job_title, company_id, notes,
    coaching_type, date_of_birth, emergency_contact_name, emergency_contact_phone,
    guardian_name, guardian_phone,
  } = body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO crm_contacts (
      organisation_id, created_by, first_name, last_name, email, phone, job_title, company_id, notes,
      coaching_type, date_of_birth, emergency_contact_name, emergency_contact_phone,
      guardian_name, guardian_phone
    ) VALUES (
      ${session.organisationId}, ${session.userId}, ${first_name.trim()}, ${last_name.trim()},
      ${email ?? null}, ${phone ?? null}, ${job_title ?? null}, ${company_id ?? null}, ${notes ?? null},
      ${coaching_type ?? null}, ${date_of_birth ?? null}, ${emergency_contact_name ?? null},
      ${emergency_contact_phone ?? null}, ${guardian_name ?? null}, ${guardian_phone ?? null}
    )
    RETURNING *
  `;
  return NextResponse.json({ contact: rows[0] }, { status: 201 });
}
