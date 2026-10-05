// Data Hub 6.2D4D1A (final review remediation) — overflow-safe integer
// arithmetic for counts/lengths.
//
// Every count/length the profiler emits is a plain JS `number` (the public
// v1 contract stays that way), but a `number` can only represent an
// integer EXACTLY up to Number.MAX_SAFE_INTEGER (2^53-1). Arithmetic that
// could silently exceed that boundary (rowCount * columnCount, summing a
// length/count across many cells, etc.) is done here via BigInt — which
// has no such ceiling — and the BigInt result is checked against the
// boundary BEFORE ever being narrowed back to a `number`. Exceeding it
// fails closed ({ok:false}) rather than silently losing precision or
// (for a literal array allocation sized by an attacker/caller-controlled
// count) throwing a raw RangeError.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function isSafeNonNegativeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

export type SafeIntResult = { ok: true; value: number } | { ok: false };

export function safeMultiply(a: number, b: number): SafeIntResult {
  const product = BigInt(a) * BigInt(b);
  if (product > MAX_SAFE) return { ok: false };
  return { ok: true, value: Number(product) };
}

export function safeSubtractNonNegative(a: number, b: number): SafeIntResult {
  const diff = BigInt(a) - BigInt(b);
  if (diff < BigInt(0) || diff > MAX_SAFE) return { ok: false };
  return { ok: true, value: Number(diff) };
}

/**
 * Accumulates non-negative integers one at a time via BigInt, failing
 * closed (via `.result()`) the instant the running total would exceed
 * Number.MAX_SAFE_INTEGER — never silently wrapping/losing precision, and
 * never throwing.
 */
export class SafeAccumulator {
  private total = BigInt(0);
  private overflowed = false;

  add(n: number): void {
    if (this.overflowed) return;
    this.total += BigInt(n);
    if (this.total > MAX_SAFE) this.overflowed = true;
  }

  result(): SafeIntResult {
    if (this.overflowed) return { ok: false };
    return { ok: true, value: Number(this.total) };
  }
}

export function safeSum(values: readonly number[]): SafeIntResult {
  const acc = new SafeAccumulator();
  for (const v of values) acc.add(v);
  return acc.result();
}
