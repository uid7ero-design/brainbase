import { describe, it, expect } from 'vitest';
import { PRESET_KEYS } from '@scheduling/core';
import { problemFrom } from '@/lib/scheduling/dashboard/api';
import {
  buildOfferingCreate,
  buildOfferingEdit,
  buildResourceCreate,
  buildResourceEdit,
  buildScheduleCreate,
  buildScheduleEdit,
  centsToText,
  emptyOfferingValues,
  emptyResourceValues,
  emptyScheduleValues,
  offeringFieldPlan,
  parseMoneyToCents,
  valuesFromOffering,
  valuesFromResource,
  valuesFromSchedule,
  withPreset,
} from '@/lib/scheduling/dashboard/forms';
import type { OfferingView, ResourceView, ScheduleView } from '@/lib/scheduling/dashboard/types';
import { RESOURCE_KIND_LABELS, configurableKinds, describeCancellation, formatDuration, formatMoney, presetChoices, recurrenceSummary, wordingFor } from '@/lib/scheduling/dashboard/wording';
import { CONFIGURABLE_PRESETS, isConfigurablePreset } from '@/lib/scheduling/configurable';

// The pure logic behind the Scheduling dashboard: what each preset asks of an offering, how typed text becomes an API body, how a
// refusal is worded, and the wording itself. No DOM; the screens are tested against it in tests/components/scheduling.

const schedule = (over: Partial<ScheduleView> = {}): ScheduleView => ({
  id: 's1', name: 'Coaching', presetKey: 'classes_coaching', presetVersion: 1, terminology: {},
  cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } },
  timezone: null, publicSlug: null, updatedAt: '2026-10-24T00:00:00.000001Z', archivedAt: null, ...over,
});
const offering = (over: Partial<OfferingView> = {}): OfferingView => ({
  id: 'o1', scheduleId: 's1', name: 'Juniors', typeKey: null, colourKey: null, durationMinutes: 60, capacity: 8,
  price: { amountCents: 2500, currency: 'AUD' }, startTime: null, recurrence: { kind: 'none' }, resourceKinds: [], updatedAt: 't', archivedAt: null, ...over,
});
const resource = (over: Partial<ResourceView> = {}): ResourceView => ({ id: 'r1', kind: 'court', name: 'Court 1', capacity: 4, minParty: null, active: true, updatedAt: 't', ...over });
const problems = (r: { ok: boolean; problems?: string[] }) => (r.ok ? [] : r.problems ?? []).join(' | ');

describe('scope: only the three initial presets', () => {
  it('are classes/coaching, appointments and facility hire', () => {
    expect([...CONFIGURABLE_PRESETS]).toEqual(['classes_coaching', 'appointments', 'resource_hire']);
    for (const key of PRESET_KEYS) expect(isConfigurablePreset(key)).toBe(CONFIGURABLE_PRESETS.includes(key));
    expect(isConfigurablePreset('restaurant_tables')).toBe(false);
    expect(isConfigurablePreset(undefined)).toBe(false);
  });

  it('the picker describes exactly them, from the core’s own definitions', () => {
    const choices = presetChoices();
    expect(choices.map(c => c.key)).toEqual([...CONFIGURABLE_PRESETS]);
    expect(choices.map(c => c.offering)).toEqual(['Session', 'Service', 'Facility']);
    expect(choices.map(c => c.resourcesRequired)).toEqual([false, true, true]);
  });

  it('the resource types offered are the union over those presets, without a table', () => {
    expect(configurableKinds()).toEqual(['court', 'space', 'practitioner', 'room', 'virtual', 'equipment']);
    expect(Object.keys(RESOURCE_KIND_LABELS).sort()).toEqual(['court', 'equipment', 'practitioner', 'room', 'space', 'table', 'virtual']);
  });
});

