'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CheckoutStatus } from '@/lib/ticketing/gateway';
import { formatAmount } from '@/lib/format';

// The return page after hosted checkout. The browser being here proves
// nothing: payment is confirmed by the payment provider's webhook, so this
// polls the order's recorded status and only shows tickets once it is PAID.

const POLL_MS = 2500;
const MAX_POLLS = 24;

export function CheckoutSuccess({ organisationSlug, eventSlug, sessionId }: { organisationSlug: string; eventSlug: string; sessionId: string }) {
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [failed, setFailed] = useState(!sessionId);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (!sessionId || failed || status?.payment_status === 'PAID' || polls >= MAX_POLLS) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/buyer/${encodeURIComponent(organisationSlug)}/${encodeURIComponent(eventSlug)}/status?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        if (res.status === 404) { setFailed(true); return; }
        if (res.ok) setStatus((await res.json()) as CheckoutStatus);
      } catch { /* retry on next tick */ }
      setPolls(p => p + 1);
    }, polls === 0 ? 0 : POLL_MS);
    return () => clearTimeout(timer);
  }, [organisationSlug, eventSlug, sessionId, status, failed, polls]);

  if (failed) {
    return <section role="alert"><h1 className="text-2xl font-semibold">We couldn&apos;t find that order</h1><p className="mt-2 text-eve-muted">If you were charged, your tickets will be emailed to you.</p></section>;
  }
  if (status?.payment_status === 'PAID') {
    return (
      <section aria-live="polite" data-testid="paid-confirmation">
        <h1 className="eve-display text-3xl">Payment received</h1>
        <p className="mt-2 text-eve-muted">Total paid {formatAmount(status.amount_total_cents, status.currency)}.</p>
        <ul className="mt-6 space-y-2">
          {status.tickets.map(t => (
            <li key={t.ticket_token}><Link className="font-medium text-eve-accent underline" href={`/t/${t.ticket_token}`}>Ticket for {t.attendee_name}</Link></li>
          ))}
        </ul>
      </section>
    );
  }
  if (status && (status.payment_status === 'FAILED' || status.payment_status === 'EXPIRED')) {
    return <section role="alert"><h1 className="text-2xl font-semibold">Payment didn&apos;t go through</h1><p className="mt-2 text-eve-muted">No tickets were issued. You can start again from the event page.</p></section>;
  }
  return (
    <section aria-live="polite">
      <h1 className="text-2xl font-semibold">Confirming your payment…</h1>
      <p className="mt-2 text-eve-muted">{polls >= MAX_POLLS ? 'This is taking longer than usual. Refresh this page in a minute — your tickets will also be emailed.' : 'This usually takes a few seconds.'}</p>
    </section>
  );
}
