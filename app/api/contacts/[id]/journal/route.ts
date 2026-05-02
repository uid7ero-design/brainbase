import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.note?.trim()) return NextResponse.json({ error: 'Note is required' }, { status: 400 });

  const contact = await sql`
    SELECT id FROM contacts WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (contact.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [entry] = await sql`
    INSERT INTO contact_journal (contact_id, organisation_id, note)
    VALUES (${id}, ${session.organisationId}, ${body.note.trim()})
    RETURNING id, note, created_at
  `;

  // Update last_contacted_at on every session note
  await sql`
    UPDATE contacts SET last_contacted_at = NOW()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `;

  return NextResponse.json({ entry }, { status: 201 });
}
