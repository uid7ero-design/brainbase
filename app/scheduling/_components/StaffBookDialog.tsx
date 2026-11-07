'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, StateMessage } from '@/components/ui/app';
import { WINDOW_DAYS, describeReadFailure, fetchBasis, loadBookableOfferings, type BasisView, type BookableOffering } from '@/lib/scheduling/staffBooking/basisClient';
import { createBookingKeyHolder, type BookingContent } from '@/lib/scheduling/staffBooking/key';
import { dayAccessibleName, dayLabel, durationText, endClock, longDayLabel, priceText, shiftDate, timesText, zoneText } from '@/lib/scheduling/staffBooking/view';
import styles from './staffBook.module.css';

// Phase 2C.3c UI SLICE 1: the staff booking dialog, READ ONLY. Resource (fixed: the calendar's), offering, date and an ENGINE-OFFERED start.
// It reads (the facility-hire offerings that link this resource, then the basis endpoint) and PREPARES the stable idempotency key in memory.
// It has no way to create, change or cancel a booking: there is no customer form, no submit, no cancel and no POST in this file.
//
// - It is mounted only while open, so a closed dialog makes no request at all; the button that mounts it exists only when the server decided
//   (lib/scheduling/staffBookingVisibility.ts) that the switch, the organisation capability and scheduling.reserve all hold.
// - The times are exactly the basis response's starts. There is no free-time input, no duration field and no step control.
// - Times are wall-clock times of the offering's pinned zone, shown with the zone's name.
// - A 404 without a code (a gate closed under the user) closes the dialog and hides the button until reload (onUnavailable).

export interface PreparedBooking {
  content: BookingContent;
  /** The in-memory idempotency key. Slice 2 sends it; slice 1 only prepares it. */
  key: string;
  timezone: string;
}

type Failure = ReturnType<typeof describeReadFailure>;
type Phase<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; failure: Failure };

