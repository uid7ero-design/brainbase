import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  PRESET_VERSION_NOTES,
  resourceRequirementAtVersion,
  upgradeScheduleConfig,
  validatePresetDefinition,
  validateReservationAgainstSchedule,
  validateReservationForPreset,
  validateScheduleConfig,
  withoutInternalResource,
} from '../src';
import { reservation, schedule } from './support/fixtures';

// Appointments preset v2: every appointment holds a concrete internal resource, exactly like
// restaurant tables, accommodation and facility hire.

describe('appointments preset v2: a resource is required', () => {
  it('requires a resource and accepts practitioner, room and an explicit virtual capacity', () => {
    const p = PRESETS.appointments;
    expect(p.version).toBe(2);
    expect(p.resources.requirement).toBe('required');
    expect([...p.resources.kinds].sort()).toEqual(['practitioner', 'room', 'virtual']);
    expect(p.capacity.semantics).toBe('exclusive_resource');
    expect(validatePresetDefinition(p)).toEqual([]);
  });

  it('shares the exclusivity model of every other exclusive preset: required resource, slot or stay span', () => {
    for (const key of ['appointments', 'restaurant_tables', 'accommodation', 'resource_hire'] as const) {
      expect(PRESETS[key].resources.requirement, key).toBe('required');
      expect(PRESETS[key].timeModel, key).not.toBe('fixed_occurrence');
    }
  });

  it('a new appointment without a resource is invalid, with one it is valid', () => {
    const s = schedule('appointments', 'sch-appt');
    const ok = reservation('appointments', s.id);
    expect(validateReservationForPreset(ok, PRESETS.appointments)).toEqual([]);
    const without = { ...ok, resourceId: null };
    expect(validateReservationForPreset(without, PRESETS.appointments)).toEqual(['appointments reservations require a resource']);
  });

  it('a virtual resource is a normal resource kind (no special case for the requirement)', () => {
    const s = schedule('appointments', 'sch-appt');
    const online = reservation('appointments', s.id, { resourceId: 'telehealth-line-1' });
    expect(validateReservationAgainstSchedule(online, s)).toEqual([]);
  });
});

describe('appointments preset versioning and existing schedules', () => {
  it('records that v1 allowed no resource and every later version requires one', () => {
    expect(PRESET_VERSION_NOTES.appointments?.[1]?.resourceRequirement).toBe('optional');
    expect(resourceRequirementAtVersion('appointments', 1)).toBe('optional');
    expect(resourceRequirementAtVersion('appointments', 2)).toBe('required');
    expect(resourceRequirementAtVersion('restaurant_tables', 1)).toBe('required'); // unchanged presets use the current rule
  });

  it('a schedule stamped v1 stays valid, and can be moved to the current version without losing its own settings', () => {
    const old = schedule('appointments', 'sch-old', { presetVersion: 1, terminology: { reservation: 'Consult' }, timezone: 'Australia/Perth' });
    expect(validateScheduleConfig(old)).toEqual([]);
    const upgraded = upgradeScheduleConfig(old);
    expect(upgraded.presetVersion).toBe(2);
    expect(upgraded.terminology).toEqual({ reservation: 'Consult' });
    expect(upgraded.timezone).toBe('Australia/Perth');
    expect(old.presetVersion).toBe(1); // input is not mutated
    expect(upgradeScheduleConfig(upgraded)).toBe(upgraded); // already current -> same object
  });

  it('a NEW booking needs a resource whatever version its schedule carries', () => {
    const v1 = reservation('appointments', 'sch-old', { presetVersion: 1, resourceId: null });
    expect(validateReservationForPreset(v1, PRESETS.appointments)).toEqual(['appointments reservations require a resource']);
  });

  it('an old v1 SNAPSHOT without a resource is still readable as history; a v2 snapshot without one is not', () => {
    const s = schedule('appointments', 'sch-old', { presetVersion: 1 });
    const legacy = reservation('appointments', s.id, { presetVersion: 1, resourceId: null });
    expect(validateReservationAgainstSchedule(legacy, s)).toEqual([]);
    const current = reservation('appointments', s.id, { presetVersion: 2, resourceId: null });
    expect(validateReservationAgainstSchedule(current, s)).toEqual(['appointments reservations require a resource']);
  });

  it('version notes are frozen', () => {
    expect(() => {
      (PRESET_VERSION_NOTES as Record<string, unknown>).appointments = {};
    }).toThrow();
  });
});

describe('customers are not made to see the internal resource', () => {
  it('withoutInternalResource drops the resource and keeps everything else', () => {
    const r = reservation('appointments', 'sch-appt');
    const view = withoutInternalResource(r);
    expect('resourceId' in view).toBe(false);
    expect(view.id).toBe(r.id);
    expect(view.instants).toEqual(r.instants);
    expect(r.resourceId).toBe('prov-1'); // original untouched
  });
});
