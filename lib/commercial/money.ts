// Phase C2 — shared integer-minor-units money helpers, applying ADR-0002
// (docs/architecture/decisions/0002-money-and-currency-standard.md).
// These exist because the exact same three calculations (line-item
// total, tax-from-rate rounding, multi-line sum) will otherwise be
// reimplemented independently by every future Quotes/Invoicing/
// Purchasing/Expenses/Budgeting line-item calculation — reducing
// duplication is the ADR's own stated bar for adding a shared helper
// (§6 of the C2 brief), not a speculative "might be useful" addition.
//
// Every function here operates ONLY on integers (cents) — never a
// float dollar amount at any intermediate step, per ADR-0002 §13's
// non-negotiable rule. There is no "Money" class/object wrapper:
// a plain `{ amount_cents: number; currency: string }` shape is used
// only where a currency must travel alongside an amount; most functions
// take/return bare integers, since currency mixing is a row-level
// modelling concern (ADR-0002 §4), not something this arithmetic layer
// enforces.

export interface Money {
  amount_cents: number;
  currency: string;
}

// Sums integer cents. Never accepts/produces a float — every argument
// and the result are whole-cent integers.
export function sumCents(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

// unit_price_cents * quantity — exact integer arithmetic (multiplying two
// integers can never introduce fractional-cent error the way a float
// dollar multiplication could).
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error('numerator must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('denominator must be a positive safe integer');
  }
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

// Applies a NUMERIC(5,2) percentage rate (0.00-100.00, matching
// ADR-0002 §5/§6's tax/discount-rate precision) to an integer cents
// amount, rounding HALF-UP to the nearest whole cent — per ADR-0002 §8's
// explicit rounding rule. This is the one place in this module where a
// float necessarily appears as an INTERMEDIATE value (JS has no
// fixed-point decimal type) — the float is never persisted or returned;
// only the final rounded integer is.
export function applyRatePercentCents(amountCents: number, ratePercent: number): number {
  return Math.round(amountCents * (ratePercent / 100));
}

// True if `rate` is a valid ADR-0002 NUMERIC(5,2) tax/discount rate
// (0.00-100.00 inclusive, at most 2 decimal places).
export function isValidRatePercent(rate: number): boolean {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return false;
  return Math.round(rate * 100) === rate * 100;
}

// True if `cents` is a valid persisted *_cents value per ADR-0002: a
// non-negative integer, never a float, never NaN/Infinity.
export function isValidCents(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 0;
}

export function lineSubtotalForQuantityCents(
  unitPriceCents: number,
  quantityScaled: number,
  quantityScale = 10_000,
): number {
  if (!isValidCents(unitPriceCents)) {
    throw new Error('unitPriceCents must be a non-negative integer');
  }
  if (!Number.isSafeInteger(quantityScaled) || quantityScaled <= 0) {
    throw new Error('quantity must be a positive scaled safe integer');
  }
  if (!Number.isSafeInteger(quantityScale) || quantityScale <= 0) {
    throw new Error('quantityScale must be a positive safe integer');
  }
  if (unitPriceCents === 0) return 0;

  // Any value that could round into the PostgreSQL INTEGER range has a
  // numerator below ~2.15e13 at scale 10,000, safely under MAX_SAFE_INTEGER.
  const maximumUsefulNumerator = POSTGRES_INTEGER_MAX * quantityScale + quantityScale;
  if (quantityScaled > Math.floor(maximumUsefulNumerator / unitPriceCents)) {
    throw new Error('calculated subtotal exceeds PostgreSQL INTEGER range');
  }
  const numerator = unitPriceCents * quantityScaled;
  const rounded = divideRoundHalfUp(numerator, quantityScale);
  if (rounded > POSTGRES_INTEGER_MAX) {
    throw new Error('calculated subtotal exceeds PostgreSQL INTEGER range');
  }
  return rounded;
}

export function calculateFractionalLineTotals(params: {
  unitPriceCents: number;
  quantityScaled: number;
  taxRatePercent: number;
}): { lineSubtotalCents: number; lineTaxCents: number; lineTotalCents: number } {
  const lineSubtotalCents = lineSubtotalForQuantityCents(params.unitPriceCents, params.quantityScaled);
  const lineTaxCents = applyRatePercentCents(lineSubtotalCents, params.taxRatePercent);
  const lineTotalCents = lineSubtotalCents + lineTaxCents;
  if (lineTotalCents > POSTGRES_INTEGER_MAX) {
    throw new Error('calculated line total exceeds PostgreSQL INTEGER range');
  }
  return { lineSubtotalCents, lineTaxCents, lineTotalCents };
}

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

// True if `currency` is a plausible ISO 4217 three-letter code shape
// (ADR-0002 §4) — a format check only, not a lookup against the real
// ISO 4217 list (no such list exists anywhere in this codebase yet, and
// adding one is out of scope for this foundation phase).
export function isValidCurrencyCode(currency: string): boolean {
  return ISO_4217_PATTERN.test(currency);
}

// Phase C3 — display-only formatting (never used for arithmetic or
// persistence — every calculation stays on integer cents throughout).
// Matches the exact Intl.NumberFormat('en-AU', { style: 'currency', ... })
// convention already established independently by
// app/events/[id]/EventDetailClient.tsx, RegistrationsPanel.tsx, and
// app/admin/client-events/ClientEventsClient.tsx — reused here rather
// than inventing a second money-display convention for Commercial.
export function formatMoneyCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}
