// Data Hub 6.2D4C-A — governed transformation-profile document contract.
//
// This module is the ONLY place that parses/validates
// WorksheetMappingProfileVersion.profile_document. It is pure and
// synchronous: no Prisma import, no DB access, no filesystem/network
// access, and it never receives a column's source_header/sourceHeader as
// input — a sourceUnit/normalizedUnit can therefore only ever come from an
// explicit field in the document itself, never be inferred from a heading.
//
// documentVersion discriminates the shape:
//   1 — historical shape (D3B/D4B). Frozen forever, byte-for-byte identical
//       to the validation eligibility.ts has always performed: EXACTLY the
//       three keys {documentVersion, headerRowOneBased, schemaStatus}, no
//       more, no less. This is intentionally NOT the same strictness as
//       lib/data-hub/schemaMatch/governedSchema.ts's own independent copy
//       (which additionally enforces MAX_HEADER_ROW_ONE_BASED) — that
//       module is pinned to profile version_number 1 forever by its own
//       design and is out of scope for this contract; changing v1
//       behavior here would regress D4B, which this module must not do.
//   2 — new: adds declarative, non-executable per-column transformation
//       rules (columnRules), targeting governed SourceSchemaColumn ids.
//
// columnRules carry no raw/sample data, no credentials, and no executable
// expressions/code/SQL/JS — every object in this file is validated against
// an exact key allowlist, so an attempt to smuggle in a field like
// `expression`/`formula`/`code`/`sql` is rejected as an unknown key, not
// silently ignored.

export const VALUE_KINDS = [
  "STRING",
  "IDENTIFIER",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "TIME",
  "DATETIME",
  "DURATION",
  "PERCENTAGE",
  "CURRENCY",
  "LATITUDE",
  "LONGITUDE",
] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];
const VALUE_KIND_SET: ReadonlySet<string> = new Set(VALUE_KINDS);

export const DATE_POLICIES = ["AU_DD_MM_YYYY", "ISO_8601"] as const;
export type DatePolicy = (typeof DATE_POLICIES)[number];
const DATE_POLICY_SET: ReadonlySet<string> = new Set(DATE_POLICIES);

// Declarative only — D4C-A never resolves/converts a zone or executes any
// Date/string logic. "UTC" and "SOURCE_OFFSET" need no companion field;
// "IANA" additionally carries the zone identifier itself (e.g.
// "Australia/Adelaide" is a SYNTHETIC fixture/example only, never a
// hard-coded universal default); "UNSPECIFIED_LOCAL" is the explicit,
// governed statement that the value is wall-clock with no known zone —
// distinct from simply omitting the field, which is not permitted wherever
// a timezone policy is required.
export const TIME_ZONE_POLICY_KINDS = ["UTC", "IANA", "SOURCE_OFFSET", "UNSPECIFIED_LOCAL"] as const;
export type TimeZonePolicyKind = (typeof TIME_ZONE_POLICY_KINDS)[number];
const TIME_ZONE_POLICY_KIND_SET: ReadonlySet<string> = new Set(TIME_ZONE_POLICY_KINDS);

export type TimeZonePolicy =
  | { kind: "UTC" }
  | { kind: "IANA"; zone: string }
  | { kind: "SOURCE_OFFSET" }
  | { kind: "UNSPECIFIED_LOCAL" };

// Timezone semantics apply only to a clock-bearing value. DATE alone (a
// calendar day, already governed by datePolicy) is out of scope. DATETIME
// always represents an instant/timestamp, so a timezone policy is
// mandatory — exactly like datePolicy, an unstated timezone on a DATETIME
// is a governance gap this contract must never silently accept. TIME (a
// bare wall-clock time with no associated date) may optionally declare one
// when known, but is not forced to.
const TIME_ZONE_POLICY_ALLOWED_KINDS: ReadonlySet<ValueKind> = new Set(["DATETIME", "TIME"]);
const TIME_ZONE_POLICY_REQUIRED_KINDS: ReadonlySet<ValueKind> = new Set(["DATETIME"]);

