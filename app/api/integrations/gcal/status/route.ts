import { NextRequest } from 'next/server';
import { readAllTokens, clearTokens } from '../../../../../lib/gcal/tokens';

export async function GET() {
  const accounts = readAllTokens();
  return Response.json({
    connected: accounts.length > 0,
    accounts:  accounts.map(t => t.email),
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email') ?? undefined;
  clearTokens(email);
  return Response.json({ ok: true });
}
