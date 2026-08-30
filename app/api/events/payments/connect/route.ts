import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { getConnectAccountState, getOrCreateConnectedAccount, createOnboardingLink } from '@/lib/events/stripeConnect';
import { StripeNotConfiguredError } from '@/lib/events/stripe';

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// GET — current Connect status for the Payments settings page (§5).
// viewer+ (read-only, matching every other Events read's own role
// floor); never returns the raw Stripe account id to the client — the
// settings UI only needs status/flags to render, not the identifier
// itself.
export async function GET() {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const state = await getConnectAccountState(auth.session.organisationId);
  return NextResponse.json({
    status: state.status,
    charges_enabled: state.chargesEnabled,
    payouts_enabled: state.payoutsEnabled,
    details_submitted: state.detailsSubmitted,
    connected_at: state.connectedAt,
    last_synced_at: state.lastSyncedAt,
    connected: state.accountId !== null,
  });
}

// POST — "Connect Stripe" (§6/§7). manager+ (this creates a Stripe
// resource and starts onboarding — a real mutation, matching the
// manager+ floor every other Events mutation in this module uses).
// organisationId is derived ONLY from the authenticated session, never
// from the request body — there is no request body read here at all.
// Idempotent: getOrCreateConnectedAccount() reuses an existing account
// id unconditionally, so repeated clicks (or a double-submit) never
// create a second Stripe account for this organisation (§7).
export async function POST() {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const accountId = await getOrCreateConnectedAccount(session.organisationId);
    const origin = await originFromHeaders();
    const onboardingUrl = await createOnboardingLink(
      accountId,
      `${origin}/events/payments/connect/return`,
      `${origin}/events/payments/connect/refresh`,
    );
    return NextResponse.json({ onboarding_url: onboardingUrl });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: 'Stripe is not currently configured.' }, { status: 503 });
    }
    console.error('[events payments connect] failed to start onboarding', err);
    return NextResponse.json({ error: 'Could not start Stripe onboarding. Please try again.' }, { status: 500 });
  }
}
