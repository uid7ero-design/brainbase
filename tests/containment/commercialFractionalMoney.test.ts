import { describe, expect, it } from 'vitest';
import {
  calculateFractionalLineTotals,
  divideRoundHalfUp,
  lineSubtotalForQuantityCents,
} from '@/lib/commercial/money';
import { parseQuantity4 } from '@/lib/commercial/quantity';

describe('C7.5C — HALF-UP integer division', () => {
  it.each([
    [0, 10000, 0],
    [4000, 10000, 0],
    [4999, 10000, 0],
    [5000, 10000, 1],
    [5001, 10000, 1],
    [9999, 10000, 1],
    [10000, 10000, 1],
    [14999, 10000, 1],
    [15000, 10000, 2],
    [15001, 10000, 2],
  ])('rounds %s / %s to %s', (numerator, denominator, expected) => {
    expect(divideRoundHalfUp(numerator, denominator)).toBe(expected);
  });

  it('rejects invalid denominator/numerator combinations', () => {
    expect(() => divideRoundHalfUp(-1, 10000)).toThrow();
    expect(() => divideRoundHalfUp(1, 0)).toThrow();
    expect(() => divideRoundHalfUp(1, -1)).toThrow();
  });
});

describe('C7.5C — fractional quantity subtotal arithmetic', () => {
  it.each([
    [1000, '6.5000', 6500],
    [1001, '6.5000', 6507],
    [1000, '0.0001', 0],
    [4999, '0.0001', 0],
    [5000, '0.0001', 1],
    [5001, '0.0001', 1],
    [1001, '0.0004', 0],
    [1001, '0.0005', 1],
    [1001, '0.0006', 1],
    [1, '0.5000', 1],
    [1, '1.5000', 2],
    [3, '0.5000', 2],
    [999, '1.2345', 1233],
    [1001, '1.2345', 1236],
    [12345, '2.7500', 33949],
    [0, '999.9999', 0],
  ])('%i cents × %s -> %i cents', (unitPriceCents, quantity, expected) => {
    expect(lineSubtotalForQuantityCents(unitPriceCents, parseQuantity4(quantity))).toBe(expected);
  });

  it('rejects invalid cents and persisted INTEGER overflow', () => {
    expect(() => lineSubtotalForQuantityCents(-1, parseQuantity4('1'))).toThrow();
    expect(() => lineSubtotalForQuantityCents(1.5, parseQuantity4('1'))).toThrow();
    expect(() => lineSubtotalForQuantityCents(2_147_483_647, parseQuantity4('2'))).toThrow(/INTEGER/);
  });
});

describe('C7.5C — fractional line totals with tax', () => {
  it('rounds subtotal before tax and tax from the persisted integer subtotal', () => {
    expect(calculateFractionalLineTotals({
      unitPriceCents: 1001,
      quantityScaled: parseQuantity4('6.5000'),
      taxRatePercent: 10,
    })).toEqual({
      lineSubtotalCents: 6507,
      lineTaxCents: 651,
      lineTotalCents: 7158,
    });
  });

  it('preserves whole-quantity behavior', () => {
    expect(calculateFractionalLineTotals({
      unitPriceCents: 10000,
      quantityScaled: parseQuantity4('1'),
      taxRatePercent: 10,
    })).toEqual({
      lineSubtotalCents: 10000,
      lineTaxCents: 1000,
      lineTotalCents: 11000,
    });
  });

  it('handles a minimum fractional quantity whose rounded subtotal is one cent', () => {
    expect(calculateFractionalLineTotals({
      unitPriceCents: 5000,
      quantityScaled: parseQuantity4('0.0001'),
      taxRatePercent: 10,
    })).toEqual({
      lineSubtotalCents: 1,
      lineTaxCents: 0,
      lineTotalCents: 1,
    });
  });
});
