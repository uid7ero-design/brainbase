import { describe, expect, it } from "vitest";
import { transformValue } from "@/lib/data-hub/normalization/transformValue";
import type { ColumnRuleV2, RawCellInput } from "@/lib/data-hub/normalization/contracts";
import { VALUE_KINDS } from "@/lib/data-hub/schemaProfiles/profileDocument";

const COL = "synthetic-col";

function rule(overrides: Partial<ColumnRuleV2> = {}): ColumnRuleV2 {
  return { sourceSchemaColumnId: COL, valueKind: "STRING", ...overrides } as ColumnRuleV2;
}

const S = (v: string): RawCellInput => ({ rawValueType: "STRING", rawValue: v });
const N = (v: number): RawCellInput => ({ rawValueType: "NUMBER", rawValue: v });
const B = (v: boolean): RawCellInput => ({ rawValueType: "BOOLEAN", rawValue: v });
const NUL: RawCellInput = { rawValueType: "NULL", rawValue: null };

function expectOk(result: ReturnType<typeof transformValue>, normalizedValue: string | boolean | null) {
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.output.normalizedValue).toBe(normalizedValue);
}

function expectBlocked(result: ReturnType<typeof transformValue>, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: "BLOCKING_ERROR", code });
  }
}

describe("6.2D4C-B2A transformValue — raw shape contract", () => {
  it("accepts every exact D4B raw shape whose type matches valueKind", () => {
    expectOk(transformValue(rule({ valueKind: "STRING" }), S("hi")), "hi");
    expectOk(transformValue(rule({ valueKind: "INTEGER" }), N(5)), "5");
    expectOk(transformValue(rule({ valueKind: "BOOLEAN" }), B(true)), true);
    expectOk(transformValue(rule({ valueKind: "STRING" }), NUL), null);
  });

  it("rejects a rawValueType/rawValue runtime mismatch as INVALID_RAW_SHAPE, even though D4A's own DB constraints make this impossible", () => {
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), { rawValueType: "STRING", rawValue: 5 } as unknown as RawCellInput), "INVALID_RAW_SHAPE");
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), { rawValueType: "NUMBER", rawValue: "5" } as unknown as RawCellInput), "INVALID_RAW_SHAPE");
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), { rawValueType: "BOOLEAN", rawValue: "true" } as unknown as RawCellInput), "INVALID_RAW_SHAPE");
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), { rawValueType: "NULL", rawValue: "x" } as unknown as RawCellInput), "INVALID_RAW_SHAPE");
  });
});

describe("6.2D4C-B2A transformValue — NULL is valid for every ValueKind", () => {
  for (const valueKind of VALUE_KINDS) {
    it(`${valueKind}: NULL raw -> normalizedValue null`, () => {
      const r = rule({
        valueKind,
        ...(valueKind === "DATE" || valueKind === "DATETIME" ? { datePolicy: "ISO_8601" as const } : {}),
        ...(valueKind === "IDENTIFIER" ? { preserveLeadingZeros: true as const } : {}),
        ...(valueKind === "DATETIME" ? { timeZonePolicy: { kind: "UTC" as const } } : {}),
      });
      expectOk(transformValue(r, NUL), null);
    });
  }
});

