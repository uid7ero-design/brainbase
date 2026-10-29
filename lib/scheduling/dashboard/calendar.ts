import type { CalendarDay, CalendarLane, CalendarView, FreeSlot, InstantWindow } from '@scheduling/core';

// Phase 2B.3d — what the availability calendar screen needs from a calendar response, as PURE functions (no React, no server imports):
// dates, wall-clock labels in a named zone, and where a window sits inside a local day. The server decides what is open, closed, free and
// held (the shared engine); this file only formats and positions it. A day's length is its TRUE length (23, 25 hours on a daylight-saving
// change), so positions are fractions of that day, never "minutes since midnight".

/** The calendar API's answer for an offering or a resource: the shared view model plus who it is for and the zone it is drawn in. */
export type CalendarResponse = Omit<CalendarView, 'ok'> & {
  zone: { value: string; pinned: boolean; source: 'first_rule' | 'first_closure' | 'backfill' | null };
  offering?: { id: string; name: string; scheduleId: string; durationMinutes: number | null; archived: boolean };
  resource?: { id: string; name: string; kind: string; active: boolean };
};

export type CalendarMode = 'day' | 'week';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MINUTE = 60_000;

// ── Dates ─────────────────────────────────────────────────────────────────

const utcOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (date: string, days: number): string => new Date(utcOf(date) + days * 86_400_000).toISOString().slice(0, 10);
export const weekday = (date: string): number => new Date(utcOf(date)).getUTCDay();
/** The Monday of the week containing `date` (the week starts on Monday). */
export const weekStart = (date: string): string => addDays(date, -((weekday(date) + 6) % 7));

export function rangeFor(mode: CalendarMode, date: string): { from: string; to: string } {
  if (mode === 'day') return { from: date, to: date };
  const from = weekStart(date);
  return { from, to: addDays(from, 6) };
}
export const stepDate = (mode: CalendarMode, date: string, direction: -1 | 1): string => addDays(mode === 'day' ? date : weekStart(date), direction * (mode === 'day' ? 1 : 7));

export const isDate = (v: string | null | undefined): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(utcOf(v)).toISOString().slice(0, 10) === v;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1, day: Number(date.slice(8, 10)) });

/** 'Mon 11 Jan'. A calendar date is named from its own digits (no Intl, so the wording never changes with the browser's locale data and no timezone can shift it). */
export function dayHeading(date: string): string {
  const p = parts(date);
  return `${DAY_NAMES[weekday(date)]} ${p.day} ${MONTHS[p.month]}`;
}
export function longDate(date: string): string {
  const p = parts(date);
  return `${LONG_DAYS[weekday(date)]} ${p.day} ${LONG_MONTHS[p.month]} ${p.year}`;
}
export function rangeHeading(from: string, to: string): string {
  if (from === to) return longDate(from);
  const f = parts(from);
  const t = parts(to);
  return `${f.day} ${MONTHS[f.month]} to ${t.day} ${MONTHS[t.month]} ${t.year}`;
}

// ── Wall-clock labels in a zone ───────────────────────────────────────────

