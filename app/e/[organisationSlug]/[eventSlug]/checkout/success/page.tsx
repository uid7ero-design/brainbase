'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme';
import { InstitutionalHeader, InstitutionalFooter } from '@/components/publicEvents/InstitutionalChrome';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
// See PublicEventClient.tsx's own identical comment: these are now the
// matching `var(--bbpe-*)` strings (lib/events/publicEventTheme.ts)
// rather than literal hex, so a non-branded organisation's rendering is
// unchanged while a themed one re-skins for free.
const BG = 'var(--bbpe-bg)';
const BORDER = 'var(--bbpe-border)';
const BORDER_SOFT = 'var(--bbpe-border-soft)';
const VIOLET_SOFT = 'var(--bbpe-accent-soft)';
const TEXT_PRIMARY = 'var(--bbpe-text-primary)';
const TEXT_SECONDARY = 'var(--bbpe-text-secondary)';
const TEXT_MUTED = 'var(--bbpe-text-muted)';
const GREEN = 'var(--bbpe-green)';
const RED = 'var(--bbpe-red)';

type StatusResponse = {
  payment_status: string;
  order_status: string;
  amount_total_cents: number;
  currency: string;
  tickets: { attendee_name: string; ticket_token: string }[];
};

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

// ── Never trust the redirect alone (§5, §15) ─────────────────────────
//
// Stripe redirected the browser here, but that is not proof of
// payment — only the webhook (see lib/events/stripe.ts) can move an
// order to PAID. This page's only job is to poll BrainBase's own
// checkout/status endpoint, which reflects the database's current,
// server-written payment_status, until it settles into a terminal
// state (or a bounded number of attempts is exhausted, in case the
// webhook is unusually slow).
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20; // ~40s — generous relative to typical webhook latency

export default function CheckoutSuccessPage() {
  const params = useParams<{ organisationSlug: string; eventSlug: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  // Public event branding (see lib/events/publicEventTheme.ts) — same
  // resolver, same organisationSlug-only lookup, as PublicEventClient.
  const theme = resolvePublicEventTheme(params.organisationSlug);
  const institutional = theme.variant === 'institutional';

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    // Missing session_id is a pure derived condition (see the
    // `!sessionId` render branch below) — never routed through
    // setState-in-effect, which triggers a needless extra render.
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch(
          `/api/public/events/${params.organisationSlug}/${params.eventSlug}/checkout/status?session_id=${encodeURIComponent(sessionId as string)}`,
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled.current) setError(body.error ?? `Could not check payment status (${res.status}).`);
          return;
        }
        if (cancelled.current) return;
        setStatus(body as StatusResponse);
        if (body.payment_status === 'PENDING') {
          setPollCount(c => {
            const next = c + 1;
            if (next < MAX_POLLS) timer = setTimeout(poll, POLL_INTERVAL_MS);
            return next;
          });
        }
      } catch {
        if (!cancelled.current) setError('Could not check payment status. Please refresh this page.');
      }
    }

    poll();
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional single-kickoff poll loop; see comment above
  }, [sessionId]);

  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT, display: 'flex', flexDirection: 'column', ...theme.cssVars }}>
      {institutional ? (
        <InstitutionalHeader theme={theme} />
      ) : (
        <header style={{ padding: '13px 20px', borderBottom: `1px solid ${BORDER_SOFT}` }}>
          <Image src="/Brand/brainbase-logo-dark.svg" alt="BRΛINBΛSE" width={132} height={30} priority style={{ display: 'block', width: 120, height: 'auto' }} />
        </header>
      )}

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 480, border: `1px solid ${BORDER}`, borderRadius: 18, background: 'var(--bbpe-card-bg)', boxShadow: 'var(--bbpe-card-shadow)', padding: '36px 28px', textAlign: 'center' }}>
          {!sessionId && <ErrorState message="Missing checkout reference." />}
          {sessionId && error && <ErrorState message={error} />}
          {sessionId && !error && !status && <ProcessingState />}
          {sessionId && !error && status && status.payment_status === 'PENDING' && pollCount >= MAX_POLLS && (
            <ProcessingState note="This is taking longer than expected. You can safely refresh this page — your payment will be confirmed as soon as it processes." />
          )}
          {sessionId && !error && status && status.payment_status === 'PENDING' && pollCount < MAX_POLLS && <ProcessingState />}
          {sessionId && !error && status && status.payment_status === 'PAID' && <ConfirmedState status={status} />}
          {sessionId && !error && status && (status.payment_status === 'FAILED' || status.payment_status === 'EXPIRED') && (
            <FailedState paymentStatus={status.payment_status} />
          )}
        </div>
      </main>
      {institutional && <InstitutionalFooter theme={theme} />}
    </div>
  );
}

