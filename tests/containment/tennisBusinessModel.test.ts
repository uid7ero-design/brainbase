import { describe, it, expect } from 'vitest';
import { businessPeriod, currentBusinessMonth, exactCents } from '@/lib/tennisBusiness/model';
import { coachingEndpoint } from '@/lib/tennisBusiness/coachingFetch';
import { managedRequestAllowed } from '@/lib/organisationUsers/policy';
describe('Tennis business scope and exact values', () => {
  it('uses Adelaide month boundaries including the UTC month change', () => {
    expect(currentBusinessMonth(new Date('2026-11-30T14:00:00Z'))).toBe('2026-12');
    expect(businessPeriod('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
  it.each(['2026-00', '2026-13', '1999-12', '2026-1', '2026-11-01', '2026-11&organisation=b'])('refuses unsupported month %s', month => expect(() => businessPeriod(month)).toThrow());
  it('never rounds monetary readback through a JavaScript number', () => {
    expect(exactCents('900719925474099399')).toBe('900719925474099399');
    for (const value of [1, null, '1.5', '-1', 'unknown']) expect(() => exactCents(value)).toThrow();
  });
  it('keeps legacy addresses unchanged outside the dedicated compatibility page', () => {
    expect(coachingEndpoint('/api/dashboard/sessions?x=1', false)).toBe('/api/dashboard/sessions?x=1');
    expect(coachingEndpoint('/api/dashboard/sessions/one', true)).toBe('/api/business/tennis/coaching/sessions/one');
    expect(coachingEndpoint('/api/bookings-old', true)).toBe('/api/bookings-old');
    expect(coachingEndpoint('https://other.invalid/api/bookings', true)).toBe('https://other.invalid/api/bookings');
  });
  it('allows only a current managed module grant at the business entry, not an unknown namespace', () => {
    expect(managedRequestAllowed({ invoicing: 'view' }, '/api/business/tennis', 'GET', 'viewer')).toBe(true);
    expect(managedRequestAllowed({ invoicing: 'view' }, '/api/business/tennis', 'POST', 'viewer')).toBe(false);
    expect(managedRequestAllowed({ organiser: 'use' }, '/api/business/tennis', 'GET', 'admin')).toBe(false);
    expect(managedRequestAllowed({ crm: 'use' }, '/api/business/other', 'GET', 'admin')).toBe(false);
  });
});
