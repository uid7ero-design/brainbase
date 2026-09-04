import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { run } from '@/lib/agents/dataIntakeAgent';
import type { AgentInput } from '@/lib/agents/types';

export async function POST(req: NextRequest) {
  // Phase C1.4: standardised on requireSession() — see
  // app/api/agents/briefing/route.ts's comment for the full rationale.
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as Partial<AgentInput>;

  const input: AgentInput = {
    organisationId: session.organisationId,
    userId:         session.userId,
    department:     body.department,
    query:          body.query,
    dataContext:    body.dataContext,
  };

  const result = await run(input);
  return NextResponse.json(result);
}
