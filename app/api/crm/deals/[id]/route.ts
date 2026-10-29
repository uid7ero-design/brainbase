import { canWriteCrm, crmLinksAllowed } from '@/lib/crm/writeAccess';
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { requireCapability, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

type Ctx = { params: Promise<{ id: string }> };
const STAGES = ['lead','qualified','proposal','negotiation','closed_won','closed_lost'];

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
    SELECT d.*, c.name AS company_name,
      ct.first_name || ' ' || ct.last_name AS contact_name,
      u.name AS assigned_to_name
    FROM crm_deals d
    LEFT JOIN crm_companies c  ON c.id  = d.company_id AND c.organisation_id = ${session.organisationId}
    LEFT JOIN crm_contacts  ct ON ct.id = d.contact_id AND ct.organisation_id = ${session.organisationId}
    LEFT JOIN users         u  ON u.id  = d.assigned_to AND u.organisation_id = ${session.organisationId}
    WHERE d.id = ${id} AND d.organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const activities = await sql`
    SELECT a.*, u.name AS created_by_name FROM crm_activities a
    LEFT JOIN users u ON u.id = a.created_by AND u.organisation_id = ${session.organisationId}
    WHERE a.deal_id = ${id} AND a.organisation_id = ${session.organisationId}
    ORDER BY a.activity_date DESC LIMIT 30
  `;

  return NextResponse.json({ deal: rows[0], activities });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  if (!canWriteCrm(session)) return forbidden();
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  const body = await req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'Invalid request.'},{status:400});
  if (!await crmLinksAllowed(session.organisationId, body)) return NextResponse.json({error:'Linked record unavailable.'},{status:400});
  const { title, value, stage, probability, expected_close, company_id, contact_id, assigned_to, notes } = body;
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (stage && !STAGES.includes(stage)) return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 });

  const rows = await sql`
    UPDATE crm_deals SET
      title = ${title.trim()}, value = ${value ?? null}, stage = ${stage ?? 'lead'},
      probability = ${probability ?? 0}, expected_close = ${expected_close ?? null},
      company_id = ${company_id || null}, contact_id = ${contact_id || null},
      assigned_to = ${assigned_to || null}, notes = ${notes ?? null}, updated_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING *
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ deal: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  if (!canWriteCrm(session)) return forbidden();
  try {
    await requireCapability(session.organisationId, 'crm');
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify CRM access.' }, { status: 503 });
    return forbidden();
  }
  const { id } = await params;

  await sql`DELETE FROM crm_deals WHERE id = ${id} AND organisation_id = ${session.organisationId}`;
  return NextResponse.json({ success: true });
}

/** A stage move changes only stage, preserving links and notes read by another editor. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  let session;
  try { session=await requireSession(); } catch { return unauthorized(); }
  if(!canWriteCrm(session))return forbidden();
  try {await requireCapability(session.organisationId,'crm');}
  catch(err){return err instanceof CapabilityDatabaseError?NextResponse.json({error:'Unable to verify CRM access.'},{status:503}):forbidden();}
  const body=await req.json();
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='stage')||!STAGES.includes(body.stage))return NextResponse.json({error:'Choose a valid stage.'},{status:400});
  const {id}=await params;
  const rows=await sql`UPDATE crm_deals SET stage=${body.stage},updated_at=now() WHERE id=${id} AND organisation_id=${session.organisationId} RETURNING *`;
  return rows.length?NextResponse.json({deal:rows[0]}):NextResponse.json({error:'Not found.'},{status:404});
}
