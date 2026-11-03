// Exact money values for the Founder OS client overview.
//
// Client-safe (no server-only imports): used by lib/founder/clientOverview.ts
// on the server and by app/admin/founder/page.tsx for display.
//
// Every amount travels as a validated, non-negative decimal STRING from SQL
// (aggregates are computed as NUMERIC and cast ::text, so they can never
// overflow BIGINT) through the JSON response to the UI. Arithmetic uses
// BigInt; formatting reuses lib/commercial/money.ts's exact formatter. A
// value that is missing, malformed, negative, fractional (for cents) or an
// imprecise JS number returns null — callers must surface that, never
// substitute zero.

import { formatMoneyCentsExact, isValidCurrencyCode } from '@/lib/commercial/money';

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const CENTS_RE = /^\d+$/;
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

function normaliseDigits(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * Integer minor units (cents). Accepts a digit string, a bigint, or a JS
 * number only when it is a non-negative SAFE integer (an unsafe number has
 * already lost precision, so it is rejected rather than trusted).
 */
export function parseCentsString(v: unknown): string | null {
  if (typeof v === 'bigint') return v >= ZERO ? v.toString() : null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v === 'string') {
    const s = v.trim();
    return CENTS_RE.test(s) ? normaliseDigits(s) : null;
  }
  return null;
}

/**
 * Non-negative NUMERIC dollar value (e.g. managed_services.monthly_value)
 * converted to exact integer cents. More than two fractional digits is
 * accepted only when the extra digits are zero; anything else is malformed.
 */
export function parseDollarsToCents(v: unknown): string | null {
  let s: string;
  if (typeof v === 'string') s = v.trim();
  else if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.abs(v) <= Number.MAX_SAFE_INTEGER / 100) s = String(v);
  else if (typeof v === 'bigint') s = v.toString();
  else return null;
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (frac.length > 2 && /[^0]/.test(frac.slice(2))) return null;
  const minor = (frac + '00').slice(0, 2);
  return (BigInt(whole) * HUNDRED + BigInt(minor)).toString();
}

/** Non-negative NUMERIC value kept as its exact normalised decimal string. */
export function parseDecimalString(v: unknown): string | null {
  let s: string;
  if (typeof v === 'string') s = v.trim();
  else if (typeof v === 'bigint') s = v.toString();
  else if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) s = String(v);
  else return null;
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return normaliseDigits(m[1]) + (frac ? `.${frac}` : '');
}

export function addCents(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function isPositiveCents(cents: string): boolean {
  return BigInt(cents) > ZERO;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Exact display of integer cents. A valid ISO currency uses the shared
 * Commercial formatter; `null` means the source records no currency, so the
 * amount is shown with a plain "$" (as the rest of Founder OS does for
 * managed-service values) and the caller labels it.
 */
export function formatCents(cents: string, currency: string | null): string {
  if (currency && isValidCurrencyCode(currency)) {
    try {
      return formatMoneyCentsExact(cents, currency);
    } catch {
      // Unknown-to-Intl currency code — fall through to the plain form.
    }
  }
  const value = BigInt(cents);
  const major = groupDigits((value / HUNDRED).toString());
  const minor = (value % HUNDRED).toString().padStart(2, '0');
  return currency ? `${currency} ${major}.${minor}` : `$${major}.${minor}`;
}

/** Exact display of a non-negative decimal string, e.g. "$1,234.50". */
export function formatDecimalDollars(decimal: string): string {
  const [whole, frac] = decimal.split('.');
  return `$${groupDigits(whole)}${frac ? `.${frac.padEnd(2, '0')}` : ''}`;
}
