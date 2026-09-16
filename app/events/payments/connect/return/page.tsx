import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/org';
import { getConnectAccountState, refreshConnectedAccountStatus } from '@/lib/events/stripeConnect';
import { logStripeConnectStatusRefreshed } from '@/lib/events/auditLog';

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
  const before = await getConnectAccountState(session.organisationId);
  const after = await refreshConnectedAccountStatus(session.organisationId);

  // Phase 8 — only audited when the stored state actually changed
  // (task's own explicit scope: "status/capabilities refreshed WHERE
  // the stored BrainBase state changes") — a routine return-page visit
  // that finds nothing new from Stripe writes nothing.
  if (
    after.accountId && (
      before.status !== after.status ||
      before.chargesEnabled !== after.chargesEnabled ||
      before.payoutsEnabled !== after.payoutsEnabled ||
      before.detailsSubmitted !== after.detailsSubmitted
    )
  ) {
    await logStripeConnectStatusRefreshed({
      organisationId: session.organisationId, userId: session.userId, accountId: after.accountId,
      before: {
        status: before.status, charges_enabled: before.chargesEnabled,
        payouts_enabled: before.payoutsEnabled, details_submitted: before.detailsSubmitted,
      },
      after: {
        status: after.status, charges_enabled: after.chargesEnabled,
        payouts_enabled: after.payoutsEnabled, details_submitted: after.detailsSubmitted,
      },
    });
  }

  redirect('/events/payments');
}
