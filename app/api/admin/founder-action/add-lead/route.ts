import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    org?: string;
    contact_name?: string;
    email?: string;
    stage?: string;
    estimated_value?: number | null;
    next_action?: string | null;
    note?: string | null;
    existing_client_id?: number | string | null;
  };

  if (!body.org?.trim())
    return NextResponse.json({ error: 'org is required' }, { status: 400 });

  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-action/add-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, triggered_by: session.userId }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      console.warn('[founder-action/add-lead] backend responded', res.status);
    } catch (err) {
      console.warn('[founder-action/add-lead] backend unreachable:', (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, action: 'lead_added', org: body.org, stage: body.stage ?? 'lead' });
}
