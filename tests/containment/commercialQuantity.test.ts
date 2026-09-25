import { describe, expect, it } from 'vitest';
import {
  addQuantity4,
  compareQuantity4,
  formatQuantity4,
  integerQuantityToQuantity4,
  parseQuantity4,
  quantity4ToDecimalString,
} from '@/lib/commercial/quantity';

const q = (value: string) => parseQuantity4(value);

describe('C7.5C — Quantity4 parsing', () => {
  it.each([
    ['1', 10000],
    ['1.0000', 10000],
    ['6.5', 65000],
    ['2.75', 27500],
    ['0.125', 1250],
    ['0.0001', 1],
    ['123.4567', 1234567],
  ])('parses %s exactly', (input, expected) => {
    expect(parseQuantity4(input)).toBe(expected);
  });

  it('accepts backwards-compatible finite number input', () => {
    expect(parseQuantity4(6.5)).toBe(65000);
  });

  it.each(['', ' ', '0', '-1', '-0.0001', '1.23456', 'abc', '1.2x', '1e-4'])(
    'rejects invalid quantity %p',
    input => expect(() => parseQuantity4(input)).toThrow(),
  );

  it('rejects NaN and Infinity', () => {
    expect(() => parseQuantity4(Number.NaN)).toThrow();
    expect(() => parseQuantity4(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('accepts the NUMERIC(14,4) maximum and rejects one unit above its integer range', () => {
    expect(parseQuantity4('9999999999.9999')).toBe(99999999999999);
    expect(() => parseQuantity4('10000000000.0000')).toThrow(/NUMERIC/);
  });
});

describe('C7.5C — Quantity4 serialization', () => {
  it.each([
    ['1', '1.0000', '1'],
    ['6.5', '6.5000', '6.5'],
    ['2.75', '2.7500', '2.75'],
    ['0.125', '0.1250', '0.125'],
    ['0.0001', '0.0001', '0.0001'],
  ])('serializes %s canonically', (input, db, display) => {
    const parsed = q(input);
    expect(quantity4ToDecimalString(parsed)).toBe(db);
    expect(formatQuantity4(parsed)).toBe(display);
    expect(parseQuantity4(quantity4ToDecimalString(parsed))).toBe(parsed);
  });
});

describe('C7.5C — Quantity4 arithmetic', () => {
  it('adds and compares four-decimal quantities exactly', () => {
    expect(addQuantity4(q('6.5'), q('2.5'))).toBe(q('9'));
    expect(addQuantity4(q('0.0001'), q('0.0001'))).toBe(q('0.0002'));
    expect(compareQuantity4(q('10'), q('10'))).toBe(0);
    expect(compareQuantity4(q('9.9999'), q('10'))).toBe(-1);
    expect(compareQuantity4(q('10.0001'), q('10'))).toBe(1);
  });

  it('converts integer PO quantities exactly and rejects non-integers', () => {
    expect(integerQuantityToQuantity4(1)).toBe(q('1'));
    expect(integerQuantityToQuantity4(10)).toBe(q('10'));
    expect(() => integerQuantityToQuantity4(0)).toThrow();
    expect(() => integerQuantityToQuantity4(-1)).toThrow();
    expect(() => integerQuantityToQuantity4(1.5)).toThrow();
  });
});
