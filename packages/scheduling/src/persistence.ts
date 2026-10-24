import type { CreateReservationResult, NewReservationInput, ReservationRepository, TenantContext } from './contracts';
import type {
  AvailabilityException,
  AvailabilityRule,
  CancellationPolicy,
  CurrencyCode,
  IanaTimezone,
  LocalDate,
  LocalTime,
  Occurrence,
  Offering,
  PresetKey,
  Reservation,
  Recurrence,
  Resource,
  ScheduleConfig,
  SchedulingSettings,
  TermLabels,
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
  /**
   * The version token for optimistic concurrency (Phase 2B.2a): the row's updated_at as a UTC instant with MICROSECOND
   * precision (YYYY-MM-DDTHH:MM:SS.ffffffZ). Opaque to callers: read it, send it back unchanged with an update.
   * Every write to the row changes it, as does a change to what hangs off it (a new offering under a schedule, a new
   * offering link on a resource), so a concurrent change is always seen as a stale write.
   */
  updatedAt: string;
  archivedAt: string | null;
}

export type NewScheduleInput = Omit<ScheduleConfig, 'id' | 'organisationId'> & { publicSlug: string | null };

export interface SettingsInput {
  currency: CurrencyCode;
}

export type NewResourceInput = Omit<Resource, 'id' | 'organisationId'>;

/** A resource as stored: the shared Resource plus its version token (see StoredSchedule.updatedAt). */
export interface StoredResource extends Resource {
  updatedAt: string;
}

export interface StoredOffering extends Offering {
  /** Wall-clock start for generated occurrences (null for slot/stay offerings). */
  /** Version token; see StoredSchedule.updatedAt. */
  updatedAt: string;
  startTime: LocalTime | null;
}

/** resourceKinds is derived from the resources linked to the offering, so it is not an input. */
export type NewOfferingInput = Omit<StoredOffering, 'id' | 'organisationId' | 'archivedAt' | 'resourceKinds' | 'updatedAt'>;

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

/**
 * The presets whose offerings may have dated occurrences written in this release. Enforced in the shared persistence layer
 * (createOccurrence), not only in a UI. event_capacity (a headcount preset too) is deliberately NOT listed: it stays
 * closed until its own design, kept apart from the Eve ticketing product (docs/architecture/scheduling-occurrence-integrity.md).
 * A preset's schedule cannot change once it has offerings, so an offering's eligibility cannot change under a writer.
 */
export const OCCURRENCE_WRITING_PRESETS: readonly string[] = ['classes_coaching'];

export type CreateOccurrenceResult =
  | { ok: true; occurrence: StoredOccurrence }
  | { ok: false; reason: 'resource_conflict' | 'duplicate_occurrence' | 'not_found' | 'offering_unavailable' | 'preset_not_supported' };

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

// ─── Configuration edits (Phase 2B.2a) ──────────────────────────────────────
//
// Every edit names the version it was made against (`expectedUpdatedAt`, from a previous read). The write applies only if
// the row is still at that version; otherwise nothing is written and the result is `stale_write`. The expected business
// outcomes are results, not exceptions (like CreateOccurrenceResult); malformed input and missing permission still throw
// SchedulingError ('invalid_input', 'permission_denied'). A row of another tenant is indistinguishable from a missing row:
// `not_found`.

/** Why a configuration write was not applied. Nothing was written in any of these cases. */
export type ConfigWriteFailure =
  | 'not_found' // no such row for this tenant (or a row of another tenant: the two are indistinguishable on purpose)
  | 'stale_write' // the row changed since it was read (the domain form of STALE_WRITE); re-read and decide again
  | 'archived' // the row, or the schedule it belongs to, is archived: archived rows are not edited
  | 'preset_locked' // the schedule already has offerings, so its preset can no longer change
  | 'resource_in_use' // the resource has live reservations or links that the requested change would break
  | 'allocation_in_use'; // a live reservation holds this resource for this offering, so it cannot be unlinked

export type ConfigWriteResult<T> = { ok: true; value: T } | { ok: false; reason: ConfigWriteFailure; detail?: string };

