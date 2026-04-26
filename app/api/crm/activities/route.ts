import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

const TYPES = ['call','email','note','meeting'] as const;

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { searchParams } = req.nextUrl;
  const contactId = searchParams.get('contactId');
  const companyId = searchParams.get('companyId');
  const dealId    = searchParams.get('dealId');
  const limit     = Math.min(Number(searchParams.get('limit') ?? 50), 200);

  const activities = await sql`
    SELECT
      a.*,
      u.name  AS created_by_name,
      ct.first_name || ' ' || ct.last_name AS contact_name,
      c.name  AS company_name,
      d.title AS deal_title
    FROM crm_activities a
    LEFT JOIN users         u  ON u.id  = a.created_by
    LEFT JOIN crm_contacts  ct ON ct.id = a.contact_id
    LEFT JOIN crm_companies c  ON c.id  = a.company_id
    LEFT JOIN crm_deals     d  ON d.id  = a.deal_id
    WHERE a.organisation_id = ${session.organisationId}
      ${contactId ? sql`AND a.contact_id = ${contactId}` : sql``}
      ${companyId ? sql`AND a.company_id = ${companyId}` : sql``}
      ${dealId    ? sql`AND a.deal_id    = ${dealId}`    : sql``}
    ORDER BY a.activity_date DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({ activities });
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json();
  const { type, subject, body: actBody, activity_date, contact_id, company_id, deal_id } = body;
  if (!TYPES.includes(type)) return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  if (!subject?.trim()) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 });

  const rows = await sql`
    INSERT INTO crm_activities (organisation_id, created_by, type, subject, body, activity_date, contact_id, company_id, deal_id)
    VALUES (${session.organisationId}, ${session.userId}, ${type}, ${subject.trim()},
            ${actBody ?? null}, ${activity_date ?? new Date().toISOString()},
            ${contact_id ?? null}, ${company_id ?? null}, ${deal_id ?? null})
    RETURNING *
  `;
  return NextResponse.json({ activity: rows[0] }, { status: 201 });
}