function IconCircle({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'bad' | 'pending' }) {
  const colors = {
    ok: { fg: GREEN, bg: 'rgba(74,222,128,.12)', bd: 'rgba(74,222,128,.35)' },
    bad: { fg: RED, bg: 'rgba(248,113,113,.12)', bd: 'rgba(248,113,113,.35)' },
    // Routed through the same --bbpe-accent-rgb var as `fg` (VIOLET_SOFT)
    // itself, not a literal violet RGB triplet — for the institutional
    // theme, fg resolves to dark gold, so this circle's own bg/border
    // must track it rather than staying stuck on the old violet, which
    // has no place in that theme's palette at all.
    pending: { fg: VIOLET_SOFT, bg: 'rgba(var(--bbpe-accent-rgb),.12)', bd: 'rgba(var(--bbpe-accent-rgb),.35)' },
  }[tone];
  return (
    <div style={{
      width: 56, height: 56, borderRadius: '50%', margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: colors.bg, border: `1px solid ${colors.bd}`,
    }}>
      {children}
    </div>
  );
}

function ProcessingState({ note }: { note?: string }) {
  return (
    <>
      <IconCircle tone="pending"><Clock size={28} color={VIOLET_SOFT} /></IconCircle>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>Processing payment</h1>
      <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, lineHeight: 1.6 }}>
        {note ?? "We're confirming your payment with Stripe. This usually takes just a few seconds — please don't close this page."}
      </p>
    </>
  );
}

function ConfirmedState({ status }: { status: StatusResponse }) {
  return (
    <>
      <IconCircle tone="ok"><CheckCircle2 size={28} color={GREEN} /></IconCircle>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>Payment confirmed</h1>
      <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: '0 0 20px' }}>
        You paid <strong style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>{formatAmount(status.amount_total_cents, status.currency)}</strong>. Your registration is confirmed.
      </p>

      {status.tickets.length > 0 && (
        <div style={{ textAlign: 'left', marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 8 }}>
            Your ticket{status.tickets.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {status.tickets.map(t => (
              <a
                key={t.ticket_token} href={`/t/${t.ticket_token}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
                  background: 'var(--bbpe-section-bg)', color: TEXT_PRIMARY, fontSize: 13, fontWeight: 600,
                }}
              >
                {t.attendee_name}
                <span style={{ color: VIOLET_SOFT, fontSize: 12, fontWeight: 700 }}>View ticket →</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FailedState({ paymentStatus }: { paymentStatus: string }) {
  const expired = paymentStatus === 'EXPIRED';
  return (
    <>
      <IconCircle tone="bad"><XCircle size={28} color={RED} /></IconCircle>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>
        {expired ? 'Checkout expired' : 'Payment failed'}
      </h1>
      <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, lineHeight: 1.6 }}>
        {expired
          ? 'Your reserved tickets were released because checkout was not completed in time. Please return to the event page to try again.'
          : 'Your payment could not be completed. Please return to the event page to try again.'}
      </p>
    </>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <>
      <IconCircle tone="bad"><XCircle size={28} color={RED} /></IconCircle>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.01em' }}>Something went wrong</h1>
      <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: 0, lineHeight: 1.6 }}>{message}</p>
    </>
  );
}
