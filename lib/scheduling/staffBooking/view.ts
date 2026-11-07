// Phase 2C.3c UI slice 1: pure display helpers for the staff booking dialog. No server imports, no I/O, no clock.

const utc = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export const shiftDate = (date: string, days: number): string => new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);

/** "Mon 16 Nov": a local calendar date has no zone, so it is formatted as UTC and never shifted. */
export const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(utc(date))).replace(',', '');

/** "Monday 16 November 2026" for the summary. */
export const longDayLabel = (date: string): string =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(utc(date)));

export const timesText = (count: number): string => (count === 0 ? 'no times' : count === 1 ? '1 time' : `${count} times`);

/** The accessible name of a day button: "Mon 16 Nov, 8 times" / "Tue 17 Nov, no times". */
export const dayAccessibleName = (date: string, count: number): string => `${dayLabel(date)}, ${timesText(count)}`;

/** The wall-clock end ("HH:MM") of a start given as an instant and a length, in the offering's pinned zone (a daylight-saving change inside the booking is honoured). */
export function endClock(startsAt: string, durationMinutes: number, timezone: string): string {
  const end = new Date(Date.parse(startsAt) + durationMinutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).formatToParts(end);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** "Australia/Adelaide time" for display; the identifier is the pinned zone the API returned. */
export const zoneText = (timezone: string): string => `${timezone.replace(/_/g, ' ')} time`;

export function durationText(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${minutes} minutes`;
}

export function priceText(price: { amountCents: number; currency: string } | null): string {
  if (!price) return 'No price set';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: price.currency }).format(price.amountCents / 100);
  } catch {
    return `${(price.amountCents / 100).toFixed(2)} ${price.currency}`;
  }
}
