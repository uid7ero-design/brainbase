import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { readSessionToken, writeSessionToken } from '@/lib/session';
import { forbiddenOrigin, jsonResponse, readJsonBody, sameOriginRequest } from '@/lib/requestGuards';

// super_admin organisation selection. The API decides eligibility (Events
// entitled, active) and issues the new token; this route only relays and
// rewrites the cookie.
export async function GET() {
  const token = await readSessionToken();
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
  const result = await getTicketingGateway().listOrganisations(token);
  if (result.status === 'ok') return jsonResponse(result.data);
  if (result.status === 'forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
  if (result.status === 'unauthorised') return jsonResponse({ error: 'Unauthorized' }, 401);
  return jsonResponse({ error: 'Service unavailable.' }, 503);
}

export async function POST(req: Request) {
  if (!sameOriginRequest(req)) return forbiddenOrigin();
  const token = await readSessionToken();
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await readJsonBody(req, 1024);
  const organisationId = typeof body?.organisationId === 'string' ? body.organisationId : '';
  if (!organisationId) return jsonResponse({ error: 'organisationId is required.' }, 400);

  const result = await getTicketingGateway().switchOrganisation(token, organisationId);
  if (result.status === 'ok') {
    await writeSessionToken(result.data.token, result.data.expiresAt);
    return jsonResponse({ ok: true, organisationId: result.data.organisationId });
  }
  if (result.status === 'forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
  if (result.status === 'unauthorised') return jsonResponse({ error: 'Unauthorized' }, 401);
  return jsonResponse({ error: 'Service unavailable.' }, 503);
}
