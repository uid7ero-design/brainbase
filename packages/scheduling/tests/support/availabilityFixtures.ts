import type { AvailabilityRule } from '../../src';

/** A valid weekly rule for org-1; each test overrides what it cares about. */
export const rule = (id: string, extra: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
  id,
  organisationId: 'org-1',
  resourceId: null,
  offeringId: 'off-1',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '17:00',
  validFrom: null,
  validTo: null,
  ...extra,
});
