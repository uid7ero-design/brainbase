import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { client_id?: number | string; org?: string; note?: string };

  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-action/follow-up-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, triggered_by: session.userId }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      console.warn('[founder-action/follow-up-client] backend responded', res.status);
    } catch (err) {
      console.warn('[founder-action/follow-up-client] backend unreachable:', (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, action: 'follow_up_logged', client_id: body.client_id, org: body.org });
}