/** Fields a schedule edit may change. Absent = unchanged. The public slug and archive state are not edited here. */
export interface SchedulePatch {
  name?: string;
  /** Replaces the schedule's wording overrides as a whole. */
  terminology?: Partial<TermLabels>;
  cancellationPolicy?: CancellationPolicy;
  /** null clears the override (the schedule then inherits the organisation timezone). */
  timezone?: IanaTimezone | null;
  /** Allowed only while the schedule has no offerings (archived ones count). The version is the preset's current one. */
  presetKey?: PresetKey;
}

/** Fields an offering edit may change. Absent = unchanged; null clears where the field is nullable. Currency never changes. */
export interface OfferingPatch {
  name?: string;
  typeKey?: string | null;
  colourKey?: string | null;
  durationMinutes?: number | null;
  capacity?: number | null;
  priceCents?: number;
  startTime?: LocalTime | null;
  /** Replaces the whole recurrence. Affects occurrences generated LATER only; existing ones are never rewritten. */
  recurrence?: Recurrence;
}

/** Fields a resource edit may change. Absent = unchanged. */
export interface ResourcePatch {
  name?: string;
  /** Only while the resource has no offering links and has never been held. */
  kind?: Resource['kind'];
  capacity?: number;
  minParty?: number | null;
  /** Deactivation is refused while a live (unreleased, not yet ended) hold exists; reactivation is always allowed. */
  active?: boolean;
}


export interface SchedulingConfigRepository {
  getSettings(tenant: TenantContext): Promise<SchedulingSettings | null>;
  saveSettings(tenant: TenantContext, input: SettingsInput): Promise<SchedulingSettings>;

  createSchedule(tenant: TenantContext, input: NewScheduleInput): Promise<StoredSchedule>;
  getSchedule(tenant: TenantContext, scheduleId: string): Promise<StoredSchedule | null>;
  /** Resolves a published schedule by its public slug within the (already authenticated) tenant. */
  findScheduleByPublicSlug(tenant: TenantContext, slug: string): Promise<StoredSchedule | null>;
  listSchedules(tenant: TenantContext): Promise<StoredSchedule[]>;
  /** One-way: there is no unarchive. Returns false when the schedule is missing or already archived. */
  archiveSchedule(tenant: TenantContext, scheduleId: string): Promise<boolean>;
  updateSchedule(tenant: TenantContext, scheduleId: string, expectedUpdatedAt: string, changes: SchedulePatch): Promise<ConfigWriteResult<StoredSchedule>>;

  createResource(tenant: TenantContext, input: NewResourceInput): Promise<StoredResource>;
  listResources(tenant: TenantContext): Promise<StoredResource[]>;
  /** Unguarded toggle kept for compatibility. Configuration screens use updateResource, which enforces the booking rules. */
  setResourceActive(tenant: TenantContext, resourceId: string, active: boolean): Promise<boolean>;
  updateResource(tenant: TenantContext, resourceId: string, expectedUpdatedAt: string, changes: ResourcePatch): Promise<ConfigWriteResult<StoredResource>>;

  createOffering(tenant: TenantContext, scheduleId: string, input: NewOfferingInput): Promise<StoredOffering>;
  getOffering(tenant: TenantContext, offeringId: string): Promise<StoredOffering | null>;
  listOfferings(tenant: TenantContext, scheduleId: string): Promise<StoredOffering[]>;
  /** One-way: there is no unarchive. Returns false when the offering is missing or already archived. Reservations are untouched. */
  archiveOffering(tenant: TenantContext, offeringId: string): Promise<boolean>;
  updateOffering(tenant: TenantContext, offeringId: string, expectedUpdatedAt: string, changes: OfferingPatch): Promise<ConfigWriteResult<StoredOffering>>;
  linkOfferingResource(tenant: TenantContext, offeringId: string, resourceId: string): Promise<void>;
  /**
   * Removes the link only (never a reservation, hold or occurrence). Idempotent: removed=false when there was no link.
   * Refused with allocation_in_use while a live hold of this resource belongs to a reservation or occurrence of this offering.
   */
  unlinkOfferingResource(tenant: TenantContext, offeringId: string, resourceId: string): Promise<ConfigWriteResult<{ removed: boolean }>>;
  /** The resources linked to an offering, this tenant's staff only (needs scheduling.view). */
  listOfferingResources(tenant: TenantContext, offeringId: string): Promise<StoredResource[]>;

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

