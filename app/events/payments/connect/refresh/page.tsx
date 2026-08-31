import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { requireRole } from '@/lib/org';
import { getConnectAccountState, createOnboardingLink } from '@/lib/events/stripeConnect';
import { StripeNotConfiguredError } from '@/lib/events/stripe';

// Stripe's own `refresh_url` target (§8) — reached when a previously
// issued Account Link has expired or was already used, not from any
// Brainbase-initiated action. Generates a genuinely fresh, single-use
// Account Link for the SAME connected account and sends the browser
// straight back into Stripe onboarding. Tenant-scoped like every other
// page here: the account acted on is always the CALLER's own
// organisation's, never one supplied by the URL or any client input.
export default async function StripeConnectRefreshPage() {
  let session;
  try {
    session = await requireRole('manager');
  } catch {
    redirect('/dashboard');
  }

  const state = await getConnectAccountState(session.organisationId);
  if (!state.accountId) redirect('/events/payments');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  // redirect() must never be called from inside this try block — it
  // works by throwing a special Next.js control-flow error, which a
  // catch here would otherwise incorrectly intercept as a real
  // failure. createOnboardingLink()'s own result is captured first;
  // the actual redirect happens afterward, outside the try/catch.
  let onboardingUrl: string;
  try {
    onboardingUrl = await createOnboardingLink(
      state.accountId,
      `${origin}/events/payments/connect/return`,
      `${origin}/events/payments/connect/refresh`,
    );
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) notFound();
    throw err;
  }
  redirect(onboardingUrl);
}
