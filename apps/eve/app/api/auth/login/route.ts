import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { EVE_NOT_ENABLED_MESSAGE } from '@/lib/organiserAuth';
import { writeSessionToken } from '@/lib/session';
import { forbiddenOrigin, jsonResponse, readJsonBody, sameOriginRequest, visitorIp } from '@/lib/requestGuards';

// Same-origin sign-in. The browser posts credentials to THIS origin only;
// the server forwards them to the ticketing API with its server-only
// credential, and stores the returned token in a host-only HttpOnly cookie.
// The token is never put in a response body or URL.
export async function POST(req: Request) {
  if (!sameOriginRequest(req)) return forbiddenOrigin();

  const body = await readJsonBody(req, 4 * 1024);
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const organisationId = typeof body?.organisationId === 'string' ? body.organisationId : undefined;
  if (!username || !password) return jsonResponse({ error: 'Invalid username or password.' }, 401);

  const result = await getTicketingGateway().login({ username, password, organisationId }, visitorIp(req));
  switch (result.status) {
    case 'ok':
      await writeSessionToken(result.data.token, result.data.expiresAt);
      return jsonResponse({ ok: true, user: { name: result.data.user.name, role: result.data.user.role }, organisationId: result.data.organisationId });
    case 'forbidden':
      // Sent only after the password was verified, about the user's own organisation.
      if (result.code === 'EVE_NOT_ENABLED') return jsonResponse({ error: EVE_NOT_ENABLED_MESSAGE }, 403);
      return jsonResponse({ error: 'Invalid username or password.' }, 401);
    case 'unauthorised':
    case 'not_found':
      return jsonResponse({ error: 'Invalid username or password.' }, 401);
    case 'error':
      if (result.httpStatus === 409 && Array.isArray(result.body.organisations)) {
        return jsonResponse({ error: 'ORGANISATION_SELECTION_REQUIRED', organisations: result.body.organisations }, 409);
      }
      if (result.httpStatus === 429) return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429);
      return jsonResponse({ error: 'Sign-in is unavailable right now.' }, 503);
    default:
      return jsonResponse({ error: 'Sign-in is unavailable right now.' }, 503);
  }
}
