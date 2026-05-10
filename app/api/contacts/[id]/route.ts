import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { status, name, email, phone, address, age, program, session_times, next_action,
          guardian_name, guardian_phone, session_id } = body;
  const validStatuses = ['lead', 'contacted', 'active', 'inactive'];

  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const touchedAt = status !== undefined ? new Date().toISOString() : null;

  let rows;
  try {
    rows = await sql`
      UPDATE contacts SET
        status             = COALESCE(${status ?? null},         status),
        name               = COALESCE(${name ?? null},           name),
        email              = COALESCE(${email ?? null},          email),
        phone              = COALESCE(${phone ?? null},          phone),
        address            = COALESCE(${address ?? null},        address),
        age                = COALESCE(${age ?? null},            age),
        program            = COALESCE(${program ?? null},        program),
        session_times      = COALESCE(${session_times ?? null},  session_times),
        next_action        = COALESCE(${next_action ?? null},    next_action),
        guardian_name      = COALESCE(${guardian_name ?? null},  guardian_name),
        guardian_phone     = COALESCE(${guardian_phone ?? null}, guardian_phone),
        session_id         = COALESCE(${session_id ?? null},     session_id),
        last_contacted_at  = COALESCE(${touchedAt ?? null},      last_contacted_at)
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, name, email, phone, status, address, age, program, session_times,
                next_action, guardian_name, guardian_phone, session_id, last_contacted_at
    `;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Columns don't exist yet — run the pending SQL migration
    if (msg.includes('guardian_name') || msg.includes('guardian_phone') || msg.includes('session_id')) {
      return NextResponse.json(
        { error: 'DB migration required: ALTER TABLE contacts ADD COLUMN IF NOT EXISTS guardian_name TEXT; ADD guardian_phone TEXT; ADD session_id TEXT;' },
        { status: 500 }
      );
    }
    console.error('[PATCH /api/contacts/:id]', err);
    return NextResponse.json({ error: 'Failed to update contact.' }, { status: 500 });
  }

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ contact: rows[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const rows = await sql`
    DELETE FROM contacts
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    RETURNING id
  `;

  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
