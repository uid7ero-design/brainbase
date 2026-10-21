import type { TenantContext } from './contracts';
import { PRESETS, TERM_KEYS } from './presets';
import type { PresetDefinition } from './presets';
import type {
  AvailabilityRule,
  CancellationPolicy,
  OrganisationSchedulingConfig,
  Recurrence,
  Reservation,
  TimeSpan,
} from './types';
import { PRESET_KEYS } from './types';

// Pure invariant checks. Every function returns a list of problems (empty =
// valid) so a host can show all of them at once; none throws except
// assertSameTenant, which guards a boundary that must never be crossed.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function minutesOfDay(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;
const isNonNegativeInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function validateRecurrence(r: Recurrence): string[] {
  if (r.kind === 'none') return [];
  const problems: string[] = [];
  if (!Number.isInteger(r.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) {
    problems.push('dayOfWeek must be an integer from 0 (Sunday) to 6 (Saturday)');
  }
  if (r.startDate !== null && !isLocalDate(r.startDate)) problems.push('startDate must be a valid YYYY-MM-DD date or null');
  if (r.end.mode === 'after_occurrences' && !isPositiveInt(r.end.count)) {
    problems.push('after_occurrences needs a count of at least 1');
  }
  if (r.end.mode === 'on_date') {
    if (!isLocalDate(r.end.date)) problems.push('on_date needs a valid YYYY-MM-DD end date');
    else if (r.startDate !== null && r.end.date < r.startDate) problems.push('end date must not be before the start date');
  }
  // A finite series needs an anchor: counting occurrences "from the start"
  // is meaningless without one (production computes after_weeks from
  // start_date and ignores the rule when it is missing).
  if (r.end.mode === 'after_occurrences' && r.startDate === null) {
    problems.push('after_occurrences requires a startDate');
  }
  return problems;
}

export function validateTimeSpan(span: TimeSpan): string[] {
  const problems: string[] = [];
  if (span.kind === 'occurrence') {
    if (!span.occurrenceId) problems.push('occurrenceId is required');
  } else if (span.kind === 'slot') {
    if (!isLocalDate(span.date)) problems.push('slot date must be a valid YYYY-MM-DD date');
    if (!isLocalTime(span.startTime)) problems.push('slot startTime must be HH:MM');
    if (!isPositiveInt(span.durationMinutes)) problems.push('slot durationMinutes must be a positive integer');
  } else {
    if (!isLocalDate(span.checkIn)) problems.push('checkIn must be a valid YYYY-MM-DD date');
    if (!isLocalDate(span.checkOut)) problems.push('checkOut must be a valid YYYY-MM-DD date');
    if (isLocalDate(span.checkIn) && isLocalDate(span.checkOut) && span.checkOut <= span.checkIn) {
      problems.push('checkOut must be after checkIn (at least one night)');
    }
  }
  return problems;
}

export function validateCancellationPolicy(p: CancellationPolicy): string[] {
  const problems: string[] = [];
  if (p.freeCancellationHoursBefore !== null && !isNonNegativeInt(p.freeCancellationHoursBefore)) {
    problems.push('freeCancellationHoursBefore must be a non-negative integer or null');
  }
  const c = p.lateCancellationCharge;
  if (c.kind === 'percent' && !(typeof c.percent === 'number' && c.percent >= 0 && c.percent <= 100)) {
    problems.push('late cancellation percent must be between 0 and 100');
  }
  if (c.kind === 'fixed' && !isNonNegativeInt(c.amountCents)) {
    problems.push('late cancellation fixed amount must be a non-negative integer number of cents');
  }
  if (!p.customerCanCancel && c.kind !== 'none') {
    problems.push('a late cancellation charge is meaningless when customers cannot cancel');
  }
  return problems;
}

export function validateAvailabilityRule(r: AvailabilityRule): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(r.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) problems.push('dayOfWeek must be 0-6');
  if (!isLocalTime(r.startTime)) problems.push('startTime must be HH:MM');
  if (!isLocalTime(r.endTime)) problems.push('endTime must be HH:MM');
  if (isLocalTime(r.startTime) && isLocalTime(r.endTime) && minutesOfDay(r.endTime) <= minutesOfDay(r.startTime)) {
    problems.push('endTime must be after startTime');
  }
  if (r.resourceId === null && r.offeringId === null) problems.push('a rule must belong to a resource or an offering');
  if (r.validFrom !== null && !isLocalDate(r.validFrom)) problems.push('validFrom must be a valid date or null');
  if (r.validTo !== null && !isLocalDate(r.validTo)) problems.push('validTo must be a valid date or null');
  if (r.validFrom !== null && r.validTo !== null && isLocalDate(r.validFrom) && isLocalDate(r.validTo) && r.validTo < r.validFrom) {
    problems.push('validTo must not be before validFrom');
  }
  return problems;
}

/** Organisation configuration: preset exists, terminology keys are known, policy is valid. */
export function validateOrganisationConfig(c: OrganisationSchedulingConfig): string[] {
  const problems: string[] = [];
  if (!c.organisationId) problems.push('organisationId is required');
  if (!(PRESET_KEYS as readonly string[]).includes(c.presetKey)) problems.push(`unknown preset: ${String(c.presetKey)}`);
  if (!c.timezone) problems.push('timezone is required');
  if (!/^[A-Z]{3}$/.test(c.currency)) problems.push('currency must be a 3-letter uppercase ISO code');
  for (const key of Object.keys(c.terminology)) {
    if (!(TERM_KEYS as readonly string[]).includes(key)) problems.push(`unknown terminology key: ${key}`);
  }
  problems.push(...validateCancellationPolicy(c.cancellationPolicy));
  return problems;
}

