// Data Hub 6.2D4D1A — exact decimal helpers for the profiling engine.
//
// Reuses D4C-B2A's own exact-decimal machinery (lib/data-hub/normalization/
// decimal.ts) verbatim for parsing/comparing/formatting a single canonical
// decimal value — this file is NOT a second type system, it only adds the
// AGGREGATE operations (min/max-over-a-set, exact sum) that module doesn't
// need for its own (per-value) purpose. Every operation here uses BigInt
// integer arithmetic exclusively — never Number()/parseFloat, never
// floating point, matching this repository's existing decimal discipline.

import {
  type ExactDecimal,
  parseStrictDecimalString,
  compareExactDecimal,
  decimalToCanonicalString,
  normalizeExactDecimal,
} from "../normalization/decimal";

export type { ExactDecimal };
export { parseStrictDecimalString, compareExactDecimal, decimalToCanonicalString, normalizeExactDecimal };

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TEN = BigInt(10);

function bigIntPow10(exponent: number): bigint {
  let result = BIG_ONE;
  for (let i = 0; i < exponent; i++) result *= BIG_TEN;
  return result;
}

function signedMagnitude(d: ExactDecimal): bigint {
  return d.negative ? -d.digits : d.digits;
}

/** Exact a + b at whichever common scale is needed — never floating point. */
export function addExactDecimal(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  const av = signedMagnitude(a) * bigIntPow10(scale - a.scale);
  const bv = signedMagnitude(b) * bigIntPow10(scale - b.scale);
  const sum = av + bv;
  const negative = sum < BIG_ZERO;
  const digits = negative ? -sum : sum;
  return normalizeExactDecimal({ negative, digits, scale });
}

export const ZERO_EXACT_DECIMAL: ExactDecimal = { negative: false, digits: BIG_ZERO, scale: 0 };

export type DecimalAggregateResult =
  | { ok: true; min: ExactDecimal; max: ExactDecimal; sum: ExactDecimal }
  | { ok: false };

/**
 * Parses every canonical decimal string once and returns the exact min,
 * max, and sum over the set — in a single O(n) pass, using only BigInt
 * arithmetic. Returns {ok:false} if ANY string fails to parse as a strict
 * canonical decimal (fail closed; the caller never falls back to a partial
 * result for malformed input).
 */
export function aggregateExactDecimalStrings(canonicalStrings: readonly string[]): DecimalAggregateResult {
  if (canonicalStrings.length === 0) return { ok: false };
  let min: ExactDecimal | null = null;
  let max: ExactDecimal | null = null;
  let sum: ExactDecimal = ZERO_EXACT_DECIMAL;
  for (const raw of canonicalStrings) {
    const parsed = parseStrictDecimalString(raw);
    if (!parsed) return { ok: false };
    if (min === null || compareExactDecimal(parsed, min) < 0) min = parsed;
    if (max === null || compareExactDecimal(parsed, max) > 0) max = parsed;
    sum = addExactDecimal(sum, parsed);
  }
  return { ok: true, min: min as ExactDecimal, max: max as ExactDecimal, sum };
}

export function isWholeExactDecimal(d: ExactDecimal): boolean {
  return normalizeExactDecimal(d).scale === 0;
}
