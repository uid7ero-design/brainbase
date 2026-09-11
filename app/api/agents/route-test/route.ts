import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logAgentRunExecuted } from '@/lib/admin/auditLog';
import { route as routeToAgent } from '@/lib/agents/agentRouter';
import * as insightAgent     from '@/lib/agents/insightAgent';
import * as actionAgent      from '@/lib/agents/actionAgent';
import * as briefingAgent    from '@/lib/agents/briefingAgent';
import * as dataIntakeAgent  from '@/lib/agents/dataIntakeAgent';
import type { AgentInput } from '@/lib/agents/types';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

export async function POST(req: NextRequest) {
  // SEC-1B2: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB, and
  // organisationId/userId were taken straight from that same stale claim.
  // requireRole() (lib/org.ts) re-reads the caller's current role/
  // organisation/status from the database on every call, so a since-
  // demoted, since-deactivated, or deleted super_admin's still-valid JWT
  // can no longer trigger a privileged agent run, and the org the agents
  // read from is the caller's current DB-confirmed org, not a stale claim.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

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

  // SEC-1B2: audit — privileged agent execution, previously entirely
  // unaudited. Never logs the query text itself (a free-text prompt that
  // may carry protected/tenant data) — only which agent ran, whether the
  // chat fallback was used, and whether it errored.
  {
    const { ipAddress, userAgent } = requestMeta(req);
    await logAgentRunExecuted({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      agent: routeResult.agent,
      fallbackUsed,
      hadError: agentError !== null,
      routeSource: 'agents/route-test',
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json({
    route:       routeResult,
    agentOutput,
    agentError,
    timing:      { routeMs, agentMs, totalMs: Date.now() - startMs },
    fallbackUsed,
  });
}
