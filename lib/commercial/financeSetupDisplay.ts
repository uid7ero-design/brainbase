// Browser-facing conversions keep money exact and dates free of timezone shifts.
const MAX_CENTS = BigInt('9223372036854775807');

export function budgetAmountToCents(value: string): string {
  const input = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input)) {
    throw new Error('Enter an amount such as 6408.00, with at most two decimal places.');
  }
  const [whole, fraction = ''] = input.replaceAll(',', '').split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (cents > MAX_CENTS) throw new Error('Amount is outside the supported range.');
  return cents.toString();
}

export function budgetCentsToAmount(cents: string): string {
  const value = BigInt(cents);
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

export function formatBudgetAmount(cents: string, currency: string): string {
  const value = BigInt(cents);
  const whole = (value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % BigInt(100)).toString().padStart(2, '0');
  return `${currency} ${whole}.${fraction}`;
}

export function australianDateToIso(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error('Enter a valid date in DD/MM/YYYY format.');
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number(year) < 1 || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error('Enter a valid date in DD/MM/YYYY format.');
  }
  return iso;
}

export function formatAustralianDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Validate API calendar text without normalising impossible dates or shifting timezones. */
export function isFinanceCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return australianDateToIso(formatAustralianDate(value)) === value; }
  catch { return false; }
}

export function isFinanceAuditTimestamp(value: unknown): value is string {
  return typeof value === 'string' && isFinanceCalendarDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && !Number.isNaN(new Date(value).getTime());
}

/** Audit instants retain the viewer's timezone and use Australian day-first notation. */
export function formatAustralianTimestamp(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '—';
  return instant.toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZoneName: 'short',
  });
}
