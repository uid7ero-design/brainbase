import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  PRESET_KEYS,
  TERM_KEYS,
  defaultScheduleConfig,
  defaultSettings,
  getPreset,
  isPresetKey,
  listPresets,
  resolveTerminology,
  validateScheduleConfig,
  validateSettings,
  validatePresetDefinition,
  validateReservationForPreset,
  type PresetKey,
  type Reservation,
} from '../src';
import { reservation, schedule } from './support/fixtures';

describe('preset registry', () => {
  it('defines exactly the six presets, each registered under its own key', () => {
    expect([...PRESET_KEYS].sort()).toEqual(
      ['accommodation', 'appointments', 'classes_coaching', 'event_capacity', 'resource_hire', 'restaurant_tables'],
    );
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_KEYS].sort());
    for (const key of PRESET_KEYS) expect(PRESETS[key].key).toBe(key);
    expect(listPresets().map(p => p.key)).toEqual([...PRESET_KEYS]);
  });

  it('isPresetKey and getPreset agree with the registry', () => {
    expect(isPresetKey('appointments')).toBe(true);
    expect(isPresetKey('tennis')).toBe(false);
    expect(isPresetKey(undefined)).toBe(false);
    expect(getPreset('accommodation')).toBe(PRESETS.accommodation);
  });

  for (const key of PRESET_KEYS) {
    it(`${key} is internally consistent`, () => {
      expect(validatePresetDefinition(PRESETS[key])).toEqual([]);
    });
  }

  it('presets are pure data: JSON round-trips with nothing lost and no function values', () => {
    for (const p of listPresets()) {
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
      const walk = (v: unknown): void => {
        expect(typeof v).not.toBe('function');
        if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(p);
    }
  });

  it('the registry is frozen so a host cannot swap in a preset at runtime', () => {
    expect(Object.isFrozen(PRESETS)).toBe(true);
    expect(() => {
      (PRESETS as Record<string, unknown>).appointments = {};
    }).toThrow();
  });

  it('every preset names every term, and no two presets share the same offering+customer wording', () => {
    const seen = new Set<string>();
    for (const p of listPresets()) {
      expect(Object.keys(p.labels).sort()).toEqual([...TERM_KEYS].sort());
      const sig = `${p.labels.offering}|${p.labels.customer}`;
      expect(seen.has(sig), sig).toBe(false);
      seen.add(sig);
    }
  });
});

describe('preset semantics', () => {
  it('classes_coaching reproduces the live LD Tennis model: fixed occurrences, headcount cap, weekly series with all three end modes', () => {
    const p = PRESETS.classes_coaching;
    expect(p.timeModel).toBe('fixed_occurrence');
    expect(p.capacity.semantics).toBe('headcount_per_occurrence');
    expect(p.availability).toBe('generated_occurrences');
    expect(p.recurrence.kinds).toEqual(['none', 'weekly']);
    expect([...p.recurrence.endModes].sort()).toEqual(['after_occurrences', 'on_date', 'ongoing']);
    expect(p.recurrence.customerJoinsSeries).toBe(true);
    expect(p.capacity.partySize).toBe('always_one');
  });

  it('only classes_coaching lets a customer join a whole series; only it offers an ongoing series', () => {
    for (const p of listPresets()) {
      expect(p.recurrence.customerJoinsSeries, p.key).toBe(p.key === 'classes_coaching');
      expect(p.recurrence.endModes.includes('ongoing'), p.key).toBe(p.key === 'classes_coaching');
    }
  });

  it('restaurant tables seat a party on a required table with a derived turn time', () => {
    const p = PRESETS.restaurant_tables;
    expect(p.capacity.semantics).toBe('party_fits_resource');
    expect(p.resources).toEqual({ requirement: 'required', kinds: ['table'] });
    expect(p.durationSource).toBe('party_size_turn_time');
    expect(p.availability).toBe('service_periods');
    expect(p.booking.requiredFields).toContain('party_size');
    expect(p.recurrence.kinds).toEqual(['none']);
  });

  it('accommodation is a date range with nightly inventory and a required room', () => {
    const p = PRESETS.accommodation;
    expect(p.timeModel).toBe('date_range');
    expect(p.durationSource).toBe('nights');
    expect(p.availability).toBe('nightly_inventory');
    expect(p.resources.requirement).toBe('required');
    expect(p.booking.requiredFields).toEqual(expect.arrayContaining(['check_in', 'check_out']));
  });

  it('appointments and resource_hire both use exclusive resources over bookable slots, differing in who chooses the duration', () => {
    for (const k of ['appointments', 'resource_hire'] as PresetKey[]) {
      expect(PRESETS[k].timeModel).toBe('bookable_slot');
      expect(PRESETS[k].capacity.semantics).toBe('exclusive_resource');
      expect(PRESETS[k].availability).toBe('weekly_hours');
    }
    expect(PRESETS.appointments.durationSource).toBe('offering_fixed');
    expect(PRESETS.resource_hire.durationSource).toBe('customer_selected');
    expect(PRESETS.resource_hire.resources.requirement).toBe('required');
  });

  it('no preset enables payments, fees or ticket concepts in its own configuration', () => {
    for (const p of listPresets()) {
      const text = JSON.stringify({ ...p, outOfScope: undefined, description: undefined });
      expect(text, p.key).not.toMatch(/ticket|stripe|fee|gst|promo/i);
    }
  });
});