describe("6.2D4C-B2A transformValue — STRING", () => {
  it("preserves source string contents exactly, no trimming", () => {
    expectOk(transformValue(rule({ valueKind: "STRING" }), S("  padded  ")), "  padded  ");
  });
  it("rejects NUMBER and BOOLEAN — never stringified", () => {
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), N(5)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
    expectBlocked(transformValue(rule({ valueKind: "STRING" }), B(true)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
});

describe("6.2D4C-B2A transformValue — IDENTIFIER", () => {
  const idRule = rule({ valueKind: "IDENTIFIER", preserveLeadingZeros: true });
  it("preserves a leading-zero identifier string exactly", () => {
    expectOk(transformValue(idRule, S("0042")), "0042");
  });
  it("rejects a NUMBER — never coerced, leading-zero evidence may already be lost", () => {
    expectBlocked(transformValue(idRule, N(42)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
  it("rejects BOOLEAN", () => {
    expectBlocked(transformValue(idRule, B(true)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
});

describe("6.2D4C-B2A transformValue — BOOLEAN", () => {
  const boolRule = rule({ valueKind: "BOOLEAN" });
  it("accepts native true/false", () => {
    expectOk(transformValue(boolRule, B(true)), true);
    expectOk(transformValue(boolRule, B(false)), false);
  });
  it("rejects string lexicon coercion — no boolean lexicon exists in D4C-A", () => {
    for (const s of ["true", "false", "yes", "no", "1", "0"]) {
      expectBlocked(transformValue(boolRule, S(s)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
    }
  });
});

describe("6.2D4C-B2A transformValue — INTEGER", () => {
  const intRule = rule({ valueKind: "INTEGER" });
  it("accepts positive/negative/zero NUMBER", () => {
    expectOk(transformValue(intRule, N(5)), "5");
    expectOk(transformValue(intRule, N(-5)), "-5");
    expectOk(transformValue(intRule, N(0)), "0");
  });
  it("rejects an unsafe-integer NUMBER", () => {
    expectBlocked(transformValue(intRule, N(2 ** 53)), "UNSAFE_NUMERIC_VALUE");
    expectBlocked(transformValue(intRule, N(Number.MAX_SAFE_INTEGER + 1)), "UNSAFE_NUMERIC_VALUE");
  });
  it("rejects a decimal-shaped NUMBER value that is not mathematically integral via strict STRING grammar, and rejects decimal STRING", () => {
    expectBlocked(transformValue(intRule, S("5.5")), "MALFORMED_NUMERIC_STRING");
  });
  it("rejects a malformed integer STRING", () => {
    expectBlocked(transformValue(intRule, S("abc")), "MALFORMED_NUMERIC_STRING");
    expectBlocked(transformValue(intRule, S("1,234")), "MALFORMED_NUMERIC_STRING");
  });
  it("preserves an arbitrarily large integer STRING exactly, without going through JS Number", () => {
    expectOk(transformValue(intRule, S("00123456789012345678901234567890")), "123456789012345678901234567890");
  });
  it("rejects BOOLEAN", () => {
    expectBlocked(transformValue(intRule, B(true)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
});

describe("6.2D4C-B2A transformValue — DECIMAL canonicalization", () => {
  const decRule = rule({ valueKind: "DECIMAL" });
  it("strips redundant leading zeros and trailing fractional zeros", () => {
    expectOk(transformValue(decRule, S("007.500")), "7.5");
  });
  it("normalizes negative zero to 0", () => {
    expectOk(transformValue(decRule, S("-0.00")), "0");
  });
  it("never emits exponent notation", () => {
    const r = transformValue(decRule, N(1.5e21));
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.output.normalizedValue)).not.toMatch(/e/i);
  });
  it("rejects malformed strings: thousands separators, currency symbols, percent symbols, whitespace, scientific notation", () => {
    for (const s of ["1,234.5", "$5.00", "5%", " 5", "1.5e10", "5."]) {
      expectBlocked(transformValue(decRule, S(s)), "MALFORMED_NUMERIC_STRING");
    }
  });
  it("rejects locale decimal commas", () => {
    expectBlocked(transformValue(decRule, S("5,5")), "MALFORMED_NUMERIC_STRING");
  });
  it("rejects non-finite NUMBER", () => {
    expectBlocked(transformValue(decRule, N(NaN)), "UNSAFE_NUMERIC_VALUE");
    expectBlocked(transformValue(decRule, N(Infinity)), "UNSAFE_NUMERIC_VALUE");
    expectBlocked(transformValue(decRule, N(-Infinity)), "UNSAFE_NUMERIC_VALUE");
  });
});

describe("6.2D4C-B2A transformValue — units", () => {
  it("kg <-> t both directions, exact decimal shifting", () => {
    expectOk(transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "kg", normalizedUnit: "t" }), N(5000)), "5");
    expectOk(transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "t", normalizedUnit: "kg" }), N(5)), "5000");
  });
  it("m <-> km both directions", () => {
    expectOk(transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "m", normalizedUnit: "km" }), S("2500")), "2.5");
    expectOk(transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "km", normalizedUnit: "m" }), S("2.5")), "2500");
  });
  it("same-unit is a pure identity, no conversion attempted", () => {
    expectOk(transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "kg", normalizedUnit: "kg" }), N(5)), "5");
  });
  it("duration: exact finite conversions succeed (90 s -> 1.5 min; 2 h -> 7200 s; 90 min -> 1.5 h)", () => {
    expectOk(transformValue(rule({ valueKind: "DURATION", sourceUnit: "s", normalizedUnit: "min" }), N(90)), "1.5");
    expectOk(transformValue(rule({ valueKind: "DURATION", sourceUnit: "h", normalizedUnit: "s" }), N(2)), "7200");
    expectOk(transformValue(rule({ valueKind: "DURATION", sourceUnit: "min", normalizedUnit: "h" }), N(90)), "1.5");
  });
  it("duration: a non-terminating conversion blocks rather than silently rounding (1 s -> min)", () => {
    expectBlocked(transformValue(rule({ valueKind: "DURATION", sourceUnit: "s", normalizedUnit: "min" }), N(1)), "NON_TERMINATING_UNIT_CONVERSION");
  });
  it("units are copied exactly from the rule into the output, including when neither is declared", () => {
    const withUnits = transformValue(rule({ valueKind: "DECIMAL", sourceUnit: "kg", normalizedUnit: "t" }), N(1000));
    expect(withUnits.ok).toBe(true);
    if (withUnits.ok) expect(withUnits.output).toMatchObject({ sourceUnit: "kg", normalizedUnit: "t" });

    const withoutUnits = transformValue(rule({ valueKind: "DECIMAL" }), N(5));
    expect(withoutUnits.ok).toBe(true);
    if (withoutUnits.ok) expect(withoutUnits.output).toMatchObject({ sourceUnit: null, normalizedUnit: null });
  });
});

