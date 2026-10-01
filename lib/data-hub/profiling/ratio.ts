// Data Hub 6.2D4D1A — deterministic ratio/mean formatting.
//
// Every ratio or mean in a profile is rendered as a canonical decimal
// STRING, computed with BigInt integer division only — never
// Number()/parseFloat, never a floating-point division. A non-terminating
// ratio (e.g. 1/3) is TRUNCATED (never rounded) to RATIO_DECIMAL_PLACES
// fractional digits; an exact ratio (e.g. 1/2) strips back down to its own
// true length ("0.5", not "0.5000000000") via the same trailing-zero
// normalization lib/data-hub/normalization/decimal.ts already uses. A
// denominator of 0 returns null — this is never silently reported as "0",
// which would misrepresent an empty population as a real measured ratio.

import { type ExactDecimal, decimalToCanonicalString, normalizeExactDecimal } from "../normalization/decimal";

export const RATIO_DECIMAL_PLACES = 10;

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TEN = BigInt(10);

function bigIntPow10(exponent: number): bigint {
  let result = BIG_ONE;
  for (let i = 0; i < exponent; i++) result *= BIG_TEN;
  return result;
}

/**
 * Exact numerator/denominator as a canonical decimal string, truncated to
 * `decimalPlaces` fractional digits. numerator/denominator are both plain
 * non-negative counts in every current caller (row/cell counts) — a
 * negative denominator is rejected defensively since it can never be a
 * legitimate count.
 */
export function exactCountRatioString(numerator: number, denominator: number, decimalPlaces: number = RATIO_DECIMAL_PLACES): string | null {
  if (denominator <= 0) return null;
  if (numerator < 0) return null;
  const scaledNumerator = BigInt(numerator) * bigIntPow10(decimalPlaces);
  const digits = scaledNumerator / BigInt(denominator); // truncating (floor) integer division — both operands non-negative
  return decimalToCanonicalString(normalizeExactDecimal({ negative: false, digits, scale: decimalPlaces }));
}

/**
 * Exact sum (an ExactDecimal, as produced by aggregateExactDecimalStrings)
 * divided by `count`, as a canonical decimal string. Precision is
 * extended `extraDecimalPlaces` digits beyond sum's own scale, then
 * trailing zeros are stripped — so an exact quotient (e.g. 10/2 = 5) comes
 * back as "5", never "5.0000000000". Returns null when count <= 0.
 */
export function exactDecimalMeanString(sum: ExactDecimal, count: number, extraDecimalPlaces: number = RATIO_DECIMAL_PLACES): string | null {
  if (count <= 0) return null;
  const resultScale = sum.scale + extraDecimalPlaces;
  const scaledMagnitude = sum.digits * bigIntPow10(extraDecimalPlaces); // sum.digits is always >= 0 by ExactDecimal's own invariant
  const quotientDigits = scaledMagnitude / BigInt(count); // truncating integer division, non-negative / positive
  const negative = sum.negative && quotientDigits !== BIG_ZERO;
  return decimalToCanonicalString(normalizeExactDecimal({ negative, digits: quotientDigits, scale: resultScale }));
}
