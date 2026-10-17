import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { clearSessionToken, readSessionToken } from '@/lib/session';
import { forbiddenOrigin, jsonResponse, sameOriginRequest } from '@/lib/requestGuards';

export async function POST(req: Request) {
  if (!sameOriginRequest(req)) return forbiddenOrigin();
  const token = await readSessionToken();
  // Best effort: the cookie is removed whether or not the API call lands.
  await getTicketingGateway().logout(token).catch(() => undefined);
  await clearSessionToken();
  return jsonResponse({ ok: true });
}
