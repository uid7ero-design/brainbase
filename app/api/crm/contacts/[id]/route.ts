import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
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
  const { id } = await params;

  const body = await req.json();
  const { first_name, last_name, email, phone, job_title, company_id, notes } = body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
  }

  const rows = await sql`
    UPDATE crm_contacts SET
      first_name = ${first_name.trim()}, last_name = ${last_name.trim()},
      email = ${email ?? null}, phone = ${phone ?? null}, job_title = ${job_title ?? null},
      company_id = ${company_id ?? null}, notes = ${notes ?? null}, updated_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ contact: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  await sql`DELETE FROM crm_contacts WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
