import { TERM_KEYS, getPreset } from './presets';
import type { OfferingPatch, ResourcePatch, SchedulePatch } from './persistence';
import { PRESET_KEYS, type PresetKey, type ResourceKind } from './types';
import { isIanaTimezone, isLocalTime, validateCancellationPolicy, validateRecurrence } from './validation';

// Phase 2B.2a: pure validation for configuration edits. No I/O, no host import: a standalone host and the BrainBase
// adapter both call these, so a rule lives in one place. Each returns a list of problems (empty = valid), in the same
// style as validation.ts. Repositories turn a non-empty list into SchedulingError('invalid_input').

const RESOURCE_KINDS: readonly ResourceKind[] = ['court', 'table', 'room', 'practitioner', 'equipment', 'space', 'virtual'];
const UPDATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k) && (o as Record<string, unknown>)[k] !== undefined;

/** The version token a caller sends back: a UTC instant, microsecond precision at most. Anything else is rejected before SQL. */
export function validateExpectedUpdatedAt(value: unknown): string[] {
  return typeof value === 'string' && UPDATED_AT_RE.test(value) && !Number.isNaN(Date.parse(value)) ? [] : ['expectedUpdatedAt must be the updatedAt value read earlier (a UTC instant)'];
}

export function validateSchedulePatch(patch: SchedulePatch): string[] {
  const problems: string[] = [];
  const keys = ['name', 'terminology', 'cancellationPolicy', 'timezone', 'presetKey'].filter(k => has(patch, k));
  if (keys.length === 0) problems.push('nothing to change');
  for (const k of Object.keys(patch)) if (!['name', 'terminology', 'cancellationPolicy', 'timezone', 'presetKey'].includes(k)) problems.push(`${k} cannot be edited`);
  if (has(patch, 'name') && (typeof patch.name !== 'string' || patch.name.trim() === '')) problems.push('schedule name is required');
  if (has(patch, 'terminology')) {
    const t = patch.terminology;
    if (typeof t !== 'object' || t === null || Array.isArray(t)) problems.push('terminology must be an object');
    else {
      for (const [key, value] of Object.entries(t)) {
        if (!(TERM_KEYS as readonly string[]).includes(key)) problems.push(`unknown terminology key: ${key}`);
        else if (typeof value !== 'string') problems.push(`terminology ${key} must be text`);
      }
    }
  }
  if (has(patch, 'cancellationPolicy')) problems.push(...validateCancellationPolicy(patch.cancellationPolicy!));
  if ('timezone' in patch && patch.timezone !== undefined && patch.timezone !== null && !isIanaTimezone(patch.timezone)) problems.push('timezone must be a valid IANA timezone or null');
  if (has(patch, 'presetKey') && !(PRESET_KEYS as readonly string[]).includes(patch.presetKey as string)) problems.push(`unknown preset: ${String(patch.presetKey)}`);
  return problems;
}

/**
 * `presetKey` is the key of the offering's schedule (the offering inherits it; an offering never has its own). Rules that
 * depend on the preset are checked here, on the values supplied; the database checks the rest of the combined row.
 */
export function validateOfferingPatch(patch: OfferingPatch, presetKey: PresetKey): string[] {
  const problems: string[] = [];
  const allowed = ['name', 'typeKey', 'colourKey', 'durationMinutes', 'capacity', 'priceCents', 'startTime', 'recurrence'];
  if (!allowed.some(k => has(patch, k))) problems.push('nothing to change');
  for (const k of Object.keys(patch)) if (!allowed.includes(k)) problems.push(`${k} cannot be edited`);
  const preset = getPreset(presetKey);
  if (has(patch, 'name') && (typeof patch.name !== 'string' || patch.name.trim() === '')) problems.push('name is required');
  if (patch.durationMinutes !== undefined && patch.durationMinutes !== null) {
    if (!isPositiveInt(patch.durationMinutes)) problems.push('durationMinutes must be a positive integer or null');
    else if (preset.timeModel === 'date_range') problems.push('a date-range offering has no duration');
  }
  if (patch.capacity !== undefined && patch.capacity !== null && !isPositiveInt(patch.capacity)) problems.push('capacity must be a positive integer or null');
  if (has(patch, 'priceCents') && !(Number.isInteger(patch.priceCents) && (patch.priceCents as number) >= 0)) problems.push('price must be a non-negative integer number of cents');
  if (patch.startTime !== undefined && patch.startTime !== null && !isLocalTime(patch.startTime)) problems.push('startTime must be HH:MM');
  if (has(patch, 'recurrence')) {
    const r = patch.recurrence!;
    problems.push(...validateRecurrence(r));
    if (!(preset.recurrence.kinds as readonly string[]).includes(r.kind)) problems.push(`${preset.name} does not allow ${r.kind} recurrence`);
    else if (r.kind === 'weekly' && !(preset.recurrence.endModes as readonly string[]).includes(r.end.mode)) problems.push(`${preset.name} does not allow the ${r.end.mode} end mode`);
    if (r.kind === 'weekly' && patch.startTime === null) problems.push('a weekly offering needs a startTime');
  }
  return problems;
}

export function validateResourcePatch(patch: ResourcePatch): string[] {
  const problems: string[] = [];
  const allowed = ['name', 'kind', 'capacity', 'minParty', 'active'];
  if (!allowed.some(k => has(patch, k))) problems.push('nothing to change');
  for (const k of Object.keys(patch)) if (!allowed.includes(k)) problems.push(`${k} cannot be edited`);
  if (has(patch, 'name') && (typeof patch.name !== 'string' || patch.name.trim() === '')) problems.push('name is required');
  if (has(patch, 'kind') && !(RESOURCE_KINDS as readonly string[]).includes(patch.kind as string)) problems.push(`unknown resource kind: ${String(patch.kind)}`);
  if (has(patch, 'capacity') && !isPositiveInt(patch.capacity)) problems.push('capacity must be a positive integer');
  if (patch.minParty !== undefined && patch.minParty !== null && !isPositiveInt(patch.minParty)) problems.push('minParty must be a positive integer or null');
  if (isPositiveInt(patch.capacity) && isPositiveInt(patch.minParty) && patch.minParty > patch.capacity) problems.push('minParty must be between 1 and capacity');
  if (has(patch, 'active') && typeof patch.active !== 'boolean') problems.push('active must be true or false');
  return problems;
}
