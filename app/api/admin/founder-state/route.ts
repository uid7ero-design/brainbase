import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

type FounderStateResponse = {
  attention_items: unknown[];
  recommendations: unknown[];
  activity_events: unknown[];
  notes: unknown[];
  revenue_snapshot: Record<string, unknown>;
};

const FALLBACK: FounderStateResponse = {
  attention_items: [],
  recommendations: [],
  activity_events: [],
  notes: [],
  revenue_snapshot: {},
};

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-state`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as FounderStateResponse;
        return NextResponse.json(data);
      }
      console.warn('[founder-state] backend responded', res.status, '— falling back to empty state');
    } catch (err) {
      console.warn('[founder-state] backend unreachable:', (err as Error).message, '— falling back to empty state');
    }
  }

  return NextResponse.json(FALLBACK);
}
