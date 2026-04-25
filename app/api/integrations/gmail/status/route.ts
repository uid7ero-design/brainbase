import { NextResponse } from 'next/server';
import { readTokens, clearTokens } from '../../../../../lib/gmail/tokens';
import { NextRequest } from 'next/server';

export async function GET() {
  const tokens = readTokens();
  if (!tokens) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, email: tokens.email ?? null });
}

export async function DELETE(_req: NextRequest) {
  clearTokens();
  return NextResponse.json({ ok: true });
}