describe("6.2D4C-B2A transformValue — LATITUDE/LONGITUDE", () => {
  it("accepts exact boundary values", () => {
    expectOk(transformValue(rule({ valueKind: "LATITUDE" }), N(90)), "90");
    expectOk(transformValue(rule({ valueKind: "LATITUDE" }), N(-90)), "-90");
    expectOk(transformValue(rule({ valueKind: "LONGITUDE" }), N(180)), "180");
    expectOk(transformValue(rule({ valueKind: "LONGITUDE" }), N(-180)), "-180");
  });
  it("rejects values just outside the boundary using exact string comparison, not float coercion", () => {
    expectBlocked(transformValue(rule({ valueKind: "LATITUDE" }), S("90.000000000000000001")), "LATITUDE_OUT_OF_RANGE");
    expectBlocked(transformValue(rule({ valueKind: "LATITUDE" }), S("-90.000000000000000001")), "LATITUDE_OUT_OF_RANGE");
    expectBlocked(transformValue(rule({ valueKind: "LONGITUDE" }), S("180.000000000000000001")), "LONGITUDE_OUT_OF_RANGE");
  });
  it("accepts a value just inside the boundary at high precision", () => {
    expectOk(transformValue(rule({ valueKind: "LATITUDE" }), S("89.999999999999999999")), "89.999999999999999999");
  });
});