describe('wording is the preset’s, with the schedule’s overrides', () => {
  it('uses the core labels and applies overrides', () => {
    expect(wordingFor({ presetKey: 'appointments', terminology: {} })).toMatchObject({ offering: 'Service', offeringPlural: 'Services' });
    expect(wordingFor({ presetKey: 'appointments', terminology: { offering: 'Treatment' } })).toMatchObject({ offering: 'Treatment', offeringPlural: 'Services' });
  });

  it('formats money, durations, repeats and cancellation in plain words', () => {
    expect(formatMoney(2550, 'AUD')).toBe('$25.50');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(recurrenceSummary({ kind: 'none' }, null)).toBe('One-off');
    expect(recurrenceSummary({ kind: 'weekly', dayOfWeek: 2, startDate: null, end: { mode: 'ongoing' } }, '16:00')).toBe('Every Tuesday at 16:00, ongoing');
    expect(recurrenceSummary({ kind: 'weekly', dayOfWeek: 1, startDate: '2026-11-02', end: { mode: 'after_occurrences', count: 6 } }, null)).toBe('Every Monday, 6 times');
    expect(describeCancellation({ customerCanCancel: false, freeCancellationHoursBefore: null, lateCancellationCharge: { kind: 'none' } })).toBe('Customers cannot cancel');
    expect(describeCancellation({ customerCanCancel: true, freeCancellationHoursBefore: 12, lateCancellationCharge: { kind: 'percent', percent: 50 } })).toBe('Free cancellation up to 12 h before the start; 50% late charge');
  });

  it('names no sport or business anywhere in the dashboard vocabulary', () => {
    const everything = JSON.stringify([presetChoices(), RESOURCE_KIND_LABELS, ...CONFIGURABLE_PRESETS.map(k => wordingFor({ presetKey: k, terminology: {} }))]);
    expect(everything).not.toMatch(/tennis|squad|\bld\b/i);
  });
});

describe('what each preset asks of an offering (read from the core)', () => {
  it('classes: capacity and duration required, may repeat forever', () => {
    expect(offeringFieldPlan('classes_coaching')).toEqual({ capacity: 'required', duration: 'required', recurrenceKinds: ['none', 'weekly'], endModes: ['ongoing', 'after_occurrences', 'on_date'] });
  });
  it('appointments: duration required, no capacity, a series must end', () => {
    expect(offeringFieldPlan('appointments')).toEqual({ capacity: 'hidden', duration: 'required', recurrenceKinds: ['none', 'weekly'], endModes: ['after_occurrences', 'on_date'] });
  });
  it('hire: duration optional, no capacity', () => {
    expect(offeringFieldPlan('resource_hire')).toMatchObject({ capacity: 'hidden', duration: 'optional' });
  });
});

describe('money', () => {
  it.each([['25', 2500], ['25.5', 2550], ['25.50', 2550], ['$1,250.05', 125005], ['0', 0], [' 7 ', 700]])('parses %s', (text, cents) => expect(parseMoneyToCents(text)).toBe(cents));
  it.each(['', 'abc', '1.234', '-5', '1e3', '12,5.0.0'])('rejects %j', text => expect(parseMoneyToCents(text)).toBeNull());
  it('round-trips', () => expect(centsToText(2550)).toBe('25.50'));
});

describe('schedule forms', () => {
  it('create: defaults come from the preset, and switching preset re-seeds them but keeps the name', () => {
    const v = emptyScheduleValues('classes_coaching');
    expect(v).toMatchObject({ presetKey: 'classes_coaching', customerCanCancel: true, freeHours: '24', lateKind: 'none' });
    const w = withPreset({ ...v, name: 'Keep me' }, 'appointments');
    expect(w).toMatchObject({ name: 'Keep me', presetKey: 'appointments' });
  });

  it('create: builds the body, trims, and omits a blank timezone', () => {
    const r = buildScheduleCreate({ ...emptyScheduleValues('appointments'), name: '  Clinic  ' });
    expect(r).toEqual({ ok: true, value: { name: 'Clinic', presetKey: 'appointments', cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } } } });
    const tz = buildScheduleCreate({ ...emptyScheduleValues(), name: 'A', timezone: 'Australia/Perth' });
    expect(tz.ok && tz.value.timezone).toBe('Australia/Perth');
  });

  it.each([
    [{ name: '  ' }, /Give the schedule a name/],
    [{ name: 'A', freeHours: 'soon' }, /whole number/],
    [{ name: 'A', lateKind: 'percent' as const, lateValue: '150' }, /between 0 and 100/],
    [{ name: 'A', lateKind: 'fixed' as const, lateValue: 'lots' }, /amount such as 20.00/],
    [{ name: 'A', timezone: 'Mars/Olympus' }, /valid IANA timezone/],
  ])('create refuses %j', (over, re) => expect(problems(buildScheduleCreate({ ...emptyScheduleValues(), ...over }))).toMatch(re));

  it('edit: sends only the changes; "nothing changed" is a problem; the preset only when it may change', () => {
    const s = schedule();
    expect(problems(buildScheduleEdit(valuesFromSchedule(s), s, true))).toMatch(/Nothing has changed/);
    expect(buildScheduleEdit({ ...valuesFromSchedule(s), name: 'New' }, s, true)).toEqual({ ok: true, value: { name: 'New' } });
    const switched = { ...valuesFromSchedule(s), presetKey: 'appointments' as const };
    expect(buildScheduleEdit(switched, s, true)).toEqual({ ok: true, value: { presetKey: 'appointments' } });
    expect(problems(buildScheduleEdit(switched, s, false))).toMatch(/Nothing has changed/); // locked: the choice is not sent
    const tz = buildScheduleEdit({ ...valuesFromSchedule(s), timezone: '' }, schedule({ timezone: 'Australia/Perth' }), true);
    expect(tz).toEqual({ ok: true, value: { timezone: null } });
  });
});

