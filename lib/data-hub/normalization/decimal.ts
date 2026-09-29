// Data Hub 6.2D4C-B2A — exact decimal arithmetic and unit conversion.
//
// Every value here is represented as sign + BigInt digits + scale (number of
// fractional digits), never as a JS `number`. This is deliberate: JS numbers
// are IEEE-754 doubles and cannot represent most decimal fractions exactly
// (0.1 + 0.2 !== 0.3), so any arithmetic on governed numeric values —
// especially unit conversion — must use exact integer (BigInt) arithmetic
// throughout, never floating point.
//
// Note: this repository's tsconfig targets ES2017, which does not support
// BigInt literal syntax (`0n`) at the type-checker level even though Node
// itself supports BigInt at any target — so every BigInt constant here is
// built via `BigInt(...)`, never a literal suffix.

import type { Unit } from "../schemaProfiles/profileDocument";

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_FIVE = BigInt(5);
const BIG_TEN = BigInt(10);

function bigIntPow(base: bigint, exponent: number): bigint {
  let result = BIG_ONE;
  for (let i = 0; i < exponent; i++) result *= base;
  return result;
}

/** value = (negative ? -1 : 1) * digits / 10^scale. digits is always >= 0. */
export interface ExactDecimal {
  negative: boolean;
  digits: bigint;
  scale: number;
}

// Grammar: optional leading '-', one or more digits, optionally '.' followed
// by one or more digits. No leading '+', no thousands separators, no
// currency/percent symbols, no whitespace, no scientific notation.
const STRICT_DECIMAL_RE = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
const STRICT_INTEGER_RE = /^(-?)([0-9]+)$/;

export function parseStrictDecimalString(raw: string): ExactDecimal | null {
  const m = STRICT_DECIMAL_RE.exec(raw);
  if (!m) return null;
  const [, signStr, intDigits, fracDigits = ""] = m;
  const digits = BigInt(intDigits + fracDigits || "0");
  return normalizeExactDecimal({ negative: signStr === "-", digits, scale: fracDigits.length });
}

export function parseStrictIntegerString(raw: string): ExactDecimal | null {
  const m = STRICT_INTEGER_RE.exec(raw);
  if (!m) return null;
  const [, signStr, intDigits] = m;
  return normalizeExactDecimal({ negative: signStr === "-", digits: BigInt(intDigits), scale: 0 });
}

/**
 * A raw JS NUMBER's shortest round-trip decimal representation, reformatted
 * without exponent notation, and without inventing any precision beyond
 * what `Number.prototype.toString()` already committed to. Rejects
 * NaN/Infinity/-Infinity outright (non-finite is never "safe/truthful").
 */
export function exactDecimalFromFiniteNumber(n: number): ExactDecimal | null {
  if (!Number.isFinite(n)) return null;
  const raw = n.toString();
  if (!raw.includes("e") && !raw.includes("E")) {
    return parseStrictDecimalString(raw);
  }
  // Expand exponential notation (e.g. "1.5e+21", "5e-7") into a plain
  // decimal string via exact digit-shifting — no floating point involved,
  // this only ever moves the position of the decimal point.
  const expMatch = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(raw);
  if (!expMatch) return null;
  const [, signStr, intDigits, fracDigits = "", expStr] = expMatch;
  const exp = Number(expStr);
  const allDigits = intDigits + fracDigits;
  const pointPos = intDigits.length + exp; // position of the decimal point within allDigits, from the left
  let digitsStr: string;
  let scale: number;
  if (pointPos <= 0) {
    digitsStr = "0".repeat(-pointPos) + allDigits;
    scale = digitsStr.length;
  } else if (pointPos >= allDigits.length) {
    digitsStr = allDigits + "0".repeat(pointPos - allDigits.length);
    scale = 0;
  } else {
    digitsStr = allDigits;
    scale = allDigits.length - pointPos;
  }
  return normalizeExactDecimal({ negative: signStr === "-", digits: BigInt(digitsStr || "0"), scale });
}

export function normalizeExactDecimal(d: ExactDecimal): ExactDecimal {
  let { negative, digits, scale } = d;
  while (scale > 0 && digits % BIG_TEN === BIG_ZERO) {
    digits /= BIG_TEN;
    scale -= 1;
  }
  if (digits === BIG_ZERO) negative = false; // no "-0"
  return { negative, digits, scale };
}

export function isIntegerValued(d: ExactDecimal): boolean {
  return normalizeExactDecimal(d).scale === 0;
}

/** Canonical plain-decimal string: no exponent, no leading '+', no leading zeros, no "-0", trailing fractional zeros stripped. */
export function decimalToCanonicalString(d: ExactDecimal): string {
  const nd = normalizeExactDecimal(d);
  const digitsStr = nd.digits.toString(); // BigInt#toString never has leading zeros
  const sign = nd.negative ? "-" : "";
  if (nd.scale === 0) return `${sign}${digitsStr}`;
  if (digitsStr.length <= nd.scale) {
    return `${sign}0.${digitsStr.padStart(nd.scale, "0")}`;
  }
  const intPart = digitsStr.slice(0, digitsStr.length - nd.scale);
  const fracPart = digitsStr.slice(digitsStr.length - nd.scale);
  return `${sign}${intPart}.${fracPart}`;
}

