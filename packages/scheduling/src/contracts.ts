import type {
  AttendanceStatus,
  CancellationOutcome,
  CancellationRequest,
  CurrencyCode,
  CustomerRef,
  CustomerSnapshot,
  IanaTimezone,
  InstantWindow,
  LocalDate,
  LocalTime,
  Money,
  OrganisationId,
  PresetKey,
  Reservation,
  TimeSpan,
} from './types';

// The ports a host application supplies. The scheduling core defines them and
// never imports an implementation, so the same domain code runs inside a
// larger platform (which maps them onto its own session, contacts, database,
// payments and email) and inside a standalone deployment (which maps them onto
// its own).
//
// Tenant isolation is part of the signature, not a convention: every port
// method that touches stored data takes the TenantContext as its FIRST
// parameter, and an implementation must scope every read and write by
// tenant.organisationId. There is deliberately no method that accepts a bare
// id without a tenant.

// ─── Tenant ─────────────────────────────────────────────────────────────────

export type SchedulingPermission =
  | 'scheduling.view'
  | 'scheduling.manage' // configure offerings, resources, availability
  | 'scheduling.reserve' // create and change reservations for customers
  | 'scheduling.attendance'; // record attendance / no-shows

export type SchedulingActor =
  | { kind: 'staff'; userId: string }
  | { kind: 'customer'; customerId: string }
  | { kind: 'public' } // unauthenticated booking widget
  | { kind: 'system' }; // scheduled jobs

export interface TenantContext {
  readonly organisationId: OrganisationId;
  readonly timezone: IanaTimezone;
  readonly actor: SchedulingActor;
  /** The host maps its own roles onto these permissions. */
  can(permission: SchedulingPermission): boolean;
}

// ─── Clock & timezone ───────────────────────────────────────────────────────

export interface Clock {
  now(): Date;
  /** Today's calendar date in the given timezone, not the server's. */
  today(timezone: IanaTimezone): LocalDate;
}

// ─── Customers ──────────────────────────────────────────────────────────────

export interface NewCustomerInput {
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface CustomerProvider {
  getById(tenant: TenantContext, customerId: string): Promise<CustomerRef | null>;
  /** Email match is exact after trim + lowercase; no fuzzy name matching. */
  findByEmail(tenant: TenantContext, email: string): Promise<CustomerRef | null>;
  /** Returns the existing customer for the email when there is one, else creates it. */
  findOrCreate(tenant: TenantContext, input: NewCustomerInput): Promise<CustomerRef>;
}

// ─── Reservations ───────────────────────────────────────────────────────────

/**
 * Everything needed to write a reservation, including the snapshot fields that
 * must be captured at booking time and never rewritten: the schedule and the
 * preset/version in force, the customer as they were, the timezone used and
 * the UTC window derived from it. The repository stores these verbatim.
 */
export interface NewReservationInput {
  scheduleId: string;
  presetKey: PresetKey;
  presetVersion: number;
  offeringId: string;
  resourceId: string | null;
  /** The host's customer record when one was matched or created; null otherwise. */
  customerId: string | null;
  customerSnapshot: CustomerSnapshot;
  timezone: IanaTimezone;
  instants: InstantWindow;
  partySize: number;
  span: TimeSpan;
  price: Money;
  seriesId: string | null;
  notes: string | null;
  /**
   * Optional client-supplied key making a retry safe: a second create with the same key in the
   * same tenant returns the original reservation (replayed: true) instead of booking twice.
   */
  idempotencyKey?: string | null;
  /** How the customer record was linked at booking time (snapshot). Defaults from customerId. */
  contactLink?: 'matched' | 'created' | 'none';
}

export type CreateReservationResult =
  | { ok: true; reservation: Reservation; replayed?: boolean }
  | {
      ok: false;
      reason:
        | 'capacity_exceeded'
        | 'resource_conflict'
        | 'duplicate_reservation'
        | 'offering_unavailable'
        | 'not_found';
    };

export interface ReservationRepository {
  getById(tenant: TenantContext, reservationId: string): Promise<Reservation | null>;
  listForOccurrence(tenant: TenantContext, occurrenceId: string): Promise<Reservation[]>;
  listForCustomer(tenant: TenantContext, customerId: string): Promise<Reservation[]>;
  /**
   * The capacity / resource check and the insert MUST be one atomic step in
   * the implementation (a locking read or a database constraint). The core
   * cannot make an overbooking safe by checking first and inserting after.
   */
  create(tenant: TenantContext, input: NewReservationInput): Promise<CreateReservationResult>;
  cancel(tenant: TenantContext, request: CancellationRequest): Promise<CancellationOutcome>;
  setAttendance(
    tenant: TenantContext,
    reservationId: string,
    attendance: AttendanceStatus | null,
  ): Promise<Reservation | null>;
}

// ─── Resource availability ──────────────────────────────────────────────────

export interface AvailabilityQuery {
  offeringId: string;
  fromDate: LocalDate;
  toDate: LocalDate; // inclusive
  partySize: number;
  /** Restrict to one resource, or null to consider every eligible resource. */
  resourceId: string | null;
}

export interface AvailabilitySlot {
  date: LocalDate;
  startTime: LocalTime;
  durationMinutes: number;
  resourceId: string | null;
  /** Remaining places (headcount) or 1 for an exclusive resource. */
  remaining: number;
}

export interface ResourceAvailability {
  findSlots(tenant: TenantContext, query: AvailabilityQuery): Promise<AvailabilitySlot[]>;
  /** Stays: nights on which the resource is free between check-in (inclusive) and check-out (exclusive). */
  isRangeFree(
    tenant: TenantContext,
    resourceId: string,
    checkIn: LocalDate,
    checkOut: LocalDate,
  ): Promise<boolean>;
}

// ─── Payments ───────────────────────────────────────────────────────────────

export interface PaymentRequest {
  reservationId: string;
  amount: Money;
  description: string;
  /** Idempotency key supplied by the core so a retry never double-charges. */
  idempotencyKey: string;
}

export type PaymentRequestResult =
  | { status: 'paid'; providerReference: string }
  | { status: 'pending'; providerReference: string; redirectUrl: string | null }
  | { status: 'failed'; reason: string };

export interface PaymentProvider {
  readonly currency: CurrencyCode;
  request(tenant: TenantContext, request: PaymentRequest): Promise<PaymentRequestResult>;
  refund(
    tenant: TenantContext,
    providerReference: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<{ status: 'refunded' | 'failed'; reason: string | null }>;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type SchedulingNotification =
  | { kind: 'reservation_confirmed'; reservationId: string }
  | { kind: 'reservation_cancelled'; reservationId: string; cancelledBy: 'customer' | 'staff' | 'system' }
  | { kind: 'reservation_reminder'; reservationId: string }
  | { kind: 'waitlist_offer'; reservationId: string };

export interface NotificationProvider {
  /** Delivery is the host's concern; a failure here must not undo a reservation. */
  notify(tenant: TenantContext, customer: CustomerRef, notification: SchedulingNotification): Promise<void>;
}

// ─── Aggregate ──────────────────────────────────────────────────────────────

/**
 * Everything a host hands the scheduling core. Payments and notifications are
 * optional: a deployment without online payment or email still schedules.
 */
export interface SchedulingPlatform {
  readonly clock: Clock;
  readonly customers: CustomerProvider;
  readonly reservations: ReservationRepository;
  readonly availability: ResourceAvailability;
  readonly payments?: PaymentProvider;
  readonly notifications?: NotificationProvider;
}
