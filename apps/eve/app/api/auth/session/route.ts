import { getTicketingGateway } from '@/lib/ticketing/gateway';
import { readSessionToken } from '@/lib/session';
import { jsonResponse } from '@/lib/requestGuards';

// The current organiser, as the API sees them right now (re-validated).
export async function GET() {
  const token = await readSessionToken();
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);
  const result = await getTicketingGateway().getSession(token);
  if (result.status === 'ok') return jsonResponse(result.data);
  if (result.status === 'unauthorised' || result.status === 'forbidden') return jsonResponse({ error: 'Unauthorized' }, 401);
  return jsonResponse({ error: 'Service unavailable.' }, 503);
}
