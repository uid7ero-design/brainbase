// Data Hub 6.2D4C-B2A — per-value transformer.
//
// Pure and deterministic: given one governed ColumnRuleV2 and one raw D4B
// cell shape, returns either a successful NormalizedValueOutput or a list
// of BLOCKING findings. Never writes anywhere, never reads Date.now(),
// Math.random(), or the process's local timezone/environment. Every
// timezone computation is driven only by the explicit IANA zone named in
// the rule (or, for UTC/SOURCE_OFFSET, no zone lookup at all).

import type { ColumnRuleV2, NormalizationFinding, RawCellInput, TransformValueResult, ValueKind } from "./contracts";
import { blockingFinding } from "./contracts";
import { compareExactDecimal, convertExactUnit, decimalToCanonicalString, exactDecimalFromFiniteNumber, parseStrictDecimalString, parseStrictIntegerString } from "./decimal";
import type { ExactDecimal } from "./decimal";
import { calendarDateToIsoString, clockTimeToCanonicalString, isValidIanaTimeZone, localWallClockToUtcInstant, parseStrictDate, parseStrictDateTime, parseStrictTime, parseUtcOffsetToMinutes, utcInstantToCanonicalString } from "./dateTime";

const LATITUDE_MIN = parseStrictIntegerString("-90")!;
const LATITUDE_MAX = parseStrictIntegerString("90")!;
const LONGITUDE_MIN = parseStrictIntegerString("-180")!;
const LONGITUDE_MAX = parseStrictIntegerString("180")!;

function fail(findings: NormalizationFinding[]): TransformValueResult {
  return { ok: false, findings };
}

function one(code: Parameters<typeof blockingFinding>[0], rule: ColumnRuleV2): TransformValueResult {
  return fail([blockingFinding(code, rule.sourceSchemaColumnId, rule.valueKind)]);
}

function succeed(rule: ColumnRuleV2, normalizedValue: string | boolean | null): TransformValueResult {
  return {
    ok: true,
    output: {
      sourceSchemaColumnId: rule.sourceSchemaColumnId,
      valueKind: rule.valueKind,
      normalizedValue,
      sourceUnit: rule.sourceUnit ?? null,
      normalizedUnit: rule.normalizedUnit ?? null,
    },
  };
}

/** Applies rule.sourceUnit -> rule.normalizedUnit if both are declared and differ; identity otherwise. */
function applyDeclaredUnitConversion(value: ExactDecimal, rule: ColumnRuleV2): { ok: true; value: ExactDecimal } | { ok: false } {
  if (!rule.sourceUnit || !rule.normalizedUnit || rule.sourceUnit === rule.normalizedUnit) {
    return { ok: true, value };
  }
  const converted = convertExactUnit(value, rule.sourceUnit, rule.normalizedUnit);
  if (!converted.ok) return { ok: false };
  return { ok: true, value: converted.value };
}

function transformNumericString(raw: RawCellInput, rule: ColumnRuleV2): { ok: true; value: ExactDecimal } | { ok: false; result: TransformValueResult } {
  if (raw.rawValueType === "NUMBER") {
    const n = raw.rawValue as number;
    const decimal = exactDecimalFromFiniteNumber(n);
    if (!decimal) return { ok: false, result: one("UNSAFE_NUMERIC_VALUE", rule) };
    return { ok: true, value: decimal };
  }
  if (raw.rawValueType === "STRING") {
    const s = raw.rawValue as string;
    const decimal = parseStrictDecimalString(s);
    if (!decimal) return { ok: false, result: one("MALFORMED_NUMERIC_STRING", rule) };
    return { ok: true, value: decimal };
  }
  return { ok: false, result: one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule) };
}

function transformString(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  if (raw.rawValueType !== "STRING") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  return succeed(rule, raw.rawValue as string);
}

function transformIdentifier(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  // NUMBER is rejected even though it is superficially "identifier-shaped"
  // — leading-zero evidence may already have been lost by the time a
  // numeric coercion happened upstream, and this contract never attempts
  // to recover data that may already be gone. Only a raw STRING (which, by
  // D4B's own raw-fidelity contract, preserves the source cell's exact
  // text) may become an IDENTIFIER.
  if (raw.rawValueType !== "STRING") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  return succeed(rule, raw.rawValue as string);
}