// Minimum required vocabulary. Never extend implicitly from a column
// heading — a new unit may only be added here, explicitly, by a future
// phase.
export const UNITS = ["kg", "t", "m", "km", "s", "min", "h", "%", "AUD"] as const;
export type Unit = (typeof UNITS)[number];
const UNIT_SET: ReadonlySet<string> = new Set(UNITS);

type UnitFamily = "MASS" | "LENGTH" | "DURATION" | "PERCENTAGE" | "CURRENCY";

const UNIT_FAMILY: Record<Unit, UnitFamily> = {
  kg: "MASS",
  t: "MASS",
  m: "LENGTH",
  km: "LENGTH",
  s: "DURATION",
  min: "DURATION",
  h: "DURATION",
  "%": "PERCENTAGE",
  AUD: "CURRENCY",
};

// Which unit families a valueKind may declare sourceUnit/normalizedUnit
// from. A valueKind absent from this map may declare NEITHER field at
// all — this is how IDENTIFIER/LATITUDE/LONGITUDE/STRING/BOOLEAN/DATE/
// TIME/DATETIME are structurally forbidden from any unit-bearing
// conversion semantics.
const VALUE_KIND_UNIT_FAMILIES: Partial<Record<ValueKind, readonly UnitFamily[]>> = {
  INTEGER: ["MASS", "LENGTH"],
  DECIMAL: ["MASS", "LENGTH"],
  DURATION: ["DURATION"],
  PERCENTAGE: ["PERCENTAGE"],
  CURRENCY: ["CURRENCY"],
};

export interface ProfileDocumentV1 {
  documentVersion: 1;
  schemaStatus: string;
  headerRowOneBased: number | null;
}

export interface ColumnRuleV2 {
  /** Identity is the governed SourceSchemaColumn.id — never a free-floating heading. */
  sourceSchemaColumnId: string;
  valueKind: ValueKind;
  /** Required iff valueKind is DATE or DATETIME; forbidden otherwise. Never locale-dependent JS Date parsing. */
  datePolicy?: DatePolicy;
  /** Required (literal true) iff valueKind is IDENTIFIER; forbidden otherwise. Marks the value as never numerically coerced. */
  preserveLeadingZeros?: true;
  /** Required iff valueKind is DATETIME; optional iff TIME; forbidden otherwise. Declarative only — never resolved/converted in D4C-A. */
  timeZonePolicy?: TimeZonePolicy;
  /** Both present or both absent — never exactly one. Same unit family required; INTEGER additionally requires sourceUnit === normalizedUnit. */
  sourceUnit?: Unit;
  normalizedUnit?: Unit;
}

export interface ProfileDocumentV2 {
  documentVersion: 2;
  schemaStatus: string;
  headerRowOneBased: number | null;
  columnRules: ColumnRuleV2[];
}

export type ProfileDocument = ProfileDocumentV1 | ProfileDocumentV2;

export type ProfileDocumentParseResult = { ok: true; document: ProfileDocument } | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseV1(doc: Record<string, unknown>): ProfileDocumentParseResult {
  const keys = Object.keys(doc).sort();
  if (keys.join(",") !== "documentVersion,headerRowOneBased,schemaStatus") {
    return { ok: false, errors: ["v1: exact key set {documentVersion, headerRowOneBased, schemaStatus} is required"] };
  }
  if (doc.documentVersion !== 1) {
    return { ok: false, errors: ["v1: documentVersion must be exactly 1"] };
  }
  if (typeof doc.schemaStatus !== "string") {
    return { ok: false, errors: ["v1: schemaStatus must be a string"] };
  }
  if (doc.headerRowOneBased === null) {
    return { ok: true, document: { documentVersion: 1, schemaStatus: doc.schemaStatus, headerRowOneBased: null } };
  }
  if (typeof doc.headerRowOneBased !== "number" || !Number.isSafeInteger(doc.headerRowOneBased) || doc.headerRowOneBased < 1) {
    return { ok: false, errors: ["v1: headerRowOneBased must be null or a safe integer >= 1"] };
  }
  return { ok: true, document: { documentVersion: 1, schemaStatus: doc.schemaStatus, headerRowOneBased: doc.headerRowOneBased } };
}

