import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { run } from '@/lib/agents/dataIntakeAgent';
import type { AgentInput } from '@/lib/agents/types';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.organisationId) {
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
