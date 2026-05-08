import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-clients`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      console.warn('[founder-clients] backend responded', res.status, '— falling back to empty list');
    } catch (err) {
      console.warn('[founder-clients] backend unreachable:', (err as Error).message, '— falling back to empty list');
    }
  }

  return NextResponse.json({ clients: [] });
}