/**
 * A reservation's shape must agree with its organisation's preset: the time
 * model decides which kind of span is legal, the capacity semantics decide
 * whether a resource is needed and how party size behaves.
 */
export function validateReservationForPreset(r: Reservation, preset: PresetDefinition): string[] {
  const problems: string[] = [...validateTimeSpan(r.span)];

  const expectedSpan: Record<PresetDefinition['timeModel'], TimeSpan['kind']> = {
    fixed_occurrence: 'occurrence',
    bookable_slot: 'slot',
    date_range: 'stay',
  };
  if (r.span.kind !== expectedSpan[preset.timeModel]) {
    problems.push(`${preset.key} reservations use a ${expectedSpan[preset.timeModel]} span, not ${r.span.kind}`);
  }
  if (!isPositiveInt(r.partySize)) problems.push('partySize must be a positive integer');
  if (preset.capacity.partySize === 'always_one' && r.partySize !== 1) {
    problems.push(`${preset.key} reservations are for exactly one person`);
  }
  if (preset.resources.requirement === 'required' && r.resourceId === null) {
    problems.push(`${preset.key} reservations require a resource`);
  }
  if (preset.resources.requirement === 'none' && r.resourceId !== null) {
    problems.push(`${preset.key} reservations do not take a resource`);
  }
  if (!Number.isInteger(r.price.amountCents) || r.price.amountCents < 0) {
    problems.push('price must be a non-negative integer number of cents');
  }
  if (r.status === 'cancelled' && r.attendance !== null) problems.push('a cancelled reservation cannot carry attendance');
  return problems;
}

/** Internal consistency of a preset definition. Used by the preset test-suite. */
export function validatePresetDefinition(p: PresetDefinition): string[] {
  const problems: string[] = [];
  if (PRESETS[p.key] !== p) problems.push('preset is not registered under its own key');
  if (p.resources.requirement !== 'none' && p.resources.kinds.length === 0) {
    problems.push('a preset that uses resources must list at least one resource kind');
  }
  if (p.resources.requirement === 'none' && p.resources.kinds.length > 0) {
    problems.push('a preset without resources must not list resource kinds');
  }
  if (p.timeModel === 'date_range') {
    for (const f of ['check_in', 'check_out'] as const) {
      if (!p.booking.requiredFields.includes(f)) problems.push(`date_range presets must require ${f}`);
    }
    if (p.durationSource !== 'nights') problems.push('date_range presets measure duration in nights');
  } else if (p.durationSource === 'nights') {
    problems.push('only date_range presets may measure duration in nights');
  }
  if (p.capacity.semantics === 'party_fits_resource') {
    if (p.resources.requirement !== 'required') problems.push('party_fits_resource needs a required resource');
    if (p.capacity.partySize !== 'required') problems.push('party_fits_resource needs a required party size');
  }
  if (p.capacity.semantics === 'exclusive_resource' && p.resources.requirement === 'none') {
    problems.push('exclusive_resource needs a resource');
  }
  if (p.capacity.semantics === 'headcount_per_occurrence' && p.timeModel !== 'fixed_occurrence') {
    problems.push('headcount_per_occurrence only makes sense for fixed occurrences');
  }
  if ((p.capacity.partySize !== 'always_one') !== p.booking.requiredFields.concat(p.booking.optionalFields).includes('party_size')) {
    problems.push('party_size must appear in booking fields exactly when the preset allows a party larger than one');
  }
  if (p.capacity.partySize === 'required' && !p.booking.requiredFields.includes('party_size')) {
    problems.push('a required party size must be a required booking field');
  }
  for (const f of p.booking.optionalFields) {
    if (p.booking.requiredFields.includes(f)) problems.push(`${f} is both required and optional`);
  }
  if (!p.booking.requiredFields.includes('customer_name')) problems.push('customer_name is always required');
  const kinds = p.recurrence.kinds;
  if (!kinds.includes('none')) problems.push('recurrence kinds must include none');
  if (kinds.length === 1 && (p.recurrence.endModes.length > 0 || p.recurrence.customerJoinsSeries)) {
    problems.push('a preset without recurrence must not list end modes or series membership');
  }
  if (kinds.includes('weekly') && p.recurrence.endModes.length === 0) problems.push('weekly recurrence needs at least one end mode');
  if (p.recurrence.customerJoinsSeries && !kinds.includes('weekly')) problems.push('series membership needs weekly recurrence');
  if ((p.availability === 'generated_occurrences') !== (p.timeModel === 'fixed_occurrence')) {
    problems.push('generated_occurrences availability pairs with fixed_occurrence, and only with it');
  }
  if ((p.availability === 'nightly_inventory') !== (p.timeModel === 'date_range')) {
    problems.push('nightly_inventory availability pairs with date_range, and only with it');
  }
  problems.push(...validateCancellationPolicy(p.defaultCancellationPolicy));
  for (const key of TERM_KEYS) {
    if (!p.labels[key] || p.labels[key].trim() === '') problems.push(`label ${key} is empty`);
  }
  return problems;
}

export class TenantIsolationError extends Error {
  constructor(expected: string, actual: string) {
    super(`Tenant isolation violation: operating as "${expected}" on a record owned by "${actual}"`);
    this.name = 'TenantIsolationError';
  }
}

/** Throws when a record belongs to a different organisation than the caller's tenant. */
export function assertSameTenant(tenant: Pick<TenantContext, 'organisationId'>, recordOrganisationId: string): void {
  if (tenant.organisationId !== recordOrganisationId) {
    throw new TenantIsolationError(tenant.organisationId, recordOrganisationId);
  }
}
