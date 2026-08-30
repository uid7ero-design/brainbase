import 'server-only';
import Stripe from 'stripe';
import sql from '@/lib/db';
import { getStripeClient } from './stripe';

// ── Account type decision (§4) ───────────────────────────────────────
//
// Express connected accounts. Stripe hosts onboarding/KYC/bank-detail
// collection entirely itself (Brainbase never sees or stores any of
// it — see this file's own functions below, none of which accept or
// persist a bank number, identity document, or card value); the
// client manages their own payout details directly with Stripe;
// Brainbase keeps platform-level integration control (this module is
// the only place that ever talks to a connected account). This is
// materially less operational burden than Custom accounts, which
// would make Brainbase responsible for building its own KYC/
// compliance UI — no product requirement here justifies that.
export const CONNECTED_ACCOUNT_TYPE = 'express' as const;

// ── Charge model decision (§12) ──────────────────────────────────────
//
// Direct charges on the connected account, not destination charges.
// Every Stripe API call this module (and lib/events/stripe.ts's
// createCheckoutSession/createRefund, both updated in this remediation
// to accept a connectedAccountId) makes against a specific
// organisation's money movement passes `{ stripeAccount: accountId }`
// as a REQUEST OPTION — Stripe's supported "acting as the connected
// account" pattern. The connected account is directly the merchant of
// record for the charge; Brainbase's platform account never receives,
// holds, or transfers the ticket proceeds itself. This is the
// simplest correct shape for "client is clearly the payment
// recipient" (§12) and needs no `transfer_data`/`on_behalf_of`
// bookkeeping. Trade-off, documented per §12/§20: a future Brainbase
// platform fee is more naturally expressed with destination charges
// (`application_fee_amount` requires either destination charges or
// direct charges with Stripe-Connect-specific fee support) — direct
// charges still support `application_fee_amount` when the platform
// has the right Connect capability, so this does not foreclose a
// future fee, but implementing one is explicitly out of scope here
// (§20 — no fee is implemented, hardcoded, or wired up in this pass).
export type ConnectStatus = 'NOT_CONNECTED' | 'ONBOARDING' | 'ACTION_REQUIRED' | 'CONNECTED' | 'RESTRICTED';

export type ConnectAccountState = {
  status: ConnectStatus;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
};

type OrgConnectRow = {
  stripe_account_id: string | null;
  stripe_account_status: string;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_connected_at: Date | string | null;
  stripe_last_synced_at: Date | string | null;
};

function toState(row: OrgConnectRow): ConnectAccountState {
  return {
    status: row.stripe_account_status as ConnectStatus,
    accountId: row.stripe_account_id,
    chargesEnabled: row.stripe_charges_enabled,
    payoutsEnabled: row.stripe_payouts_enabled,
    detailsSubmitted: row.stripe_details_submitted,
    connectedAt: row.stripe_connected_at ? new Date(row.stripe_connected_at).toISOString() : null,
    lastSyncedAt: row.stripe_last_synced_at ? new Date(row.stripe_last_synced_at).toISOString() : null,
  };
}

// Pure — no I/O — so it's independently testable (see
// tests/containment/eventsPhase4AConnect.test.ts) without a live or
// mocked Stripe account object. Stripe's Account object remains the
// source of truth; this is Brainbase's own DERIVED label from it (§3):
//   no account at all              -> NOT_CONNECTED
//   account.requirements.disabled_reason set -> RESTRICTED (Stripe has
//     restricted the account — e.g. rejected KYC, compliance action)
//   !details_submitted             -> ONBOARDING (still mid-flow)
//   details_submitted but !charges_enabled, OR any requirement
//     currently/past due            -> ACTION_REQUIRED
//   charges_enabled && payouts_enabled && no outstanding requirement
//                                   -> CONNECTED
export function deriveConnectStatus(account: Stripe.Account | null): ConnectStatus {
  if (!account) return 'NOT_CONNECTED';
  if (account.requirements?.disabled_reason) return 'RESTRICTED';
  if (!account.details_submitted) return 'ONBOARDING';
  const currentlyDue = account.requirements?.currently_due ?? [];
  const pastDue = account.requirements?.past_due ?? [];
  if (!account.charges_enabled || currentlyDue.length > 0 || pastDue.length > 0) return 'ACTION_REQUIRED';
  if (!account.payouts_enabled) return 'ACTION_REQUIRED';
  return 'CONNECTED';
}

// Reads the organisation's locally-cached Connect state — no Stripe
// call. This is the fast path every normal Events page load and the
// paid-checkout eligibility gate use (§9's "avoid calling Stripe
// unnecessarily on every normal Events page request").
export async function getConnectAccountState(organisationId: string): Promise<ConnectAccountState> {
  const rows = await sql`
    SELECT stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled,
      stripe_details_submitted, stripe_connected_at, stripe_last_synced_at
    FROM organisations WHERE id = ${organisationId} LIMIT 1
  `;
  const row = rows[0] as OrgConnectRow | undefined;
  if (!row) throw new Error('Organisation not found.');
  return toState(row);
}

