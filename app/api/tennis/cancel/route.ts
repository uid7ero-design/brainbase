import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token?: string };
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const rows = await sql`
    UPDATE tennis_leads
    SET status = 'cancelled'
    WHERE client_token = ${token}::uuid
      AND status NOT IN ('cancelled', 'closed', 'booked')
    RETURNING id, name
  `;

  if (rows.length === 0) {
    const existing = await sql`
      SELECT status FROM tennis_leads WHERE client_token = ${token}::uuid LIMIT 1
    `;
    if (existing.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing[0].status === 'cancelled') return NextResponse.json({ already: true });
    return NextResponse.json({ error: 'This request cannot be cancelled at this stage' }, { status: 400 });
  }

  return NextResponse.json({ success: true, name: rows[0].name });
}
