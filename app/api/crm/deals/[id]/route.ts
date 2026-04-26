import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

type Ctx = { params: Promise<{ id: string }> };
const STAGES = ['lead','qualified','proposal','negotiation','closed_won','closed_lost'];

export async function GET(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  const rows = await sql`
    SELECT d.*, c.name AS company_name,
      ct.first_name || ' ' || ct.last_name AS contact_name,
      u.name AS assigned_to_name
    FROM crm_deals d
    LEFT JOIN crm_companies c  ON c.id  = d.company_id
    LEFT JOIN crm_contacts  ct ON ct.id = d.contact_id
    LEFT JOIN users         u  ON u.id  = d.assigned_to
    WHERE d.id = ${id} AND d.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const activities = await sql`
    SELECT a.*, u.name AS created_by_name FROM crm_activities a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.deal_id = ${id} AND a.organisation_id = ${session.organisationId}
    ORDER BY a.activity_date DESC LIMIT 30
  `;

  return NextResponse.json({ deal: rows[0], activities });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  const body = await req.json();
  const { title, value, stage, probability, expected_close, company_id, contact_id, assigned_to, notes } = body;
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (stage && !STAGES.includes(stage)) return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 });

  const rows = await sql`
    UPDATE crm_deals SET
      title = ${title.trim()}, value = ${value ?? null}, stage = ${stage ?? 'lead'},
      probability = ${probability ?? 0}, expected_close = ${expected_close ?? null},
      company_id = ${company_id ?? null}, contact_id = ${contact_id ?? null},
      assigned_to = ${assigned_to ?? null}, notes = ${notes ?? null}, updated_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ deal: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  const { id } = await params;

  await sql`DELETE FROM crm_deals WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}