describe('offering forms', () => {
  const v = (presetKey: Parameters<typeof emptyOfferingValues>[0], over: Record<string, string> = {}) => ({ ...emptyOfferingValues(presetKey), name: 'Thing', ...over });

  it('classes: builds the body in cents and refuses what the preset forbids', () => {
    expect(buildOfferingCreate(v('classes_coaching', { durationMinutes: '60', capacity: '8', price: '25.50' }), 'classes_coaching')).toEqual({
      ok: true, value: { name: 'Thing', priceCents: 2550, recurrence: { kind: 'none' }, durationMinutes: 60, capacity: 8 },
    });
    expect(problems(buildOfferingCreate(v('classes_coaching', { durationMinutes: '60' }), 'classes_coaching'))).toMatch(/need a capacity/);
    expect(problems(buildOfferingCreate(v('classes_coaching', { capacity: '8' }), 'classes_coaching'))).toMatch(/need a duration/);
    expect(problems(buildOfferingCreate(v('classes_coaching', { durationMinutes: '60', capacity: '8', price: 'free' }), 'classes_coaching'))).toMatch(/Price must be an amount/);
    expect(problems(buildOfferingCreate(v('classes_coaching', { name: ' ', durationMinutes: '60', capacity: '8' }), 'classes_coaching'))).toMatch(/name is required/);
  });

  it('appointments and hire never send a capacity, even if one was typed earlier', () => {
    const body = buildOfferingCreate(v('appointments', { durationMinutes: '30', capacity: '99' }), 'appointments');
    expect(body).toEqual({ ok: true, value: { name: 'Thing', priceCents: 0, recurrence: { kind: 'none' }, durationMinutes: 30 } });
    const hire = buildOfferingCreate(v('resource_hire'), 'resource_hire');
    expect(hire).toEqual({ ok: true, value: { name: 'Thing', priceCents: 0, recurrence: { kind: 'none' } } }); // duration optional
  });

  it('weekly series: needs a day, a time, and an end the preset allows', () => {
    const weekly = { recurrence: 'weekly', dayOfWeek: '2', startTime: '16:00', durationMinutes: '60', capacity: '8' };
    expect(buildOfferingCreate(v('classes_coaching', weekly), 'classes_coaching')).toMatchObject({ ok: true, value: { startTime: '16:00', recurrence: { kind: 'weekly', dayOfWeek: 2, startDate: null, end: { mode: 'ongoing' } } } });
    expect(problems(buildOfferingCreate(v('classes_coaching', { ...weekly, startTime: '' }), 'classes_coaching'))).toMatch(/start time/);
    expect(problems(buildOfferingCreate(v('appointments', { recurrence: 'weekly', dayOfWeek: '1', startTime: '09:00', durationMinutes: '30', endMode: 'ongoing' }), 'appointments'))).toMatch(/does not allow the ongoing end mode|does not allow that way of ending/);
    expect(problems(buildOfferingCreate(v('appointments', { recurrence: 'weekly', dayOfWeek: '1', startTime: '09:00', durationMinutes: '30', endMode: 'after_occurrences', endCount: '4' }), 'appointments'))).toMatch(/first date/);
    expect(buildOfferingCreate(v('appointments', { recurrence: 'weekly', dayOfWeek: '1', startTime: '09:00', durationMinutes: '30', endMode: 'after_occurrences', endCount: '4', startDate: '2026-11-02' }), 'appointments').ok).toBe(true);
  });

  it('edit: only changed fields; clearing is expressed as null; unchanged is a problem', () => {
    const o = offering();
    expect(problems(buildOfferingEdit(valuesFromOffering(o), o, 'classes_coaching'))).toMatch(/Nothing has changed/);
    expect(buildOfferingEdit({ ...valuesFromOffering(o), capacity: '12', price: '30' }, o, 'classes_coaching')).toEqual({ ok: true, value: { capacity: 12, priceCents: 3000 } });
    const hire = offering({ durationMinutes: 60, capacity: null });
    expect(buildOfferingEdit({ ...valuesFromOffering(hire), durationMinutes: '' }, hire, 'resource_hire')).toEqual({ ok: true, value: { durationMinutes: null } });
    const weekly = offering({ startTime: '16:00', recurrence: { kind: 'weekly', dayOfWeek: 2, startDate: null, end: { mode: 'ongoing' } } });
    expect(valuesFromOffering(weekly)).toMatchObject({ recurrence: 'weekly', dayOfWeek: '2', startTime: '16:00', endMode: 'ongoing' });
    // a stored capacity on a preset where the resource decides is cleared by the edit, never kept
    expect(buildOfferingEdit(valuesFromOffering(offering({ capacity: 8 })), offering({ capacity: 8 }), 'appointments')).toEqual({ ok: true, value: { capacity: null } });
  });
});

