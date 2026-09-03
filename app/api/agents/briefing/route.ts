import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { run } from '@/lib/agents/briefingAgent';
import type { AgentInput } from '@/lib/agents/types';

export async function POST(req: NextRequest) {
  // Phase C1.4: previously the raw JWT-only getSession() (no DB re-check, no
  // cross-org staleness rejection, no impersonation resolution) — inconsistent
  // with app/api/chat's stronger getAuthSession() and with this same
  // app/api/agents family's own scout/route.ts, which already used
  // requireSession(). Standardised on requireSession() (lib/org.ts): DB-
  // authoritative, rejects a session whose org no longer matches the DB,
  // resolves the super_admin org_override — the same semantics scout already
  // had, now shared consistently across every direct agents/** entry point.
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