function transformBoolean(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  // No boolean lexicon exists in the D4C-A contract — "true"/"false"/
  // "yes"/"no"/"1"/"0" as STRING are deliberately never coerced; only a
  // raw BOOLEAN cell may become a normalized BOOLEAN.
  if (raw.rawValueType !== "BOOLEAN") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  return succeed(rule, raw.rawValue as boolean);
}

function transformInteger(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  if (raw.rawValueType === "NUMBER") {
    const n = raw.rawValue as number;
    if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return one("UNSAFE_NUMERIC_VALUE", rule);
    return succeed(rule, decimalToCanonicalString({ negative: n < 0, digits: BigInt(Math.abs(n)), scale: 0 }));
    // (BigInt(Math.abs(n)) is exact and safe: n is already a verified safe integer.)
  }
  if (raw.rawValueType === "STRING") {
    const s = raw.rawValue as string;
    const parsed = parseStrictIntegerString(s);
    if (!parsed) return one("MALFORMED_NUMERIC_STRING", rule);
    // D4C-A already guarantees an INTEGER rule can only declare
    // sourceUnit === normalizedUnit (never a real conversion), so no unit
    // arithmetic is ever performed here — the value passes through
    // unchanged, still an exact integer by construction.
    return succeed(rule, decimalToCanonicalString(parsed));
  }
  return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
}

function transformDecimalLike(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  const parsed = transformNumericString(raw, rule);
  if (!parsed.ok) return parsed.result;
  const converted = applyDeclaredUnitConversion(parsed.value, rule);
  if (!converted.ok) return one("NON_TERMINATING_UNIT_CONVERSION", rule);
  return succeed(rule, decimalToCanonicalString(converted.value));
}

function transformLatLng(rule: ColumnRuleV2, raw: RawCellInput, kind: "LATITUDE" | "LONGITUDE"): TransformValueResult {
  const parsed = transformNumericString(raw, rule);
  if (!parsed.ok) return parsed.result;
  const [min, max, code] = kind === "LATITUDE" ? ([LATITUDE_MIN, LATITUDE_MAX, "LATITUDE_OUT_OF_RANGE"] as const) : ([LONGITUDE_MIN, LONGITUDE_MAX, "LONGITUDE_OUT_OF_RANGE"] as const);
  if (compareExactDecimal(parsed.value, min) < 0 || compareExactDecimal(parsed.value, max) > 0) {
    return one(code, rule);
  }
  return succeed(rule, decimalToCanonicalString(parsed.value));
}

function transformDate(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  if (raw.rawValueType !== "STRING") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  const result = parseStrictDate(raw.rawValue as string, rule.datePolicy!);
  if (!result.ok) return one(result.reason === "MALFORMED" ? "MALFORMED_DATE_STRING" : "INVALID_CALENDAR_DATE", rule);
  return succeed(rule, calendarDateToIsoString(result.date));
}

function transformTime(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  if (raw.rawValueType !== "STRING") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  const result = parseStrictTime(raw.rawValue as string);
  if (!result.ok) return one(result.reason === "MALFORMED" ? "MALFORMED_TIME_STRING" : "INVALID_CLOCK_TIME", rule);
  // A bare TIME has no calendar date, so no instant/offset resolution is
  // possible or attempted regardless of which timeZonePolicy (if any) the
  // rule declares — UTC/IANA/SOURCE_OFFSET/UNSPECIFIED_LOCAL are all
  // identical no-ops here by design: the canonical wall-clock string is
  // the only thing this system can truthfully represent for TIME. The
  // timeZonePolicy remains meaningful only for DATETIME, where an actual
  // instant exists.
  return succeed(rule, clockTimeToCanonicalString(result.time));
}

