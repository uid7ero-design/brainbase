// Phase C7.5C — exact four-decimal commercial quantity arithmetic.
// NUMERIC(14,4)'s maximum scaled value is below Number.MAX_SAFE_INTEGER,
// so quantities can use branded safe integers without floating-point math.

export const QUANTITY_DECIMAL_PLACES = 4;
export const QUANTITY_SCALE = 10_000;
export const MAX_QUANTITY4_SCALED = 99_999_999_999_999;

declare const quantity4Brand: unique symbol;
export type Quantity4 = number & { readonly [quantity4Brand]: 'Quantity4' };

const QUANTITY_PATTERN = /^\d+(?:\.\d{1,4})?$/;

function parseQuantity4Base(input: string | number): Quantity4 {
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new Error('quantity must be a decimal with at most 4 decimal places');
  }
  const raw = typeof input === 'number' ? String(input) : input.trim();
  if (!QUANTITY_PATTERN.test(raw)) {
    throw new Error('quantity must be a decimal with at most 4 decimal places');
  }

  const [whole, fraction = ''] = raw.split('.');
  const scaled = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(4, '0') || '0');
  if (!Number.isSafeInteger(scaled) || scaled > MAX_QUANTITY4_SCALED) {
    throw new Error('quantity exceeds NUMERIC(14,4) range');
  }
  return scaled as Quantity4;
}

export function parseQuantity4(input: string | number): Quantity4 {
  const scaled = parseQuantity4Base(input);
  if (scaled <= 0) throw new Error('quantity must be greater than zero');
  return scaled;
}

export function parseQuantity4NonNegative(input: string | number): Quantity4 {
  return parseQuantity4Base(input);
}

export function integerQuantityToQuantity4(quantity: number): Quantity4 {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('ordered quantity must be a positive safe integer');
  }
  const scaled = quantity * QUANTITY_SCALE;
  if (!Number.isSafeInteger(scaled) || scaled > MAX_QUANTITY4_SCALED) {
    throw new Error('quantity exceeds NUMERIC(14,4) range');
  }
  return scaled as Quantity4;
}

export function quantity4ToDecimalString(quantity: Quantity4): string {
  const whole = Math.floor(quantity / QUANTITY_SCALE);
  const fraction = (quantity % QUANTITY_SCALE).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
}

export function formatQuantity4(quantity: Quantity4): string {
  const canonical = quantity4ToDecimalString(quantity);
  return canonical.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
}

export function quantity4ToDisplayNumber(quantity: Quantity4): number {
  return quantity / QUANTITY_SCALE;
}

export function compareQuantity4(a: Quantity4, b: Quantity4): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addQuantity4(...quantities: Quantity4[]): Quantity4 {
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
  if (!Number.isSafeInteger(total) || total > MAX_QUANTITY4_SCALED) {
    throw new Error('quantity exceeds NUMERIC(14,4) range');
  }
  return total as Quantity4;
}

export function subtractQuantity4(a: Quantity4, b: Quantity4): Quantity4 {
  if (b > a) throw new Error('quantity subtraction would be negative');
  return (a - b) as Quantity4;
}

export function remainingQuantity4(ordered: Quantity4, consumed: Quantity4): Quantity4 {
  return (consumed >= ordered ? 0 : ordered - consumed) as Quantity4;
}