export function compareExactDecimal(a: ExactDecimal, b: ExactDecimal): -1 | 0 | 1 {
  // Compare exactly via a common scale, using BigInt only.
  const scale = Math.max(a.scale, b.scale);
  const av = (a.negative ? -BIG_ONE : BIG_ONE) * a.digits * bigIntPow(BIG_TEN, scale - a.scale);
  const bv = (b.negative ? -BIG_ONE : BIG_ONE) * b.digits * bigIntPow(BIG_TEN, scale - b.scale);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

type UnitFamily = "MASS" | "LENGTH" | "DURATION" | "PERCENTAGE" | "CURRENCY";

// "1 <unit> = num base-units" (den is always 1 for this vocabulary — every
// conversion factor here is a plain positive integer). Base unit per family:
// kg (MASS), m (LENGTH), s (DURATION), "%" (PERCENTAGE, trivial identity),
// AUD (CURRENCY, trivial identity — no FX conversion exists in this phase).
const UNIT_TO_BASE_FACTOR: Record<Unit, bigint> = {
  kg: BigInt(1),
  t: BigInt(1000),
  m: BigInt(1),
  km: BigInt(1000),
  s: BigInt(1),
  min: BigInt(60),
  h: BigInt(3600),
  "%": BigInt(1),
  AUD: BigInt(1),
};

const UNIT_FAMILY: Record<Unit, UnitFamily> = {
  kg: "MASS",
  t: "MASS",
  m: "LENGTH",
  km: "LENGTH",
  s: "DURATION",
  min: "DURATION",
  h: "DURATION",
  "%": "PERCENTAGE",
  AUD: "CURRENCY",
};

function bigIntGcd(a: bigint, b: bigint): bigint {
  a = a < BIG_ZERO ? -a : a;
  b = b < BIG_ZERO ? -b : b;
  while (b !== BIG_ZERO) {
    [a, b] = [b, a % b];
  }
  return a;
}

export type UnitConversionResult = { ok: true; value: ExactDecimal } | { ok: false; nonTerminating: true };

/**
 * Converts `value` (already in `sourceUnit`) to `normalizedUnit`, exactly.
 * Both units must belong to the same family (the caller — the D4C-A parser
 * — already guarantees this at the rule level; this function re-asserts it
 * defensively via an exception rather than a silent no-op).
 *
 * If the exact result has a terminating base-10 decimal expansion, returns
 * it. If not (e.g. 1 s -> min = 1/60, which repeats forever), returns
 * { ok: false } — the caller must surface NON_TERMINATING_UNIT_CONVERSION
 * rather than silently rounding.
 */
export function convertExactUnit(value: ExactDecimal, sourceUnit: Unit, normalizedUnit: Unit): UnitConversionResult {
  if (UNIT_FAMILY[sourceUnit] !== UNIT_FAMILY[normalizedUnit]) {
    throw new Error("convertExactUnit: sourceUnit/normalizedUnit must be the same family");
  }
  if (sourceUnit === normalizedUnit) return { ok: true, value: normalizeExactDecimal(value) };

  const sourceFactor = UNIT_TO_BASE_FACTOR[sourceUnit];
  const targetFactor = UNIT_TO_BASE_FACTOR[normalizedUnit];

  // result = value * sourceFactor / targetFactor
  //        = (sign * digits / 10^scale) * sourceFactor / targetFactor
  const signedDigits = (value.negative ? -BIG_ONE : BIG_ONE) * value.digits;
  let numerator = signedDigits * sourceFactor;
  let denominator = bigIntPow(BIG_TEN, value.scale) * targetFactor;

  const g = bigIntGcd(numerator, denominator);
  if (g !== BIG_ZERO) {
    numerator /= g;
    denominator /= g;
  }
  if (denominator < BIG_ZERO) {
    numerator = -numerator;
    denominator = -denominator;
  }

  // A reduced fraction terminates in base 10 iff its denominator's only
  // prime factors are 2 and 5. Strip those factors; anything left over
  // means the decimal expansion is infinite/repeating.
  let d = denominator;
  let twos = 0;
  let fives = 0;
  while (d % BIG_TWO === BIG_ZERO) {
    d /= BIG_TWO;
    twos += 1;
  }
  while (d % BIG_FIVE === BIG_ZERO) {
    d /= BIG_FIVE;
    fives += 1;
  }
  if (d !== BIG_ONE) {
    return { ok: false, nonTerminating: true };
  }

  const shift = Math.max(twos, fives);
  const numeratorScaled = numerator * bigIntPow(BIG_TWO, shift - twos) * bigIntPow(BIG_FIVE, shift - fives);
  const negative = numeratorScaled < BIG_ZERO;
  const digits = negative ? -numeratorScaled : numeratorScaled;
  return { ok: true, value: normalizeExactDecimal({ negative, digits, scale: shift }) };
}
