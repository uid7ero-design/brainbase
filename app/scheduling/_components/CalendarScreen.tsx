'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, PageHeader, Panel, StateMessage, buttonProps } from '@/components/ui/app';
import { seg } from '@/lib/scheduling/dashboard/api';
import { localToday } from '@/lib/scheduling/dashboard/availability';
import {
  KIND_TEXT,
  clipToDay,
  clockAt,
  columnHeight,
  dayHeading,
  dayNote,
  describeZoneAt,
  isDate,
  laneStateText,
  place,
  rangeFor,
  rangeHeading,
  reasonText,
  slotsInDay,
  stepDate,
  windowText,
  type BlockKind,
  type CalendarMode,
  type CalendarResponse,
} from '@/lib/scheduling/dashboard/calendar';
import type { StatusView } from '@/lib/scheduling/dashboard/types';
import type { CalendarDay, CalendarLane } from '@scheduling/core';
import { LoadError } from './parts';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// The READ-ONLY availability calendar of ONE offering or resource (Phase 2B.3d). Everything on it comes from the calendar API, which
// authorises every request on its own and computes with the shared engine; this screen only draws what it is told. It has no way to save
// hours, book, hold or pin anything: `canManage` only decides whether a link to the hours screen says "Edit hours" or "View hours".
//   - Wide screens (768px and up) draw a time grid: DAY view has one column per lane (the offering, then each resource), WEEK view one column
//     per day for the lane chosen. Narrow screens draw a plain agenda instead; the same agenda is available under the grid for screen readers.
//   - Times are wall-clock times in the zone shown, never converted for the viewer. A resource set in another zone says so; its blocks sit at
//     their true instants. A day that is 23 or 25 hours long is drawn at its true length and labelled.

const HOUR_LABEL_EVERY = 3;
const STEPS = [15, 30, 60] as const;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

