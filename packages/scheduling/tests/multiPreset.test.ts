import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PRESETS,
  PRESET_KEYS,
  TERM_KEYS,
  clonePolicy,
  defaultScheduleConfig,
  isIanaTimezone,
  normaliseEmail,
  resolveScheduleTerminology,
  resolveScheduleTimezone,
  resolveTerminology,
  validateReservationAgainstSchedule,
  validateReservationSnapshot,
  validateScheduleConfig,
  validateSettings,
  type ScheduleConfig,
} from '../src';
import { ORG, reservation, schedule, settings } from './support/fixtures';

// One organisation runs several business lines. These tests prove two schedules
// with DIFFERENT presets coexist inside one tenant, and that nothing configured
// on one can reach the other, the presets themselves, or the organisation
// settings.

describe('two presets in one organisation', () => {
  const restaurant = (): ScheduleConfig => schedule('restaurant_tables', 'sch-restaurant', {
    name: 'Dining room',
    terminology: { customer: 'Diner', customerPlural: 'Diners' },
    timezone: 'Australia/Perth',
  });
  const classes = (): ScheduleConfig => schedule('classes_coaching', 'sch-classes', {
    name: 'Junior squad',
    terminology: { customer: 'Squad member', customerPlural: 'Squad' },
  });

  it('both are valid in the same tenant at the same time, each under its own preset and version', () => {
    const a = restaurant();
    const b = classes();
    expect(a.organisationId).toBe(b.organisationId);
    expect(a.organisationId).toBe(ORG);
    expect(validateScheduleConfig(a)).toEqual([]);
    expect(validateScheduleConfig(b)).toEqual([]);
    expect(a.presetKey).not.toBe(b.presetKey);
    expect(a.presetVersion).toBe(PRESETS.restaurant_tables.version);
    expect(b.presetVersion).toBe(PRESETS.classes_coaching.version);
  });

  it('wording is resolved per schedule: each sees its own overrides over its own preset, never the other\'s', () => {
    const a = resolveScheduleTerminology(restaurant());
    const b = resolveScheduleTerminology(classes());
    expect(a.customer).toBe('Diner');
    expect(b.customer).toBe('Squad member');
    expect(a.reservation).toBe(PRESETS.restaurant_tables.labels.reservation);
    expect(b.reservation).toBe(PRESETS.classes_coaching.labels.reservation);
    // an override on one never appears in the other, nor in an un-customised schedule of the same preset
    const plain = resolveScheduleTerminology(schedule('classes_coaching', 'sch-plain'));
    expect(plain.customer).toBe(PRESETS.classes_coaching.labels.customer);
    expect(Object.values(a)).not.toContain('Squad member');
    expect(Object.values(b)).not.toContain('Diner');
  });

  it('changing one schedule\'s policy, terminology or timezone leaves the other, the preset and the settings untouched', () => {
    const org = settings({ timezone: 'Australia/Adelaide' });
    const a = restaurant();
    const b = classes();
    const beforeB = JSON.stringify(b);
    const beforeOrg = JSON.stringify(org);
    const beforePresets = JSON.stringify(PRESETS);

    a.cancellationPolicy.lateCancellationCharge = { kind: 'percent', percent: 100 };
    a.cancellationPolicy.freeCancellationHoursBefore = 1;
    a.terminology.customer = 'Patron';
    a.timezone = 'Pacific/Auckland';

    expect(JSON.stringify(b)).toBe(beforeB);
    expect(JSON.stringify(org)).toBe(beforeOrg);
    expect(JSON.stringify(PRESETS)).toBe(beforePresets);
    expect(resolveScheduleTerminology(b).customer).toBe('Squad member');
    expect(resolveScheduleTimezone(b, org, 'Australia/Adelaide')).toBe('Australia/Adelaide');
  });

  it('schedules seeded from the SAME preset do not share nested objects (no aliasing)', () => {
    const x = defaultScheduleConfig({ id: 'x', organisationId: ORG, name: 'X', presetKey: 'resource_hire' });
    const y = defaultScheduleConfig({ id: 'y', organisationId: ORG, name: 'Y', presetKey: 'resource_hire' });
    expect(x.cancellationPolicy).toEqual(y.cancellationPolicy);
    expect(x.cancellationPolicy).not.toBe(y.cancellationPolicy);
    expect(x.cancellationPolicy.lateCancellationCharge).not.toBe(y.cancellationPolicy.lateCancellationCharge);
    expect(x.terminology).not.toBe(y.terminology);
    x.cancellationPolicy.lateCancellationCharge = { kind: 'fixed', amountCents: 9999 };
    expect(y.cancellationPolicy.lateCancellationCharge).toEqual(PRESETS.resource_hire.defaultCancellationPolicy.lateCancellationCharge);
  });

  it('presets are deeply frozen: a schedule cannot reach into one even by trying', () => {
    expect(Object.isFrozen(PRESETS.restaurant_tables.labels)).toBe(true);
    expect(Object.isFrozen(PRESETS.restaurant_tables.defaultCancellationPolicy)).toBe(true);
    expect(Object.isFrozen(PRESETS.restaurant_tables.defaultCancellationPolicy.lateCancellationCharge)).toBe(true);
    expect(Object.isFrozen(PRESETS.restaurant_tables.booking.requiredFields)).toBe(true);
    expect(() => { (PRESETS.restaurant_tables.labels as unknown as Record<string, string>).customer = 'x'; }).toThrow();
    expect(() => { (PRESETS.accommodation.defaultCancellationPolicy.lateCancellationCharge as { percent?: number }).percent = 1; }).toThrow();
    expect(() => { (PRESETS.event_capacity.outOfScope as string[]).push('anything'); }).toThrow();
    // a clone, by contrast, is freely mutable and independent
    const c = clonePolicy(PRESETS.accommodation.defaultCancellationPolicy);
    expect(() => { (c.lateCancellationCharge as { percent?: number }).percent = 1; }).not.toThrow();
    expect(PRESETS.accommodation.defaultCancellationPolicy.lateCancellationCharge).toEqual({ kind: 'percent', percent: 100 });
  });

  it('every preset can coexist with every other in one tenant', () => {
    const all = PRESET_KEYS.map(k => schedule(k, `sch-${k}`));
    for (const s of all) expect(validateScheduleConfig(s), s.presetKey).toEqual([]);
    expect(new Set(all.map(s => s.id)).size).toBe(PRESET_KEYS.length);
    // each resolves its own labels
    for (const s of all) expect(resolveScheduleTerminology(s)).toEqual(PRESETS[s.presetKey].labels);
  });

  it('a reservation is judged by the preset it was made under, per schedule, and cross-schedule use is rejected', () => {
    const a = restaurant();
    const b = classes();
    const table = reservation('restaurant_tables', a.id);
    const enrolment = reservation('classes_coaching', b.id);
    expect(validateReservationAgainstSchedule(table, a)).toEqual([]);
    expect(validateReservationAgainstSchedule(enrolment, b)).toEqual([]);
    // a table reservation presented to the classes schedule (and vice versa) is rejected
    expect(validateReservationAgainstSchedule(table, b)).not.toEqual([]);
    expect(validateReservationAgainstSchedule(enrolment, a)).not.toEqual([]);
    // a table booking carries a party and a table: it is not valid under the class preset's rules
    expect(validateReservationAgainstSchedule({ ...table, presetKey: 'classes_coaching' }, a)).not.toEqual([]);
  });

  it('a reservation from another tenant is rejected even when ids and preset match', () => {
    const a = restaurant();
    const foreign = reservation('restaurant_tables', a.id, { organisationId: 'org-2' });
    expect(validateReservationAgainstSchedule(foreign, a)).toEqual(expect.arrayContaining([expect.stringMatching(/different organisations/)]));
  });

  it('history survives configuration change: editing the schedule\'s current preset does not invalidate or reinterpret an existing reservation', () => {
    const a = restaurant();
    const old = reservation('restaurant_tables', a.id);
    // the schedule is later reconfigured (new terminology, tighter policy, another timezone)
    a.terminology = { reservation: 'Booking' };
    a.cancellationPolicy = clonePolicy({ customerCanCancel: false, freeCancellationHoursBefore: null, lateCancellationCharge: { kind: 'none' } });
    a.timezone = 'Pacific/Auckland';
    expect(validateReservationAgainstSchedule(old, a)).toEqual([]);
    expect(old.timezone).toBe('Australia/Adelaide'); // snapshot unchanged
    expect(old.presetKey).toBe('restaurant_tables');
  });

  it('the settings type carries no preset, wording or policy (those live only on a schedule)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/types.ts'), 'utf8');
    const block = src.slice(src.indexOf('export interface SchedulingSettings'), src.indexOf('/** One business line'));
    for (const word of ['presetKey', 'terminology', 'cancellationPolicy', 'presetVersion']) expect(block, word).not.toContain(word);
    expect(src).not.toContain('OrganisationSchedulingConfig');
    expect(Object.keys(settings()).sort()).toEqual(['currency', 'organisationId', 'timezone']);
  });

  it('terminology override keys are exactly the preset-independent TermLabels, so any preset accepts the same keys', () => {
    for (const k of PRESET_KEYS) expect(Object.keys(PRESETS[k].labels).sort()).toEqual([...TERM_KEYS].sort());
    expect(resolveTerminology('restaurant_tables', { customer: 'Diner' }).customer).toBe('Diner');
    expect(resolveTerminology('classes_coaching', { customer: 'Squad' }).customer).toBe('Squad');
  });
});

