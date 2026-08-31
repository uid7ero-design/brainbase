import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { refreshConnectedAccountStatus } from '@/lib/events/stripeConnect';

// Stripe's own `return_url` target (§8) — reached after the user
// completes or exits the hosted onboarding flow. Never assumes success
// merely because Stripe redirected here (§8's own explicit
// instruction): the only thing this page does is re-fetch the
// connected account's ACTUAL current state from Stripe and persist it,
// then hand off to the settings page, which renders whatever that
// real state turns out to be — Connected, still ACTION_REQUIRED, or
// still ONBOARDING if the user exited early.
export default async function StripeConnectReturnPage() {
  let session;
  try {
    session = await requireRole('manager');
  } catch {
    redirect('/dashboard');
  }
  await refreshConnectedAccountStatus(session.organisationId);
  redirect('/events/payments');
}