describe('resource forms', () => {
  it('create and edit', () => {
    expect(buildResourceCreate({ ...emptyResourceValues('court'), name: ' Court 1 ', capacity: '4' })).toEqual({ ok: true, value: { kind: 'court', name: 'Court 1', capacity: 4 } });
    expect(problems(buildResourceCreate({ ...emptyResourceValues('court'), name: '', capacity: '4' }))).toMatch(/Give the resource a name/);
    expect(problems(buildResourceCreate({ ...emptyResourceValues('court'), name: 'A', capacity: '0' }))).toMatch(/at least 1/);
    const r = resource({ minParty: 2 });
    expect(problems(buildResourceEdit(valuesFromResource(r), r))).toMatch(/Nothing has changed/);
    expect(buildResourceEdit({ ...valuesFromResource(r), kind: 'space', capacity: '6' }, r)).toEqual({ ok: true, value: { kind: 'space', capacity: 6 } }); // minParty untouched
  });
});

describe('how a refusal is reported', () => {
  it('maps each contract code to a plain message and the flags the screens act on', () => {
    const stale = problemFrom(409, { error: 'x', code: 'STALE_WRITE' });
    expect(stale).toMatchObject({ stale: true, denied: false, notConfigured: false });
    expect(stale.message).toMatch(/Someone else changed this/);
    expect(problemFrom(409, { code: 'PRESET_LOCKED' }).message).toMatch(/cannot change once it has offerings/);
    expect(problemFrom(409, { code: 'ALLOCATION_IN_USE' }).message).toMatch(/live reservation/);
    expect(problemFrom(409, { code: 'RESOURCE_IN_USE' }).message).toMatch(/in use/);
    expect(problemFrom(409, { code: 'ARCHIVED' }).message).toMatch(/archived/);
    expect(problemFrom(409, { code: 'KIND_NOT_ACCEPTED' }).message).toMatch(/cannot be used/);
    expect(problemFrom(404, { code: 'NOT_FOUND' }).message).toMatch(/no longer exists/);
    expect(problemFrom(503, { code: 'SCHEDULING_NOT_CONFIGURED' })).toMatchObject({ notConfigured: true });
    expect(problemFrom(401, {})).toMatchObject({ denied: true, message: 'Your session has expired. Sign in again.' });
    expect(problemFrom(403, {})).toMatchObject({ denied: true, message: 'You do not have permission to do this.' });
    expect(problemFrom(400, { code: 'INVALID_INPUT', problems: ['a', 'b'] })).toMatchObject({ problems: ['a', 'b'], message: 'Please fix the following.' });
    expect(problemFrom(500, null).message).toBe('Something went wrong. Nothing was saved.');
  });

  it('never shows server internals: only the message of a known code, or the API’s own plain error text', () => {
    expect(problemFrom(500, { error: 'Internal error.' }).message).toBe('Internal error.');
    expect(JSON.stringify(problemFrom(409, { code: 'STALE_WRITE', stack: 'at secret.ts:1' }))).not.toContain('secret');
  });
});
