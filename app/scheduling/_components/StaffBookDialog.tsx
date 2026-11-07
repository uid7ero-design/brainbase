'use client';
import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react';
import { Button, Dialog, Field, FormActions, StateMessage, fieldControlClassName } from '@/components/ui/app';
import { WINDOW_DAYS, describeReadFailure, fetchBasis, loadBookableOfferings, type BasisView, type BookableOffering } from '@/lib/scheduling/staffBooking/basisClient';
import { createBookingKeyHolder } from '@/lib/scheduling/staffBooking/key';
import { NOTES_MAX, POLL_DELAYS_MS, RETURN_TO_TIME, createMachine, initialState, type FieldKey, type Step, type Target } from '@/lib/scheduling/staffBooking/machine';
import { lookupReservation, postReservation, type BookedReservation } from '@/lib/scheduling/staffBooking/submitClient';
import { dayAccessibleName, dayLabel, durationText, endClock, longDayLabel, priceText, shiftDate, timesText, zoneText } from '@/lib/scheduling/staffBooking/view';
import styles from './staffBook.module.css';

// Phase 2C.3c UI SLICES 1-2: the staff booking dialog. Resource (fixed: the calendar's) -> offering -> date -> ENGINE-OFFERED start -> customer details
// -> review -> booked. It creates exactly one thing: a facility-hire booking through the reservation create call (lib/scheduling/staffBooking/submitClient.ts), with one idempotency key per
// distinct booking content (lib/scheduling/staffBooking/key.ts) and the state machine in lib/scheduling/staffBooking/machine.ts. There is no payment control,
// no CRM or customer-account call and no storage: customer details exist in this component's memory and in the one POST body.
//
// - It is mounted only while open, so a closed dialog makes no request at all; the button that mounts it exists only when the server decided
//   (lib/scheduling/staffBookingVisibility.ts) that the switch, the organisation capability and scheduling.reserve all hold.
// - The times are exactly the basis response's starts. There is no free-time input, no duration field and no step control.
// - Times are wall-clock times of the offering's pinned zone, shown with the zone's name.
// - A 404 without a code (a gate closed under the user) closes the dialog and hides the button until reload (onUnavailable).
// - While a booking is being sent or checked, the dialog cannot be closed and nothing can change the booking or its key.

type Failure = ReturnType<typeof describeReadFailure>;
type Phase<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; failure: Failure };

const FIELD_IDS: Record<FieldKey, string> = { name: 'sb-f-name', email: 'sb-f-email', phone: 'sb-f-phone', partySize: 'sb-f-party', notes: 'sb-f-notes' };
const FIELD_LABELS: Record<FieldKey, string> = { name: 'Name', email: 'Email', phone: 'Phone', partySize: 'Party size', notes: 'Notes' };
const FIELD_ORDER: FieldKey[] = ['name', 'email', 'phone', 'partySize', 'notes'];

type Stage = 'offering' | 'date' | 'time' | 'ready' | Step;

