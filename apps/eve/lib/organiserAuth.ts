import { redirect } from 'next/navigation';
import { getTicketingGateway, type OrganiserSession } from './ticketing/gateway';
import { readSessionToken } from './session';

// Resolves the signed-in organiser for a server component, or redirects to
// sign-in. The API re-checks user, organisation, role and capability on
// this very call, so a disabled user or a removed entitlement lands here
// as unauthorised on the next navigation.
export async function requireOrganiser(): Promise<{ token: string; session: OrganiserSession }> {
  const token = await readSessionToken();
  if (!token) redirect('/signin');
  const result = await getTicketingGateway().getSession(token);
  if (result.status === 'ok') return { token, session: result.data };
  if (result.status === 'unauthorised' || result.status === 'forbidden') redirect('/signin?reason=session');
  // Upstream down or misconfigured: say so rather than pretending to be signed out.
  throw new Error('The ticketing service is unavailable.');
}

export const canManage = (role: string) => role === 'manager' || role === 'admin' || role === 'super_admin';
