import type { ConnectView, PaymentState } from '@/lib/ticketing/gateway';

// Presentation helpers for the READ-ONLY Payments pages. Labels are the
// organiser's vocabulary; no provider identifier is ever shown.

export const STATE_LABEL: Record<PaymentState, string> = {
  PAID: 'Paid', PENDING: 'Pending', FAILED: 'Failed', EXPIRED: 'Expired', REFUNDED: 'Refunded',
};

const STATE_TONE: Record<PaymentState, string> = {
  PAID: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-900 border-amber-200',
  FAILED: 'bg-red-50 text-red-900 border-red-200',
  EXPIRED: 'bg-stone-100 text-stone-800 border-stone-300',
  REFUNDED: 'bg-sky-50 text-sky-900 border-sky-200',
};

export function StateBadge({ state }: { state: PaymentState }) {
  return (
    <span data-testid={`state-${state}`} className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[state]}`}>
      {STATE_LABEL[state]}
    </span>
  );
}

export const FEE_MODE_LABEL = { PASS_THROUGH: 'Paid by the buyer', ABSORB: 'Deducted from your sales' } as const;

const CONNECT_COPY: Record<ConnectView['status'], { title: string; detail: string }> = {
  NOT_CONNECTED: { title: 'Not connected', detail: 'No Stripe account is connected, so paid tickets cannot be sold yet.' },
  ONBOARDING: { title: 'Setup in progress', detail: 'A Stripe account has been started but its details have not been submitted.' },
  ACTION_REQUIRED: { title: 'Action required', detail: 'Stripe needs more information before this account is fully enabled.' },
  CONNECTED: { title: 'Connected', detail: 'Your Stripe account is connected.' },
  RESTRICTED: { title: 'Restricted', detail: 'Stripe has restricted this account.' },
};

// Cached account state only (what the paid-checkout gate itself reads).
// Read-only: no onboarding or management action exists here.
export function ConnectPanel({ connect }: { connect: ConnectView | null }) {
  if (!connect) {
    return (
      <section data-testid="connect-status" className="rounded-lg border border-eve-line bg-eve-surface-alt p-4 text-sm">
        <h2 className="font-semibold">Stripe account</h2>
        <p className="mt-1 text-eve-muted">The account status could not be loaded right now.</p>
      </section>
    );
  }
  const copy = CONNECT_COPY[connect.status] ?? CONNECT_COPY.NOT_CONNECTED;
  return (
    <section data-testid="connect-status" className="rounded-lg border border-eve-line bg-eve-surface p-4 text-sm">
      <h2 className="font-semibold">Stripe account: {copy.title}</h2>
      <p className="mt-1 text-eve-muted">{copy.detail}</p>
      <p className="mt-2" data-testid="paid-eligibility">
        {connect.eligible_for_paid_ticketing ? 'Paid ticketing: available.' : 'Paid ticketing: not available until a Stripe account that can take payments is connected.'}
      </p>
      {connect.connected ? (
        <p className="mt-1 text-eve-muted">Payments {connect.charges_enabled ? 'enabled' : 'not enabled'} · Payouts {connect.payouts_enabled ? 'enabled' : 'not enabled'}</p>
      ) : null}
    </section>
  );
}
