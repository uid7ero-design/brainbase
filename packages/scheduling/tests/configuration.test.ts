import { describe, it, expect } from 'vitest';
import { validateExpectedUpdatedAt, validateOfferingPatch, validateResourcePatch, validateSchedulePatch, type OfferingPatch, type ResourcePatch, type PresetKey, type SchedulePatch } from '../src';

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