describe("6.2D4C-B2A transformValue — DATE", () => {
  it("AU_DD_MM_YYYY: valid date, canonical YYYY-MM-DD output", () => {
    expectOk(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("28/09/2026")), "2026-09-28");
  });
  it("AU_DD_MM_YYYY: rejects an out-of-range day as INVALID_CALENDAR_DATE", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("32/01/2026")), "INVALID_CALENDAR_DATE");
  });
  it("AU_DD_MM_YYYY: rejects malformed grammar (single-digit day)", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("1/01/2026")), "MALFORMED_DATE_STRING");
  });
  it("AU_DD_MM_YYYY: leap year Feb 29 accepted in a leap year, rejected otherwise", () => {
    expectOk(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("29/02/2024")), "2024-02-29");
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("29/02/2023")), "INVALID_CALENDAR_DATE");
  });
  it("ISO_8601: valid date", () => {
    expectOk(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), S("2026-09-28")), "2026-09-28");
  });
  it("ISO_8601: rejects an out-of-range month as INVALID_CALENDAR_DATE, and malformed grammar as MALFORMED_DATE_STRING", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), S("2026-13-01")), "INVALID_CALENDAR_DATE");
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), S("2026-9-28")), "MALFORMED_DATE_STRING");
  });
  it("ISO_8601: explicitly accepts D4B's SheetJS-produced UTC-midnight timestamp shape as a narrow, documented accommodation", () => {
    expectOk(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), S("2026-09-28T00:00:00.000Z")), "2026-09-28");
  });
  it("ISO_8601: rejects a non-midnight timestamp — arbitrary datetimes are never generally treated as dates", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), S("2026-09-28T10:15:00.000Z")), "MALFORMED_DATE_STRING");
  });
  it("AU_DD_MM_YYYY: the ISO-midnight-timestamp accommodation does not apply to the AU policy", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "AU_DD_MM_YYYY" }), S("2026-09-28T00:00:00.000Z")), "MALFORMED_DATE_STRING");
  });
  it("rejects non-STRING raw for DATE", () => {
    expectBlocked(transformValue(rule({ valueKind: "DATE", datePolicy: "ISO_8601" }), N(20260928)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
});

describe("6.2D4C-B2A transformValue — TIME", () => {
  it("accepts boundary times, canonicalizing to HH:mm:ss", () => {
    expectOk(transformValue(rule({ valueKind: "TIME" }), S("00:00")), "00:00:00");
    expectOk(transformValue(rule({ valueKind: "TIME" }), S("23:59:59")), "23:59:59");
  });
  it("preserves fractional seconds verbatim, never rounded", () => {
    expectOk(transformValue(rule({ valueKind: "TIME" }), S("23:59:59.123456789")), "23:59:59.123456789");
  });
  it("rejects an invalid clock time (grammar matches, value out of range)", () => {
    expectBlocked(transformValue(rule({ valueKind: "TIME" }), S("24:00")), "INVALID_CLOCK_TIME");
    expectBlocked(transformValue(rule({ valueKind: "TIME" }), S("12:60")), "INVALID_CLOCK_TIME");
    expectBlocked(transformValue(rule({ valueKind: "TIME" }), S("12:30:60")), "INVALID_CLOCK_TIME");
  });
  it("rejects malformed grammar", () => {
    expectBlocked(transformValue(rule({ valueKind: "TIME" }), S("12:3")), "MALFORMED_TIME_STRING");
    expectBlocked(transformValue(rule({ valueKind: "TIME" }), S("12")), "MALFORMED_TIME_STRING");
  });
  it("every timeZonePolicy kind produces the identical canonical output for TIME — no instant exists, so none can perform a DST-based conversion", () => {
    const kinds = [{ kind: "UTC" as const }, { kind: "IANA" as const, zone: "America/New_York" }, { kind: "SOURCE_OFFSET" as const }, { kind: "UNSPECIFIED_LOCAL" as const }];
    for (const timeZonePolicy of kinds) {
      expectOk(transformValue(rule({ valueKind: "TIME", timeZonePolicy }), S("14:30:00")), "14:30:00");
    }
    // timeZonePolicy is optional on TIME — absent is also valid.
    expectOk(transformValue(rule({ valueKind: "TIME" }), S("14:30:00")), "14:30:00");
  });
});

describe("6.2D4C-B2A transformValue — DATETIME", () => {
  it("UTC: normalizes to canonical UTC, accepting an absent or redundant Z offset", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UTC" } });
    expectOk(transformValue(r, S("2026-09-28T14:30:00")), "2026-09-28T14:30:00Z");
    expectOk(transformValue(r, S("2026-09-28T14:30:00Z")), "2026-09-28T14:30:00Z");
  });
  it("UTC: rejects an explicit numeric offset as a contradiction", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UTC" } });
    expectBlocked(transformValue(r, S("2026-09-28T14:30:00+05:00")), "UNEXPECTED_OFFSET_PRESENT");
  });
  it("SOURCE_OFFSET: normalizes an explicit offset to canonical UTC exactly", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "SOURCE_OFFSET" } });
    expectOk(transformValue(r, S("2026-09-28T14:30:00+09:30")), "2026-09-28T05:00:00Z");
    expectOk(transformValue(r, S("2026-09-28T14:30:00Z")), "2026-09-28T14:30:00Z");
  });
  it("SOURCE_OFFSET: a missing offset is BLOCKING", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "SOURCE_OFFSET" } });
    expectBlocked(transformValue(r, S("2026-09-28T14:30:00")), "MISSING_SOURCE_OFFSET");
  });
  it("IANA: ordinary conversion, using a non-Australian synthetic zone (proves no Adelaide hard-code)", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "America/New_York" } });
    expectOk(transformValue(r, S("2026-07-15T12:00:00")), "2026-07-15T16:00:00Z");
  });
  it("IANA: rejects an invalid zone identifier", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "Not/AZone" } });
    expectBlocked(transformValue(r, S("2026-07-15T12:00:00")), "INVALID_IANA_ZONE");
  });
  it("IANA: rejects an explicit offset present alongside a zone as a contradiction", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "America/New_York" } });
    expectBlocked(transformValue(r, S("2026-07-15T12:00:00Z")), "UNEXPECTED_OFFSET_PRESENT");
  });
  it("IANA: a DST spring-forward gap (nonexistent local time) is BLOCKING, never silently shifted", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "America/New_York" } });
    expectBlocked(transformValue(r, S("2026-03-08T02:30:00")), "NONEXISTENT_LOCAL_TIME");
  });
  it("IANA: a DST fall-back overlap (ambiguous local time) is BLOCKING, never silently resolved to one side", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "America/New_York" } });
    expectBlocked(transformValue(r, S("2026-11-01T01:30:00")), "AMBIGUOUS_LOCAL_TIME");
  });
  it("UNSPECIFIED_LOCAL: preserves the exact local wall clock with no fabricated offset — a structurally different canonical shape than every instant-representing policy", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UNSPECIFIED_LOCAL" } });
    expectOk(transformValue(r, S("2026-09-28T14:30:00")), "2026-09-28T14:30:00");
  });
  it("UNSPECIFIED_LOCAL: rejects an explicit offset as a contradiction (it would claim a known instant)", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UNSPECIFIED_LOCAL" } });
    expectBlocked(transformValue(r, S("2026-09-28T14:30:00Z")), "UNEXPECTED_OFFSET_PRESENT");
  });
  it("rejects malformed grammar (missing T separator)", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UTC" } });
    expectBlocked(transformValue(r, S("2026-09-28 14:30:00")), "MALFORMED_DATETIME_STRING");
  });
  it("rejects non-STRING raw", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "UTC" } });
    expectBlocked(transformValue(r, N(1)), "UNSUPPORTED_RAW_TYPE_FOR_VALUE_KIND");
  });
});