describe('timezone resolution', () => {
  it('schedule override wins, then the organisation default, then the host fallback', () => {
    const org = settings({ timezone: 'Australia/Darwin' });
    expect(resolveScheduleTimezone({ timezone: 'Pacific/Auckland' }, org, 'Australia/Adelaide')).toBe('Pacific/Auckland');
    expect(resolveScheduleTimezone({ timezone: null }, org, 'Australia/Adelaide')).toBe('Australia/Darwin');
    expect(resolveScheduleTimezone({ timezone: null }, settings({ timezone: null }), 'Australia/Adelaide')).toBe('Australia/Adelaide');
    expect(resolveScheduleTimezone({ timezone: null }, null, 'Australia/Adelaide')).toBe('Australia/Adelaide');
    expect(resolveScheduleTimezone({ timezone: null }, undefined, 'UTC')).toBe('UTC');
  });

  it('two schedules in one organisation resolve different zones without affecting each other', () => {
    const org = settings({ timezone: 'Australia/Adelaide' });
    const a = schedule('restaurant_tables', 'a', { timezone: 'Australia/Perth' });
    const b = schedule('classes_coaching', 'b');
    expect(resolveScheduleTimezone(a, org, 'UTC')).toBe('Australia/Perth');
    expect(resolveScheduleTimezone(b, org, 'UTC')).toBe('Australia/Adelaide');
  });

  it('isIanaTimezone accepts real zones and rejects everything else', () => {
    for (const ok of ['Australia/Adelaide', 'Australia/Perth', 'Pacific/Auckland', 'UTC', 'Europe/London']) expect(isIanaTimezone(ok), ok).toBe(true);
    for (const bad of ['', ' ', 'Adelaide', 'Mars/Olympus', 'Australia/Adelaide ', 5, null, undefined]) expect(isIanaTimezone(bad), String(bad)).toBe(false);
  });

  it('settings validation uses the same rule and allows "not configured"', () => {
    expect(validateSettings(settings({ timezone: null }))).toEqual([]);
    expect(validateSettings(settings({ timezone: 'Australia/Adelaide' }))).toEqual([]);
    expect(validateSettings(settings({ timezone: 'Nowhere/Land' }))).not.toEqual([]);
  });
});

