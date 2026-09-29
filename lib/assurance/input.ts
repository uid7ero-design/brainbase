// BrainBase Assurance — pure input normalisation. Zero server imports.
//
// Every service entry point takes `unknown`-ish request data through
// these helpers and builds an explicit, allow-listed input object — no
// request body is ever spread into a SQL statement (mass-assignment
// protection by construction).

import { AssuranceValidationError } from './errors';
import { isOneOf } from './domain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Required non-blank text, trimmed, length-capped. */
export function requiredText(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AssuranceValidationError(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AssuranceValidationError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

/** Optional text: undefined/null/blank -> null (the schema forbids blank strings). */
export function optionalText(value: unknown, field: string, max = 4000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AssuranceValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new AssuranceValidationError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) throw new AssuranceValidationError(`${field} is not a valid id.`);
  return value.toLowerCase();
}

export function requiredUuid(value: unknown, field: string): string {
  const id = optionalUuid(value, field);
  if (!id) throw new AssuranceValidationError(`${field} is required.`);
  return id;
}

/** users.id is TEXT (cuid-style), not a UUID. Accept a bounded, conservative token shape. */
export function optionalUserId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new AssuranceValidationError(`${field} is not a valid user.`);
  }
  return value;
}

export function requiredEnum<T extends string>(list: readonly T[], value: unknown, field: string): T {
  if (!isOneOf(list, value)) throw new AssuranceValidationError(`${field} is not a valid option.`);
  return value;
}

export function optionalEnum<T extends string>(list: readonly T[], value: unknown, field: string): T | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredEnum(list, value, field);
}

/** Optional ISO date/datetime string -> ISO string, rejecting unparseable values. */
export function optionalDateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AssuranceValidationError(`${field} must be a date.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AssuranceValidationError(`${field} must be a valid date.`);
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2200) throw new AssuranceValidationError(`${field} is out of range.`);
  return d.toISOString();
}

export function requiredDateTime(value: unknown, field: string): string {
  const v = optionalDateTime(value, field);
  if (!v) throw new AssuranceValidationError(`${field} is required.`);
  return v;
}

export function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'on' || value === '1') return true;
  if (value === 'false' || value === 'off' || value === '0') return false;
  throw new AssuranceValidationError('Invalid yes/no value.');
}

/** Distinct, validated UUID list (bounded). */
export function uuidList(value: unknown, field: string, max = 50): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AssuranceValidationError(`${field} must be a list.`);
  if (value.length > max) throw new AssuranceValidationError(`${field} has too many entries.`);
  const out = new Set<string>();
  for (const v of value) out.add(requiredUuid(v, field));
  return [...out];
}

/** Search text for ILIKE: trimmed, capped, with LIKE metacharacters escaped. */
export function searchPattern(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 100);
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

/** First value of a Next.js searchParams entry. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
