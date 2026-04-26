import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

const STAGES = ['lead','qualified','proposal','negotiation','closed_won','closed_lost'] as const;

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const stage = req.nextUrl.searchParams.get('stage');

  const deals = await sql`
    SELECT
      d.*,
      c.name  AS company_name,
      ct.first_name || ' ' || ct.last_name AS contact_name,
      u.name  AS assigned_to_name
    FROM crm_deals d
    LEFT JOIN crm_companies c  ON c.id  = d.company_id
    LEFT JOIN crm_contacts  ct ON ct.id = d.contact_id
    LEFT JOIN users         u  ON u.id  = d.assigned_to
    WHERE d.organisation_id = ${session.organisationId}
      ${stage ? sql`AND d.stage = ${stage}` : sql``}
    ORDER BY d.created_at DESC
  `;

  return NextResponse.json({ deals });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json();
  const { title, value, stage = 'lead', probability, expected_close, company_id, contact_id, assigned_to, notes } = body;
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!STAGES.includes(stage)) return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 });

  const rows = await sql`
    INSERT INTO crm_deals (organisation_id, created_by, title, value, stage, probability, expected_close, company_id, contact_id, assigned_to, notes)
    VALUES (${session.organisationId}, ${session.userId}, ${title.trim()}, ${value ?? null}, ${stage},
            ${probability ?? 0}, ${expected_close ?? null}, ${company_id ?? null}, ${contact_id ?? null},
            ${assigned_to ?? null}, ${notes ?? null})
    RETURNING *
  `;
  return NextResponse.json({ deal: rows[0] }, { status: 201 });
}