const COLUMN_RULE_KEYS = new Set(["sourceSchemaColumnId", "valueKind", "datePolicy", "preserveLeadingZeros", "timeZonePolicy", "sourceUnit", "normalizedUnit"]);

function parseTimeZonePolicy(raw: unknown, where: string): { ok: true; policy: TimeZonePolicy } | { ok: false; errors: string[] } {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`${where}.timeZonePolicy must be a plain object`] };
  }
  if (typeof raw.kind !== "string" || !TIME_ZONE_POLICY_KIND_SET.has(raw.kind)) {
    return { ok: false, errors: [`${where}.timeZonePolicy.kind must be one of: ${TIME_ZONE_POLICY_KINDS.join(", ")}`] };
  }
  const kind = raw.kind as TimeZonePolicyKind;

  if (kind === "IANA") {
    const allowedKeys = new Set(["kind", "zone"]);
    const unknownKeys = Object.keys(raw).filter((k) => !allowedKeys.has(k));
    if (unknownKeys.length > 0) {
      return { ok: false, errors: [`${where}.timeZonePolicy has unknown key(s): ${unknownKeys.join(", ")}`] };
    }
    if (typeof raw.zone !== "string" || raw.zone.length === 0) {
      return { ok: false, errors: [`${where}.timeZonePolicy.zone is required and must be a non-empty string when kind is IANA`] };
    }
    return { ok: true, policy: { kind: "IANA", zone: raw.zone } };
  }

  const allowedKeys = new Set(["kind"]);
  const unknownKeys = Object.keys(raw).filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return { ok: false, errors: [`${where}.timeZonePolicy has unknown key(s) for kind ${kind}: ${unknownKeys.join(", ")}`] };
  }
  return { ok: true, policy: { kind } as TimeZonePolicy };
}

