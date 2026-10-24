import { describe, it, expect } from 'vitest';
import { validateExpectedUpdatedAt, validateOfferingForPreset, validateOfferingPatch, validateResourcePatch, validateSchedulePatch, type OfferingPatch, type ResourcePatch, type PresetKey, type SchedulePatch } from '../src';

// Phase 2B.2a: the pure rules behind configuration edits. Every rule has a positive case and a negative one.

describe('version token (expectedUpdatedAt)', () => {
  it.each(['2026-11-01T00:00:00Z', '2026-11-01T00:00:00.123Z', '2026-11-01T00:00:00.123456Z'])('accepts a UTC instant: %s', value => {
    expect(validateExpectedUpdatedAt(value)).toEqual([]);
  });
  it.each(['', 'yesterday', '2026-11-01', '2026-11-01T00:00:00+10:00', '2026-11-01T00:00:00.1234567Z', '2026-13-45T00:00:00Z', null, undefined, 42, {}])('rejects %s before any SQL is built', value => {
    expect(validateExpectedUpdatedAt(value)).toHaveLength(1);
  });
});

describe('schedule patch', () => {
  const ok = (p: SchedulePatch) => expect(validateSchedulePatch(p)).toEqual([]);
  const bad = (p: unknown, re: RegExp) => expect(validateSchedulePatch(p as SchedulePatch).join(' | ')).toMatch(re);

  it('accepts each editable field on its own', () => {
    ok({ name: 'Junior coaching' });
    ok({ terminology: { offering: 'Lesson' } });
    ok({ cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } } });
    ok({ timezone: 'Australia/Perth' });
    ok({ timezone: null });
    ok({ presetKey: 'appointments' });
  });

  it('refuses an empty patch', () => bad({}, /nothing to change/));
  it('refuses fields that are not editable (organisation, id, slug, archive state, version)', () => {
    for (const k of ['organisationId', 'id', 'publicSlug', 'archivedAt', 'presetVersion', 'updatedAt']) bad({ name: 'x', [k]: 'y' }, new RegExp(`${k} cannot be edited`));
  });
  it('refuses a blank name', () => {
    bad({ name: '' }, /name is required/);
    bad({ name: '   ' }, /name is required/);
  });
  it('refuses unknown terminology keys and non-text values', () => {
    bad({ terminology: { nonsense: 'x' } }, /unknown terminology key: nonsense/);
    bad({ terminology: { offering: 7 } }, /terminology offering must be text/);
    bad({ terminology: ['a'] }, /terminology must be an object/);
    bad({ terminology: null }, /terminology must be an object/);
  });
  it('refuses an invalid cancellation policy', () => {
    bad({ cancellationPolicy: { customerCanCancel: false, freeCancellationHoursBefore: null, lateCancellationCharge: { kind: 'percent', percent: 50 } } }, /meaningless/);
    bad({ cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: -1, lateCancellationCharge: { kind: 'none' } } }, /freeCancellationHoursBefore/);
  });
  it('refuses an invalid timezone and an unknown preset', () => {
    bad({ timezone: 'Mars/Olympus' }, /valid IANA timezone/);
    bad({ presetKey: 'spa_day' }, /unknown preset: spa_day/);
  });
});

describe('offering patch', () => {
  const ok = (p: OfferingPatch, preset: PresetKey = 'classes_coaching') => expect(validateOfferingPatch(p, preset)).toEqual([]);
  const bad = (p: unknown, re: RegExp, preset: PresetKey = 'classes_coaching') => expect(validateOfferingPatch(p as OfferingPatch, preset).join(' | ')).toMatch(re);

  it('accepts each editable field', () => {
    ok({ name: 'Tuesday juniors' });
    ok({ typeKey: null, colourKey: 'blue' });
    ok({ durationMinutes: 45, capacity: 12, priceCents: 2500 });
    ok({ startTime: '16:30' });
    ok({ recurrence: { kind: 'weekly', dayOfWeek: 2, startDate: '2026-11-03', end: { mode: 'ongoing' } } });
    ok({ recurrence: { kind: 'none' } });
  });
  it('refuses an empty patch and fields that are not editable (schedule, currency, organisation, archive, resource kinds)', () => {
    bad({}, /nothing to change/);
    for (const k of ['scheduleId', 'currency', 'organisationId', 'archivedAt', 'resourceKinds', 'price', 'updatedAt']) bad({ name: 'x', [k]: 'y' }, new RegExp(`${k} cannot be edited`));
  });
  it('refuses a blank name, a non-positive duration or capacity, a negative or fractional price, a malformed start time', () => {
    bad({ name: ' ' }, /name is required/);
    bad({ durationMinutes: 0 }, /durationMinutes/);
    bad({ capacity: -2 }, /capacity must be a positive integer/);
    bad({ priceCents: -1 }, /price must be a non-negative integer/);
    bad({ priceCents: 10.5 }, /price must be a non-negative integer/);
    bad({ startTime: '25:00' }, /startTime must be HH:MM/);
  });
  it('allows clearing capacity and duration with null where the preset lets a resource decide', () => ok({ capacity: null, durationMinutes: null }, 'appointments'));
  it('refuses a duration on a date-range (accommodation) offering', () => bad({ durationMinutes: 60 }, /no duration/, 'accommodation'));
  it('refuses a recurrence the preset does not allow, and an end mode it does not allow', () => {
    bad({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'ongoing' } } }, /does not allow weekly recurrence/, 'restaurant_tables');
  });
  it('refuses a malformed recurrence and a weekly recurrence with its start time cleared in the same edit', () => {
    bad({ recurrence: { kind: 'weekly', dayOfWeek: 9, startDate: null, end: { mode: 'ongoing' } } }, /dayOfWeek/);
    bad({ recurrence: { kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'ongoing' } }, startTime: null }, /needs a startTime/);
  });
});