export default function CalendarScreen({ kind, id, canManage, organisationTimezone = null }: { kind: 'offering' | 'resource'; id: string; canManage: boolean; organisationTimezone?: string | null }) {
  const ownerPath = kind === 'offering' ? `/offerings/${seg(id)}` : `/resources/${seg(id)}`;
  const params = useSearchParams();
  // The page already knows the organisation's zone (it is read beside the access check), so the calendar can start loading at once. Only without it
  // (it could not be read) does the screen fall back to asking /status, as before.
  const status = useSchedulingData<StatusView>(organisationTimezone ? null : '/status');
  const narrow = useNarrow();

  const [mode, setMode] = useState<CalendarMode>(params.get('view') === 'week' ? 'week' : 'day');
  const [date, setDate] = useState<string | null>(isDate(params.get('date')) ? params.get('date') : null);
  const [step, setStep] = useState<number | null>(STEPS.includes(Number(params.get('step')) as (typeof STEPS)[number]) ? Number(params.get('step')) : null);
  const [laneId, setLaneId] = useState<string | null>(null);

  // The first date is "today" in the zone the organisation shows; once the calendar answers, "Today" uses the zone it is drawn in.
  const startDate = date ?? (organisationTimezone ? localToday(organisationTimezone) : status.state === 'ready' && status.data ? localToday(status.data.timezone) : status.state === 'error' ? localToday('UTC') : null);
  const range = startDate ? rangeFor(mode, startDate) : null;
  const query = range ? `from=${range.from}&to=${range.to}${kind === 'offering' && step ? `&step=${step}` : ''}` : '';
  const calendar = useSchedulingData<CalendarResponse>(range ? `${ownerPath}/calendar?${query}` : null);

  useEffect(() => {
    if (!startDate) return;
    const next = new URLSearchParams();
    next.set('view', mode);
    next.set('date', startDate);
    if (kind === 'offering' && step) next.set('step', String(step));
    window.history.replaceState(null, '', `${window.location.pathname}?${next.toString()}`);
  }, [mode, startDate, step, kind]);

  const view = calendar.data;
  const subject = view?.offering ?? view?.resource ?? null;
  const name = subject?.name ?? '';
  const zone = view?.timezone ?? null;
  const today = zone ? localToday(zone) : startDate ?? '';
  const hoursHref = kind === 'offering' ? `/scheduling/offerings/${seg(id)}/availability` : `/scheduling/resources/${seg(id)}/availability`;
  const lanes = useMemo(() => view?.lanes ?? [], [view]);
  const selected = lanes.find(l => l.id === laneId) ?? lanes[0] ?? null;
  const names = useMemo(() => Object.fromEntries(lanes.map(l => [l.id, l.name])), [lanes]);

  const back = <Link href={kind === 'offering' ? '/scheduling/schedules' : '/scheduling/resources'}>{kind === 'offering' ? 'Schedules' : 'Resources'}</Link>;
  const header = (
    <PageHeader
      eyebrow={back}
      title={`Calendar: ${name || (kind === 'offering' ? 'offering' : 'resource')}`}
      meta={view && (view.offering?.archived || view.resource?.active === false) ? <Badge state="inactive">{kind === 'offering' ? 'Archived' : 'Inactive'}</Badge> : undefined}
      description="When this is available, what is closed and what is already held. Read only: nothing here books or changes anything."
      actions={
        <Link href={hoursHref} {...buttonProps('secondary', 'md')} className={`${buttonProps('secondary', 'md').className} ${styles.touch}`} data-testid="hours-link">
          {canManage ? 'Edit hours' : 'View hours'}
        </Link>
      }
    />
  );

  if (!range || calendar.state === 'loading') {
    return (
      <div className={`${styles.page} ${styles.availability}`}>
        {header}
        <StateMessage kind="loading" title="Loading the calendar…" />
      </div>
    );
  }
  if (calendar.state === 'error' && calendar.problem) {
    const p = calendar.problem;
    return (
      <div className={`${styles.page} ${styles.availability}`}>
        {header}
        {p.code === 'NOT_FOUND' ? (
          <StateMessage kind="empty" size="page" title={`This ${kind} no longer exists`}>{p.message}</StateMessage>
        ) : p.code === 'AVAILABILITY_NOT_READY' || p.code === 'AVAILABILITY_ZONES_NOT_READY' ? (
          <StateMessage kind="empty" size="page" title="The calendar isn’t set up yet" action={<Button className={styles.touch} onClick={calendar.reload}>Check again</Button>}>
            Hours aren’t set up on this installation yet. Ask a BrainBase admin to finish the setup.
          </StateMessage>
        ) : p.code === 'CALENDAR_TOO_LARGE' ? (
          <StateMessage kind="empty" size="page" title="Too many resources to draw">{p.message}</StateMessage>
        ) : p.code === 'CALENDAR_UNAVAILABLE' ? (
          <StateMessage kind="error" title="These hours can’t be drawn as a calendar" action={<Button className={styles.touch} onClick={calendar.reload}>Try again</Button>}>
            {p.problems.length > 0 ? p.problems.join(' ') : 'The saved hours need review on the hours screen.'}
          </StateMessage>
        ) : (
          <LoadError problem={p} onRetry={calendar.reload} />
        )}
      </div>
    );
  }
  if (!view || !zone || !startDate || !range) return null;

  const firstDay = view.days[0];
  const zoneText = describeZoneAt(zone, firstDay.startsAt);
  const otherZones = lanes.filter(l => l.timezone !== zone);
  const notices = [
    ...view.days.filter(d => dayNote(d)).map(d => `${dayHeading(d.date)}: ${dayNote(d)}.`),
    ...view.adjustments.map(a => `${dayHeading(a.date)}: ${a.owner.kind === 'offering' ? 'the offering’s' : `${names[a.owner.id] ?? 'a resource'}’s`} hours ${a.startTime} to ${a.endTime} ${adjustmentText(a.kind)}`),
  ];
  const noSlotsReason = view.slot === null && kind === 'offering' ? reasonText('no_duration', names) : '';
  // A resource's own missing hours or inactivity is stated beside it in the explainer above the calendar, so it is not repeated here.
  const shownReasons = view.reasons.filter(r => !/^(resource_no_availability|resource_inactive):/.test(r) && r !== 'no_resource_availability');

  return (
    <div className={`${styles.page} ${styles.availability}`} data-testid="calendar-screen">
      {header}
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. This calendar is read only for everyone.</p>}

      <div className={styles.calToolbar} role="group" aria-label="Calendar controls">
        <div className={styles.calSegment} role="group" aria-label="View">
          {(['day', 'week'] as const).map(m => (
            <Button key={m} className={styles.touch} variant={mode === m ? 'primary' : 'secondary'} aria-pressed={mode === m} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
              {m === 'day' ? 'Day' : 'Week'}
            </Button>
          ))}
        </div>
        <div className={styles.calSegment} role="group" aria-label="Move">
          <Button className={styles.touch} onClick={() => setDate(stepDate(mode, startDate, -1))} aria-label={mode === 'day' ? 'Previous day' : 'Previous week'} data-testid="prev">←</Button>
          <Button className={styles.touch} onClick={() => setDate(today)} data-testid="today">Today</Button>
          <Button className={styles.touch} onClick={() => setDate(stepDate(mode, startDate, 1))} aria-label={mode === 'day' ? 'Next day' : 'Next week'} data-testid="next">→</Button>
        </div>
        <label className={styles.calField}>
          <span>Go to date</span>
          <input type="date" value={startDate} onChange={e => isDate(e.target.value) && setDate(e.target.value)} data-testid="date-input" />
        </label>
        {kind === 'offering' && view.slot && (
          <label className={styles.calField}>
            <span>Bookable every</span>
            <select value={step ?? view.slot.stepMinutes} onChange={e => setStep(Number(e.target.value))} data-testid="step-select">
              {[...new Set([view.offering?.durationMinutes ?? view.slot.durationMinutes, ...STEPS])].sort((a, b) => a - b).map(m => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </label>
        )}
        {mode === 'week' && lanes.length > 1 && (
          <label className={styles.calField}>
            <span>Show</span>
            <select value={selected?.id ?? ''} onChange={e => setLaneId(e.target.value)} data-testid="lane-select">
              {lanes.map(l => (
                <option key={l.id} value={l.id}>{l.kind === 'offering' ? `${l.name} (offering hours)` : l.name}</option>
              ))}
            </select>
          </label>
        )}
        {calendar.refreshing && <span className={styles.dim} role="status">Updating…</span>}
      </div>

      <h2 className={styles.calRange} data-testid="range-heading">{rangeHeading(view.fromDate, view.toDate)}</h2>
      {calendar.problem && <p className={styles.notice} role="alert">The calendar could not be refreshed, so what you see may be out of date. <Button variant="ghost" size="sm" className={styles.touch} onClick={calendar.reload}>Try again</Button></p>}

      <Explainer kind={kind} view={view} lanes={lanes} canManage={canManage} />

      <Panel title="Timezone">
        <p className={styles.zoneFacts}>
          <strong data-testid="calendar-timezone">{zoneText}</strong>
          <span>
            {view.zone.pinned ? 'Fixed when the first hours were saved.' : 'Not fixed yet: this is the zone the first hours saved would be read in.'} Times are wall-clock times in this zone, not converted to your device’s.
          </span>
          {otherZones.map(l => (
            <span key={l.id} data-testid="other-zone">{l.name}’s hours are set in {describeZoneAt(l.timezone, firstDay.startsAt)}; they are drawn at their true times here.</span>
          ))}
        </p>
      </Panel>

      {notices.length > 0 && (
        <aside className={styles.notice} role="note" aria-label="Daylight saving" data-testid="calendar-dst-notice">
          <strong>Daylight saving</strong>
          <ul className={styles.dstList}>
            {notices.map(n => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </aside>
      )}

      {shownReasons.length > 0 && (
        <p className={styles.notice} role="status" data-testid="calendar-reasons">
          {shownReasons.map(r => reasonText(r, names)).filter(Boolean).join(' ')}
        </p>
      )}
      {noSlotsReason && !view.reasons.includes('no_duration') && <p className={styles.notice} role="status">{noSlotsReason}</p>}

      <Legend />

      {!narrow && (
        <>
          {mode === 'week' && selected && selected.state === 'no_hours' && (
            <p className={styles.notice} role="status" data-testid={`lane-empty-${selected.id}`}>
              <strong>No hours set</strong> for {selected.name}, so it is unavailable this week.
            </p>
          )}
          <GridScroller
            mode={mode}
            focusKey={`${mode}|${view.fromDate}|${view.toDate}|${selected?.id ?? ''}`}
            label={mode === 'day' ? 'Day calendar. Scrolls up and down, and sideways when there are many columns.' : 'Week calendar. Scrolls up and down, and sideways on narrow screens.'}
          >
            {mode === 'day' ? <DayGrid day={view.days[0]} lanes={lanes} view={view} /> : selected && <WeekGrid days={view.days} lane={selected} view={view} today={today} />}
          </GridScroller>
        </>
      )}

      <details className={styles.calAgenda} open={narrow} data-testid="calendar-agenda">
        <summary>{narrow ? 'Agenda' : 'Show as a list'}</summary>
        <Agenda view={view} lanes={mode === 'week' && !narrow && selected ? [selected] : lanes} today={today} />
      </details>
    </div>
  );
}

function adjustmentText(kind: string): string {
  switch (kind) {
    case 'start_in_gap':
      return 'start at a time the clocks skip, so they open when the clocks jump.';
    case 'end_in_gap':
      return 'end at a time the clocks skip, so they close when the clocks jump.';
    case 'start_ambiguous':
      return 'start at a time that happens twice; the first one is used.';
    case 'end_ambiguous':
      return 'end at a time that happens twice; the first one is used.';
    default:
      return 'fall wholly in the hour the clocks skip, so they do not happen that day.';
  }
}

function Legend() {
  const items: BlockKind[] = ['hours', 'closed', 'free', 'occupied', 'slot'];
  return (
    <ul className={styles.calLegend} aria-label="Key" data-testid="calendar-legend">
      {items.map(k => (
        <li key={k}>
          <span className={styles.calSwatch} data-kind={k} aria-hidden="true" />
          {KIND_TEXT[k]}
        </li>
      ))}
      <li>
        <span className={styles.calSwatch} data-kind="none" aria-hidden="true" />
        Not available
      </li>
    </ul>
  );
}

// ── The grid ──────────────────────────────────────────────────────────────

type View = CalendarResponse;

function Blocks({ day, lane, view }: { day: CalendarDay; lane: CalendarLane; view: View }) {
  const zone = lane.timezone;
  const shown = view.timezone;
  const put = (kind: BlockKind, w: { startsAt: string; endsAt: string }, label: string, key: string) => {
    const p = place(day, w);
    return (
      <div
        key={key}
        className={styles.calBlock}
        data-kind={kind}
        data-start={w.startsAt}
        data-end={w.endsAt}
        role="img"
        aria-label={`${label} ${windowText(w, shown)}`}
        title={`${label} ${windowText(w, shown)}${zone !== shown ? ` (${windowText(w, zone)} in ${zone})` : ''}`}
        style={{ top: `${p.top}%`, height: `${p.height}%` }}
      />
    );
  };
  const slotMinutes = view.slot?.durationMinutes ?? 0;
  const slots = view.slot ? slotsInDay(day, view.slots, lane.kind === 'offering' ? null : lane.id) : [];
  return (
    <>
      {clipToDay(day, lane.hours).map((w, i) => put('hours', w, 'Open', `h${i}`))}
      {clipToDay(day, lane.closed).map((w, i) => put('closed', w, 'Closed', `c${i}`))}
      {clipToDay(day, lane.free).map((w, i) => put('free', w, 'Free', `f${i}`))}
      {clipToDay(day, lane.occupied).map((w, i) => put('occupied', w, w.kind === 'session' ? 'Held by a session' : 'Held', `o${i}`))}
      {slots.map((s, i) => put('slot', { startsAt: s.startsAt, endsAt: new Date(Date.parse(s.startsAt) + slotMinutes * 60_000).toISOString().replace('.000Z', 'Z') }, 'Bookable', `s${i}`))}
    </>
  );
}

function HourLines({ day, zone, labelled }: { day: CalendarDay; zone: string; labelled: boolean }) {
  return (
    <>
      {day.ticks.map(t => {
        const p = place(day, { startsAt: t.at, endsAt: t.at });
        return (
          <div key={t.at} className={styles.calTick} style={{ top: `${p.top}%` }} data-hour={t.hour} aria-hidden="true">
            {labelled && t.hour % HOUR_LABEL_EVERY === 0 && <span>{clockAt(t.at, zone)}</span>}
          </div>
        );
      })}
    </>
  );
}

/** One day, one column per lane: the offering, then each resource side by side. */
function DayGrid({ day, lanes, view }: { day: CalendarDay; lanes: CalendarLane[]; view: View }) {
  const height = columnHeight(day);
  return (
    <div className={styles.calGrid} style={{ gridTemplateColumns: `3.5rem repeat(${lanes.length}, minmax(9rem, 1fr))` }}>
      <div className={styles.calCorner} />
      {lanes.map(l => (
        <div key={l.id} className={styles.calHead} data-testid={`lane-head-${l.id}`}>
          <strong>{l.name}</strong>
          <span>{l.kind === 'offering' ? 'Offering' : 'Resource'} · {laneStateText(l)}</span>
        </div>
      ))}
      <div className={styles.calAxis} style={{ height }} aria-hidden="true">
        <HourLines day={day} zone={view.timezone} labelled />
      </div>
      {lanes.map(l => (
        <div key={l.id} className={styles.calColumn} style={{ height }} data-lane={l.id} data-state={l.state}>
          <HourLines day={day} zone={view.timezone} labelled={false} />
          {l.state === 'no_hours' && (
            <div className={styles.calEmpty} data-testid={`lane-empty-${l.id}`}>
              <strong>No hours set</strong>
              <span>Unavailable</span>
            </div>
          )}
          <Blocks day={day} lane={l} view={view} />
        </div>
      ))}
    </div>
  );
}

/** One lane across the days of a week: one column per day, each drawn at the day's true length. */
function WeekGrid({ days, lane, view, today }: { days: CalendarDay[]; lane: CalendarLane; view: View; today: string }) {
  const zone = view.timezone;
  return (
    <div className={styles.calGrid} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(6.5rem, 1fr))` }}>
      {days.map(d => (
        <div key={d.date} className={styles.calHead} data-today={d.date === today || undefined} data-testid={`day-head-${d.date}`}>
          <strong>{dayHeading(d.date)}</strong>
          <span>{dayNote(d) ?? ' '}</span>
        </div>
      ))}
      {days.map(d => (
        <div key={d.date} className={styles.calColumn} style={{ height: columnHeight(d) }} data-day={d.date} data-minutes={d.minutes}>
          <HourLines day={d} zone={zone} labelled />
          <Blocks day={d} lane={lane} view={view} />
        </div>
      ))}
    </div>
  );
}

// ── The agenda ────────────────────────────────────────────────────────────

const joinWindows = (ws: { startsAt: string; endsAt: string }[], zone: string): string => ws.map(w => windowText(w, zone)).join(', ');

function Agenda({ view, lanes, today }: { view: View; lanes: CalendarLane[]; today: string }) {
  const zone = view.timezone;
  return (
    <div className={styles.calAgendaBody}>
      {view.days.map(day => {
        const note = dayNote(day);
        return (
          <section key={day.date} className={styles.calAgendaDay} aria-label={dayHeading(day.date)} data-testid={`agenda-${day.date}`} data-today={day.date === today || undefined}>
            <h3>
              {dayHeading(day.date)}
              {day.date === today ? ' (today)' : ''}
              {note ? <small> · {note}</small> : null}
            </h3>
            <ul>
              {lanes.map(l => {
                const hours = clipToDay(day, l.hours);
                const closed = clipToDay(day, l.closed);
                const free = clipToDay(day, l.free);
                const held = clipToDay(day, l.occupied);
                const slots = view.slot ? slotsInDay(day, view.slots, l.kind === 'offering' ? null : l.id) : [];
                return (
                  <li key={l.id} data-lane={l.id}>
                    <strong>{l.name}</strong>
                    {l.state === 'inactive' || l.state === 'archived' ? (
                      <span> — {laneStateText(l).toLowerCase()}, not available</span>
                    ) : l.state === 'unsupported' ? (
                      <span> — unavailable: it has a rule of a kind that is not supported yet</span>
                    ) : l.state === 'no_hours' ? (
                      <span> — no hours set, so {l.kind === 'resource' ? 'not available' : 'nothing is available'}</span>
                    ) : hours.length === 0 ? (
                      <span> — {closed.length > 0 ? `closed (${joinWindows(closed, zone)})` : 'no hours, not available'}</span>
                    ) : (
                      <span>
                        {' '}— open {joinWindows(hours, zone)}
                        {closed.length > 0 ? `; closed ${joinWindows(closed, zone)}` : ''}
                        {l.kind === 'resource' ? `; free ${free.length ? joinWindows(free, zone) : 'none'}` : ''}
                        {held.length > 0 ? `; held ${joinWindows(held, zone)}` : ''}
                        {slots.length > 0 ? `; ${slots.length} bookable start${slots.length === 1 ? '' : 's'}: ${slots.slice(0, 12).map(s => clockAt(s.startsAt, zone)).join(', ')}${slots.length > 12 ? '…' : ''}` : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ── The grid's own scroll box ─────────────────────────────────────────────

/**
 * The time grid in a box that scrolls on its own (both ways), so the lane headers stay at the top and the time column stays at the left while the day is
 * scrolled, and so the keyboard can scroll it (it is a labelled, focusable region). When a day or week is drawn the box is scrolled to just above the first
 * open or bookable block, so the working hours are on screen without scrolling. Drawing only: nothing here changes what is calculated.
 */
function GridScroller({ mode, label, focusKey, children }: { mode: CalendarMode; label: string; focusKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const blocks = [...el.querySelectorAll<HTMLElement>('[data-kind=hours][data-start], [data-kind=slot][data-start]')];
    const box = el.getBoundingClientRect();
    // nothing open to show (a day with no hours): the top, unless that leaves a label across the bottom edge
    const first = blocks.length === 0 ? 0 : Math.min(...blocks.map(b => b.getBoundingClientRect().top - box.top + el.scrollTop));
    const header = el.querySelector<HTMLElement>('[class*=calHead]')?.offsetHeight ?? 0;
    // Not an arbitrary offset. A LABELLED hour line is put a fixed distance (LINE_GAP) below the sticky header, so no time label is left half under it, and the position
    // is also chosen so that no label straddles the bottom edge of the box. It is the last such position that still shows the first open block, and never beyond the end
    // of the scroll range (a clamped position would not be aligned to anything). At the very top the first label (00:00) sits wholly inside the time column.
    const LINE_GAP = 12;
    const LABEL_ABOVE = 7; // a label is centred on its line: about 7px above it and 10px below
    const LABEL_BELOW = 10.5;
    const ticks = [...(el.querySelector('[class*=calAxis]') ?? el.querySelector('[class*=calColumn]') ?? el).querySelectorAll<HTMLElement>('[class*=calTick]')];
    const labelled = ticks.filter(t => t.querySelector('span')).map(t => t.getBoundingClientRect().top - box.top + el.scrollTop);
    const maxScroll = el.scrollHeight - el.clientHeight;
    const aligned = labelled.map(t => Math.round(t - header - LINE_GAP)).filter(top => top >= 0 && top <= maxScroll);
    const straddlesBottom = (top: number) => labelled.some(t => t - top - LABEL_ABOVE < el.clientHeight && t - top + LABEL_BELOW > el.clientHeight);
    if (blocks.length === 0) {
      // nearest to the top first: the top itself, then each aligned position going down
      el.scrollTop = [0, ...aligned.sort((a, b) => a - b)].find(top => !straddlesBottom(top)) ?? 0;
      return;
    }
    const wanted = Math.min(first - header - LINE_GAP + 0.5, maxScroll);
    const candidates = aligned.filter(top => top <= wanted).sort((a, b) => b - a);
    el.scrollTop = candidates.find(top => !straddlesBottom(top)) ?? candidates[0] ?? 0;
  }, [focusKey]);
  return (
    <div ref={ref} className={styles.calScroller} data-testid="calendar-grid" data-mode={mode} role="region" tabIndex={0} aria-label={label}>
      {children}
    </div>
  );
}

// ── Why there may be nothing to book ──────────────────────────────────────

type Tone = 'ok' | 'missing' | 'none';

/** What each lane's hours are over the range, in words: "09:00 to 12:00" for a day, "Mon 11 Jan 09:00 to 12:00; …" for a week. */
function hoursSummary(view: View, lane: CalendarLane): string {
  const zone = view.timezone;
  const parts = view.days
    .map(day => ({ day, ws: clipToDay(day, lane.hours) }))
    .filter(x => x.ws.length > 0)
    .map(x => (view.days.length === 1 ? joinWindows(x.ws, zone) : `${dayHeading(x.day.date)} ${joinWindows(x.ws, zone)}`));
  return parts.join('; ');
}

function Mark({ tone }: { tone: Tone }) {
  // decorative: the words beside it say the same thing, so the state is never carried by the mark or its colour alone
  return <span className={styles.calMark} data-tone={tone} aria-hidden="true">{tone === 'ok' ? '✓' : tone === 'missing' ? '✕' : '–'}</span>;
}

/**
 * Three plain statements above the calendar, so nobody has to read the grid to learn why nothing can be booked: whether the OFFERING has hours, whether each
 * linked RESOURCE has hours, and, from those, whether there are bookable times and why not. It reads the view the API already returned and creates nothing:
 * the only action is a link to the hours screen of the resource, "Set hours" for a manager and "View hours" for everyone else.
 */
function Explainer({ kind, view, lanes, canManage }: { kind: 'offering' | 'resource'; view: View; lanes: CalendarLane[]; canManage: boolean }) {
  const offering = lanes.find(l => l.kind === 'offering') ?? null;
  const resources = lanes.filter(l => l.kind === 'resource');
  const hoursLink = (l: CalendarLane) => (
    <Link href={`/scheduling/resources/${seg(l.id)}/availability`} {...buttonProps('secondary', 'sm')} className={`${buttonProps('secondary', 'sm').className} ${styles.touch}`}>
      {canManage ? 'Set hours' : 'View hours'}
    </Link>
  );

  const resourceRow = (l: CalendarLane) => {
    const names = { [l.id]: l.name };
    if (l.state === 'open')
      return { tone: 'ok' as Tone, body: <><strong>{l.name} has hours:</strong> {hoursSummary(view, l) || 'none in this period'}.</>, link: false };
    if (l.state === 'inactive') return { tone: 'missing' as Tone, body: <><strong>{l.name} is inactive,</strong> so it is unavailable.</>, link: false };
    if (l.state === 'unsupported') return { tone: 'missing' as Tone, body: <><strong>{l.name}:</strong> {reasonText(`resource_unsupported_rule_kind:${l.id}`, names)}</>, link: true };
    return {
      tone: 'missing' as Tone,
      body: <><strong>{l.name} has no hours set,</strong> so it is unavailable, including when this offering needs it.</>,
      link: true,
    };
  };

  if (kind === 'resource') {
    const only = lanes[0];
    if (!only) return null;
    const row = resourceRow(only);
    return (
      <ul className={styles.calExplainer} data-testid="calendar-explainer" aria-label="About this calendar">
        <li data-testid={`explain-resource-${only.id}`} data-tone={row.tone}>
          <Mark tone={row.tone} />
          <span>{row.body}</span>
          {row.link && hoursLink(only)}
        </li>
      </ul>
    );
  }

  const offeringRow: { tone: Tone; body: ReactNode } = !offering
    ? { tone: 'none', body: <>No offering.</> }
    : offering.state === 'open'
      ? { tone: 'ok', body: <><strong>Offering hours are set:</strong> {hoursSummary(view, offering)}.</> }
      : offering.state === 'archived'
        ? { tone: 'missing', body: <><strong>This offering is archived,</strong> so it has no availability.</> }
        : offering.state === 'unsupported'
          ? { tone: 'missing', body: <><strong>This offering has a rule that is not supported yet,</strong> so it is unavailable.</> }
          : { tone: 'missing', body: <><strong>No offering hours are set</strong> in this period, so nothing can be booked.</> };

  const noResource = resources.filter(r => r.state !== 'open');
  const withHours = resources.filter(r => r.state === 'open');
  const nameList = (ls: CalendarLane[]) => ls.map(r => r.name).join(', ');
  let bookable: { tone: Tone; body: ReactNode };
  if (view.slots.length > 0) {
    bookable = { tone: 'ok', body: <><strong>{view.slots.length} bookable start time{view.slots.length === 1 ? '' : 's'}</strong> in this period.</> };
  } else if (offering && offering.state !== 'open') {
    bookable = { tone: 'none', body: <><strong>No bookable times:</strong> the offering itself is not available.</> };
  } else if (view.reasons.includes('no_duration')) {
    bookable = { tone: 'none', body: <><strong>No bookable times:</strong> this offering has no duration, so start times cannot be worked out.</> };
  } else if (resources.length > 0 && withHours.length === 0) {
    bookable = {
      tone: 'none',
      body: <><strong>No bookable times:</strong> this offering needs at least one linked resource with hours, and {nameList(noResource)} {noResource.length === 1 ? 'has' : 'have'} none that can be used.</>,
    };
  } else {
    bookable = { tone: 'none', body: <><strong>No bookable times</strong> in this period: the open time is shorter than a session, already held, or closed.</> };
  }

  return (
    <ul className={styles.calExplainer} data-testid="calendar-explainer" aria-label="Why there may be nothing to book">
      <li data-testid="explain-offering" data-tone={offeringRow.tone}>
        <Mark tone={offeringRow.tone} />
        <span>{offeringRow.body}</span>
      </li>
      {resources.map(l => {
        const row = resourceRow(l);
        return (
          <li key={l.id} data-testid={`explain-resource-${l.id}`} data-tone={row.tone}>
            <Mark tone={row.tone} />
            <span>{row.body}</span>
            {row.link && hoursLink(l)}
          </li>
        );
      })}
      <li data-testid="explain-bookable" data-tone={bookable.tone}>
        <Mark tone={bookable.tone} />
        <span>{bookable.body}</span>
      </li>
    </ul>
  );
}