function parseColumnRule(raw: unknown, index: number): { ok: true; rule: ColumnRuleV2 } | { ok: false; errors: string[] } {
  const where = `v2: columnRules[${index}]`;
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`${where} must be a plain object`] };
  }

  const unknownKeys = Object.keys(raw).filter((k) => !COLUMN_RULE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return { ok: false, errors: [`${where} has unknown/unsupported key(s): ${unknownKeys.join(", ")}`] };
  }

  if (typeof raw.sourceSchemaColumnId !== "string" || raw.sourceSchemaColumnId.length === 0) {
    return { ok: false, errors: [`${where}.sourceSchemaColumnId must be a non-empty string`] };
  }
  if (typeof raw.valueKind !== "string" || !VALUE_KIND_SET.has(raw.valueKind)) {
    return { ok: false, errors: [`${where}.valueKind must be one of: ${VALUE_KINDS.join(", ")}`] };
  }
  const valueKind = raw.valueKind as ValueKind;

  const hasDatePolicy = Object.prototype.hasOwnProperty.call(raw, "datePolicy");
  const hasPreserveLeadingZeros = Object.prototype.hasOwnProperty.call(raw, "preserveLeadingZeros");
  const hasTimeZonePolicy = Object.prototype.hasOwnProperty.call(raw, "timeZonePolicy");
  const hasSourceUnit = Object.prototype.hasOwnProperty.call(raw, "sourceUnit");
  const hasNormalizedUnit = Object.prototype.hasOwnProperty.call(raw, "normalizedUnit");

  if (valueKind === "DATE" || valueKind === "DATETIME") {
    if (typeof raw.datePolicy !== "string" || !DATE_POLICY_SET.has(raw.datePolicy)) {
      return { ok: false, errors: [`${where} valueKind ${valueKind} requires datePolicy to be one of: ${DATE_POLICIES.join(", ")}`] };
    }
  } else if (hasDatePolicy) {
    return { ok: false, errors: [`${where} valueKind ${valueKind} must not declare datePolicy`] };
  }

  if (valueKind === "IDENTIFIER") {
    if (raw.preserveLeadingZeros !== true) {
      return { ok: false, errors: [`${where} valueKind IDENTIFIER requires preserveLeadingZeros: true`] };
    }
  } else if (hasPreserveLeadingZeros) {
    return { ok: false, errors: [`${where} valueKind ${valueKind} must not declare preserveLeadingZeros`] };
  }

  let timeZonePolicy: TimeZonePolicy | undefined;
  if (TIME_ZONE_POLICY_ALLOWED_KINDS.has(valueKind)) {
    if (!hasTimeZonePolicy) {
      if (TIME_ZONE_POLICY_REQUIRED_KINDS.has(valueKind)) {
        return { ok: false, errors: [`${where} valueKind ${valueKind} requires timeZonePolicy`] };
      }
    } else {
      const tz = parseTimeZonePolicy(raw.timeZonePolicy, where);
      if (!tz.ok) return tz;
      timeZonePolicy = tz.policy;
    }
  } else if (hasTimeZonePolicy) {
    return { ok: false, errors: [`${where} valueKind ${valueKind} must not declare timeZonePolicy`] };
  }

  const allowedFamilies = VALUE_KIND_UNIT_FAMILIES[valueKind];
  let sourceFamily: UnitFamily | undefined;
  let normalizedFamily: UnitFamily | undefined;

  if (!allowedFamilies) {
    if (hasSourceUnit || hasNormalizedUnit) {
      return { ok: false, errors: [`${where} valueKind ${valueKind} must not declare sourceUnit/normalizedUnit`] };
    }
  } else {
    // Unit-pair coherence: a normalized unit must never be claimed without
    // an explicitly governed original unit, or vice versa. Exactly one
    // present is always invalid — both absent, or both present, only.
    if (hasSourceUnit !== hasNormalizedUnit) {
      return { ok: false, errors: [`${where} sourceUnit and normalizedUnit must both be declared together, or both omitted`] };
    }
    if (hasSourceUnit) {
      if (typeof raw.sourceUnit !== "string" || !UNIT_SET.has(raw.sourceUnit)) {
        return { ok: false, errors: [`${where}.sourceUnit must be one of: ${UNITS.join(", ")}`] };
      }
      sourceFamily = UNIT_FAMILY[raw.sourceUnit as Unit];
      if (!allowedFamilies.includes(sourceFamily)) {
        return { ok: false, errors: [`${where} valueKind ${valueKind} is not compatible with sourceUnit "${raw.sourceUnit}"`] };
      }
    }
    if (hasNormalizedUnit) {
      if (typeof raw.normalizedUnit !== "string" || !UNIT_SET.has(raw.normalizedUnit)) {
        return { ok: false, errors: [`${where}.normalizedUnit must be one of: ${UNITS.join(", ")}`] };
      }
      normalizedFamily = UNIT_FAMILY[raw.normalizedUnit as Unit];
      if (!allowedFamilies.includes(normalizedFamily)) {
        return { ok: false, errors: [`${where} valueKind ${valueKind} is not compatible with normalizedUnit "${raw.normalizedUnit}"`] };
      }
    }
    if (sourceFamily !== undefined && normalizedFamily !== undefined && sourceFamily !== normalizedFamily) {
      return { ok: false, errors: [`${where} sourceUnit and normalizedUnit must belong to the same unit family`] };
    }
    // INTEGER carries a whole-number value with no fractional representation
    // available, so a cross-unit conversion within a family (e.g. kg -> t)
    // could produce a non-integral normalized value. D4C-A permits INTEGER
    // to declare a unit only when preserved exactly unchanged; a real
    // unit conversion belongs to DECIMAL, which already allows it.
    if (valueKind === "INTEGER" && hasSourceUnit && hasNormalizedUnit && raw.sourceUnit !== raw.normalizedUnit) {
      return {
        ok: false,
        errors: [`${where} valueKind INTEGER may only declare sourceUnit === normalizedUnit (no unit conversion); got sourceUnit "${raw.sourceUnit}", normalizedUnit "${raw.normalizedUnit}"`],
      };
    }
  }

  const rule: ColumnRuleV2 = { sourceSchemaColumnId: raw.sourceSchemaColumnId, valueKind };
  if (hasDatePolicy) rule.datePolicy = raw.datePolicy as DatePolicy;
  if (hasPreserveLeadingZeros) rule.preserveLeadingZeros = true;
  if (timeZonePolicy) rule.timeZonePolicy = timeZonePolicy;
  if (hasSourceUnit) rule.sourceUnit = raw.sourceUnit as Unit;
  if (hasNormalizedUnit) rule.normalizedUnit = raw.normalizedUnit as Unit;
  return { ok: true, rule };
}