describe('resource patch', () => {
  const ok = (p: ResourcePatch) => expect(validateResourcePatch(p)).toEqual([]);
  const bad = (p: unknown, re: RegExp) => expect(validateResourcePatch(p as ResourcePatch).join(' | ')).toMatch(re);

  it('accepts each editable field', () => {
    ok({ name: 'Court 2' });
    ok({ kind: 'room' });
    ok({ capacity: 6, minParty: 2 });
    ok({ minParty: null });
    ok({ active: false });
  });
  it('refuses an empty patch and fields that are not editable', () => {
    bad({}, /nothing to change/);
    for (const k of ['organisationId', 'id', 'updatedAt', 'createdBy']) bad({ name: 'x', [k]: 'y' }, new RegExp(`${k} cannot be edited`));
  });
  it('refuses a blank name, an unknown kind, a non-positive capacity, minParty above capacity, and a non-boolean active', () => {
    bad({ name: '' }, /name is required/);
    bad({ kind: 'spaceship' }, /unknown resource kind/);
    bad({ capacity: 0 }, /capacity must be a positive integer/);
    bad({ minParty: 0 }, /minParty must be a positive integer/);
    bad({ capacity: 2, minParty: 3 }, /minParty must be between 1 and capacity/);
    bad({ active: 'no' }, /active must be true or false/);
  });
});

describe('offering rules for a preset (2B.2b)', () => {
  const none = { kind: 'none' } as const;
  const weekly = { kind: 'weekly', dayOfWeek: 2, startDate: null, end: { mode: 'ongoing' } } as const;
  const base = { name: 'Session', durationMinutes: 60 as number | null, capacity: 8 as number | null, startTime: null as string | null, recurrence: none as typeof none | typeof weekly };
  const problems = (over: Partial<typeof base>, preset: PresetKey) => validateOfferingForPreset({ ...base, ...over }, preset);

  it('accepts a valid offering for each initial preset', () => {
    expect(problems({}, 'classes_coaching')).toEqual([]);
    expect(problems({ durationMinutes: 30, capacity: null }, 'appointments')).toEqual([]);
    expect(problems({ durationMinutes: 60, capacity: null }, 'resource_hire')).toEqual([]);
    expect(problems({ durationMinutes: null, capacity: null }, 'resource_hire')).toEqual([]); // the customer chooses the duration
  });
  it('classes need a headcount limit and a duration', () => {
    expect(problems({ capacity: null }, 'classes_coaching').join()).toMatch(/need a capacity/);
    expect(problems({ capacity: 0 }, 'classes_coaching').join()).toMatch(/need a capacity/);
    expect(problems({ durationMinutes: null }, 'classes_coaching').join()).toMatch(/need a duration/);
  });
  it('exclusive-resource presets leave capacity to the resource', () => {
    expect(problems({ durationMinutes: 30, capacity: 4 }, 'appointments').join()).toMatch(/capacity must be empty/);
    expect(problems({ capacity: 4 }, 'resource_hire').join()).toMatch(/capacity must be empty/);
  });
  it('appointments need a duration; nights and turn-time presets have none', () => {
    expect(problems({ durationMinutes: null, capacity: null }, 'appointments').join()).toMatch(/need a duration/);
    expect(problems({ durationMinutes: 60, capacity: null }, 'accommodation').join()).toMatch(/no fixed duration/);
    expect(problems({ durationMinutes: 60, capacity: null }, 'restaurant_tables').join()).toMatch(/no fixed duration/);
  });
  it('a weekly offering needs its start time, a blank name is refused', () => {
    expect(problems({ recurrence: weekly }, 'classes_coaching').join()).toMatch(/needs a startTime/);
    expect(problems({ recurrence: weekly, startTime: '16:00' }, 'classes_coaching')).toEqual([]);
    expect(problems({ name: '  ' }, 'classes_coaching').join()).toMatch(/name is required/);
  });
});
