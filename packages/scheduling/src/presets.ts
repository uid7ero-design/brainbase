import type {
  AvailabilityStrategy,
  BookingFieldKey,
  CancellationPolicy,
  CapacitySemantics,
  DurationSource,
  PresetKey,
  RecurrenceEnd,
  RecurrenceKind,
  ScheduleConfig,
  SchedulingSettings,
  ResourceKind,
  ResourceRequirement,
  TermKey,
  TermLabels,
  TimeModel,
} from './types';
import { PRESET_KEYS } from './types';

// Presets are DATA. Each one declares how the shared scheduling model should
// be read for one kind of business: wording, time model, resources, what
// "capacity" means, what a booking must collect, which recurrence is allowed,
// the default cancellation policy and how bookable times are derived.
//
// A preset carries no functions and no hooks. Behaviour that differs between
// presets is selected by the closed unions in types.ts (TimeModel,
// CapacitySemantics, AvailabilityStrategy), each of which the engine will
// implement once, so a preset can never inject runtime behaviour. A schedule
// customises a preset only through validated terminology overrides and policy
// values (see ScheduleConfig). The registry is deeply frozen, and schedule
// configs are built from deep copies, so one schedule can never change a
// preset or another schedule by mutation.

export interface PresetDefinition {
  readonly key: PresetKey;
  /**
   * Version of this definition. Bumped whenever a change would alter how an
   * existing schedule or reservation should be interpreted. Schedules and
   * reservations record the version they were created under.
   */
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly labels: TermLabels;
  readonly timeModel: TimeModel;
  readonly durationSource: DurationSource;
  readonly resources: {
    readonly requirement: ResourceRequirement;
    readonly kinds: readonly ResourceKind[];
  };
  readonly capacity: {
    readonly semantics: CapacitySemantics;
    /** Whether a booking carries a party size larger than one. */
    readonly partySize: 'always_one' | 'required' | 'optional';
  };
  readonly booking: {
    readonly requiredFields: readonly BookingFieldKey[];
    readonly optionalFields: readonly BookingFieldKey[];
  };
  readonly recurrence: {
    readonly kinds: readonly RecurrenceKind[];
    readonly endModes: readonly RecurrenceEnd['mode'][];
    /**
     * True when a customer joins a whole series (every occurrence, with
     * pause windows) rather than each date being booked on its own. This is
     * the lineage behaviour LD Tennis uses today (recurring_group_id).
     */
    readonly customerJoinsSeries: boolean;
  };
  readonly defaultCancellationPolicy: CancellationPolicy;
  readonly availability: AvailabilityStrategy;
  /**
   * Capabilities this preset deliberately does not provide because another
   * product owns them. Non-empty only where the preset sits beside a product
   * with overlapping vocabulary (event_capacity versus the ticketing product).
   */
  readonly outOfScope: readonly string[];
}