describe('events-style reservations versus the ticketing product', () => {
  it('event_capacity explicitly leaves ticket sales, per-type inventory, promotions, fees, door scanning and payouts to the ticketing product', () => {
    expect(PRESETS.event_capacity.outOfScope).toEqual([
      'paid_ticket_sales',
      'ticket_types_and_per_type_inventory',
      'promotions_presales_and_access_codes',
      'platform_fees_and_gst_on_tickets',
      'qr_ticket_wallet_and_check_in_scanning',
      'organiser_payouts',
    ]);
  });

  it('no other preset carries an out-of-scope list (the boundary is specific to events)', () => {
    for (const p of listPresets()) {
      if (p.key !== 'event_capacity') expect(p.outOfScope, p.key).toEqual([]);
    }
  });

  it('event_capacity is a headcount-per-occurrence preset, the same capacity model as classes, with no price-bearing concepts', () => {
    expect(PRESETS.event_capacity.capacity.semantics).toBe('headcount_per_occurrence');
    expect(PRESETS.event_capacity.labels.reservation).toBe('Registration');
  });
});

describe('terminology', () => {
  it('returns the preset labels untouched when there are no overrides', () => {
    expect(resolveTerminology('classes_coaching', {})).toEqual(PRESETS.classes_coaching.labels);
    expect(resolveTerminology('appointments', null)).toEqual(PRESETS.appointments.labels);
  });

  it('applies trimmed overrides over the preset, leaving other terms alone', () => {
    const t = resolveTerminology('classes_coaching', { customer: '  Squad member ', customerPlural: 'Squad' });
    expect(t.customer).toBe('Squad member');
    expect(t.customerPlural).toBe('Squad');
    expect(t.offering).toBe(PRESETS.classes_coaching.labels.offering);
  });

  it('ignores blank overrides and unknown keys', () => {
    const t = resolveTerminology('accommodation', { customer: '   ', bogus: 'x' } as never);
    expect(t.customer).toBe(PRESETS.accommodation.labels.customer);
    expect('bogus' in t).toBe(false);
  });

  it('never mutates the preset', () => {
    const before = JSON.stringify(PRESETS.classes_coaching);
    resolveTerminology('classes_coaching', { customer: 'Squad member' });
    expect(JSON.stringify(PRESETS.classes_coaching)).toBe(before);
  });
});

describe('organisation settings and schedule configuration', () => {
  it('default settings carry no timezone until one is configured', () => {
    const s = defaultSettings({ organisationId: 'org-1', currency: 'AUD' });
    expect(s.timezone).toBeNull();
    expect(validateSettings(s)).toEqual([]);
    expect(validateSettings(defaultSettings({ organisationId: 'org-1', currency: 'AUD', timezone: 'Australia/Adelaide' }))).toEqual([]);
  });

  it('settings reject a missing tenant, a bad currency and a non-IANA timezone', () => {
    const s = defaultSettings({ organisationId: 'org-1', currency: 'AUD' });
    expect(validateSettings({ ...s, organisationId: '' })).not.toEqual([]);
    expect(validateSettings({ ...s, currency: 'aud' })).not.toEqual([]);
    expect(validateSettings({ ...s, timezone: 'Mars/Olympus' })).not.toEqual([]);
    expect(validateSettings({ ...s, timezone: '' })).not.toEqual([]);
  });

  it('a schedule seeded from any preset is valid, records the preset version, and deep-copies the default policy', () => {
    for (const key of PRESET_KEYS) {
      const c = defaultScheduleConfig({ id: 'sch-' + key, organisationId: 'org-1', name: 'Main', presetKey: key });
      expect(validateScheduleConfig(c), key).toEqual([]);
      expect(c.presetVersion).toBe(PRESETS[key].version);
      expect(c.timezone).toBeNull();
      expect(c.cancellationPolicy).toEqual(PRESETS[key].defaultCancellationPolicy);
      expect(c.cancellationPolicy).not.toBe(PRESETS[key].defaultCancellationPolicy);
      expect(c.cancellationPolicy.lateCancellationCharge).not.toBe(PRESETS[key].defaultCancellationPolicy.lateCancellationCharge);
    }
  });

  it('rejects an unknown preset, a version the preset never had, an unknown terminology key, a bad timezone and a missing tenant or name', () => {
    const base = schedule('appointments', 'sch-1');
    expect(validateScheduleConfig({ ...base, presetKey: 'nope' as never })).toEqual(expect.arrayContaining([expect.stringMatching(/unknown preset/)]));
    expect(validateScheduleConfig({ ...base, presetVersion: 0 })).not.toEqual([]);
    expect(validateScheduleConfig({ ...base, presetVersion: PRESETS.appointments.version + 1 })).not.toEqual([]);
    expect(validateScheduleConfig({ ...base, terminology: { bogus: 'x' } as never })).toEqual(expect.arrayContaining([expect.stringMatching(/unknown terminology key/)]));
    expect(validateScheduleConfig({ ...base, timezone: 'Not/AZone' })).not.toEqual([]);
    expect(validateScheduleConfig({ ...base, organisationId: '' })).not.toEqual([]);
    expect(validateScheduleConfig({ ...base, name: '  ' })).not.toEqual([]);
    expect(validateScheduleConfig({ ...base, id: '' })).not.toEqual([]);
  });
});

