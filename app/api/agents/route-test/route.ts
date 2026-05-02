import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { route as routeToAgent } from '@/lib/agents/agentRouter';
import * as insightAgent     from '@/lib/agents/insightAgent';
import * as actionAgent      from '@/lib/agents/actionAgent';
import * as briefingAgent    from '@/lib/agents/briefingAgent';
import * as dataIntakeAgent  from '@/lib/agents/dataIntakeAgent';
import type { AgentInput } from '@/lib/agents/types';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { query } = await req.json() as { query: string };
  if (!query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  const startMs = Date.now();

  const agentInput: AgentInput = {
    organisationId: session.organisationId,
    userId:         session.userId,
    query,
  };

  const routeResult = await routeToAgent(agentInput);
  const routeMs = Date.now() - startMs;

  let agentOutput = null;
  let agentError: string | null = null;
  let agentMs = 0;
  const fallbackUsed = routeResult.agent === 'chat';

  if (!fallbackUsed) {
    const agentStart = Date.now();
    try {
      if (routeResult.agent === 'insight')    agentOutput = await insightAgent.run(agentInput);
      if (routeResult.agent === 'action')     agentOutput = await actionAgent.run(agentInput);
      if (routeResult.agent === 'briefing')   agentOutput = await briefingAgent.run(agentInput);
      if (routeResult.agent === 'dataIntake') agentOutput = await dataIntakeAgent.run(agentInput);
    } catch (err) {
      agentError = (err as Error).message;
    }
    agentMs = Date.now() - agentStart;
  }

  return NextResponse.json({
    route:       routeResult,
    agentOutput,
    agentError,
    timing:      { routeMs, agentMs, totalMs: Date.now() - startMs },
    fallbackUsed,
  });
}
