import { describe, it, expect } from 'vitest'
import { sumCents, lineTotalCents, applyRatePercentCents, isValidRatePercent, isValidCents, isValidCurrencyCode } from '@/lib/commercial/money'

// Phase C2 — lib/commercial/money.ts, applying ADR-0002. Every value in
// and out of these functions is a whole-cent integer — never a float
// dollar amount at any point.

describe('Phase C2 — sumCents', () => {
  it('sums a list of integer cents exactly', () => {
    expect(sumCents([100, 250, 50])).toBe(400)
  })
  it('empty list sums to 0', () => {
    expect(sumCents([])).toBe(0)
  })
})

describe('Phase C2 — lineTotalCents (exact integer multiplication)', () => {
  it('unit price * quantity, no floating point involved', () => {
    expect(lineTotalCents(1999, 3)).toBe(5997)
  })
  it('zero quantity produces zero, not an error', () => {
    expect(lineTotalCents(500, 0)).toBe(0)
  })
})

describe('Phase C2 — applyRatePercentCents (rounds half-up to the nearest whole cent, per ADR-0002 §8)', () => {
  it('a clean percentage produces an exact result', () => {
    expect(applyRatePercentCents(10000, 10)).toBe(1000) // 10% of $100.00 = $10.00
  })
  it('a fractional-cent result rounds half-up', () => {
    expect(applyRatePercentCents(101, 50)).toBe(51) // 50% of $1.01 = 50.5c -> 51c
  })
  it('never returns a non-integer', () => {
    const result = applyRatePercentCents(333, 33)
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('Phase C2 — isValidRatePercent (ADR-0002 NUMERIC(5,2) shape: 0.00-100.00, at most 2 decimals)', () => {
  it('accepts valid rates', () => {
    expect(isValidRatePercent(10)).toBe(true)
    expect(isValidRatePercent(0)).toBe(true)
    expect(isValidRatePercent(100)).toBe(true)
    expect(isValidRatePercent(7.5)).toBe(true)
    expect(isValidRatePercent(12.34)).toBe(true)
  })
  it('rejects out-of-range and malformed rates', () => {
    expect(isValidRatePercent(-1)).toBe(false)
    expect(isValidRatePercent(100.01)).toBe(false)
    expect(isValidRatePercent(101)).toBe(false)
    expect(isValidRatePercent(NaN)).toBe(false)
    expect(isValidRatePercent(Infinity)).toBe(false)
    expect(isValidRatePercent(12.345)).toBe(false) // 3 decimal places
  })
})

describe('Phase C2 — isValidCents (ADR-0002: non-negative integer, never a float)', () => {
  it('accepts non-negative integers', () => {
    expect(isValidCents(0)).toBe(true)
    expect(isValidCents(12345)).toBe(true)
  })
  it('rejects negative values, floats, and non-finite numbers', () => {
    expect(isValidCents(-1)).toBe(false)
    expect(isValidCents(12.5)).toBe(false)
    expect(isValidCents(NaN)).toBe(false)
    expect(isValidCents(Infinity)).toBe(false)
  })
})

describe('Phase C2 — isValidCurrencyCode (ISO 4217 three-letter shape)', () => {
  it('accepts a plausible three-letter uppercase code', () => {
    expect(isValidCurrencyCode('AUD')).toBe(true)
    expect(isValidCurrencyCode('USD')).toBe(true)
  })
  it('rejects lowercase, wrong length, or non-letter input', () => {
    expect(isValidCurrencyCode('aud')).toBe(false)
    expect(isValidCurrencyCode('AU')).toBe(false)
    expect(isValidCurrencyCode('AUDD')).toBe(false)
    expect(isValidCurrencyCode('12D')).toBe(false)
  })
})
