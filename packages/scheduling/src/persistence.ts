import type { CreateReservationResult, NewReservationInput, ReservationRepository, TenantContext } from './contracts';
import type {
  AvailabilityException,
  AvailabilityRule,
  CurrencyCode,
  IanaTimezone,
  LocalDate,
  LocalTime,
  Occurrence,
  Offering,
  Reservation,
  Resource,
  ScheduleConfig,
  SchedulingSettings,
} from './types';

// Persistence ports for the Phase 2A database foundation. Like contracts.ts, the core defines
// them and a host (BrainBase, or a standalone deployment with its own database) supplies an
// implementation. Every method takes the TenantContext FIRST, and an implementation must scope
// every read and write by tenant.organisationId. Input objects deliberately have NO
// organisationId field: the tenant is only ever the one the host authenticated, never a value
// that arrived in a request.

/** Why a persistence call failed in domain terms (database codes are mapped by the adapter). */
export type SchedulingErrorCode =
  | 'permission_denied'
  | 'invalid_input'
  | 'not_found'
  | 'conflict' // a uniqueness rule other than the booking ones (e.g. a duplicate slug)
  | 'resource_conflict' // the resource is already held for an overlapping range
  | 'capacity_exceeded'
  | 'duplicate_reservation'
  | 'offering_unavailable'
  | 'lifecycle_violation' // an illegal status change, or an attempt to rewrite a snapshot
  | 'unsafe_isolation' // the capacity guard refuses REPEATABLE READ / SERIALIZABLE
  | 'contention_timeout'; // a lock wait exceeded its bound; NOTHING was written; retryable, and NOT a booking refusal

export class SchedulingError extends Error {
  readonly code: SchedulingErrorCode;
  /** The database constraint that fired, when the failure came from one (for adapters and tests). */
  readonly constraint: string | null;
  /**
   * True only when the statement was aborted before writing anything and may be repeated. Today
   * that is `contention_timeout` alone. Callers still bound the repeats (see retryOnContention).
   */
  get retryable(): boolean {
    return this.code === 'contention_timeout';
  }
  constructor(code: SchedulingErrorCode, message?: string, constraint: string | null = null) {
    super(message ?? code);
    this.name = 'SchedulingError';
    this.code = code;
    this.constraint = constraint;
  }
}

// ─── Stored shapes ──────────────────────────────────────────────────────────

export interface StoredSchedule extends ScheduleConfig {
  /** Present when the schedule is open to self-service booking. */
  publicSlug: string | null;
  archivedAt: string | null;
}

export type NewScheduleInput = Omit<ScheduleConfig, 'id' | 'organisationId'> & { publicSlug: string | null };

export interface SettingsInput {
  currency: CurrencyCode;
}

export type NewResourceInput = Omit<Resource, 'id' | 'organisationId'>;

export interface StoredOffering extends Offering {
  /** Wall-clock start for generated occurrences (null for slot/stay offerings). */
  startTime: LocalTime | null;
}

/** resourceKinds is derived from the resources linked to the offering, so it is not an input. */
export type NewOfferingInput = Omit<StoredOffering, 'id' | 'organisationId' | 'archivedAt' | 'resourceKinds'>;

export type NewAvailabilityRuleInput = Omit<AvailabilityRule, 'id' | 'organisationId'> & { kind: 'hours' | 'service_period'; label: string | null };
export type NewAvailabilityExceptionInput = Omit<AvailabilityException, 'id' | 'organisationId'>;

/**
 * A dated occurrence. `startsAt`/`endsAt` are derived by the caller from the local fields and
 * the timezone (see localWindowToInstants); the database stores both.
 */
export interface NewOccurrenceInput {
  offeringId: string;
  /** A court / room held for the occurrence. Null when the occurrence uses no exclusive resource. */
  resourceId: string | null;
  date: LocalDate;
  startTime: LocalTime;
  timezone: IanaTimezone;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export type CreateOccurrenceResult =
  | { ok: true; occurrence: StoredOccurrence }
  | { ok: false; reason: 'resource_conflict' | 'duplicate_occurrence' | 'not_found' | 'offering_unavailable' };

export interface StoredOccurrence extends Occurrence {
  resourceId: string | null;
  timezone: IanaTimezone;
  startsAt: string;
  endsAt: string;
}

export interface NewSeriesInput {
  offeringId: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  timezone: IanaTimezone;
}

export interface StoredSeries extends NewSeriesInput {
  id: string;
  organisationId: string;
  customerEmailNormalised: string | null;
  status: 'active' | 'ended' | 'cancelled';
}

export interface SeriesPause {
  id: string;
  seriesId: string;
  pauseFrom: LocalDate;
  pauseUntil: LocalDate;
  reason: string | null;
}

export interface ResourceHold {
  id: string;
  resourceId: string;
  /** Half-open [startsAt, endsAt). */
  startsAt: string;
  endsAt: string;
  reservationId: string | null;
  occurrenceId: string | null;
  releasedAt: string | null;
}

export interface SchedulingConfigRepository {
  getSettings(tenant: TenantContext): Promise<SchedulingSettings | null>;
  saveSettings(tenant: TenantContext, input: SettingsInput): Promise<SchedulingSettings>;

