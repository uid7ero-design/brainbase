'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PublicEventDetail } from '@/lib/ticketing/gateway';
import { formatAmount, formatDateTime, formatMoney } from '@/lib/format';
import { QuestionField, isAnswered, type Answer } from './QuestionField';
import { organiserReference } from '@ticketing/core/publicOrganiser';

// The buyer's booking form. It talks only to this product's own origin
// (/api/buyer/...); the server relays to the ticketing API, which owns
// every rule (capacity, windows, codes, pricing, fees). Figures shown here
// are display only — the API re-derives them at submit.

const MAX_ORDER_TICKETS = 20;

type Quote = {
  subtotal_cents: number; discount_cents: number; total_cents: number; currency: string | null;
  pricing: 'FREE' | 'PAID' | null;
  promotion: { code: string } | null; promotion_error: string | null;
  access: { unlocked_ticket_type_ids: string[] } | null; access_error: string | null;
  cart_error: string | null; platform_fee_cents?: number; payment_total_cents?: number; fee?: { label: string } | null;
};

type Confirmation = { reference: string; bookingToken: string | null; tickets: { attendee_name: string; ticket_token: string }[] };

const input = 'mt-1 block min-h-11 w-full rounded-lg border border-eve-line bg-white px-3 text-sm text-eve-ink';
const label = 'block text-sm font-medium text-eve-ink';

function lines0Empty(qty: Record<string, number>): boolean {
  return Object.values(qty).every(n => n <= 0);
}

