// Buyer-facing event date/time lines, rendered in the event's OWN stored IANA
// timezone (events.timezone) — never the server's zone (UTC on Vercel). Pure:
// no clock, no environment, no stored data is changed.
//
//   same local date   { kind: 'single', date: 'Saturday, 20 March 2027',
//                       time: '12:00 pm – 11:00 pm ACDT' }
//   different dates   { kind: 'span',
//     (overnight,        start: 'Saturday, 20 March 2027, 10:00 pm ACDT',
//      multi-day)        end:   'Sunday, 21 March 2027, 2:00 am ACDT' }
//   no usable end     { kind: 'single', date: ..., time: '12:00 pm ACDT' }
//
// The zone abbreviation comes from Intl for each instant, so daylight saving
// is handled by the platform's tz database: an event that crosses a DST
// change shows each end's own abbreviation ('12:30 am ACDT – 3:00 am ACST').
// An end that is missing, unparseable or not after the start is treated as
// "no end". An unusable timezone falls back to an explicitly labelled UTC
// rather than an unlabelled guess.

export type EventScheduleLines =
  | { kind: 'single'; date: string; time: string }
  | { kind: 'span'; start: string; end: string };

type Instant = string | Date | null | undefined;

const LOCALE = 'en-AU';

function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function usableZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

// Intl may separate "12:00" and "pm" with a narrow or non-breaking space
// depending on the ICU version; emails and tests want one plain space.
function plainSpaces(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

// 'Saturday, 20 March 2027'. Assembled from parts: en-AU's own long format
// drops the comma after the weekday.
function dateLine(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone,
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')} ${part('year')}`;
}

function timeOnly(d: Date, timeZone: string): string {
  return plainSpaces(new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone }).format(d)).toLowerCase();
}

function zoneName(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: 'short' })
    .formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? timeZone;
}

export function formatEventSchedule(startsAt: Instant, endsAt: Instant, timeZone: string | null | undefined): EventScheduleLines | null {
  const start = toDate(startsAt);
  if (!start) return null;
  const zone = usableZone(timeZone);
  const startDate = dateLine(start, zone);
  const startTime = timeOnly(start, zone);
  const startZone = zoneName(start, zone);

  const end = toDate(endsAt);
  if (!end || end.getTime() <= start.getTime()) {
    return { kind: 'single', date: startDate, time: `${startTime} ${startZone}` };
  }

  const endDate = dateLine(end, zone);
  const endTime = timeOnly(end, zone);
  const endZone = zoneName(end, zone);
  if (startDate !== endDate) {
    return { kind: 'span', start: `${startDate}, ${startTime} ${startZone}`, end: `${endDate}, ${endTime} ${endZone}` };
  }
  const time = startZone === endZone
    ? `${startTime} – ${endTime} ${endZone}`
    : `${startTime} ${startZone} – ${endTime} ${endZone}`;
  return { kind: 'single', date: startDate, time };
}

// The same schedule as one line, for a label/value row or a subject:
//   'Saturday, 20 March 2027, 12:00 pm – 11:00 pm ACDT'
//   'Saturday, 20 March 2027, 10:00 pm ACDT – Sunday, 21 March 2027, 2:00 am ACDT'
//   'Saturday, 20 March 2027, 12:00 pm ACDT'   (no usable end)
export function formatEventScheduleLine(startsAt: Instant, endsAt: Instant, timeZone: string | null | undefined): string | null {
  const s = formatEventSchedule(startsAt, endsAt, timeZone);
  if (!s) return null;
  return s.kind === 'single' ? `${s.date}, ${s.time}` : `${s.start} – ${s.end}`;
}
