export const MAX_REMITTANCE_CENTS = 2147483647;
export function parseRemittanceAmount(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Use an amount with at most two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (cents <= BigInt(0) || cents > BigInt(MAX_REMITTANCE_CENTS)) throw new Error('Payment amount is outside the supported range.');
  return Number(cents);
}