export function BuyerBooking({ organisationSlug, eventSlug, detail, cancelled }: {
  organisationSlug: string; eventSlug: string; detail: PublicEventDetail; cancelled: boolean;
}) {
  const { sessions, ticket_types: types, session_inventory: inventory } = detail;
  const base = `/api/buyer/${encodeURIComponent(organisationSlug)}/${encodeURIComponent(eventSlug)}`;

  const [sessionId, setSessionId] = useState(sessions.length === 1 ? sessions[0].id : '');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [promoInput, setPromoInput] = useState('');
  const [accessInput, setAccessInput] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [access, setAccess] = useState<string | null>(null);
  const [rawQuote, setQuote] = useState<Quote | null>(null);
  const [purchaser, setPurchaser] = useState({ name: '', email: '', phone: '' });
  // Paid checkout only: unticked by default. The API re-checks it server-side.
  const [accepted, setAccepted] = useState(false);
  const [attendeeNames, setAttendeeNames] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmation | null>(null);

  // No lines and no access code: there is nothing to quote, so any earlier quote is stale.
  const quote = lines0Empty(qty) && !access ? null : rawQuote;
  const unlocked = new Set(quote?.access?.unlocked_ticket_type_ids ?? []);
  const selectedSession = sessions.find(s => s.id === sessionId) ?? null;

  function remainingFor(typeId: string, fallback: number): number {
    if (!sessionId) return fallback;
    return inventory.find(p => p.ticket_type_id === typeId && p.event_session_id === sessionId)?.remaining ?? fallback;
  }

  // Paid checkout is offered only when the server says so for this
  // organisation; missing or anything but true means it is not. Paid types
  // stay listed with their price but cannot be selected, so the paid flow
  // (details, terms, "Continue to payment") never starts. Free types are
  // unaffected. The checkout API enforces the same gate regardless.
  const paidOpen = detail.paid_checkout_available === true;
  // A required registration question the event has not opted in to on Eve
  // would make any booking here fail, so nothing is offered (server-derived).
  const blocked = detail.questions_block_booking === true;
  const offered = (t: { price_cents: number }) => !blocked && (paidOpen || t.price_cents <= 0);
  const anyOffered = types.some(offered);

  // Registration questions (only present when the event is opted in on Eve).
  const questions = detail.questions ?? [];
  const orderQuestions = questions.filter(q => q.scope === 'ORDER');
  const attendeeQuestions = questions.filter(q => q.scope === 'ATTENDEE');
  const [orderAnswers, setOrderAnswers] = useState<Record<string, Answer>>({});
  const [slotAnswers, setSlotAnswers] = useState<Record<string, Record<string, Answer>>>({});
  // Unticked by default; shown only once a sensitive question is answered.
  // The purchaser's own acknowledgements (ADR 0013 §4b), each unticked by
  // default and shown only once a question of that kind is answered:
  // agreeing to the organiser collecting SENSITIVE answers, and confirming
  // that a THIRD_PARTY (e.g. emergency contact) knows their details are being
  // given. The second is NOT that person's consent.
  const [agreeSensitive, setAgreeSensitive] = useState(false);
  const [confirmThirdParty, setConfirmThirdParty] = useState(false);

  const lines = types.filter(t => offered(t) && (qty[t.id] ?? 0) > 0).map(t => ({ type: t, quantity: qty[t.id] }));
  const totalTickets = lines.reduce((n, l) => n + l.quantity, 0);
  const grossCents = lines.reduce((n, l) => n + l.type.price_cents * l.quantity, 0);
  const anyPaid = lines.some(l => l.type.price_cents > 0);
  const currency = quote?.currency ?? 'aud';
  const cartKey = JSON.stringify([lines.map(l => [l.type.id, l.quantity]), sessionId, promo, access]);

  // Server quote for the current selection and codes (display only).
  useEffect(() => {
    if (lines.length === 0 && !access) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${base}/quote`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({
            items: lines.map(l => ({ ticket_type_id: l.type.id, quantity: l.quantity })),
            event_session_id: sessionId || undefined, promotion_code: promo ?? undefined, access_code: access ?? undefined,
          }),
        });
        const body = await res.json().catch(() => null);
        setQuote(res.ok && body ? (body as Quote) : null);
      } catch { /* aborted or offline: the submit re-derives everything */ }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  const slots = useMemo(() => lines.flatMap(l => Array.from({ length: l.quantity }, (_, i) => ({ type: l.type, index: i }))), [cartKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const slotKey = (s: { type: { id: string }; index: number }) => `${s.type.id}-${s.index}`;

  // SENSITIVE and THIRD_PARTY answers need explicit agreement (ADR 0013 §4b);
  // the server enforces the same rule.
  const answeredIn = (category: string) => [...new Set([
    ...orderQuestions.filter(q => q.data_category === category && isAnswered(orderAnswers[q.id])),
    ...slots.flatMap(s => attendeeQuestions.filter(q => q.data_category === category && isAnswered(slotAnswers[slotKey(s)]?.[q.id]))),
  ].map(q => q.label))];
  const sensitiveLabels = answeredIn('SENSITIVE');
  const thirdPartyLabels = answeredIn('THIRD_PARTY');

  // Only answered questions are sent; the server applies "required".
  const toResponses = (qs: typeof questions, answers: Record<string, Answer> | undefined) =>
    qs.filter(q => isAnswered(answers?.[q.id])).map(q => {
      const a = answers![q.id];
      return { question_id: q.id, answer: typeof a === 'string' ? a.trim() : a };
    });

  function firstMissingRequired(): string | null {
    for (const q of orderQuestions) if (q.required && !isAnswered(orderAnswers[q.id])) return q.label;
    for (const s of slots) for (const q of attendeeQuestions) {
      if (q.required && !isAnswered(slotAnswers[slotKey(s)]?.[q.id])) return q.label;
    }
    return null;
  }

  function setQuantity(typeId: string, next: number, max: number) {
    setQty(prev => ({ ...prev, [typeId]: Math.max(0, Math.min(next, max)) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!anyOffered) return;
    if (!sessionId && sessions.length > 0) { setError('Choose a session.'); return; }
    if (totalTickets === 0) { setError('Select at least one ticket.'); return; }
    const missing = firstMissingRequired();
    if (missing) { setError(`${missing} is required.`); return; }
    if (sensitiveLabels.length > 0 && !agreeSensitive) {
      setError('Please confirm you agree to the organiser collecting the health, disability or accessibility information you have given.'); return;
    }
    if (thirdPartyLabels.length > 0 && !confirmThirdParty) {
      setError('Please confirm the person whose details you have given knows you are giving them to the organiser.'); return;
    }
    if (anyPaid && !accepted) { setError('Please agree to the Terms and the Refunds & cancellations policy to continue.'); return; }
    setBusy(true);
    try {
      const payload = {
        items: lines.map(l => ({ ticket_type_id: l.type.id, quantity: l.quantity })),
        event_session_id: sessionId || undefined,
        purchaser_name: purchaser.name, purchaser_email: purchaser.email, purchaser_phone: purchaser.phone || undefined,
        promotion_code: promo ?? undefined, access_code: access ?? undefined,
        attendees: slots.map(s => {
          const responses = toResponses(attendeeQuestions, slotAnswers[slotKey(s)]);
          return { name: attendeeNames[s.type.id]?.[s.index] || purchaser.name, ticket_type_id: s.type.id, ...(responses.length ? { responses } : {}) };
        }),
        ...(orderQuestions.length && toResponses(orderQuestions, orderAnswers).length ? { order_responses: toResponses(orderQuestions, orderAnswers) } : {}),
        ...(sensitiveLabels.length > 0 && agreeSensitive ? { agree_sensitive: true } : {}),
        ...(thirdPartyLabels.length > 0 && confirmThirdParty ? { confirm_third_party: true } : {}),
        ...(anyPaid ? { accept_terms: true } : {}),
      };
      const res = await fetch(`${base}/${anyPaid ? 'checkout' : 'register'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.'); return; }
      if (anyPaid) {
        if (typeof body.checkout_url === 'string' && body.checkout_url.startsWith('https://')) window.location.assign(body.checkout_url);
        else setError('Checkout could not be started. Please try again.');
        return;
      }
      setDone({ reference: String(body.confirmation_reference ?? ''), bookingToken: body.booking_token ?? null, tickets: body.tickets ?? [] });
    } catch {
      setError('Could not reach the booking service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section aria-live="polite" className="rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-6" data-testid="free-confirmation">
        <h2 className="text-xl font-semibold">You&apos;re booked in</h2>
        <p className="mt-2 text-sm text-eve-muted">Confirmation reference {done.reference}</p>
        <ul className="mt-4 space-y-2">
          {done.tickets.map(t => (
            <li key={t.ticket_token}><Link className="font-medium text-eve-accent underline" href={`/t/${t.ticket_token}`}>Ticket for {t.attendee_name}</Link></li>
          ))}
        </ul>
        {done.bookingToken ? <p className="mt-4"><Link className="font-medium text-eve-accent underline" href={`/b/${done.bookingToken}/tickets`}>View all tickets in this booking</Link></p> : null}
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8" aria-label="Book tickets">
      {cancelled ? <p role="status" className="rounded-lg bg-eve-surface-alt p-3 text-sm">Checkout was cancelled. Nothing was charged — your selection is below.</p> : null}

      {sessions.length > 0 ? (
        <div>
          <label htmlFor="session" className={label}>Session</label>
          <select id="session" className={input} value={sessionId} onChange={e => setSessionId(e.target.value)} required>
            <option value="">Choose a session…</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id} disabled={s.remaining <= 0}>
                {s.name} — {formatDateTime(s.starts_at, detail.event.timezone)}{s.remaining <= 0 ? ' (sold out)' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-semibold">Tickets</legend>
        <ul className="mt-3 divide-y divide-eve-line rounded-lg border border-eve-line bg-eve-surface">
          {types.map(t => {
            const remaining = remainingFor(t.id, t.remaining);
            const locked = t.requires_access_code && !unlocked.has(t.id);
            const onSale = t.sale_status === 'ON_SALE';
            const others = totalTickets - (qty[t.id] ?? 0);
            const sessionCap = selectedSession ? selectedSession.remaining - others : Number.POSITIVE_INFINITY;
            const max = Math.max(0, Math.min(remaining, MAX_ORDER_TICKETS - others, sessionCap));
            const state = !offered(t) && !blocked ? 'Not currently on sale' : locked ? 'Access code required' : !onSale ? (t.sale_status === 'COMING_SOON' ? `On sale ${formatDateTime(t.sale_starts_at, detail.event.timezone)}` : 'Sales ended') : remaining <= 0 ? 'Sold out' : `${remaining} remaining`;
            const disabled = !offered(t) || locked || !onSale || max <= 0;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{t.name} <span className="text-eve-muted">· {formatMoney(t.price_cents, quote?.currency ?? 'aud')}</span></p>
                  {t.description ? <p className="text-sm text-eve-muted">{t.description}</p> : null}
                  <p className="text-xs text-eve-muted" data-testid={`state-${t.id}`}>{state}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" aria-label={`Fewer ${t.name}`} disabled={disabled || (qty[t.id] ?? 0) === 0} onClick={() => setQuantity(t.id, (qty[t.id] ?? 0) - 1, max)} className="min-h-11 min-w-11 rounded-lg border border-eve-line">−</button>
                  <output aria-label={`${t.name} quantity`} className="w-6 text-center">{qty[t.id] ?? 0}</output>
                  <button type="button" aria-label={`More ${t.name}`} disabled={disabled || (qty[t.id] ?? 0) >= max} onClick={() => setQuantity(t.id, (qty[t.id] ?? 0) + 1, max)} className="min-h-11 min-w-11 rounded-lg border border-eve-line">+</button>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {types.some(t => offered(t) && t.requires_access_code) || (anyOffered && detail.has_promotions) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {types.some(t => offered(t) && t.requires_access_code) ? (
            <div>
              <label htmlFor="access" className={label}>Access code</label>
              <div className="flex gap-2">
                <input id="access" className={input} value={accessInput} onChange={e => setAccessInput(e.target.value)} autoComplete="off" />
                <button type="button" className="mt-1 min-h-11 rounded-lg border border-eve-line px-3 text-sm" onClick={() => setAccess(accessInput.trim().toUpperCase() || null)}>Apply</button>
              </div>
              {quote?.access_error ? <p role="alert" className="mt-1 text-sm text-red-700">{quote.access_error}</p> : null}
            </div>
          ) : null}
          {anyOffered && detail.has_promotions ? (
            <div>
              <label htmlFor="promo" className={label}>Promotional code</label>
              <div className="flex gap-2">
                <input id="promo" className={input} value={promoInput} onChange={e => setPromoInput(e.target.value)} autoComplete="off" />
                <button type="button" className="mt-1 min-h-11 rounded-lg border border-eve-line px-3 text-sm" onClick={() => setPromo(promoInput.trim().toUpperCase() || null)}>Apply</button>
              </div>
              {quote?.promotion_error ? <p role="alert" className="mt-1 text-sm text-red-700">{quote.promotion_error}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {totalTickets > 0 ? (
        <>
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold">Your details</legend>
            <div><label htmlFor="pname" className={label}>Full name</label><input id="pname" className={input} required value={purchaser.name} onChange={e => setPurchaser({ ...purchaser, name: e.target.value })} autoComplete="name" /></div>
            <div><label htmlFor="pemail" className={label}>Email</label><input id="pemail" type="email" className={input} required value={purchaser.email} onChange={e => setPurchaser({ ...purchaser, email: e.target.value })} autoComplete="email" /></div>
            <div><label htmlFor="pphone" className={label}>Phone (optional)</label><input id="pphone" type="tel" className={input} value={purchaser.phone} onChange={e => setPurchaser({ ...purchaser, phone: e.target.value })} autoComplete="tel" /></div>
          </fieldset>

          {questions.length > 0 ? (
            // Collection notice, immediately before the organiser's questions (ADR 0013 §4b).
            <p data-testid="questions-notice" className="rounded-lg bg-eve-surface-alt p-3 text-sm text-eve-ink">
              {`${organiserReference(detail.organiser_name, { sentenceStart: true })} asks these questions to help run this event. Your answers go to ${organiserReference(detail.organiser_name)} for this event. You can leave optional questions blank. `}
              <Link href="/privacy#registration-questions" target="_blank" rel="noopener" className="underline">How we handle your answers</Link>
            </p>
          ) : null}

          {orderQuestions.length > 0 ? (
            <fieldset className="space-y-4" data-testid="order-questions">
              <legend className="text-sm font-semibold">About your booking</legend>
              {orderQuestions.map(q => (
                <QuestionField key={q.id} question={q} idPrefix="oq" value={orderAnswers[q.id]} organiserName={detail.organiser_name ?? null}
                  onChange={v => setOrderAnswers(prev => ({ ...prev, [q.id]: v }))} />
              ))}
            </fieldset>
          ) : null}

          {attendeeQuestions.length > 0 ? (
            slots.map(s => (
              <fieldset key={slotKey(s)} className="space-y-4" data-testid={`attendee-${slotKey(s)}`}>
                <legend className="text-sm font-semibold">{s.type.name} ticket {s.index + 1}</legend>
                {totalTickets > 1 ? (
                  <div>
                    <label htmlFor={`att-${s.type.id}-${s.index}`} className={label}>Attendee name</label>
                    <input id={`att-${s.type.id}-${s.index}`} className={input} required value={attendeeNames[s.type.id]?.[s.index] ?? ''}
                      onChange={e => setAttendeeNames(prev => { const arr = [...(prev[s.type.id] ?? [])]; arr[s.index] = e.target.value; return { ...prev, [s.type.id]: arr }; })} />
                  </div>
                ) : null}
                {attendeeQuestions.map(q => (
                  <QuestionField key={q.id} question={q} idPrefix={`aq-${slotKey(s)}`} value={slotAnswers[slotKey(s)]?.[q.id]} organiserName={detail.organiser_name ?? null}
                    onChange={v => setSlotAnswers(prev => ({ ...prev, [slotKey(s)]: { ...prev[slotKey(s)], [q.id]: v } }))} />
                ))}
              </fieldset>
            ))
          ) : totalTickets > 1 ? (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold">Attendee names</legend>
              {slots.map(s => (
                <div key={`${s.type.id}-${s.index}`}>
                  <label htmlFor={`att-${s.type.id}-${s.index}`} className={label}>{s.type.name} ticket {s.index + 1}</label>
                  <input id={`att-${s.type.id}-${s.index}`} className={input} required value={attendeeNames[s.type.id]?.[s.index] ?? ''}
                    onChange={e => setAttendeeNames(prev => { const arr = [...(prev[s.type.id] ?? [])]; arr[s.index] = e.target.value; return { ...prev, [s.type.id]: arr }; })} />
                </div>
              ))}
            </fieldset>
          ) : null}

          <div className="rounded-lg bg-eve-surface-alt p-4 text-sm" aria-live="polite">
            <p>Tickets: {formatAmount(quote?.subtotal_cents ?? grossCents, currency)}</p>
            {quote && quote.discount_cents > 0 ? <p>Discount: −{formatAmount(quote.discount_cents, currency)}</p> : null}
            {quote?.fee && (quote.platform_fee_cents ?? 0) > 0 ? <p>{quote.fee.label}: {formatAmount(quote.platform_fee_cents ?? 0, currency)}</p> : null}
            <p className="mt-1 text-base font-semibold" data-testid="payable">
              Total: {anyPaid ? formatAmount(quote?.payment_total_cents ?? quote?.total_cents ?? grossCents, currency) : 'Free'}
            </p>
            {quote?.cart_error ? <p role="alert" className="mt-2 text-red-700">{quote.cart_error}</p> : null}
          </div>
        </>
      ) : null}

      {totalTickets > 0 ? (
        <div className="space-y-3 text-sm" data-testid="booking-notices">
          {sensitiveLabels.length > 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-eve-line p-3" data-testid="agree-sensitive">
              <input id="agree-sensitive" type="checkbox" checked={agreeSensitive} onChange={e => setAgreeSensitive(e.target.checked)} required className="mt-1 h-5 w-5 shrink-0" />
              <label htmlFor="agree-sensitive" className="text-eve-ink">
                {`I agree to ${organiserReference(detail.organiser_name)} collecting my answers to ${sensitiveLabels.join(', ')} for this event, including health, disability or accessibility information. `}
                Only answer what you are comfortable sharing.
              </label>
            </div>
          ) : null}
          {thirdPartyLabels.length > 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-eve-line p-3" data-testid="confirm-third-party">
              <input id="confirm-third-party" type="checkbox" checked={confirmThirdParty} onChange={e => setConfirmThirdParty(e.target.checked)} required className="mt-1 h-5 w-5 shrink-0" />
              <label htmlFor="confirm-third-party" className="text-eve-ink">
                {`I confirm that the person whose details I have given (${thirdPartyLabels.join(', ')}) knows I am giving them to ${organiserReference(detail.organiser_name)} for this event, or that I am allowed to give them.`}
              </label>
            </div>
          ) : null}
          <p data-testid="collection-notice" className="text-eve-muted">
            Your booking details (your name, email and phone, {questions.length > 0 ? <>the attendees&apos; names, and your answers to the organiser&apos;s questions</> : <>and the attendees&apos; names</>}) are provided to the event organiser so they can run the booking and contact you about the event. Your name, email and phone may also appear in the organiser&apos;s event contact records. This is not consent to marketing. See the{' '}
            <Link href="/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</Link>.
          </p>
          {anyPaid ? (
            <p data-testid="paid-payment-notice" className="text-eve-muted">
              You will pay securely with Stripe on the next page. Your card details are entered with Stripe and are not seen or stored by us.
            </p>
          ) : null}
          {anyPaid ? (
            <div className="flex items-start gap-3">
              <input id="accept-terms" type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required className="mt-1 h-5 w-5 shrink-0" />
              <label htmlFor="accept-terms" className="text-eve-ink">
                I agree to the <Link href="/terms" target="_blank" rel="noopener" className="underline">Terms</Link> and{' '}
                <Link href="/refunds" target="_blank" rel="noopener" className="underline">Refunds &amp; cancellations</Link> policy.
              </label>
            </div>
          ) : (
            <p data-testid="free-terms-notice" className="text-eve-ink">
              By registering you agree to the <Link href="/terms" target="_blank" rel="noopener" className="underline">Terms</Link> and acknowledge the{' '}
              <Link href="/privacy" target="_blank" rel="noopener" className="underline">Privacy Policy</Link>.
            </p>
          )}
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      {anyOffered ? (
        <button type="submit" disabled={busy || totalTickets === 0} className="min-h-12 w-full rounded-full bg-eve-ink px-6 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Please wait…' : anyPaid ? 'Continue to payment' : 'Complete registration'}
        </button>
      ) : (
        <p role="status" data-testid="not-on-sale" className="rounded-lg bg-eve-surface-alt p-4 text-center text-sm font-medium text-eve-ink">
          {blocked ? 'Online registration isn’t available for this event.' : 'Tickets are not currently on sale.'}
        </p>
      )}
    </form>
  );
}
