import { NextRequest, NextResponse } from 'next/server';
import { readAllTokens, clearTokens } from '../../../../../lib/gcal/tokens';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '../../../../../lib/globalIntegrationAccess';

export async function GET() {
  try {
    await requireGlobalIntegrationAccess('GCAL_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const accounts = readAllTokens();
  return NextResponse.json({
    connected: accounts.length > 0,
    accounts:  accounts.map(t => t.email),
  });
}

export async function DELETE(req: NextRequest) {
  try {
    await requireGlobalIntegrationAccess('GCAL_OWNER_ORG_ID', 'manager');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email') ?? undefined;
  clearTokens(email);
  return NextResponse.json({ ok: true });
}