export default function StaffBookDialog({
  resourceId,
  resourceName,
  today,
  onClose,
  onUnavailable,
  onBooked,
}: {
  resourceId: string;
  resourceName: string;
  /** The first local date to offer (the calendar's "today" in its zone). */
  today: string;
  onClose: () => void;
  onUnavailable: () => void;
  /** A booking was made (or may have been): the calendar should re-read. */
  onBooked?: () => void;
}) {
  // Loaded state is stored WITH the request it answers, and "loading" is derived (no request answered yet for the current one), so no effect sets state synchronously.
  const [offeringsRes, setOfferingsRes] = useState<{ tick: number; phase: Phase<{ items: BookableOffering[]; truncated: boolean }> } | null>(null);
  const [offeringId, setOfferingId] = useState<string | null>(null);
  const [pendingOffering, setPendingOffering] = useState<string | null>(null); // a radio group only SELECTS (arrow keys select as they move); "Continue" commits
  const [auto, setAuto] = useState(false);
  const [windowFrom, setWindowFrom] = useState(today);
  const [basisRes, setBasisRes] = useState<{ key: string; phase: Phase<BasisView> } | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [preferSpent, setPreferSpent] = useState(-1); // the refetch number whose "preselect the previous time" has been used or overridden
  const [waitHint, setWaitHint] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const [holder] = useState(() => createBookingKeyHolder());
  const [reduce] = useState(() => createMachine(holder));
  const [m, dispatch] = useReducer(reduce, undefined, initialState);

  const onUnavailableRef = useRef(onUnavailable);
  const alive = useRef(true);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 1. Which facility-hire offerings link this resource.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const result = await loadBookableOfferings(resourceId, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          const failure = describeReadFailure(result.problem);
          setOfferingsRes({ tick, phase: { status: 'error', failure } });
          if (failure.gateOff) onUnavailableRef.current();
          return;
        }
        setOfferingsRes({ tick, phase: { status: 'ready', data: { items: result.data.offerings, truncated: result.data.truncated } } });
        if (result.data.offerings.length === 1) {
          setOfferingId(result.data.offerings[0].id);
          setAuto(true);
        }
      } catch {
        // aborted: the dialog closed or the resource changed
      }
    })();
    return () => controller.abort();
  }, [resourceId, tick]);

  const offerings: Phase<{ items: BookableOffering[]; truncated: boolean }> = offeringsRes && offeringsRes.tick === tick ? offeringsRes.phase : { status: 'loading' };
  const basisKey = `${offeringId ?? ''}|${resourceId}|${windowFrom}|${tick}|${m.refetch}`;
  const basis: Phase<BasisView> = basisRes && basisRes.key === basisKey ? basisRes.phase : { status: 'loading' };

  // 2. The basis and the engine's starts for the chosen offering and the 14-day window (re-read after a stale-time refusal).
  useEffect(() => {
    if (!offeringId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await fetchBasis({ offeringId, resourceId, from: windowFrom, to: shiftDate(windowFrom, WINDOW_DAYS - 1) }, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          const failure = describeReadFailure(result.problem);
          setBasisRes({ key: basisKey, phase: { status: 'error', failure } });
          if (failure.gateOff) onUnavailableRef.current();
          return;
        }
        setBasisRes({ key: basisKey, phase: { status: 'ready', data: result.data } });
      } catch {
        // aborted
      }
    })();
    return () => controller.abort();
  }, [offeringId, resourceId, windowFrom, tick, basisKey]);

  const chosenOffering = offerings.status === 'ready' ? (offerings.data.items.find(o => o.id === offeringId) ?? null) : null;
  const view = basis.status === 'ready' ? basis.data : null;
  const day = view && date ? (view.days.find(d => d.date === date) ?? null) : null;
  // After AVAILABILITY_CHANGED the previous start is preselected, but ONLY when the fresh read still offers it.
  const prefer = m.preferTime;
  const preselect = !time && prefer && day && prefer.date === day.date && preferSpent !== m.refetch && day.starts.some(s => s.time === prefer.time) ? prefer.time : null;
  const effTime = time ?? preselect;
  const start = day && effTime ? (day.starts.find(s => s.time === effTime) ?? null) : null;

  const picking = m.step === 'idle';
  const selectStage: Stage = !offeringId ? 'offering' : !date ? 'date' : !effTime ? 'time' : 'ready';
  const stage: Stage = picking ? selectStage : m.step;

  // 3. The POST. One per `sends` increment; the frozen attempt (same key, same body) on every retry. Not abortable by the effect cleanup
  // (a strict-mode remount must not lose the reply); `alive` stops a reply from touching an unmounted dialog.
  const sentFor = useRef(0);
  useEffect(() => {
    if (m.step !== 'submitting' || !m.attempt || sentFor.current === m.sends) return;
    sentFor.current = m.sends;
    const { key, body } = m.attempt;
    void postReservation(body, key).then(outcome => {
      if (!alive.current) return;
      dispatch({ type: 'RESPONSE', outcome });
      if (outcome.kind === 'refused' && RETURN_TO_TIME[outcome.code]) setTime(null);
      if (outcome.kind === 'gate_off') onUnavailableRef.current();
    });
  }, [m.step, m.attempt, m.sends]);

  // 4. Reconcile after an uncertain outcome: look the booking up by the ORIGINAL key at 0.5, 1.5, 3 and 6 seconds. Read only.
  useEffect(() => {
    if (m.step !== 'checking' || !m.attempt) return;
    const key = m.attempt.key;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void lookupReservation(key, controller.signal).then(outcome => {
        if (!controller.signal.aborted) dispatch({ type: 'POLL', outcome });
      });
    }, POLL_DELAYS_MS[m.poll] ?? POLL_DELAYS_MS[POLL_DELAYS_MS.length - 1]);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [m.step, m.poll, m.attempt]);

  // 5. IDEMPOTENCY_CONFLICT: show what already exists under the key (read only).
  useEffect(() => {
    if (m.step !== 'conflict' || !m.attempt) return;
    const controller = new AbortController();
    void lookupReservation(m.attempt.key, controller.signal).then(outcome => {
      if (!controller.signal.aborted) dispatch({ type: 'CONFLICT_LOOKUP', outcome });
    });
    return () => controller.abort();
  }, [m.step, m.attempt]);

  const steps = useMemo(() => {
    const all = [
      { id: 'offering', label: 'Offering' },
      { id: 'date', label: 'Date' },
      { id: 'time', label: 'Start time' },
      { id: 'details', label: 'Customer' },
      { id: 'review', label: 'Review' },
      { id: 'done', label: 'Booked' },
    ] as const;
    return auto ? all.filter(s => s.id !== 'offering') : all;
  }, [auto]);
  const currentStepId: (typeof steps)[number]['id'] =
    stage === 'offering' || stage === 'date' || stage === 'time' ? stage
    : stage === 'ready' ? 'time'
    : stage === 'details' ? 'details'
    : stage === 'done' ? 'done'
    : 'review';

  // Focus moves to the step heading when the stage changes (not on open: the dialog places focus itself). A start chosen on the "ready" stage keeps focus on
  // the radio group so arrow keys keep working.
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const focusWanted = useRef(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (stage !== 'ready') focusWanted.current = true; // the heading may not exist yet (the times are still loading): it is focused as soon as it renders
  }, [stage]);
  useEffect(() => {
    if (focusWanted.current && heading.current) {
      focusWanted.current = false;
      heading.current.focus();
    }
  });
  useEffect(() => {
    if (m.errorTick > 0) summary.current?.focus();
  }, [m.errorTick]);

  const failure = offerings.status === 'error' ? offerings.failure : basis.status === 'error' ? basis.failure : null;
  const busy = m.step === 'submitting' || m.step === 'checking';

  const announce =
    m.notice ? m.notice
    : m.step === 'submitting' ? 'Booking in progress. Please wait.'
    : m.step === 'checking' ? 'Checking whether your booking was saved. Please wait. Do not book again.'
    : m.step === 'done' ? 'Booked. The booking reference is shown below.'
    : m.step === 'unsure' ? 'We could not confirm whether the booking was saved.'
    : m.step === 'retry' ? 'The system was busy. Nothing was booked.'
    : waitHint ? 'Please wait: this booking is being saved or checked. The window can be closed afterwards.'
    : m.step !== 'idle' ? ''
    : offerings.status === 'loading' ? 'Loading offerings…'
    : basis.status === 'loading' && offeringId ? 'Loading available times…'
    : view && stage === 'date' ? `${view.days.filter(d => d.starts.length > 0).length} days with times between ${dayLabel(view.range.from)} and ${dayLabel(view.range.to)}.`
    : day && stage === 'time' ? `${timesText(day.starts.length)} on ${dayLabel(day.date)}.`
    : stage === 'ready' ? 'Start time chosen. Nothing has been booked.'
    : '';

  function chooseOffering(id: string) {
    if (id === offeringId) return;
    setOfferingId(id);
    setDate(null);
    setTime(null);
    setWindowFrom(today);
  }
  function moveWindow(days: number) {
    setWindowFrom(from => {
      const next = shiftDate(from, days);
      return next < today ? today : next;
    });
    setDate(null);
    setTime(null);
  }
  function pickTime(t: string) {
    setPreferSpent(m.refetch);
    setTime(t);
  }
  function backFromSelection() {
    if (stage === 'ready') {
      setPreferSpent(m.refetch);
      setTime(null);
    } else if (stage === 'time') setDate(null);
    else if (stage === 'date' && !auto) setOfferingId(null);
  }
  const canGoBackSelect = picking && (stage === 'ready' || stage === 'time' || (stage === 'date' && !auto));

  const target: Target | null =
    view && day && start && chosenOffering
      ? {
          offeringId: view.offering.id,
          offeringName: chosenOffering.name,
          resourceId,
          resourceName,
          date: day.date,
          time: start.time,
          startsAt: start.startsAt,
          durationMinutes: view.offering.durationMinutes,
          timezone: view.timezone,
          capacity: view.resource.capacity,
          price: view.offering.price,
          basis: view.basis,
        }
      : null;

  function requestClose() {
    if (busy) {
      setWaitHint(true);
      return;
    }
    if (m.attempt || m.step === 'done') onBooked?.(); // a booking was made, or may have been: the calendar re-reads
    onClose();
  }

  async function copyReference(id: string, input: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(id);
      setCopy('copied');
    } catch {
      setCopy('failed');
      input?.focus();
      input?.select();
    }
  }

  const errorKeys = FIELD_ORDER.filter(k => m.errors[k]);
  const t = m.target;

  return (
    <Dialog open onClose={requestClose} title={`Book ${resourceName}`} width={560}>
      <div className={styles.body} data-testid="staff-book-dialog" data-step={stage}>
        <p className={styles.lead}>
          {m.step === 'done'
            ? 'This booking has been saved.'
            : 'Choose a date and one of the start times offered, then enter the customer’s details. No payment is collected here.'}
        </p>

        <ol className={styles.steps} aria-label="Booking steps">
          {steps.map(s => (
            <li key={s.id} className={styles.stepItem} aria-current={s.id === currentStepId ? 'step' : undefined} data-done={steps.findIndex(x => x.id === s.id) < steps.findIndex(x => x.id === currentStepId) ? 'true' : 'false'}>
              {s.label}
            </li>
          ))}
        </ol>

        <div className={m.notice || waitHint ? `${styles.live} ${styles.liveNotice}` : styles.live} role="status" aria-live="polite" data-testid="booking-live">
          {announce}
        </div>

        {failure ? (
          <StateMessage
            kind="error"
            title={failure.text}
            action={failure.retryable ? <Button variant="secondary" onClick={() => setTick(n => n + 1)}>Try again</Button> : undefined}
          />
        ) : picking && offerings.status === 'loading' ? (
          <StateMessage kind="loading" title="Loading offerings…" />
        ) : picking && offerings.status === 'ready' && offerings.data.items.length === 0 ? (
          <StateMessage kind="empty" title="Nothing can be booked on this resource.">
            It is not assigned to an active facility-hire offering. Assign it to an offering in Scheduling first.
          </StateMessage>
        ) : (
          <>
            {picking && auto && chosenOffering && (
              <dl className={styles.facts}>
                <div><dt>Offering</dt><dd>{chosenOffering.name}</dd></div>
              </dl>
            )}

            {picking && stage === 'offering' && offerings.status === 'ready' && (
              <section aria-labelledby="sb-h-offering">
                <h3 id="sb-h-offering" ref={heading} tabIndex={-1} className={styles.heading}>Choose an offering</h3>
                <fieldset className={styles.group}>
                  <legend className={styles.legend}>Offering for {resourceName}</legend>
                  {offerings.data.items.map(o => (
                    <label key={o.id} className={styles.option}>
                      <input type="radio" name="sb-offering" value={o.id} checked={pendingOffering === o.id} onChange={() => setPendingOffering(o.id)} className={styles.input} />
                      <span className={styles.optionBody}>
                        <span className={styles.optionTitle}>{o.name}</span>
                        <span className={styles.optionMeta}>{durationText(o.durationMinutes)} · {priceText(o.price)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className={styles.continue}>
                  <Button variant="primary" disabled={!pendingOffering} onClick={() => pendingOffering && chooseOffering(pendingOffering)} className={styles.touch}>Continue</Button>
                </div>
                {offerings.data.truncated && <p className={styles.hint}>Only the first {offerings.data.items.length} matching offerings are shown.</p>}
              </section>
            )}

            {picking && offeringId && basis.status === 'loading' && <StateMessage kind="loading" title="Loading available times…" />}

            {picking && view && stage !== 'offering' && (
              <dl className={styles.facts} data-testid="booking-facts">
                <div><dt>Resource</dt><dd>{resourceName}</dd></div>
                <div><dt>Length</dt><dd data-testid="duration">{durationText(view.offering.durationMinutes)}</dd></div>
                <div><dt>Timezone</dt><dd data-testid="zone">{zoneText(view.timezone)}</dd></div>
              </dl>
            )}

            {picking && view && stage === 'date' && (
              <section aria-labelledby="sb-h-date">
                <h3 id="sb-h-date" ref={heading} tabIndex={-1} className={styles.heading}>Choose a date</h3>
                <div className={styles.window}>
                  <Button variant="secondary" onClick={() => moveWindow(-WINDOW_DAYS)} disabled={windowFrom <= today} aria-label="Earlier dates" className={styles.touch}>Earlier</Button>
                  <span className={styles.windowText}>{dayLabel(view.range.from)} to {dayLabel(view.range.to)}</span>
                  <Button variant="secondary" onClick={() => moveWindow(WINDOW_DAYS)} aria-label="Later dates" className={styles.touch}>Later</Button>
                </div>
                {view.days.every(d => d.starts.length === 0) && (
                  <p className={styles.hint} role="note">No times are offered in these {WINDOW_DAYS} days. Try later dates, or check this resource’s hours.</p>
                )}
                <ul className={styles.days}>
                  {view.days.map(d => {
                    const none = d.starts.length === 0;
                    return (
                      <li key={d.date}>
                        <button
                          type="button"
                          className={styles.day}
                          aria-disabled={none ? 'true' : undefined}
                          aria-label={dayAccessibleName(d.date, d.starts.length)}
                          data-empty={none ? 'true' : 'false'}
                          onClick={() => {
                            if (none) return;
                            setDate(d.date);
                            setTime(null);
                          }}
                        >
                          <span className={styles.dayName}>{dayLabel(d.date)}</span>
                          <span className={styles.dayCount}>{none ? 'No times' : timesText(d.starts.length)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {picking && view && day && (stage === 'time' || stage === 'ready') && (
              <section aria-labelledby="sb-h-time">
                <h3 id="sb-h-time" ref={heading} tabIndex={-1} className={styles.heading}>Choose a start time on {longDayLabel(day.date)}</h3>
                {day.starts.length === 0 ? (
                  <p className={styles.hint} role="note">No times are left on this day. Go back and choose another date.</p>
                ) : (
                  <fieldset className={styles.group}>
                    <legend className={styles.legend}>Start times, {zoneText(view.timezone)}</legend>
                    <div className={styles.times}>
                      {day.starts.map(s => (
                        <label key={s.startsAt} className={styles.time}>
                          <input type="radio" name="sb-time" value={s.time} checked={effTime === s.time} onChange={() => pickTime(s.time)} className={styles.input} />
                          <span className={styles.timeText}>{s.time}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </section>
            )}

            {picking && view && day && start && stage === 'ready' && (
              <section aria-labelledby="sb-h-ready" data-testid="prepared">
                <h3 id="sb-h-ready" className={styles.heading}>Start time chosen</h3>
                <dl className={styles.summary}>
                  <div><dt>Date</dt><dd>{longDayLabel(day.date)}</dd></div>
                  <div><dt>Starts</dt><dd>{start.time}</dd></div>
                  <div><dt>Ends</dt><dd>{endClock(start.startsAt, view.offering.durationMinutes, view.timezone)}</dd></div>
                  <div><dt>Length</dt><dd>{durationText(view.offering.durationMinutes)}</dd></div>
                  <div><dt>Price</dt><dd>{priceText(view.offering.price)}</dd></div>
                </dl>
                <div className={styles.continue}>
                  <Button variant="primary" className={styles.touch} disabled={!target} data-testid="to-details" onClick={() => target && dispatch({ type: 'START', target })}>
                    Continue to customer details
                  </Button>
                </div>
              </section>
            )}

            {/* ── customer details ─────────────────────────────────────────────────────────────────────────────────────────────── */}
            {m.step === 'details' && t && (
              <section aria-labelledby="sb-h-details">
                <h3 id="sb-h-details" ref={heading} tabIndex={-1} className={styles.heading}>Customer details</h3>
                <p className={styles.hint}>
                  For {longDayLabel(t.date)}, {t.time} to {endClock(t.startsAt, t.durationMinutes, t.timezone)} ({zoneText(t.timezone)}). Enter the customer’s details, not your own.
                </p>
                {errorKeys.length > 0 && (
                  <div ref={summary} role="alert" tabIndex={-1} className={styles.errorSummary} data-testid="error-summary">
                    <p className={styles.errorTitle}>{errorKeys.length === 1 ? 'There is 1 problem to fix.' : `There are ${errorKeys.length} problems to fix.`}</p>
                    <ul>
                      {errorKeys.map(k => (
                        <li key={k}>
                          <a
                            href={`#${FIELD_IDS[k]}`}
                            onClick={e => {
                              e.preventDefault();
                              document.getElementById(FIELD_IDS[k])?.focus();
                            }}
                          >
                            {FIELD_LABELS[k]}: {m.errors[k]}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <form
                  id="sb-details-form"
                  noValidate
                  autoComplete="off"
                  className={styles.form}
                  onSubmit={e => {
                    e.preventDefault();
                    dispatch({ type: 'REVIEW' });
                  }}
                >
                  <Field label="Customer name" required id={FIELD_IDS.name} error={m.errors.name}>
                    {control => (
                      <input {...control} className={fieldControlClassName} type="text" name="sb-customer-name" autoComplete="off" autoCapitalize="words" spellCheck={false} maxLength={200} value={m.details.name} onChange={e => dispatch({ type: 'FIELD', field: 'name', value: e.target.value })} />
                    )}
                  </Field>
                  <div className={styles.pair}>
                    <Field label="Customer email" id={FIELD_IDS.email} helper="Optional." error={m.errors.email}>
                      {control => (
                        <input {...control} className={fieldControlClassName} type="email" name="sb-customer-email" autoComplete="off" inputMode="email" spellCheck={false} maxLength={300} value={m.details.email} onChange={e => dispatch({ type: 'FIELD', field: 'email', value: e.target.value })} />
                      )}
                    </Field>
                    <Field label="Customer phone" id={FIELD_IDS.phone} helper="Optional." error={m.errors.phone}>
                      {control => (
                        <input {...control} className={fieldControlClassName} type="tel" name="sb-customer-phone" autoComplete="off" inputMode="tel" maxLength={60} value={m.details.phone} onChange={e => dispatch({ type: 'FIELD', field: 'phone', value: e.target.value })} />
                      )}
                    </Field>
                  </div>
                  <Field label="Party size" required id={FIELD_IDS.partySize} helper={`Up to ${t.capacity} for ${t.resourceName}.`} error={m.errors.partySize}>
                    {control => (
                      <input {...control} className={`${fieldControlClassName} ${styles.narrowField}`} type="text" name="sb-party-size" autoComplete="off" inputMode="numeric" maxLength={4} value={m.details.partySize} onChange={e => dispatch({ type: 'FIELD', field: 'partySize', value: e.target.value })} />
                    )}
                  </Field>
                  <Field label="Notes" id={FIELD_IDS.notes} helper={`Optional. ${m.details.notes.length} of ${NOTES_MAX} characters.`} error={m.errors.notes}>
                    {control => (
                      <textarea {...control} className={fieldControlClassName} name="sb-booking-notes" autoComplete="off" rows={3} value={m.details.notes} onChange={e => dispatch({ type: 'FIELD', field: 'notes', value: e.target.value })} />
                    )}
                  </Field>
                  <p className={styles.hint}>Nothing is saved until you confirm on the next step. Customer details are not stored in your browser.</p>
                </form>
              </section>
            )}

            {/* ── review ───────────────────────────────────────────────────────────────────────────────────────────────────────── */}
            {(m.step === 'review' || m.step === 'submitting') && t && (
              <section aria-labelledby="sb-h-review" aria-busy={m.step === 'submitting'}>
                <h3 id="sb-h-review" ref={heading} tabIndex={-1} className={styles.heading}>{m.step === 'submitting' ? 'Booking…' : 'Review the booking'}</h3>
                <BookingSummary
                  rows={[
                    ['Offering', t.offeringName],
                    ['Resource', t.resourceName],
                    ['Date', longDayLabel(t.date)],
                    ['Starts', t.time],
                    ['Ends', endClock(t.startsAt, t.durationMinutes, t.timezone)],
                    ['Length', durationText(t.durationMinutes)],
                    ['Timezone', zoneText(t.timezone)],
                    ['Party size', m.details.partySize.trim()],
                    ['Customer', m.details.name.trim()],
                    ...(m.details.email.trim() ? [['Email', m.details.email.trim()] as [string, string]] : []),
                    ...(m.details.phone.trim() ? [['Phone', m.details.phone.trim()] as [string, string]] : []),
                    ...(m.details.notes.trim() ? [['Notes', m.details.notes.trim()] as [string, string]] : []),
                    ['Price', priceText(t.price)],
                  ]}
                  testId="review-summary"
                />
                <p className={styles.hint} role="note">No payment is collected through this window. The price is recorded on the booking only. Confirming saves the booking and gives you its reference.</p>
              </section>
            )}

            {/* ── checking / unsure / retry / conflict ──────────────────────────────────────────────────────────────────────────── */}
            {m.step === 'checking' && (
              <section aria-labelledby="sb-h-checking" aria-busy="true">
                <h3 id="sb-h-checking" ref={heading} tabIndex={-1} className={styles.heading}>Checking whether your booking was saved</h3>
                <StateMessage kind="loading" title="Checking whether your booking was saved">
                  Please wait and do not book again. This booking will not be repeated: it is checked under the same reference.
                </StateMessage>
              </section>
            )}
            {m.step === 'unsure' && (
              <section aria-labelledby="sb-h-unsure">
                <h3 id="sb-h-unsure" ref={heading} tabIndex={-1} className={styles.heading}>We could not confirm whether the booking was saved</h3>
                <StateMessage kind="error" title="The booking may have been saved.">
                  “Try again” sends the same booking under the same reference, so it cannot be booked twice. If you close this window instead, look in the calendar before booking again.
                </StateMessage>
              </section>
            )}
            {m.step === 'retry' && (
              <section aria-labelledby="sb-h-retry">
                <h3 id="sb-h-retry" ref={heading} tabIndex={-1} className={styles.heading}>The system was busy</h3>
                <StateMessage kind="error" title="Nothing was booked.">
                  Try again to send the same booking. It is safe to repeat.
                </StateMessage>
              </section>
            )}
            {m.step === 'conflict' && (
              <section aria-labelledby="sb-h-conflict">
                <h3 id="sb-h-conflict" ref={heading} tabIndex={-1} className={styles.heading}>This reference is already used</h3>
                <StateMessage kind="error" title="Nothing new was booked.">
                  This booking reference already belongs to a different booking, so this one was not saved over it.
                </StateMessage>
                {m.conflictFound && (
                  <BookingSummary
                    rows={[
                      ['Existing booking', m.conflictFound.id],
                      ['Customer', m.conflictFound.customer.name],
                      ...(m.conflictFound.start ? [['Starts', `${longDayLabel(m.conflictFound.start.date)}, ${m.conflictFound.start.time}`] as [string, string]] : []),
                    ]}
                    testId="conflict-summary"
                  />
                )}
              </section>
            )}
            {m.step === 'unavailable' && (
              <section aria-labelledby="sb-h-unavail">
                <h3 id="sb-h-unavail" ref={heading} tabIndex={-1} className={styles.heading}>Booking is not available</h3>
                <StateMessage kind="error" title="Booking isn’t available right now. Nothing was booked." />
              </section>
            )}
            {m.step === 'denied' && (
              <section aria-labelledby="sb-h-denied">
                <h3 id="sb-h-denied" ref={heading} tabIndex={-1} className={styles.heading}>You can’t book here</h3>
                <StateMessage kind="error" title="Your session has ended or you do not have permission to book. Nothing was booked." />
              </section>
            )}

            {/* ── booked ───────────────────────────────────────────────────────────────────────────────────────────────────────── */}
            {m.step === 'done' && m.reservation && (
              <Confirmation reservation={m.reservation} resourceName={resourceName} mismatch={m.mismatch} heading={heading} copy={copy} onCopy={copyReference} />
            )}
          </>
        )}

        <FormActions>
          {picking && canGoBackSelect && !failure && <Button variant="secondary" onClick={backFromSelection} className={styles.touch}>Back</Button>}
          {m.step === 'details' && <Button variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className={styles.touch}>Back</Button>}
          {m.step === 'details' && (
            <Button variant="primary" type="submit" form="sb-details-form" className={styles.touch} data-testid="to-review">
              Review booking
            </Button>
          )}
          {m.step === 'review' && <Button variant="secondary" onClick={() => dispatch({ type: 'BACK' })} className={styles.touch}>Back</Button>}
          {m.step === 'review' && (
            <Button variant="primary" onClick={() => dispatch({ type: 'SUBMIT' })} className={styles.touch} data-testid="confirm-booking">
              Confirm booking
            </Button>
          )}
          {m.step === 'submitting' && (
            <Button variant="primary" disabled aria-busy="true" className={styles.touch} data-testid="confirm-booking">
              Booking…
            </Button>
          )}
          {(m.step === 'unsure' || m.step === 'retry') && (
            <Button variant="primary" onClick={() => dispatch({ type: 'RETRY' })} className={styles.touch} data-testid="retry-booking">
              Try again
            </Button>
          )}
          {m.step === 'conflict' && (
            <Button variant="primary" onClick={() => dispatch({ type: 'NEW_ATTEMPT' })} className={styles.touch} data-testid="new-attempt">
              Start a new booking
            </Button>
          )}
          {m.step === 'done' ? (
            <Button variant="primary" onClick={requestClose} className={styles.touch} data-testid="booking-done">Done</Button>
          ) : (
            !busy && <Button variant="secondary" onClick={requestClose} className={styles.touch}>Close</Button>
          )}
        </FormActions>
      </div>
    </Dialog>
  );
}

function BookingSummary({ rows, testId }: { rows: Array<[string, string]>; testId: string }) {
  return (
    <dl className={styles.summary} data-testid={testId}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Confirmation({
  reservation,
  resourceName,
  mismatch,
  heading,
  copy,
  onCopy,
}: {
  reservation: BookedReservation;
  resourceName: string;
  mismatch: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  copy: 'idle' | 'copied' | 'failed';
  onCopy: (id: string, input: HTMLInputElement | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const r = reservation;
  const ends = r.durationMinutes !== null ? endClock(r.startsAt, r.durationMinutes, r.timezone) : null;
  return (
    <section aria-labelledby="sb-h-booked" data-testid="confirmation">
      <h3 id="sb-h-booked" ref={heading} tabIndex={-1} className={styles.heading}>Booked</h3>
      {mismatch && (
        <p className={styles.hint} role="note">This reference already belonged to the booking below, which was saved earlier. No second booking was made.</p>
      )}
      <Field label="Booking reference" id="sb-f-reference" helper="Use this full reference to find the booking.">
        {control => (
          <div className={styles.refRow}>
            <input {...control} ref={input} readOnly className={`${fieldControlClassName} ${styles.reference}`} value={r.id} onFocus={e => e.currentTarget.select()} data-testid="reservation-id" />
            <Button variant="secondary" className={styles.touch} onClick={() => onCopy(r.id, input.current)} data-testid="copy-reference">
              Copy reference
            </Button>
          </div>
        )}
      </Field>
      <p className={styles.copyStatus} role="status" aria-live="polite" data-testid="copy-status">
        {copy === 'copied' ? 'Reference copied.' : copy === 'failed' ? 'Copying was blocked. The reference is selected: press Ctrl+C or Command+C.' : ''}
      </p>
      <BookingSummary
        rows={[
          ['Resource', resourceName],
          ...(r.start ? [['Date', longDayLabel(r.start.date)] as [string, string], ['Starts', r.start.time] as [string, string]] : []),
          ...(ends ? [['Ends', ends] as [string, string]] : []),
          ...(r.durationMinutes !== null ? [['Length', durationText(r.durationMinutes)] as [string, string]] : []),
          ['Timezone', zoneText(r.timezone)],
          ['Party size', String(r.partySize)],
          ['Customer', r.customer.name],
          ...(r.customer.email ? [['Email', r.customer.email] as [string, string]] : []),
          ...(r.customer.phone ? [['Phone', r.customer.phone] as [string, string]] : []),
          ...(r.notes ? [['Notes', r.notes] as [string, string]] : []),
          ['Price', priceText(r.price)],
        ]}
        testId="confirmation-summary"
      />
      <p className={styles.hint} role="note">No payment was collected. The price is recorded on the booking only.</p>
    </section>
  );
}
