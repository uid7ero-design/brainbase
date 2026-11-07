import { describe, expect, it } from 'vitest';
import { parseReceipt } from '@/lib/tennisBusiness/receiptInput';

const receipt = { id: '10000000-0000-4000-8000-000000000001', date: '2024-02-29', amount: '24.95',
  merchant: ' Shop ', description: ' Tennis balls ', reference: '' };
const parse = (changes: Partial<typeof receipt>) => parseReceipt({ ...receipt, ...changes }, '2026-11-07');

describe('paid receipt validation', () => {
  it.each([['0.01', 1], ['12.3', 1230], ['21474836.47', 2147483647]] as const)('reads exact AUD cents for %s', (amount, cents) => {
    expect(parse({ amount })).toMatchObject({ cents, merchant: 'Shop', description: 'Tennis balls', reference: null });
  });
  it.each(['0', '-1', '1e2', '0.001', '21474836.48', 'NaN'])('rejects invalid receipt amount %s', amount => {
    expect(() => parse({ amount })).toThrow();
  });
  it.each([{ date: '2025-02-29' }, { date: '2026-11-08' }, { merchant: ' ' }, { description: '' }, { id: 'invalid' }])('rejects invalid receipt fields', fields => {
    expect(() => parse(fields)).toThrow();
  });
});
