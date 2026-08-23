import { NextRequest, NextResponse } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '@/lib/globalIntegrationAccess';
import { getConnectionSummary, clearConnection } from '@/lib/microsoft/tokens';

// Founder OS Phase E.5A — connection presence only. Mirrors GET
// /api/integrations/gmail/status exactly: "connected" means a token is
// stored, never "Microsoft Graph is currently reachable" (no live API
// call is made here). DELETE mirrors Gmail/GCal's own disconnect
// action.
export async function GET() {
  try {
    await requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const connection = await getConnectionSummary();
  if (!connection) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, email: connection.accountEmail });
}

export async function DELETE(_req: NextRequest) {
  try {
    await requireGlobalIntegrationAccess('MS365_OWNER_ORG_ID', 'manager');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  await clearConnection();
  return NextResponse.json({ ok: true });
}