/** 'UTC+10:30' / 'UTC-3' / 'UTC' for an offset in minutes. */
export function offsetText(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** The wall-clock time of an instant in a zone, 24-hour: '09:00'. */
export function clockAt(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}

/** '09:00 to 12:00'. A window ending at local midnight reads '24:00', so 'until midnight' is never '00:00'. */
export function windowText(w: InstantWindow, zone: string): string {
  const start = clockAt(w.startsAt, zone);
  const end = clockAt(w.endsAt, zone);
  return `${start} to ${end === '00:00' && w.endsAt > w.startsAt ? '24:00' : end}`;
}

export function utcOffsetAt(instant: string, zone: string): number {
  const raw = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(instant)).find(p => p.type === 'timeZoneName')?.value ?? '';
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** 'Australia/Adelaide (UTC+10:30)' at a given instant, so daylight saving is visible. */
export function describeZoneAt(zone: string, instant: string): string {
  return `${zone} (${offsetText(utcOffsetAt(instant, zone))})`;
}

// ── Days ──────────────────────────────────────────────────────────────────

/** A note for a day that is not 24 hours long, or null. */
export function dayNote(day: Pick<CalendarDay, 'minutes'>): string | null {
  if (day.minutes === 1440) return null;
  const hours = day.minutes / 60;
  const label = Number.isInteger(hours) ? `${hours}-hour` : `${day.minutes}-minute`;
  return day.minutes < 1440 ? `${label} day: the clocks go forward` : `${label} day: the clocks go back`;
}

/** The part of `windows` inside one day, as instants. */
export function clipToDay<T extends InstantWindow>(day: Pick<CalendarDay, 'startsAt' | 'endsAt'>, windows: readonly T[]): T[] {
  const s = Date.parse(day.startsAt);
  const e = Date.parse(day.endsAt);
  const out: T[] = [];
  for (const w of windows) {
    const ws = Math.max(s, Date.parse(w.startsAt));
    const we = Math.min(e, Date.parse(w.endsAt));
    if (we > ws) out.push({ ...w, startsAt: new Date(ws).toISOString().replace('.000Z', 'Z'), endsAt: new Date(we).toISOString().replace('.000Z', 'Z') });
  }
  return out;
}

/** Where an instant window sits in a day, as percentages of the day's TRUE length. */
export function place(day: Pick<CalendarDay, 'startsAt' | 'endsAt'>, w: InstantWindow): { top: number; height: number } {
  const s = Date.parse(day.startsAt);
  const total = Date.parse(day.endsAt) - s;
  return { top: ((Date.parse(w.startsAt) - s) / total) * 100, height: ((Date.parse(w.endsAt) - Date.parse(w.startsAt)) / total) * 100 };
}

export const slotsInDay = (day: Pick<CalendarDay, 'startsAt' | 'endsAt'>, slots: readonly FreeSlot[], resourceId?: string | null): FreeSlot[] =>
  slots.filter(s => (resourceId === undefined || s.resourceId === resourceId) && Date.parse(s.startsAt) >= Date.parse(day.startsAt) && Date.parse(s.startsAt) < Date.parse(day.endsAt));

/** The height of a day column in pixels: its true length at a fixed scale, so a 23-hour day is visibly shorter. */
export const PX_PER_MINUTE = 0.6;
export const columnHeight = (day: Pick<CalendarDay, 'minutes'>): number => Math.round(day.minutes * PX_PER_MINUTE);

// ── Words ─────────────────────────────────────────────────────────────────

const REASONS: Record<string, string> = {
  offering_archived: 'This is archived, so it has no availability.',
  no_offering_availability: 'No hours are saved for this offering in this period, so nothing is available.',
  no_duration: 'This offering has no duration, so bookable times cannot be worked out.',
  no_resource_availability: 'This resource has no hours in this period, so it is unavailable.',
  unsupported_rule_kind: 'This offering has an hours rule of a kind that is not supported yet (a “service period”), so it is unavailable until that rule is removed or changed to ordinary hours.',
};

export function reasonText(reason: string, names: Record<string, string>): string {
  const [code, id] = reason.split(':');
  if (code === 'resource_inactive') return `${names[id] ?? 'A resource'} is inactive, so it takes no availability.`;
  if (code === 'resource_unsupported_rule_kind') return `${names[id] ?? 'A resource'} has an hours rule of a kind that is not supported yet (a “service period”), so it is unavailable until that rule is removed or changed to ordinary hours.`;
  if (code === 'resource_no_availability') return `${names[id] ?? 'A resource'} has no hours in this period, so it is unavailable.`;
  return REASONS[reason] ?? '';
}

export const laneStateText = (lane: Pick<CalendarLane, 'state' | 'kind'>): string =>
  lane.state === 'open' ? 'Open' : lane.state === 'inactive' ? 'Inactive' : lane.state === 'archived' ? 'Archived' : lane.state === 'unsupported' ? 'Unavailable' : 'No hours';

export const KIND_TEXT = { hours: 'Open', closed: 'Closed', free: 'Free', occupied: 'Held', slot: 'Bookable' } as const;
export type BlockKind = keyof typeof KIND_TEXT;

export { MINUTE };