const V2_TOP_LEVEL_KEYS = new Set(["documentVersion", "schemaStatus", "headerRowOneBased", "columnRules"]);

function parseV2(doc: Record<string, unknown>): ProfileDocumentParseResult {
  const unknownKeys = Object.keys(doc).filter((k) => !V2_TOP_LEVEL_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return { ok: false, errors: [`v2: unknown top-level key(s): ${unknownKeys.join(", ")}`] };
  }
  const missingKeys = [...V2_TOP_LEVEL_KEYS].filter((k) => !Object.prototype.hasOwnProperty.call(doc, k));
  if (missingKeys.length > 0) {
    return { ok: false, errors: [`v2: missing required key(s): ${missingKeys.join(", ")}`] };
  }
  if (typeof doc.schemaStatus !== "string") {
    return { ok: false, errors: ["v2: schemaStatus must be a string"] };
  }

  let headerRowOneBased: number | null;
  if (doc.headerRowOneBased === null) {
    headerRowOneBased = null;
  } else if (typeof doc.headerRowOneBased === "number" && Number.isSafeInteger(doc.headerRowOneBased) && doc.headerRowOneBased >= 1) {
    headerRowOneBased = doc.headerRowOneBased;
  } else {
    return { ok: false, errors: ["v2: headerRowOneBased must be null or a safe integer >= 1"] };
  }

  if (!Array.isArray(doc.columnRules)) {
    return { ok: false, errors: ["v2: columnRules must be an array"] };
  }

  const seenIds = new Set<string>();
  const rules: ColumnRuleV2[] = [];
  for (let i = 0; i < doc.columnRules.length; i++) {
    const parsed = parseColumnRule(doc.columnRules[i], i);
    if (!parsed.ok) return parsed;
    if (seenIds.has(parsed.rule.sourceSchemaColumnId)) {
      return { ok: false, errors: [`v2: duplicate sourceSchemaColumnId "${parsed.rule.sourceSchemaColumnId}" at columnRules[${i}]`] };
    }
    seenIds.add(parsed.rule.sourceSchemaColumnId);
    rules.push(parsed.rule);
  }

  return { ok: true, document: { documentVersion: 2, schemaStatus: doc.schemaStatus, headerRowOneBased, columnRules: rules } };
}

/**
 * Strict parser/validator for WorksheetMappingProfileVersion.profile_document.
 * Fail-closed: any unrecognized shape, including a documentVersion other
 * than 1 or 2, is rejected rather than guessed at.
 */
export function parseProfileDocument(doc: unknown): ProfileDocumentParseResult {
  if (!isPlainObject(doc)) {
    return { ok: false, errors: ["profile document must be a plain JSON object"] };
  }
  if (doc.documentVersion === 1) return parseV1(doc);
  if (doc.documentVersion === 2) return parseV2(doc);
  return { ok: false, errors: ["profile document documentVersion must be 1 or 2"] };
}

/**
 * The ONLY extraction D4B's staging-eligibility code may perform against a
 * profile document. Deliberately narrowed to headerRowOneBased alone —
 * columnRules is never returned here, so D4B code calling this helper has
 * no way to observe or execute transformation semantics.
 *
 * undefined = invalid document; null = governed "no tabular header".
 */
export function headerRowOneBasedFromDocument(doc: unknown): number | null | undefined {
  const result = parseProfileDocument(doc);
  if (!result.ok) return undefined;
  return result.document.headerRowOneBased;
}
