import { checkTicketingGate } from '@/lib/ticketing/gate';

// Tokens are stateless; logout instructs the Eve server to drop its cookie.
// (No schema => no server-side revocation list; lifetime + per-request DB
// revalidation bound the exposure of a copied token.) Server-to-server only.
export async function POST(req: Request) {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;
  return Response.json({ ok: true, clearCookie: true }, { headers: { 'Cache-Control': 'no-store' } });
}