const NO_CHARGE = { kind: 'none' } as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const PRESETS: Readonly<Record<PresetKey, PresetDefinition>> = deepFreeze({
  classes_coaching: {
    key: 'classes_coaching',
    version: 1,
    name: 'Classes and coaching',
    description:
      'Recurring group or private sessions with a fixed time and a headcount cap. Customers enrol in a session, usually weekly.',
    labels: {
      offering: 'Session',
      offeringPlural: 'Sessions',
      reservation: 'Enrolment',
      reservationPlural: 'Enrolments',
      customer: 'Participant',
      customerPlural: 'Participants',
      resource: 'Space',
      resourcePlural: 'Spaces',
      occurrence: 'Class',
      reserveAction: 'Enrol',
      cancelAction: 'Cancel enrolment',
    },
    timeModel: 'fixed_occurrence',
    durationSource: 'offering_fixed',
    resources: { requirement: 'optional', kinds: ['court', 'space', 'practitioner'] },
    capacity: { semantics: 'headcount_per_occurrence', partySize: 'always_one' },
    booking: {
      requiredFields: ['customer_name'],
      optionalFields: ['customer_email', 'customer_phone', 'notes'],
    },
    recurrence: {
      kinds: ['none', 'weekly'],
      endModes: ['ongoing', 'after_occurrences', 'on_date'],
      customerJoinsSeries: true,
    },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: 24,
      lateCancellationCharge: NO_CHARGE,
    },
    availability: 'generated_occurrences',
    outOfScope: [],
  },

  appointments: {
    key: 'appointments',
    version: 1,
    name: 'Appointments',
    description:
      'One-to-one services where the customer picks a start time within a provider\'s working hours.',
    labels: {
      offering: 'Service',
      offeringPlural: 'Services',
      reservation: 'Appointment',
      reservationPlural: 'Appointments',
      customer: 'Client',
      customerPlural: 'Clients',
      resource: 'Provider',
      resourcePlural: 'Providers',
      occurrence: 'Appointment',
      reserveAction: 'Book',
      cancelAction: 'Cancel appointment',
    },
    timeModel: 'bookable_slot',
    durationSource: 'offering_fixed',
    resources: { requirement: 'optional', kinds: ['practitioner', 'room'] },
    capacity: { semantics: 'exclusive_resource', partySize: 'always_one' },
    booking: {
      requiredFields: ['customer_name', 'customer_email'],
      optionalFields: ['customer_phone', 'notes'],
    },
    recurrence: {
      kinds: ['none', 'weekly'],
      endModes: ['after_occurrences', 'on_date'],
      customerJoinsSeries: false,
    },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: 24,
      lateCancellationCharge: NO_CHARGE,
    },
    availability: 'weekly_hours',
    outOfScope: [],
  },

  restaurant_tables: {
    key: 'restaurant_tables',
    version: 1,
    name: 'Restaurant table bookings',
    description:
      'Party reservations seated on tables during named service periods, with a turn time per party size.',
    labels: {
      offering: 'Service period',
      offeringPlural: 'Service periods',
      reservation: 'Reservation',
      reservationPlural: 'Reservations',
      customer: 'Guest',
      customerPlural: 'Guests',
      resource: 'Table',
      resourcePlural: 'Tables',
      occurrence: 'Sitting',
      reserveAction: 'Reserve',
      cancelAction: 'Cancel reservation',
    },
    timeModel: 'bookable_slot',
    durationSource: 'party_size_turn_time',
    resources: { requirement: 'required', kinds: ['table'] },
    capacity: { semantics: 'party_fits_resource', partySize: 'required' },
    booking: {
      requiredFields: ['customer_name', 'customer_phone', 'party_size'],
      optionalFields: ['customer_email', 'special_requests', 'notes'],
    },
    recurrence: { kinds: ['none'], endModes: [], customerJoinsSeries: false },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: 2,
      lateCancellationCharge: NO_CHARGE,
    },
    availability: 'service_periods',
    outOfScope: [],
  },

  accommodation: {
    key: 'accommodation',
    version: 1,
    name: 'Hotel and accommodation',
    description:
      'Stays booked by check-in and check-out date against rooms or units, with availability tracked per night.',
    labels: {
      offering: 'Room type',
      offeringPlural: 'Room types',
      reservation: 'Booking',
      reservationPlural: 'Bookings',
      customer: 'Guest',
      customerPlural: 'Guests',
      resource: 'Room',
      resourcePlural: 'Rooms',
      occurrence: 'Stay',
      reserveAction: 'Book',
      cancelAction: 'Cancel booking',
    },
    timeModel: 'date_range',
    durationSource: 'nights',
    resources: { requirement: 'required', kinds: ['room', 'space'] },
    capacity: { semantics: 'exclusive_resource', partySize: 'required' },
    booking: {
      requiredFields: ['customer_name', 'customer_email', 'check_in', 'check_out', 'party_size'],
      optionalFields: ['customer_phone', 'guest_names', 'special_requests', 'notes'],
    },
    recurrence: { kinds: ['none'], endModes: [], customerJoinsSeries: false },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: 72,
      lateCancellationCharge: { kind: 'percent', percent: 100 },
    },
    availability: 'nightly_inventory',
    outOfScope: [],
  },

  resource_hire: {
    key: 'resource_hire',
    version: 1,
    name: 'Resource and facility hire',
    description:
      'Hourly or per-slot hire of a court, room, space or piece of equipment, held exclusively for the booked time.',
    labels: {
      offering: 'Facility',
      offeringPlural: 'Facilities',
      reservation: 'Booking',
      reservationPlural: 'Bookings',
      customer: 'Hirer',
      customerPlural: 'Hirers',
      resource: 'Space',
      resourcePlural: 'Spaces',
      occurrence: 'Booking slot',
      reserveAction: 'Book',
      cancelAction: 'Cancel booking',
    },
    timeModel: 'bookable_slot',
    durationSource: 'customer_selected',
    resources: { requirement: 'required', kinds: ['court', 'room', 'space', 'equipment'] },
    capacity: { semantics: 'exclusive_resource', partySize: 'optional' },
    booking: {
      requiredFields: ['customer_name', 'customer_email'],
      optionalFields: ['customer_phone', 'party_size', 'notes'],
    },
    recurrence: {
      kinds: ['none', 'weekly'],
      endModes: ['after_occurrences', 'on_date'],
      customerJoinsSeries: false,
    },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: 48,
      lateCancellationCharge: { kind: 'percent', percent: 50 },
    },
    availability: 'weekly_hours',
    outOfScope: [],
  },

  event_capacity: {
    key: 'event_capacity',
    version: 1,
    name: 'Events-style capacity reservations',
    description:
      'Free or invitation-style reservations against a dated occurrence with a headcount cap (workshops, open days, info sessions). Not ticket sales.',
    labels: {
      offering: 'Event',
      offeringPlural: 'Events',
      reservation: 'Registration',
      reservationPlural: 'Registrations',
      customer: 'Attendee',
      customerPlural: 'Attendees',
      resource: 'Venue',
      resourcePlural: 'Venues',
      occurrence: 'Session',
      reserveAction: 'Register',
      cancelAction: 'Cancel registration',
    },
    timeModel: 'fixed_occurrence',
    durationSource: 'offering_fixed',
    resources: { requirement: 'optional', kinds: ['space', 'room'] },
    capacity: { semantics: 'headcount_per_occurrence', partySize: 'optional' },
    booking: {
      requiredFields: ['customer_name', 'customer_email'],
      optionalFields: ['customer_phone', 'party_size', 'notes'],
    },
    recurrence: {
      kinds: ['none', 'weekly'],
      endModes: ['after_occurrences', 'on_date'],
      customerJoinsSeries: false,
    },
    defaultCancellationPolicy: {
      customerCanCancel: true,
      freeCancellationHoursBefore: null,
      lateCancellationCharge: NO_CHARGE,
    },
    availability: 'generated_occurrences',
    // The ticketing product (Events / Eve) owns everything money- or
    // door-related. See packages/scheduling/README.md and
    // docs/architecture/decisions/0014-scheduling-and-bookings-foundation.md.
    outOfScope: [
      'paid_ticket_sales',
      'ticket_types_and_per_type_inventory',
      'promotions_presales_and_access_codes',
      'platform_fees_and_gst_on_tickets',
      'qr_ticket_wallet_and_check_in_scanning',
      'organiser_payouts',
    ],
  },
});