function transformDateTime(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  if (raw.rawValueType !== "STRING") return one("UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND", rule);
  const parsed = parseStrictDateTime(raw.rawValue as string, rule.datePolicy!);
  if (!parsed.ok) return one(parsed.reason === "MALFORMED" ? "MALFORMED_DATETIME_STRING" : "INVALID_CALENDAR_DATE", rule);
  const { date, time, offset } = parsed.value;
  const policy = rule.timeZonePolicy!;

  if (policy.kind === "UTC") {
    if (offset !== null && offset !== "Z") return one("UNEXPECTED_OFFSET_PRESENT", rule);
    const utcMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
    return succeed(rule, utcInstantToCanonicalString(utcMs, time.fraction));
  }

  if (policy.kind === "SOURCE_OFFSET") {
    if (offset === null) return one("MISSING_SOURCE_OFFSET", rule);
    // The single, centralized range check (parseUtcOffsetToMinutes, in
    // dateTime.ts) is the only place that validates a numeric offset —
    // never re-derived here. A syntactically offset-shaped but
    // out-of-range string (e.g. "+09:99", "+25:00", "+15:00") is rejected
    // as INVALID_UTC_OFFSET and never reaches Date.UTC arithmetic.
    const parsedOffset = parseUtcOffsetToMinutes(offset);
    if (!parsedOffset.ok) return one("INVALID_UTC_OFFSET", rule);
    const localAsUtcMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
    const utcMs = localAsUtcMs - parsedOffset.minutes * 60_000;
    return succeed(rule, utcInstantToCanonicalString(utcMs, time.fraction));
  }

  if (policy.kind === "IANA") {
    if (offset !== null) return one("UNEXPECTED_OFFSET_PRESENT", rule);
    if (!isValidIanaTimeZone(policy.zone)) return one("INVALID_IANA_ZONE", rule);
    const resolved = localWallClockToUtcInstant(policy.zone, { year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute, second: time.second });
    if (!resolved.ok) return one(resolved.kind === "NONEXISTENT" ? "NONEXISTENT_LOCAL_TIME" : "AMBIGUOUS_LOCAL_TIME", rule);
    return succeed(rule, utcInstantToCanonicalString(resolved.utcMs, time.fraction));
  }

  // UNSPECIFIED_LOCAL — preserve the exact local wall-clock, never fabricate
  // an offset or claim it is a known instant. Canonical shape deliberately
  // has NO trailing "Z"/offset, distinguishing it from every other policy's
  // output, which always represents a genuine UTC instant.
  if (offset !== null) return one("UNEXPECTED_OFFSET_PRESENT", rule);
  const base = `${calendarDateToIsoString(date)}T${clockTimeToCanonicalString(time)}`;
  return succeed(rule, base);
}

export function transformValue(rule: ColumnRuleV2, raw: RawCellInput): TransformValueResult {
  // D4A's own DB constraints make this impossible in practice, but this
  // transformer is a pure function with no DB behind it — it must not
  // trust its caller's raw shape blindly.
  const shapeOk =
    (raw.rawValueType === "STRING" && typeof raw.rawValue === "string") ||
    (raw.rawValueType === "NUMBER" && typeof raw.rawValue === "number") ||
    (raw.rawValueType === "BOOLEAN" && typeof raw.rawValue === "boolean") ||
    (raw.rawValueType === "NULL" && raw.rawValue === null);
  if (!shapeOk) return one("INVALID_RAW_SHAPE", rule);

  if (raw.rawValueType === "NULL") {
    // Valid for every current ValueKind — no requiredness rule exists in
    // the D4C-A contract, and none is invented here.
    return succeed(rule, null);
  }

  const kind: ValueKind = rule.valueKind;
  switch (kind) {
    case "STRING":
      return transformString(rule, raw);
    case "IDENTIFIER":
      return transformIdentifier(rule, raw);
    case "BOOLEAN":
      return transformBoolean(rule, raw);
    case "INTEGER":
      return transformInteger(rule, raw);
    case "DECIMAL":
    case "DURATION":
    case "PERCENTAGE":
    case "CURRENCY":
      return transformDecimalLike(rule, raw);
    case "LATITUDE":
      return transformLatLng(rule, raw, "LATITUDE");
    case "LONGITUDE":
      return transformLatLng(rule, raw, "LONGITUDE");
    case "DATE":
      return transformDate(rule, raw);
    case "TIME":
      return transformTime(rule, raw);
    case "DATETIME":
      return transformDateTime(rule, raw);
    default: {
      const exhaustive: never = kind;
      throw new Error(`transformValue: unhandled valueKind ${String(exhaustive)}`);
    }
  }
}
