'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import {
  FONT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, VIOLET_SOFT, GREEN, RED, YELLOW,
  Panel, SectionHeader, primaryBtnStyle, secondaryBtnStyle, EventsSharedStyles,
} from '../_components/ui';

type ConnectStatusResponse = {
  status: 'NOT_CONNECTED' | 'ONBOARDING' | 'ACTION_REQUIRED' | 'CONNECTED' | 'RESTRICTED';
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  connected_at: string | null;
  last_synced_at: string | null;
  connected: boolean;
};

const STATUS_COPY: Record<ConnectStatusResponse['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  NOT_CONNECTED: { label: 'Not connected', tone: 'neutral' },
  ONBOARDING: { label: 'Setup incomplete', tone: 'warn' },
  ACTION_REQUIRED: { label: 'Action required', tone: 'warn' },
  CONNECTED: { label: 'Connected', tone: 'ok' },
  RESTRICTED: { label: 'Payments disabled', tone: 'bad' },
};

const TONE_COLOR: Record<'ok' | 'warn' | 'bad' | 'neutral', string> = { ok: GREEN, warn: YELLOW, bad: RED, neutral: TEXT_MUTED };

// §5 — organisation-facing Stripe payment setup. Never displays a bank
// account number, routing detail, or any identity-document field —
// none of that is ever sent to (or held by) Brainbase in the first
// place (§6/§1); this page only ever shows the status labels and
// boolean flags lib/events/stripeConnect.ts's derived state exposes.
export default function PaymentsClient() {
  const [state, setState] = useState<ConnectStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Bumping reloadKey re-runs the fetch effect below — the "Refresh
  // status" button's only job — matching EventDetailClient.tsx's own
  // established reload() pattern exactly.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch('/api/events/payments/connect');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error ?? `Failed to load payment status (${res.status}).`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setState(body);
      } catch {
        if (!cancelled) setError('Failed to load payment status.');
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function connectStripe() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/events/payments/connect', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Could not start Stripe onboarding (${res.status}).`);
        setConnecting(false);
        return;
      }
      window.location.href = body.onboarding_url;
    } catch {
      setError('Could not start Stripe onboarding. Please try again.');
      setConnecting(false);
    }
  }

  const copy = state ? STATUS_COPY[state.status] : null;

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 760, margin: '0 auto' }}>
      <EventsSharedStyles />

      <Link href="/events" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: VIOLET_SOFT, fontSize: 12.5, textDecoration: 'none', marginBottom: 16, fontWeight: 600 }}>
        <ArrowLeft size={13} /> Back to Events
      </Link>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-.01em' }}>Payments</h1>
        <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '5px 0 0' }}>Connect Stripe to sell paid tickets. Ticket revenue is paid directly to your own bank account by Stripe.</p>
      </div>

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <Panel>
        <SectionHeader title="Stripe" />

        {!state && !error && <div style={{ fontSize: 13, color: TEXT_MUTED }}>Loading…</div>}

        {state && copy && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <StatusIcon tone={copy.tone} />
              <span style={{ fontSize: 15, fontWeight: 700, color: TONE_COLOR[copy.tone] }}>{copy.label}</span>
            </div>

            {state.connected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, fontSize: 13, color: TEXT_SECONDARY }}>
                <FlagRow label="Charges enabled" ok={state.charges_enabled} />
                <FlagRow label="Payouts enabled" ok={state.payouts_enabled} />
                <FlagRow label="Details submitted" ok={state.details_submitted} />
                {state.last_synced_at && (
                  <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 4 }}>
                    Last checked {new Date(state.last_synced_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {!state.connected && (
                <button onClick={connectStripe} disabled={connecting} style={{ ...primaryBtnStyle, opacity: connecting ? 0.6 : 1 }}>
                  {connecting ? 'Starting…' : 'Connect Stripe'}
                </button>
              )}
              {state.connected && state.status !== 'CONNECTED' && (
                <Link href="/events/payments/connect/refresh" style={{ ...primaryBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                  Continue setup
                </Link>
              )}
              {state.connected && (
                <button onClick={reload} style={secondaryBtnStyle}>Refresh status</button>
              )}
            </div>

            {!state.connected && (
              <p style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 16, lineHeight: 1.6 }}>
                You&rsquo;ll be redirected to Stripe to securely provide your business and bank details. Brainbase never sees or stores this information.
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function StatusIcon({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const color = TONE_COLOR[tone];
  if (tone === 'ok') return <CheckCircle2 size={20} color={color} />;
  if (tone === 'warn') return <AlertTriangle size={20} color={color} />;
  if (tone === 'bad') return <XCircle size={20} color={color} />;
  return <Clock size={20} color={color} />;
}

function FlagRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {ok ? <CheckCircle2 size={14} color={GREEN} /> : <XCircle size={14} color={TEXT_MUTED} />}
      <span>{label}</span>
    </div>
  );
}

