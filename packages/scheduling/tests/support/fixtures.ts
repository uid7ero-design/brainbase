import type { PresetKey, Reservation, ScheduleConfig, SchedulingSettings, TimeSpan } from '../../src';
import { PRESETS, defaultScheduleConfig, defaultSettings } from '../../src';

// Shared builders for the package tests. They produce VALID records so each test
// states only what it varies.

export const ORG = 'org-1';

export function settings(over: Partial<SchedulingSettings> = {}): SchedulingSettings {
  return { ...defaultSettings({ organisationId: ORG, currency: 'AUD' }), ...over };
}

export function schedule(presetKey: PresetKey, id: string, over: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return { ...defaultScheduleConfig({ id, organisationId: ORG, name: `${presetKey} schedule`, presetKey }), ...over };
}

const SPANS: Record<PresetKey, { span: TimeSpan; resourceId: string | null; partySize: number; window: { startsAt: string; endsAt: string } }> = {
  classes_coaching: { span: { kind: 'occurrence', occurrenceId: 'occ-1' }, resourceId: null, partySize: 1, window: { startsAt: '2026-11-02T05:30:00Z', endsAt: '2026-11-02T06:30:00Z' } },
  appointments: { span: { kind: 'slot', date: '2026-11-02', startTime: '10:00', durationMinutes: 30 }, resourceId: 'prov-1', partySize: 1, window: { startsAt: '2026-11-01T23:30:00Z', endsAt: '2026-11-02T00:00:00Z' } },
  restaurant_tables: { span: { kind: 'slot', date: '2026-11-02', startTime: '18:30', durationMinutes: 90 }, resourceId: 'table-1', partySize: 4, window: { startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-02T09:30:00Z' } },
  accommodation: { span: { kind: 'stay', checkIn: '2026-11-02', checkOut: '2026-11-04' }, resourceId: 'room-1', partySize: 2, window: { startsAt: '2026-11-02T03:30:00Z', endsAt: '2026-11-03T23:30:00Z' } },
  resource_hire: { span: { kind: 'slot', date: '2026-11-02', startTime: '17:00', durationMinutes: 60 }, resourceId: 'court-1', partySize: 1, window: { startsAt: '2026-11-02T06:00:00Z', endsAt: '2026-11-02T07:00:00Z' } },
  event_capacity: { span: { kind: 'occurrence', occurrenceId: 'occ-9' }, resourceId: null, partySize: 1, window: { startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-02T09:00:00Z' } },
};

export function reservation(presetKey: PresetKey, scheduleId: string, over: Partial<Reservation> = {}): Reservation {
  const s = SPANS[presetKey];
  return {
    id: `res-${presetKey}`,
    organisationId: ORG,
    scheduleId,
    presetKey,
    presetVersion: PRESETS[presetKey].version,
    offeringId: `off-${presetKey}`,
    resourceId: s.resourceId,
    customerId: 'cust-1',
    customerSnapshot: { displayName: 'Sam Taylor', email: 'Sam@Example.com', emailNormalised: 'sam@example.com', phone: null },
    timezone: 'Australia/Adelaide',
    instants: s.window,
    participants: [],
    partySize: s.partySize,
    span: s.span,
    status: 'confirmed',
    attendance: null,
    paymentStatus: 'unpaid',
    price: { amountCents: 0, currency: 'AUD' },
    seriesId: null,
    notes: null,
    ...over,
  };
}