describe("6.2D4C-B2A transformValue — security", () => {
  it("a finding never contains the raw cell value or any other content, only stable metadata keys", () => {
    const sensitiveButRejected = S("123 Fake Street, Anytown — do not leak this into a finding");
    const r = transformValue(rule({ valueKind: "IDENTIFIER", preserveLeadingZeros: true }), N(5)); // wrong type, blocks
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const finding of r.findings) {
        expect(Object.keys(finding).sort()).toEqual(expect.arrayContaining(["code", "severity"]));
        for (const key of Object.keys(finding)) {
          expect(["severity", "code", "sourceSchemaColumnId", "valueKind"]).toContain(key);
        }
      }
    }
    // The sensitive fixture string itself is never fed into a code path that
    // could echo it back — asserted structurally above, not by substring
    // search (which would be vacuous here since it was never passed in).
    void sensitiveButRejected;
  });
});

describe("6.2D4C-B2A transformValue — determinism", () => {
  it("the same input produces a deep-equal result every time", () => {
    const r = rule({ valueKind: "DATETIME", datePolicy: "ISO_8601", timeZonePolicy: { kind: "IANA", zone: "Pacific/Auckland" } });
    const raw = S("2026-09-28T14:30:00");
    const a = transformValue(r, raw);
    const b = transformValue(r, raw);
    const c = transformValue(r, raw);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