  createSchedule(tenant: TenantContext, input: NewScheduleInput): Promise<StoredSchedule>;
  getSchedule(tenant: TenantContext, scheduleId: string): Promise<StoredSchedule | null>;
  /** Resolves a published schedule by its public slug within the (already authenticated) tenant. */
  findScheduleByPublicSlug(tenant: TenantContext, slug: string): Promise<StoredSchedule | null>;
  listSchedules(tenant: TenantContext): Promise<StoredSchedule[]>;
  archiveSchedule(tenant: TenantContext, scheduleId: string): Promise<boolean>;

  createResource(tenant: TenantContext, input: NewResourceInput): Promise<Resource>;
  listResources(tenant: TenantContext): Promise<Resource[]>;
  setResourceActive(tenant: TenantContext, resourceId: string, active: boolean): Promise<boolean>;

  createOffering(tenant: TenantContext, scheduleId: string, input: NewOfferingInput): Promise<StoredOffering>;
  getOffering(tenant: TenantContext, offeringId: string): Promise<StoredOffering | null>;
  listOfferings(tenant: TenantContext, scheduleId: string): Promise<StoredOffering[]>;
  linkOfferingResource(tenant: TenantContext, offeringId: string, resourceId: string): Promise<void>;

  addAvailabilityRule(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string, input: NewAvailabilityRuleInput): Promise<AvailabilityRule>;
  addAvailabilityException(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string, input: NewAvailabilityExceptionInput): Promise<AvailabilityException>;
  listAvailabilityRules(tenant: TenantContext, ownerKind: 'resource' | 'offering', ownerId: string): Promise<AvailabilityRule[]>;

  createOccurrence(tenant: TenantContext, input: NewOccurrenceInput): Promise<CreateOccurrenceResult>;
  getOccurrence(tenant: TenantContext, occurrenceId: string): Promise<StoredOccurrence | null>;
  listOccurrences(tenant: TenantContext, offeringId: string, fromInstant: string, toInstant: string): Promise<StoredOccurrence[]>;
  /** Closes the occurrence, cancels its live reservations and releases its holds, atomically. */
  cancelOccurrence(tenant: TenantContext, occurrenceId: string, reason: string | null): Promise<{ cancelledReservationIds: string[] } | null>;

  createSeries(tenant: TenantContext, input: NewSeriesInput): Promise<StoredSeries>;
  getSeries(tenant: TenantContext, seriesId: string): Promise<StoredSeries | null>;
  addSeriesPause(tenant: TenantContext, seriesId: string, pause: { pauseFrom: LocalDate; pauseUntil: LocalDate; reason: string | null }): Promise<SeriesPause | null>;
  listSeriesPauses(tenant: TenantContext, seriesId: string): Promise<SeriesPause[]>;

  listHoldsForReservation(tenant: TenantContext, reservationId: string): Promise<ResourceHold[]>;
}

/**
 * A booking request in which the resource is optional. With a resourceId the customer (or staff)
 * chose a provider; with null the repository assigns one. Either way the stored reservation
 * names a concrete resource, and the customer is never required to know it exists.
 */
export type AssignedReservationInput = Omit<NewReservationInput, 'resourceId'> & { resourceId?: string | null };

export type CreateAssignedReservationResult =
  | { ok: true; reservation: Reservation; replayed?: boolean; assigned: boolean }
  | Extract<CreateReservationResult, { ok: false }>;

/**
 * Exclusive-resource presets (appointments, restaurant tables, accommodation, facility hire):
 * a reservation that resolves its resource from the offering's linked, active, permitted
 * resources. It NEVER creates a resource; when none is free it reports resource_conflict.
 */
export interface ResourceAssigningReservationRepository extends ReservationRepository {
  createAssigned(tenant: TenantContext, input: AssignedReservationInput): Promise<CreateAssignedReservationResult>;
}

/** What a 2A host hands the persistence layer, on top of the Phase 1 platform. */
export interface SchedulingPersistence {
  readonly config: SchedulingConfigRepository;
  readonly reservations: ResourceAssigningReservationRepository;
}

