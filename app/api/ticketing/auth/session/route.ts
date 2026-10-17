import { authorizeTicketingApiRequest } from '@/lib/ticketing/authorize';

// Resolves the current context from the database. Server-to-server only.
export async function GET(req: Request) {
  const auth = await authorizeTicketingApiRequest(req, 'viewer');
  if (!auth.ok) return auth.response;
  const { userId, organisationId, role, name } = auth.context;
  return Response.json({ user: { id: userId, name, role }, organisationId }, { headers: { 'Cache-Control': 'no-store' } });
}
