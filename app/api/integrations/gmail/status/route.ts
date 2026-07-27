import { NextResponse } from 'next/server';
import { readTokens, clearTokens } from '../../../../../lib/gmail/tokens';
import { NextRequest } from 'next/server';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '../../../../../lib/globalIntegrationAccess';

export async function GET() {
  try {
    await requireGlobalIntegrationAccess('GMAIL_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const tokens = readTokens();
  if (!tokens) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, email: tokens.email ?? null });
}

export async function DELETE(_req: NextRequest) {
  try {
    await requireGlobalIntegrationAccess('GMAIL_OWNER_ORG_ID', 'manager');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  clearTokens();
  return NextResponse.json({ ok: true });
}
