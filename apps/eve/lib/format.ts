// Display formatting. Money arrives as integer cents; dates as ISO strings
// together with the event's own IANA timezone, which is what they are shown in.

export function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function safeZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: safeZone(timeZone), timeZoneName: 'short',
  }).format(d);
}

function formatTime(d: Date, zone: string | undefined): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(d);
}

function zoneName(d: Date, zone: string | undefined): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? '';
}

// Start–end in the event's zone. Same local date: one date and a time range
// ("Sat, 20 Mar 2027, 12:00 pm – 11:00 pm ACDT"). Different local dates
// (overnight, multi-day): both dates. The zone name is shown on both ends only
// when it differs (a DST change inside the event). No usable end, or an end
// not after the start: the start alone, exactly as formatDateTime.
export function formatDateTimeRange(startIso: string | null | undefined, endIso: string | null | undefined, timeZone?: string | null): string {
  const startText = formatDateTime(startIso, timeZone);
  if (!startText || !endIso) return startText;
  const start = new Date(startIso as string);
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return startText;
  const zone = safeZone(timeZone);
  const startZone = zoneName(start, zone);
  const endZone = zoneName(end, zone);
  const startDate = formatDate(startIso, timeZone);
  const endDate = formatDate(endIso, timeZone);
  const startPart = `${formatTime(start, zone)}${startZone === endZone ? '' : ` ${startZone}`}`;
  const endPart = `${formatTime(end, zone)} ${endZone}`;
  return startDate === endDate
    ? `${startDate}, ${startPart} – ${endPart}`
    : `${startDate}, ${startPart} – ${endDate}, ${endPart}`;
}

export function formatDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: safeZone(timeZone) }).format(d);
}
