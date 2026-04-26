import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  const rows = await sql`
    SELECT c.*, u.name AS created_by_name
    FROM crm_companies c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.id = ${id} AND c.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const contacts = await sql`
    SELECT id, first_name, last_name, email, job_title FROM crm_contacts
    WHERE company_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY first_name
  `;
  const deals = await sql`
    SELECT id, title, value, stage, expected_close FROM crm_deals
    WHERE company_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;
  const activities = await sql`
    SELECT a.*, u.name AS created_by_name FROM crm_activities a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.company_id = ${id} AND a.organisation_id = ${session.organisationId}
    ORDER BY a.activity_date DESC LIMIT 20
  `;

  return NextResponse.json({ company: rows[0], contacts, deals, activities });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  const body = await req.json();
  const { name, website, industry, company_size, phone, address, notes } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  const rows = await sql`
    UPDATE crm_companies SET
      name = ${name.trim()}, website = ${website ?? null}, industry = ${industry ?? null},
      company_size = ${company_size ?? null}, phone = ${phone ?? null},
      address = ${address ?? null}, notes = ${notes ?? null}, updated_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ company: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  await sql`DELETE FROM crm_companies WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