export default function StaffBookDialog({
  resourceId,
  resourceName,
  today,
  onClose,
  onUnavailable,
  onPrepared,
}: {
  resourceId: string;
  resourceName: string;
  /** The first local date to offer (the calendar's "today" in its zone). */
  today: string;
  onClose: () => void;
  onUnavailable: () => void;
  onPrepared?: (prepared: PreparedBooking) => void;
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
  const holder = useRef(createBookingKeyHolder());
  const onPreparedRef = useRef(onPrepared);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onPreparedRef.current = onPrepared;
    onUnavailableRef.current = onUnavailable;
  });

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
  const basisKey = `${offeringId ?? ''}|${resourceId}|${windowFrom}|${tick}`;
  const basis: Phase<BasisView> = basisRes && basisRes.key === basisKey ? basisRes.phase : { status: 'loading' };

  // 2. The basis and the engine's starts for the chosen offering and the 14-day window.
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
  const start = day && time ? (day.starts.find(s => s.time === time) ?? null) : null;

  // 3. The key for exactly this content, prepared in memory and never sent.
  useEffect(() => {
    if (!offeringId || !date || !time || !start || !view) return;
    const content: BookingContent = { offeringId, resourceId, date, time };
    const key = holder.current.keyFor(content);
    onPreparedRef.current?.({ content, key, timezone: view.timezone });
  }, [offeringId, resourceId, date, time, start, view]);

  const step: 'offering' | 'date' | 'time' | 'ready' = !offeringId ? 'offering' : !date ? 'date' : !time ? 'time' : 'ready';
  const steps = useMemo(() => {
    const all = [
      { id: 'offering', label: 'Offering' },
      { id: 'date', label: 'Date' },
      { id: 'time', label: 'Start time' },
      { id: 'ready', label: 'Ready' },
    ] as const;
    return auto ? all.filter(s => s.id !== 'offering') : all;
  }, [auto]);

  // Focus moves to the step heading when the step changes (not on open: the dialog places focus itself).
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (step === 'ready') return; // choosing a time must not take focus from the radio group (arrow keys keep working); the live region announces it
    heading.current?.focus();
  }, [step]);

  const announce =
    offerings.status === 'loading' ? 'Loading offerings…'
    : basis.status === 'loading' && offeringId ? 'Loading available times…'
    : view && step === 'date' ? `${view.days.filter(d => d.starts.length > 0).length} days with times between ${dayLabel(view.range.from)} and ${dayLabel(view.range.to)}.`
    : day && step === 'time' ? `${timesText(day.starts.length)} on ${dayLabel(day.date)}.`
    : step === 'ready' ? 'Start time chosen. Nothing has been booked.'
    : '';

  const failure = offerings.status === 'error' ? offerings.failure : basis.status === 'error' ? basis.failure : null;

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
  const back = () => {
    if (step === 'ready') setTime(null);
    else if (step === 'time') setDate(null);
    else if (step === 'date' && !auto) {
      setOfferingId(null);
    }
  };
  const canGoBack = step === 'ready' || step === 'time' || (step === 'date' && !auto);

  return (
    <Dialog open onClose={onClose} title={`Book ${resourceName}`} width={560}>
      <div className={styles.body} data-testid="staff-book-dialog">
        <p className={styles.lead}>
          Choose a date and one of the start times offered. Nothing is booked from this window yet.
        </p>

        <ol className={styles.steps} aria-label="Booking steps">
          {steps.map(s => (
            <li key={s.id} className={styles.stepItem} aria-current={s.id === step ? 'step' : undefined} data-done={steps.findIndex(x => x.id === s.id) < steps.findIndex(x => x.id === step) ? 'true' : 'false'}>
              {s.label}
            </li>
          ))}
        </ol>

        <div className={styles.live} role="status" aria-live="polite">{announce}</div>

        {failure ? (
          <StateMessage
            kind="error"
            title={failure.text}
            action={failure.retryable ? <Button variant="secondary" onClick={() => setTick(t => t + 1)}>Try again</Button> : undefined}
          />
        ) : offerings.status === 'loading' ? (
          <StateMessage kind="loading" title="Loading offerings…" />
        ) : offerings.status === 'ready' && offerings.data.items.length === 0 ? (
          <StateMessage kind="empty" title="Nothing can be booked on this resource.">
            It is not assigned to an active facility-hire offering. Assign it to an offering in Scheduling first.
          </StateMessage>
        ) : (
          <>
            {auto && chosenOffering && (
              <dl className={styles.facts}>
                <div><dt>Offering</dt><dd>{chosenOffering.name}</dd></div>
              </dl>
            )}

            {step === 'offering' && offerings.status === 'ready' && (
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

            {offeringId && basis.status === 'loading' && <StateMessage kind="loading" title="Loading available times…" />}

            {view && step !== 'offering' && (
              <dl className={styles.facts} data-testid="booking-facts">
                <div><dt>Resource</dt><dd>{resourceName}</dd></div>
                <div><dt>Length</dt><dd data-testid="duration">{durationText(view.offering.durationMinutes)}</dd></div>
                <div><dt>Timezone</dt><dd data-testid="zone">{zoneText(view.timezone)}</dd></div>
              </dl>
            )}

            {view && step === 'date' && (
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

            {view && day && (step === 'time' || step === 'ready') && (
              <section aria-labelledby="sb-h-time">
                <h3 id="sb-h-time" ref={step === 'time' ? heading : undefined} tabIndex={-1} className={styles.heading}>Choose a start time on {longDayLabel(day.date)}</h3>
                <fieldset className={styles.group}>
                  <legend className={styles.legend}>Start times, {zoneText(view.timezone)}</legend>
                  <div className={styles.times}>
                    {day.starts.map(s => (
                      <label key={s.startsAt} className={styles.time}>
                        <input type="radio" name="sb-time" value={s.time} checked={time === s.time} onChange={() => setTime(s.time)} className={styles.input} />
                        <span className={styles.timeText}>{s.time}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>
            )}

            {view && day && start && step === 'ready' && (
              <section aria-labelledby="sb-h-ready" data-testid="prepared" data-key-prepared="true">
                <h3 id="sb-h-ready" className={styles.heading}>Start time chosen</h3>
                <dl className={styles.summary}>
                  <div><dt>Date</dt><dd>{longDayLabel(day.date)}</dd></div>
                  <div><dt>Starts</dt><dd>{start.time}</dd></div>
                  <div><dt>Ends</dt><dd>{endClock(start.startsAt, view.offering.durationMinutes, view.timezone)}</dd></div>
                  <div><dt>Length</dt><dd>{durationText(view.offering.durationMinutes)}</dd></div>
                  <div><dt>Price</dt><dd>{priceText(view.offering.price)}</dd></div>
                </dl>
                <p className={styles.hint} role="note">
                  Customer details and confirming a booking arrive in a later release. Nothing has been booked or saved.
                </p>
              </section>
            )}
          </>
        )}

        <div className={styles.footer}>
          {canGoBack && !failure && <Button variant="secondary" onClick={back} className={styles.touch}>Back</Button>}
          <Button variant="secondary" onClick={onClose} className={styles.touch}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