describe('reservation snapshot semantics', () => {
  const s = schedule('classes_coaching', 'sch-1');

  it('normaliseEmail trims and lower-cases, and nothing else', () => {
    expect(normaliseEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
    expect(normaliseEmail('a+tag@x.com')).toBe('a+tag@x.com'); // no provider-specific rewriting
  });

  it('a valid reservation carries a consistent customer snapshot, a timezone and a UTC window', () => {
    expect(validateReservationSnapshot(reservation('classes_coaching', s.id))).toEqual([]);
  });

  it('the snapshot must agree with the normalisation rule (so matching is on email, never on a name)', () => {
    const r = reservation('classes_coaching', s.id);
    expect(validateReservationSnapshot({ ...r, customerSnapshot: { ...r.customerSnapshot, emailNormalised: 'someone-else@example.com' } })).not.toEqual([]);
    expect(validateReservationSnapshot({ ...r, customerSnapshot: { ...r.customerSnapshot, email: null, emailNormalised: null } })).toEqual([]);
    expect(validateReservationSnapshot({ ...r, customerSnapshot: { ...r.customerSnapshot, displayName: ' ' } })).not.toEqual([]);
  });

  it('a booking with no contact details is valid, with no customer link and a null normalised email', () => {
    const r = reservation('classes_coaching', s.id, {
      customerId: null,
      customerSnapshot: { displayName: 'Walk-in', email: null, emailNormalised: null, phone: null },
    });
    expect(validateReservationAgainstSchedule(r, s)).toEqual([]);
  });

  it('two different people with the same name are distinguished only by normalised email', () => {
    const a = reservation('classes_coaching', s.id, { id: 'a', customerSnapshot: { displayName: 'Sam Taylor', email: 'sam1@example.com', emailNormalised: 'sam1@example.com', phone: null } });
    const b = reservation('classes_coaching', s.id, { id: 'b', customerSnapshot: { displayName: 'Sam Taylor', email: 'sam2@example.com', emailNormalised: 'sam2@example.com', phone: null } });
    expect(a.customerSnapshot.displayName).toBe(b.customerSnapshot.displayName);
    expect(a.customerSnapshot.emailNormalised).not.toBe(b.customerSnapshot.emailNormalised);
  });

  it('the recorded timezone must be real and the UTC window must be well-formed and ordered', () => {
    const r = reservation('classes_coaching', s.id);
    expect(validateReservationSnapshot({ ...r, timezone: 'Adelaide' })).not.toEqual([]);
    expect(validateReservationSnapshot({ ...r, instants: { startsAt: '2026-11-02 05:30', endsAt: '2026-11-02T06:30:00Z' } })).not.toEqual([]);
    expect(validateReservationSnapshot({ ...r, instants: { startsAt: '2026-11-02T06:30:00Z', endsAt: '2026-11-02T05:30:00Z' } })).not.toEqual([]);
    expect(validateReservationSnapshot({ ...r, instants: { startsAt: '2026-11-02T05:30:00Z', endsAt: '2026-11-02T05:30:00Z' } })).not.toEqual([]);
  });

  it('the preset version on a reservation must be one the preset has had', () => {
    const r = reservation('classes_coaching', s.id);
    expect(validateReservationSnapshot({ ...r, presetVersion: 0 })).not.toEqual([]);
    expect(validateReservationSnapshot({ ...r, presetVersion: PRESETS.classes_coaching.version + 1 })).not.toEqual([]);
  });
});
