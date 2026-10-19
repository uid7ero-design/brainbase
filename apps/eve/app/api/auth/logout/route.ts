import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { clearSessionToken, readSessionToken } from '@/lib/session';
import { forbiddenOrigin, jsonResponse, sameOriginRequest } from '@/lib/requestGuards';

export async function POST(req: Request) {
  if (!sameOriginRequest(req)) return forbiddenOrigin();
  const token = await readSessionToken();
  // The API revokes the session server-side, so the token is dead even where a
  // copy exists. The cookie is removed whether or not that call lands; if it
  // did not, say so instead of claiming the session was revoked.
  const result = token ? await getTicketingGateway().logout(token).catch(() => null) : null;
  await clearSessionToken();
  const revoked = !token || result?.status === 'ok';
  return jsonResponse({ ok: true, revoked });
}