export function isPresetKey(value: unknown): value is PresetKey {
  return typeof value === 'string' && (PRESET_KEYS as readonly string[]).includes(value);
}

export function getPreset(key: PresetKey): PresetDefinition {
  return PRESETS[key];
}

export function listPresets(): PresetDefinition[] {
  return PRESET_KEYS.map(k => PRESETS[k]);
}

export const TERM_KEYS: readonly TermKey[] = Object.freeze(
  Object.keys(PRESETS.classes_coaching.labels) as TermKey[],
);

/**
 * The wording an organisation actually sees: the preset's labels with the
 * organisation's overrides applied. Blank overrides are ignored so an
 * emptied settings field falls back to the preset instead of rendering an
 * empty label. Unknown keys are ignored (never copied through).
 */
export function resolveTerminology(
  presetKey: PresetKey,
  overrides: Partial<TermLabels> | null | undefined,
): TermLabels {
  const resolved: TermLabels = { ...PRESETS[presetKey].labels };
  if (!overrides) return resolved;
  for (const key of TERM_KEYS) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim() !== '') resolved[key] = value.trim();
  }
  return resolved;
}

/** An independent deep copy of a cancellation policy (no shared nested objects). */
export function clonePolicy(policy: CancellationPolicy): CancellationPolicy {
  return { ...policy, lateCancellationCharge: { ...policy.lateCancellationCharge } };
}

/** Organisation-wide defaults for a new organisation. Timezone stays null until configured. */
export function defaultSettings(params: {
  organisationId: string;
  currency: string;
  timezone?: string | null;
}): SchedulingSettings {
  return {
    organisationId: params.organisationId,
    timezone: params.timezone ?? null,
    currency: params.currency,
  };
}

/**
 * A new schedule seeded entirely from a preset. The host supplies the facts the
 * preset cannot know (tenant, id, name). Everything copied from the preset is a
 * deep copy, so later edits to this schedule cannot reach the preset or any
 * other schedule.
 */
export function defaultScheduleConfig(params: {
  id: string;
  organisationId: string;
  name: string;
  presetKey: PresetKey;
  timezone?: string | null;
}): ScheduleConfig {
  const preset = PRESETS[params.presetKey];
  return {
    id: params.id,
    organisationId: params.organisationId,
    name: params.name,
    presetKey: params.presetKey,
    presetVersion: preset.version,
    terminology: {},
    cancellationPolicy: clonePolicy(preset.defaultCancellationPolicy),
    timezone: params.timezone ?? null,
  };
}

/** The wording a schedule shows: its preset's labels with the schedule's own overrides. */
export function resolveScheduleTerminology(schedule: Pick<ScheduleConfig, 'presetKey' | 'terminology'>): TermLabels {
  return resolveTerminology(schedule.presetKey, schedule.terminology);
}
