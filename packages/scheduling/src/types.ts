// Scheduling domain vocabulary. Types only: no behaviour lives here.
//
// Identity and time conventions follow the existing database and the money
// standard (docs/architecture/decisions/0002-money-and-currency-standard.md):
//  - every id is an opaque string; organisation_id is TEXT, never a UUID type;
//  - calendar dates are 'YYYY-MM-DD' and wall-clock times are 'HH:MM', both in
//    the organisation's own timezone (this matches session_instances.date /
//    start_time today); instants are only ever produced at the edges;
//  - money is integer minor units plus an explicit currency code.

export type OrganisationId = string;
export type LocalDate = string; // 'YYYY-MM-DD'
export type LocalTime = string; // 'HH:MM', 24-hour
export type IanaTimezone = string; // e.g. 'Australia/Adelaide'
export type CurrencyCode = string; // ISO 4217, e.g. 'AUD'

// ─── Presets ────────────────────────────────────────────────────────────────

export const PRESET_KEYS = [
  'classes_coaching',
  'appointments',
  'restaurant_tables',
  'accommodation',
  'resource_hire',
  'event_capacity',
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/**
 * How a booking relates to time.
 *  fixed_occurrence: the business publishes dated occurrences (a class, an
 *                    event session); customers join one.
 *  bookable_slot:    the customer picks a start inside the business's
 *                    availability; the booking owns that slot.
 *  date_range:       the customer books a check-in and check-out date.
 */
export type TimeModel = 'fixed_occurrence' | 'bookable_slot' | 'date_range';

export type DurationSource =
  | 'offering_fixed' // duration is a property of the offering
  | 'customer_selected' // customer chooses from allowed durations
  | 'party_size_turn_time' // derived from party size (restaurant turn time)
  | 'nights'; // derived from check-in / check-out

/**
 * What "capacity" means for the preset.
 *  headcount_per_occurrence: many customers share one occurrence up to a cap.
 *  exclusive_resource:       one booking holds a resource for the whole span.
 *  party_fits_resource:      a party is seated on a resource whose seat range
 *                            fits it (tables).
 */
export type CapacitySemantics =
  | 'headcount_per_occurrence'
  | 'exclusive_resource'
  | 'party_fits_resource';

export type ResourceKind =
  | 'court'
  | 'table'
  | 'room'
  | 'practitioner'
  | 'equipment'
  | 'space';

export type ResourceRequirement = 'none' | 'optional' | 'required';

/**
 * How the set of bookable times is derived.
 *  generated_occurrences: materialised from a schedule rule (today's
 *                         session_instances).
 *  weekly_hours:          recurring weekly opening hours plus exceptions.
 *  service_periods:       named periods (lunch, dinner) with a sitting grid.
 *  nightly_inventory:     per-night availability of each unit.
 */
export type AvailabilityStrategy =
  | 'generated_occurrences'
  | 'weekly_hours'
  | 'service_periods'
  | 'nightly_inventory';

export type BookingFieldKey =
  | 'customer_name'
  | 'customer_email'
  | 'customer_phone'
  | 'party_size'
  | 'notes'
  | 'special_requests'
  | 'check_in'
  | 'check_out'
  | 'guest_names';

/** Customer-facing wording. Organisations may override these (terminology). */
export interface TermLabels {
  offering: string;
  offeringPlural: string;
  reservation: string;
  reservationPlural: string;
  customer: string;
  customerPlural: string;
  resource: string;
  resourcePlural: string;
  occurrence: string;
  reserveAction: string; // 'Enrol', 'Book', 'Reserve'
  cancelAction: string;
}
export type TermKey = keyof TermLabels;

// ─── Recurrence ─────────────────────────────────────────────────────────────

export type RecurrenceKind = 'none' | 'weekly';

/**
 * How a recurring series ends. Mirrors the three modes in production today
 * (sessions.end_mode: ongoing / after_weeks / on_date); 'after_occurrences'
 * is the neutral name for 'after_weeks' because a weekly series ends after a
 * count of occurrences.
 */
export type RecurrenceEnd =
  | { mode: 'ongoing' }
  | { mode: 'after_occurrences'; count: number }
  | { mode: 'on_date'; date: LocalDate };

export type Recurrence =
  | { kind: 'none' }
  | {
      kind: 'weekly';
      dayOfWeek: number; // 0 = Sunday .. 6 = Saturday, as Date.getDay()
      startDate: LocalDate | null; // null = "from today" (legacy sessions)
      end: RecurrenceEnd;
    };

// ─── Money & cancellation ───────────────────────────────────────────────────

export interface Money {
  amountCents: number; // integer minor units, >= 0
  currency: CurrencyCode;
}

export type LateCancellationCharge =
  | { kind: 'none' }
  | { kind: 'percent'; percent: number } // 0..100 of the reservation price
  | { kind: 'fixed'; amountCents: number };

export interface CancellationPolicy {
  customerCanCancel: boolean;
  /** Hours before start inside which a cancellation is "late". null = never late. */
  freeCancellationHoursBefore: number | null;
  lateCancellationCharge: LateCancellationCharge;
}

export type CancelledBy = 'customer' | 'staff' | 'system';

export interface CancellationRequest {
  reservationId: string;
  cancelledBy: CancelledBy;
  reason: string | null;
  /** Cancel only this occurrence of a series, or this and all later ones. */
  scope: 'this_occurrence' | 'this_and_future';
}

export type CancellationOutcome =
  | { status: 'cancelled'; cancelledReservationIds: string[]; charge: Money | null }
  | { status: 'rejected'; reason: 'not_found' | 'already_cancelled' | 'not_permitted' | 'in_the_past' };

// ─── Configuration: organisation settings and schedules ─────────────────────
//
// An organisation has ONE SchedulingSettings record (defaults that apply to
// everything it runs) and any number of Schedules. A schedule is one business
// line (a restaurant, a coaching programme, room hire, an events programme)
// and carries its own preset, wording, cancellation policy and optional
// timezone. Two schedules in the same organisation share nothing except the
// settings defaults and the organisation's resources, so configuring one never
// changes the other.

/** Organisation-wide defaults. Exactly one per organisation. */
export interface SchedulingSettings {
  organisationId: OrganisationId;
  /**
   * The organisation's default IANA timezone. Null means "not configured": the
   * host supplies a fallback when resolving (see resolveScheduleTimezone), so
   * existing organisations that never set one keep working without a backfill.
   */
  timezone: IanaTimezone | null;
  currency: CurrencyCode;
}

/** One business line within an organisation. */
export interface ScheduleConfig {
  id: string;
  organisationId: OrganisationId;
  name: string;
  presetKey: PresetKey;
  /**
   * The version of the preset definition this schedule was configured against
   * (PresetDefinition.version). Recorded so a later change to a preset's
   * meaning can be detected and migrated deliberately instead of silently
   * re-interpreting existing schedules and their reservations.
   */
  presetVersion: number;
  /** Per-schedule wording overrides; only keys of TermLabels are valid. */
  terminology: Partial<TermLabels>;
  cancellationPolicy: CancellationPolicy;
  /** Overrides the organisation default for this schedule only; null = inherit. */
  timezone: IanaTimezone | null;
}

// ─── Offerings, resources, availability ─────────────────────────────────────

export interface Offering {
  id: string;
  organisationId: OrganisationId;
  /** The schedule (business line) this offering belongs to; fixes its preset. */
  scheduleId: string;
  name: string;
  /** Organisation-defined category (today's session_types.slug). */
  typeKey: string | null;
  colourKey: string | null;
  durationMinutes: number | null; // null for date_range offerings
  /** Max headcount (headcount_per_occurrence) or null where a resource decides. */
  capacity: number | null;
  price: Money;
  recurrence: Recurrence;
  resourceKinds: ResourceKind[];
  archivedAt: string | null; // ISO instant; null = active
}

export interface Resource {
  id: string;
  organisationId: OrganisationId;
  kind: ResourceKind;
  name: string;
  /** Seats / beds / people the resource holds. */
  capacity: number;
  /** Minimum party for party_fits_resource (tables); null otherwise. */
  minParty: number | null;
  active: boolean;
}

/** Recurring weekly opening window for a resource or an offering. */
export interface AvailabilityRule {
  id: string;
  organisationId: OrganisationId;
  resourceId: string | null;
  offeringId: string | null;
  dayOfWeek: number;
  startTime: LocalTime;
  endTime: LocalTime;
  validFrom: LocalDate | null;
  validTo: LocalDate | null;
}

export interface AvailabilityException {
  id: string;
  organisationId: OrganisationId;
  resourceId: string | null;
  offeringId: string | null;
  fromDate: LocalDate;
  toDate: LocalDate; // inclusive
  kind: 'closed' | 'override';
  reason: string | null;
}

// ─── Occurrences & reservations ─────────────────────────────────────────────

export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'completed';

/** One dated instance of an offering (today's session_instances row). */
export interface Occurrence {
  id: string;
  organisationId: OrganisationId;
  offeringId: string;
  date: LocalDate;
  startTime: LocalTime;
  durationMinutes: number;
  capacity: number;
  status: OccurrenceStatus;
}

export type TimeSpan =
  | { kind: 'occurrence'; occurrenceId: string }
  | { kind: 'slot'; date: LocalDate; startTime: LocalTime; durationMinutes: number }
  | { kind: 'stay'; checkIn: LocalDate; checkOut: LocalDate };

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'waitlisted';

export type AttendanceStatus = 'attended' | 'absent' | 'late';

export type PaymentStatus = 'unpaid' | 'paid' | 'refunded' | 'waived';

/** A person on a reservation. customerId is the link to the host's customer record. */
export interface Participant {
  customerId: string | null;
  displayName: string;
  role: 'primary' | 'guest';
}

/**
 * What the customer looked like when they booked. Copied onto the reservation
 * at booking time and never rewritten, so editing or merging the customer
 * record later cannot change history (receipts, attendance lists, disputes).
 */
export interface CustomerSnapshot {
  displayName: string;
  email: string | null;
  /** normaliseEmail(email): trim + lowercase; null when there is no email. */
  emailNormalised: string | null;
  phone: string | null;
}

/** A reservation's absolute time window, UTC ISO-8601 ending in 'Z'. */
export interface InstantWindow {
  startsAt: string;
  endsAt: string;
}

export interface Reservation {
  id: string;
  organisationId: OrganisationId;
  /** The schedule the booking was made under. */
  scheduleId: string;
  /**
   * The preset and version in force when the booking was made. A snapshot:
   * later edits to the schedule or the preset definition do not reinterpret
   * an existing reservation.
   */
  presetKey: PresetKey;
  presetVersion: number;
  offeringId: string;
  resourceId: string | null;
  /**
   * The host's customer record, when one is linked. Null for a booking with no
   * identifying contact detail (customers are never matched on name alone).
   */
  customerId: string | null;
  customerSnapshot: CustomerSnapshot;
  /**
   * The IANA timezone used to interpret `span` and to derive `window`. A
   * snapshot: changing the schedule's or organisation's timezone later never
   * moves an existing reservation.
   */
  timezone: IanaTimezone;
  /** The absolute window (instants) derived from `span` and `timezone` at booking time. */
  instants: InstantWindow;
  participants: Participant[];
  partySize: number;
  span: TimeSpan;
  status: ReservationStatus;
  attendance: AttendanceStatus | null;
  paymentStatus: PaymentStatus;
  price: Money;
  /** Shared by every reservation in one recurring series (legacy recurring_group_id). */
  seriesId: string | null;
  notes: string | null;
}

// ─── Customers ──────────────────────────────────────────────────────────────

/** The scheduling core's view of a customer; the host owns the full record. */
export interface CustomerRef {
  id: string;
  organisationId: OrganisationId;
  displayName: string;
  email: string | null;
  phone: string | null;
}
