// Data Hub 6.2D4C-B2A — pure normalization transformer contracts.
//
// Nothing in this module (or any sibling module under
// lib/data-hub/normalization/) imports Prisma, performs DB/network/file
// I/O, reads Date.now()/Math.random(), or depends on the host process's
// local timezone (process.env.TZ or the OS timezone) — every function is a
// pure, deterministic mapping from (profile_document, raw cell/row data) to
// (normalization plan | normalized value | findings). This is a foundation
// library only: it never creates a normalization run, never persists
// anything, and is never wired into an executor/route in this phase.

import type { ValueKind, Unit, DatePolicy, TimeZonePolicy, ColumnRuleV2 } from "../schemaProfiles/profileDocument";

export type { ValueKind, Unit, DatePolicy, TimeZonePolicy, ColumnRuleV2 };

// B2B will persist this literal into DataHubNormalizationRun.normalizer_version.
// Deliberately NOT derived from package.json version or the current date —
// it identifies the exact semantics of THIS transformer implementation, and
// must only ever change when a maintainer deliberately revises those
// semantics.
export const NORMALIZER_VERSION = "v1" as const;

// Stable, closed allowlist. A finding's code is data a caller may safely
// branch on (e.g. to decide whether a defect is worth surfacing to an
// operator) — it is never a free-form string.
export const NORMALIZATION_FINDING_CODES = [
  // Plan-level (buildNormalizationPlan)
  "PROFILE_DOCUMENT_INVALID",
  "NORMALIZATION_INELIGIBLE_V1",
  "MISSING_GOVERNED_RULE",
  "UNKNOWN_RULE_COLUMN",
  // Value-level (transformValue) — raw-shape/type mismatches
  "INVALID_RAW_SHAPE",
  "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND",
  // Numeric grammar/range
  "MALFORMED_NUMERIC_STRING",
  "UNSAFE_NUMERIC_VALUE",
  "INTEGER_NOT_WHOLE",
  "LATITUDE_OUT_OF_RANGE",
  "LONGITUDE_OUT_OF_RANGE",
  // Unit conversion
  "NON_TERMINATING_UNIT_CONVERSION",
  // Date/time/datetime grammar and calendar validity
  "MALFORMED_DATE_STRING",
  "INVALID_CALENDAR_DATE",
  "MALFORMED_TIME_STRING",
  "INVALID_CLOCK_TIME",
  "MALFORMED_DATETIME_STRING",
  // Timezone/instant resolution
  "MISSING_SOURCE_OFFSET",
  "UNEXPECTED_OFFSET_PRESENT",
  "INVALID_IANA_ZONE",
  "NONEXISTENT_LOCAL_TIME",
  "AMBIGUOUS_LOCAL_TIME",
] as const;
export type NormalizationFindingCode = (typeof NORMALIZATION_FINDING_CODES)[number];

export type NormalizationFindingSeverity = "WARNING" | "BLOCKING_ERROR";

/**
 * A pure, structured description of a defect. Never carries a raw cell
 * value, worksheet Notes/text payload, address/person/PII content, or any
 * other cell content or secret — only stable metadata (code, the governed
 * column identity it concerns, and the valueKind it was evaluated against).
 */
export interface NormalizationFinding {
  severity: NormalizationFindingSeverity;
  code: NormalizationFindingCode;
  sourceSchemaColumnId?: string;
  valueKind?: ValueKind;
}

export function blockingFinding(code: NormalizationFindingCode, sourceSchemaColumnId?: string, valueKind?: ValueKind): NormalizationFinding {
  const finding: NormalizationFinding = { severity: "BLOCKING_ERROR", code };
  if (sourceSchemaColumnId !== undefined) finding.sourceSchemaColumnId = sourceSchemaColumnId;
  if (valueKind !== undefined) finding.valueKind = valueKind;
  return finding;
}

// ---------------------------------------------------------------------------
// Normalization plan
// ---------------------------------------------------------------------------

/**
 * A validated, ready-to-execute mapping from every governed source column to
 * its exact declarative transformation rule. Built once from a pinned
 * WorksheetMappingProfileVersion.profile_document — never re-derived from
 * WorksheetMappingProfile.active_profile_version_id, and never consulted
 * against a live/"current" profile pointer anywhere in this module.
 */
export interface NormalizationPlan {
  /** One entry per governed source column, keyed by SourceSchemaColumn.id. */
  rulesByColumnId: ReadonlyMap<string, ColumnRuleV2>;
}

export type NormalizationPlanResult = { ok: true; plan: NormalizationPlan } | { ok: false; findings: NormalizationFinding[] };

// ---------------------------------------------------------------------------
// Raw input contract (the exact D4B durable shape)
// ---------------------------------------------------------------------------

export const RAW_VALUE_TYPES = ["STRING", "NUMBER", "BOOLEAN", "NULL"] as const;
export type RawValueType = (typeof RAW_VALUE_TYPES)[number];

/** Mirrors DataHubRawCell.raw_value_type/.raw_value exactly (D4A/D4B). */
export interface RawCellInput {
  rawValueType: RawValueType;
  rawValue: string | number | boolean | null;
}

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

/** Never a JSON number — matches DataHubNormalizedCell's own scalar/null CHECK. */
export type NormalizedValue = string | boolean | null;

export interface NormalizedValueOutput {
  sourceSchemaColumnId: string;
  valueKind: ValueKind;
  normalizedValue: NormalizedValue;
  sourceUnit: Unit | null;
  normalizedUnit: Unit | null;
}

export type TransformValueResult = { ok: true; output: NormalizedValueOutput } | { ok: false; findings: NormalizationFinding[] };