describe('reservation shape per preset', () => {
  it('a class enrolment is one person on an occurrence', () => {
    const r: Reservation = reservation('classes_coaching', 'sch-1');
    expect(validateReservationForPreset(r, PRESETS.classes_coaching)).toEqual([]);
    expect(validateReservationForPreset({ ...r, partySize: 2 }, PRESETS.classes_coaching)).not.toEqual([]);
    expect(validateReservationForPreset({ ...r, span: { kind: 'stay', checkIn: '2026-11-01', checkOut: '2026-11-02' } }, PRESETS.classes_coaching)).not.toEqual([]);
  });

  it('a hotel booking needs a room and a stay of at least one night', () => {
    const stay = { kind: 'stay', checkIn: '2026-11-01', checkOut: '2026-11-03' } as const;
    const r: Reservation = reservation('accommodation', 'sch-1', { span: stay });
    expect(validateReservationForPreset(r, PRESETS.accommodation)).toEqual([]);
    expect(validateReservationForPreset({ ...r, resourceId: null }, PRESETS.accommodation)).not.toEqual([]);
    expect(validateReservationForPreset({ ...r, span: { kind: 'stay', checkIn: '2026-11-03', checkOut: '2026-11-03' } }, PRESETS.accommodation)).not.toEqual([]);
  });

  it('a table reservation needs a table and a slot', () => {
    const r: Reservation = reservation('restaurant_tables', 'sch-1');
    expect(validateReservationForPreset(r, PRESETS.restaurant_tables)).toEqual([]);
    expect(validateReservationForPreset({ ...r, resourceId: null }, PRESETS.restaurant_tables)).not.toEqual([]);
  });

  it('rejects a negative or fractional price and a cancelled reservation carrying attendance', () => {
    const r: Reservation = reservation('classes_coaching', 'sch-1');
    expect(validateReservationForPreset({ ...r, price: { amountCents: -1, currency: 'AUD' } }, PRESETS.classes_coaching)).not.toEqual([]);
    expect(validateReservationForPreset({ ...r, price: { amountCents: 10.5, currency: 'AUD' } }, PRESETS.classes_coaching)).not.toEqual([]);
    expect(validateReservationForPreset({ ...r, status: 'cancelled', attendance: 'attended' }, PRESETS.classes_coaching)).not.toEqual([]);
  });
});

describe('validatePresetDefinition catches inconsistent presets', () => {
  const broken = (patch: object) => ({ ...PRESETS.accommodation, ...patch }) as never;

  it('flags a date_range preset that does not require check-in/out', () => {
    expect(validatePresetDefinition(broken({ booking: { requiredFields: ['customer_name', 'party_size'], optionalFields: [] } }))).not.toEqual([]);
  });
  it('flags party_fits_resource without a required resource', () => {
    const p = { ...PRESETS.restaurant_tables, resources: { requirement: 'optional', kinds: ['table'] } } as never;
    expect(validatePresetDefinition(p)).not.toEqual([]);
  });
  it('flags weekly recurrence with no end modes, and series membership without weekly', () => {
    const p = { ...PRESETS.appointments, recurrence: { kinds: ['none', 'weekly'], endModes: [], customerJoinsSeries: false } } as never;
    expect(validatePresetDefinition(p)).not.toEqual([]);
    const q = { ...PRESETS.restaurant_tables, recurrence: { kinds: ['none'], endModes: [], customerJoinsSeries: true } } as never;
    expect(validatePresetDefinition(q)).not.toEqual([]);
  });
  it('flags an empty label', () => {
    const p = { ...PRESETS.appointments, labels: { ...PRESETS.appointments.labels, reserveAction: ' ' } } as never;
    expect(validatePresetDefinition(p)).not.toEqual([]);
  });
});
