import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const companies = await sql`
    SELECT
      c.*,
      COUNT(DISTINCT ct.id)::int AS contact_count,
      COUNT(DISTINCT d.id)::int  AS deal_count,
      COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('closed_lost')), 0) AS pipeline_value
    FROM crm_companies c
    LEFT JOIN crm_contacts ct ON ct.company_id = c.id
    LEFT JOIN crm_deals    d  ON d.company_id  = c.id
    WHERE c.organisation_id = ${session.organisationId}
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `;

  return NextResponse.json({ companies });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json();
  const { name, website, industry, company_size, phone, address, notes } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });

  const rows = await sql`
    INSERT INTO crm_companies (organisation_id, created_by, name, website, industry, company_size, phone, address, notes)
    VALUES (${session.organisationId}, ${session.userId}, ${name.trim()}, ${website ?? null}, ${industry ?? null},
            ${company_size ?? null}, ${phone ?? null}, ${address ?? null}, ${notes ?? null})
    RETURNING *
  `;
  return NextResponse.json({ company: rows[0] }, { status: 201 });
}