// Idempotent (§7): if the organisation already has a stripe_account_id,
// it is reused unconditionally — repeated clicks never create a
// second Stripe account for one organisation. organisationId must
// already be session-derived by the caller (see the connect route);
// this function trusts it rather than re-deriving tenancy itself,
// matching every other lib/events/*.ts function's own convention.
export async function getOrCreateConnectedAccount(organisationId: string): Promise<string> {
  const existing = await getConnectAccountState(organisationId);
  if (existing.accountId) return existing.accountId;

  const orgRows = await sql`SELECT name FROM organisations WHERE id = ${organisationId} LIMIT 1`;
  const orgName = (orgRows[0] as { name: string } | undefined)?.name ?? 'Organisation';

  const stripe = getStripeClient();
  const account = await stripe.accounts.create({
    type: CONNECTED_ACCOUNT_TYPE,
    business_profile: { name: orgName, product_description: 'Event ticketing' },
  });

  // A second, concurrent click racing this same organisation is
  // resolved by the UNIQUE partial index on organisations(
  // stripe_account_id) — this UPDATE is itself guarded by
  // stripe_account_id IS NULL, so only the first writer's account id
  // is ever persisted; the loser's freshly-created (but now orphaned)
  // Stripe account is simply never referenced by Brainbase again. In
  // practice this route is manager+-authenticated and rate-limited at
  // the HTTP layer already, making the race exceedingly unlikely, but
  // the guard costs nothing and closes it structurally regardless.
  await sql`
    UPDATE organisations SET stripe_account_id = ${account.id}
    WHERE id = ${organisationId} AND stripe_account_id IS NULL
  `;
  const finalState = await getConnectAccountState(organisationId);
  return finalState.accountId ?? account.id;
}

// Stripe Connect Express onboarding (§6): a fresh, single-use Account
// Link — Stripe's own hosted onboarding UI. `refreshUrl` is where
// STRIPE sends the browser if this specific link has expired or was
// already used (not a Brainbase-initiated action); `returnUrl` is
// where Stripe sends the browser after the user completes or exits
// the flow. Brainbase never collects KYC/bank fields itself (§6's own
// explicit prohibition) — this function's only job is requesting the
// link URL.
export async function createOnboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const stripe = getStripeClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

// Refreshes Brainbase's locally-cached Connect state from Stripe (the
// authoritative source) and persists it. Called after onboarding
// return, on an explicit "Refresh status" action, or before paid
// checkout if the cached state looks stale/insufficient — never on
// every normal page load (§9).
export async function refreshConnectedAccountStatus(organisationId: string): Promise<ConnectAccountState> {
  const current = await getConnectAccountState(organisationId);
  if (!current.accountId) return current; // nothing to refresh

  const stripe = getStripeClient();
  const account = await stripe.accounts.retrieve(current.accountId);
  const status = deriveConnectStatus(account);
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;

  const rows = await sql`
    UPDATE organisations
    SET stripe_account_status = ${status},
        stripe_charges_enabled = ${chargesEnabled},
        stripe_payouts_enabled = ${payoutsEnabled},
        stripe_details_submitted = ${detailsSubmitted},
        stripe_connected_at = CASE WHEN ${status} = 'CONNECTED' AND stripe_connected_at IS NULL THEN now() ELSE stripe_connected_at END,
        stripe_last_synced_at = now()
    WHERE id = ${organisationId}
    RETURNING stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled,
      stripe_details_submitted, stripe_connected_at, stripe_last_synced_at
  `;
  return toState(rows[0] as OrgConnectRow);
}

export type EligibilityResult = { eligible: true; accountId: string } | { eligible: false; reason: string };

// The paid-ticketing gate (§10). Minimum bar: a connected account
// exists AND Stripe has charges_enabled — the definitive "can this
// account currently accept a payment" signal. payouts_enabled/
// details_submitted are surfaced in the UI (§5) but are not
// individually blocking beyond what charges_enabled already implies
// in practice, matching the brief's own "minimum eligibility" framing
// (payouts/details are listed as "prefer additionally", not as a
// second hard gate). Reads only the locally-cached columns — no live
// Stripe call on this hot path (§9).
export async function checkPaidTicketingEligibility(organisationId: string): Promise<EligibilityResult> {
  const state = await getConnectAccountState(organisationId);
  if (!state.accountId || !state.chargesEnabled) {
    return { eligible: false, reason: 'Connect Stripe before selling paid tickets.' };
  }
  return { eligible: true, accountId: state.accountId };
}
