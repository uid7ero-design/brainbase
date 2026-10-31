import { redirect } from 'next/navigation';
import { getTicketingGateway, type OrganiserSession } from './ticketing/gateway';
import { readSessionToken } from './session';

// Resolves the signed-in organiser for a server component, or redirects to
// sign-in. The API re-checks user, organisation, role and capability on
// this very call, so a disabled user or a removed entitlement lands here
// as unauthorised on the next navigation. An organisation that is not (or
// no longer) enabled on Eve gets a neutral "not enabled" sign-in notice.
export async function requireOrganiser(): Promise<{ token: string; session: OrganiserSession }> {
  const token = await readSessionToken();
  if (!token) redirect('/signin');
  const result = await getTicketingGateway().getSession(token);
  if (result.status === 'ok') return { token, session: result.data };
  if (result.status === 'forbidden' && result.code === 'EVE_NOT_ENABLED') redirect('/signin?reason=not-enabled');
  if (result.status === 'unauthorised' || result.status === 'forbidden') redirect('/signin?reason=session');
  // Upstream down or misconfigured: say so rather than pretending to be signed out.
  throw new Error('The ticketing service is unavailable.');
}

export const EVE_NOT_ENABLED_MESSAGE =
  "Eve isn't enabled for your organisation yet. An administrator of your organisation can turn it on.";

export const canManage = (role: string) => role === 'manager' || role === 'admin' || role === 'super_admin';
