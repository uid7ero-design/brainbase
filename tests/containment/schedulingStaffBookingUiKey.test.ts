import { describe, expect, it } from 'vitest';
import { BOOKING_KEY_PATTERN, createBookingKeyHolder, newBookingKey } from '@/lib/scheduling/staffBooking/key';
import { dayAccessibleName, durationText, endClock, priceText, shiftDate } from '@/lib/scheduling/staffBooking/view';

// Phase 2C.3c UI slice 1: the in-memory idempotency key and the display helpers (pure).

const content = { offeringId: 'off-1', resourceId: 'court-1', date: '2027-01-11', time: '10:00' };

describe('the booking key', () => {
  it('has the design format: bk_ + 32 hex characters (35 characters, inside the API’s 16-80 [A-Za-z0-9_-])', () => {
    for (let i = 0; i < 50; i += 1) {
      const key = newBookingKey();
      expect(key).toMatch(BOOKING_KEY_PATTERN);
      expect(key).toHaveLength(35);
      expect(key).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    }
  });

  it('is the SAME key for the same content however often it is asked for, and a new key only for different content', () => {
    let n = 0;
    const holder = createBookingKeyHolder(() => `0000000${++n}-0000-0000-0000-000000000000`);
    const first = holder.keyFor(content);
    for (let i = 0; i < 20; i += 1) expect(holder.keyFor({ ...content })).toBe(first);
    expect(n).toBe(1); // exactly one key was ever generated
    const other = holder.keyFor({ ...content, time: '11:00' });
    expect(other).not.toBe(first);
    expect(n).toBe(2);
    expect(holder.keyFor({ ...content, time: '11:00' })).toBe(other);
  });

  it('returning to an earlier content after a change makes a fresh key (one key per content run), never reusing a stale one for different content', () => {
    const holder = createBookingKeyHolder();
    const a = holder.keyFor(content);
    const b = holder.keyFor({ ...content, resourceId: 'court-2' });
    expect(b).not.toBe(a);
    expect(holder.keyFor({ ...content, resourceId: 'court-2' })).toBe(b);
  });

  it('exposes no way to rotate: current() never creates, and only an explicit discard() forgets the key', () => {
    const holder = createBookingKeyHolder();
    expect(holder.current()).toBeNull();
    expect(Object.keys(holder).sort()).toEqual(['current', 'discard', 'keyFor']);
    const key = holder.keyFor(content);
    expect(holder.current()).toBe(key);
    expect(holder.current()).toBe(key);
    holder.discard();
    expect(holder.current()).toBeNull();
    expect(holder.keyFor(content)).not.toBe(key);
  });
});

describe('display helpers', () => {
  it('names a day for a screen reader with its count, and "no times" for an empty day', () => {
    expect(dayAccessibleName('2026-11-16', 8)).toBe('Mon 16 Nov, 8 times');
    expect(dayAccessibleName('2026-11-17', 0)).toBe('Tue 17 Nov, no times');
    expect(dayAccessibleName('2026-11-18', 1)).toBe('Wed 18 Nov, 1 time');
  });
  it('shifts local dates without a zone', () => {
    expect(shiftDate('2027-01-11', 13)).toBe('2027-01-24');
    expect(shiftDate('2027-03-01', -1)).toBe('2027-02-28');
  });
  it('computes the end in the pinned zone, honouring a daylight-saving change inside the booking', () => {
    // Adelaide clocks go back at 03:00 on 2027-04-04; 01:30 plus 60 real minutes is still before the change.
    expect(endClock('2027-04-03T15:00:00Z', 60, 'Australia/Adelaide')).toBe('02:30');
    expect(endClock('2027-01-10T23:30:00Z', 60, 'Australia/Adelaide')).toBe('11:00');
  });
  it('states durations and prices plainly', () => {
    expect(durationText(60)).toBe('1 hour');
    expect(durationText(120)).toBe('2 hours');
    expect(durationText(90)).toBe('90 minutes');
    expect(priceText({ amountCents: 5000, currency: 'AUD' })).toMatch(/50\.00/);
    expect(priceText(null)).toBe('No price set');
  });
});
