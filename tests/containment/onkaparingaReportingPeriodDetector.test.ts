import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  detectOnkaparingaReportingPeriod,
  validateManualSelection,
  validateCandidateRange,
  evaluateConfirmationEligibility,
  type OnkaparingaDetectorInput,
  type DetectorResult,
  type EvidenceItem,
  type EvidenceType,
} from "@/lib/data-hub/reportingPeriod/onkaparingaDetector";

// Data Hub 6.2C2 — Onkaparinga reporting-period detector containment
// suite. All 31 test IDs from the task brief, plus a structural JSON
// Schema contract check, schema/TypeScript enum synchronization checks,
// and global-invariant assertions. Purely behavioral over a pure
// function — no mocks, no DB, no network. Every ID asserts the FULL,
// exact evidence array (fixed, documented order — see `EVIDENCE_ORDER`
// below) rather than merely outcome/reasonCode, per the 6.2C2 contract:
// evidence statuses must reflect the FINAL interpretation (conflicting
// SUPPORTS entries are re-stamped CONFLICTS), not raw per-field parse
// success.

const ROOT = process.cwd();
const SERVICE_PATH = "lib/data-hub/reportingPeriod/onkaparingaDetector.ts";
const TEST_PATH = "tests/containment/onkaparingaReportingPeriodDetector.test.ts";

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── Static containment: pure module, no forbidden imports ───────────────

describe("onkaparingaDetector — static containment: pure, DB/session/filesystem/network-free", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never imports prisma, db, org/session, fetch, filesystem, or storage APIs", () => {
    expect(code).not.toMatch(/from\s+["'].*prisma["']/);
    expect(code).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(code).not.toMatch(/requireSession|requireRole/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/from\s+["']fs["']|require\(["']fs["']\)/);
    expect(code).not.toMatch(/from\s+["'][^"']*\/storage\//);
    expect(code).not.toMatch(/@vercel\/blob/);
    expect(code).not.toMatch(/next\/server/);
  });

  it("never reads workbook bytes (no xlsx/workbookParser import)", () => {
    expect(code).not.toMatch(/from\s+["']xlsx["']/);
    expect(code).not.toMatch(/workbookParser/);
  });

  it("performs no writes of any kind (no create/update/delete/upsert vocabulary)", () => {
    expect(code).not.toMatch(/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
  });

  it("performs no toggle/config/env writes and touches no persistence/config module", () => {
    expect(code).not.toMatch(/process\.env\.\w+\s*=/);
    expect(code).not.toMatch(/sourceSystem/i);
    expect(code).not.toMatch(/toggle/i);
  });
});

// ─── Minimal generic JSON Schema structural validator (no ajv dependency,
// per the task brief's "do not add ajv unless already present" rule).
// Supports exactly the subset of Draft 2020-12 constructs used by
// onkaparingaDetector.schema.json: $ref/$defs, type, enum, const, pattern,
// minLength, minimum/maximum, minItems, properties, required,
// additionalProperties:false, oneOf, allOf, if/then/else, items. ───────

const SCHEMA_PATH = "lib/data-hub/reportingPeriod/onkaparingaDetector.schema.json";
const schemaDoc = JSON.parse(read(SCHEMA_PATH));
const defs = schemaDoc.$defs;

function resolveRef(ref: string): unknown {
  const key = ref.replace("#/$defs/", "");
  return defs[key];
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return false;
  }
}

function validates(schema: unknown, value: unknown): boolean {
  try {
    assertValid(schema, value);
    return true;
  } catch {
    return false;
  }
}

function assertValid(schemaIn: unknown, value: unknown): void {
  let schema = schemaIn as Record<string, unknown>;
  if (typeof schema.$ref === "string") {
    schema = resolveRef(schema.$ref) as Record<string, unknown>;
  }

  if (schema.oneOf) {
    const matches = (schema.oneOf as unknown[]).filter((s) => validates(s, value));
    if (matches.length !== 1) {
      throw new Error(`oneOf expected exactly 1 match, got ${matches.length}`);
    }
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeMatches(t, value))) {
      throw new Error(`type mismatch: expected one of ${types.join(",")}, got ${JSON.stringify(value)}`);
    }
  }

  if (schema.enum) {
    if (!(schema.enum as unknown[]).includes(value)) {
      throw new Error(`enum mismatch: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
    }
  }

  if ("const" in schema) {
    if (value !== schema.const) {
      throw new Error(`const mismatch: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
  }

  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern as string).test(value)) {
      throw new Error(`pattern mismatch: ${value} !~ ${schema.pattern}`);
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new Error("minLength violation");
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) throw new Error("minimum violation");
    if (typeof schema.maximum === "number" && value > schema.maximum) throw new Error("maximum violation");
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new Error("minItems violation");
    }
    if (schema.items) {
      for (const item of value) assertValid(schema.items, item);
    }
  }

  if (schema.properties && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const allowedKeys = Object.keys(schema.properties as Record<string, unknown>);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.includes(key)) {
          throw new Error(`additionalProperties violation: unexpected key "${key}"`);
        }
      }
    }
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new Error(`required violation: missing key "${key}"`);
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        assertValid(subSchema, obj[key]);
      }
    }
  }

  if (schema.allOf) {
    for (const sub of schema.allOf as unknown[]) assertValid(sub, value);
  }

  if (schema.if) {
    if (validates(schema.if, value)) {
      if (schema.then) assertValid(schema.then, value);
    } else if (schema.else) {
      assertValid(schema.else, value);
    }
  }
}

function assertMatchesSchema(defName: string, value: unknown): void {
  assertValid({ $ref: `#/$defs/${defName}` }, value);
}

// ─── Fixture helpers ───────────────────────────────────────────────────

function input(overrides: Partial<OnkaparingaDetectorInput>): OnkaparingaDetectorInput {
  return {
    originalFilename: "unrelated-report.xlsx",
    schemaMatched: true,
    explicitPeriodMetadata: null,
    overviewHeading: null,
    serviceExceptionTotalsHeading: null,
    trendsHeading: null,
    trendsYear: null,
    ...overrides,
  };
}

function expectExact(result: DetectorResult, reasonCode: string, start: string, end: string): void {
  expect(result.outcome).toBe("EXACT");
  expect(result.reasonCode).toBe(reasonCode);
  expect(result.period).toEqual({ start, end });
  expect(result.requiresManualSelection).toBe(false);
}

function expectAmbiguous(
  result: DetectorResult,
  reasonCode: string,
  suggestedPeriod: { start: string; end: string } | null
): void {
  expect(result.outcome).toBe("AMBIGUOUS");
  expect(result.reasonCode).toBe(reasonCode);
  expect(result.period).toBeNull();
  expect(result.suggestedPeriod).toEqual(suggestedPeriod);
  expect(result.requiresManualSelection).toBe(true);
}

function expectAbsent(result: DetectorResult, reasonCode: string): void {
  expect(result.outcome).toBe("ABSENT");
  expect(result.reasonCode).toBe(reasonCode);
  expect(result.period).toBeNull();
  expect(result.suggestedPeriod).toBeNull();
  expect(result.requiresManualSelection).toBe(true);
}

// ─── Exact evidence-payload fixture builder ────────────────────────────
//
// The evidence array's shape and order are fixed by construction (see
// onkaparingaDetector.ts's own `evidence` array literal): explicit
// metadata, filename, schema match, overview, service-exception-totals,
// trends, then the three always-IGNORED non-authoritative items. Rather
// than duplicate the full 9-item array in every test, `evidenceFixture`
// starts from the "genuinely nothing supplied" baseline (matching the
// `input()` fixture's own defaults) and applies only the per-test
// overrides — but every assertion below still compares the FULL,
// resulting array with `toEqual`, so nothing is a partial/subset match.

const DEFAULT_EVIDENCE: EvidenceItem[] = [
  {
    type: "EXPLICIT_PERIOD_METADATA",
    source: "explicitPeriodMetadata",
    authority: "AUTHORITATIVE",
    status: "MISSING",
    candidate: null,
    details: "no explicit period metadata field supplied",
  },
  {
    type: "FILENAME_PERIOD",
    source: "originalFilename",
    authority: "STRONG",
    status: "MISSING",
    candidate: null,
    details: "filename does not match the strict Onkaparinga naming grammar",
  },
  {
    type: "SOURCE_SCHEMA_MATCH",
    source: "schemaMatched",
    authority: "AUTHORITATIVE",
    status: "SUPPORTS",
    candidate: null,
    details: "workbook structurally matches the configured Onkaparinga schema",
  },
  {
    type: "WORKBOOK_OVERVIEW_MONTH",
    source: "overviewHeading",
    authority: "CORROBORATING",
    status: "MISSING",
    candidate: null,
    details: "no heading supplied",
  },
  {
    type: "SERVICE_EXCEPTION_TOTALS_MONTH",
    source: "serviceExceptionTotalsHeading",
    authority: "CORROBORATING",
    status: "MISSING",
    candidate: null,
    details: "no heading supplied",
  },
  {
    type: "TRENDS_PERIOD_CORROBORATION",
    source: "trendsHeading",
    authority: "CORROBORATING",
    status: "MISSING",
    candidate: null,
    details: "no trends heading supplied",
  },
  {
    type: "OPERATIONAL_ROW_DATES",
    source: "operationalRowDatesPresent",
    authority: "NON_AUTHORITATIVE",
    status: "IGNORED",
    candidate: null,
    details: "operationalRowDatesPresent not supplied; would never be used to determine period regardless",
  },
  {
    type: "UPLOAD_TIMESTAMP",
    source: "uploadTimestampPresent",
    authority: "NON_AUTHORITATIVE",
    status: "IGNORED",
    candidate: null,
    details: "uploadTimestampPresent not supplied; would never be used to determine period regardless",
  },
  {
    type: "FILE_TIMESTAMP",
    source: "fileTimestampPresent",
    authority: "NON_AUTHORITATIVE",
    status: "IGNORED",
    candidate: null,
    details: "fileTimestampPresent not supplied; would never be used to determine period regardless",
  },
];

const EVIDENCE_ORDER: EvidenceType[] = DEFAULT_EVIDENCE.map((e) => e.type);

function evidenceFixture(overrides: Partial<Record<EvidenceType, Partial<EvidenceItem>>>): EvidenceItem[] {
  return DEFAULT_EVIDENCE.map((item) =>
    overrides[item.type] ? { ...item, ...overrides[item.type] } : { ...item }
  );
}

const JUNE_2026_CANDIDATE = { month: 6, year: 2026, start: "2026-06-01", end: "2026-06-30" };
const JULY_2026_CANDIDATE = { month: 7, year: 2026, start: "2026-07-01", end: "2026-07-31" };

// ─── EXACT ────────────────────────────────────────────────────────────

describe("ONK-RPD-E01 real_june_2026_workbook_exact", () => {
  it("filename + three corroborators (overview, SET, trends+year) -> EXACT_CORROBORATED, June 2026", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        overviewHeading: "Overview June",
        serviceExceptionTotalsHeading: "Service Exception Totals June",
        trendsHeading: "Trends March to June",
        trendsYear: 2026,
      })
    );
    expectExact(result, "EXACT_CORROBORATED", "2026-06-01", "2026-06-30");
    expect(result.suggestedPeriod).toBeNull();
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
        SERVICE_EXCEPTION_TOTALS_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Service Exception Totals June" -> month 6',
        },
        TRENDS_PERIOD_CORROBORATION: {
          source: "trendsHeading+trendsYear",
          status: "SUPPORTS",
          candidate: JUNE_2026_CANDIDATE,
          details: 'heading "Trends March to June" with trendsYear 2026 -> end month 6/2026',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-E02 filename_case_variation_exact", () => {
  it("uppercase filename variant still strictly matches, case-insensitively", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "CITY OF ONKAPARINGA-MONTH-JUNE-2026.XLSX",
        overviewHeading: "Overview June",
      })
    );
    expectExact(result, "EXACT_CORROBORATED", "2026-06-01", "2026-06-30");
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-E03 allowed_separator_variation_exact", () => {
  it("mixed hyphen/underscore/space separators between tokens still match", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city_of onkaparinga-month  june_2026.xlsx",
        overviewHeading: "Overview June",
      })
    );
    expectExact(result, "EXACT_CORROBORATED", "2026-06-01", "2026-06-30");
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-E04 filename_plus_one_content_corroborator_exact", () => {
  it("exactly one corroborator (overview only) is sufficient for EXACT", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        overviewHeading: "Overview June",
      })
    );
    expectExact(result, "EXACT_CORROBORATED", "2026-06-01", "2026-06-30");
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-E05 explicit_metadata_exact", () => {
  it("a future explicit period metadata field with month+year is EXACT on its own", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "generic-upload.xlsx",
        explicitPeriodMetadata: "2026-07",
      })
    );
    expectExact(result, "EXACT_EXPLICIT_METADATA", "2026-07-01", "2026-07-31");
    expect(result.suggestedPeriod).toBeNull();
    expect(result.evidence).toEqual(
      evidenceFixture({
        EXPLICIT_PERIOD_METADATA: {
          status: "SUPPORTS",
          candidate: JULY_2026_CANDIDATE,
          details: "explicit period metadata 2026-07",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

// ─── AMBIGUOUS ────────────────────────────────────────────────────────

describe("ONK-RPD-A01 filename_june_overview_july", () => {
  it("filename June 2026 vs overview July -> TRUSTED_SIGNALS_CONFLICT, suggest June 2026; overview evidence ends CONFLICTS, not SUPPORTS", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        overviewHeading: "Overview July",
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", { start: "2026-06-01", end: "2026-06-30" });
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 7, year: null, start: null, end: null },
          details: 'heading "Overview July" -> month 7',
        },
      })
    );
    // The anchor (filename, which is also the suggestion) stays SUPPORTS;
    // only the disagreeing corroborator is re-stamped.
    const filenameEv = result.evidence.find((e) => e.type === "FILENAME_PERIOD")!;
    expect(filenameEv.status).toBe("SUPPORTS");
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A02 content_signals_disagree", () => {
  it("overview June vs SET July with no filename candidate -> TRUSTED_SIGNALS_CONFLICT; both content items end CONFLICTS (no anchor)", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        overviewHeading: "Overview June",
        serviceExceptionTotalsHeading: "Service Exception Totals July",
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        WORKBOOK_OVERVIEW_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
        SERVICE_EXCEPTION_TOTALS_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 7, year: null, start: null, end: null },
          details: 'heading "Service Exception Totals July" -> month 7',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A03 month_without_year", () => {
  it("overview month with no trusted year anywhere -> MONTH_WITHOUT_YEAR", () => {
    const result = detectOnkaparingaReportingPeriod(input({ overviewHeading: "Overview June" }));
    expectAmbiguous(result, "MONTH_WITHOUT_YEAR", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A04 filename_only_uncorroborated", () => {
  it("strict filename match with no content corroboration -> FILENAME_ONLY_UNCORROBORATED, suggest June 2026", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx" })
    );
    expectAmbiguous(result, "FILENAME_ONLY_UNCORROBORATED", { start: "2026-06-01", end: "2026-06-30" });
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A05 multiple_filename_candidates", () => {
  it("two distinct month/year pairs in one filename -> MULTIPLE_FILENAME_CANDIDATES, no suggestion", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026-month-july-2026.xlsx" })
    );
    expectAmbiguous(result, "MULTIPLE_FILENAME_CANDIDATES", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: {
          status: "CONFLICTS",
          candidate: null,
          details: "recognisable Onkaparinga filename prefix with more than one candidate month/year pair",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A06 explicit_metadata_conflicts_with_filename", () => {
  it("explicit metadata July 2026 vs filename June 2026 -> TRUSTED_SIGNALS_CONFLICT, NO hidden precedence, suggestion null; BOTH sides end CONFLICTS", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        explicitPeriodMetadata: "2026-07",
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        EXPLICIT_PERIOD_METADATA: {
          status: "CONFLICTS",
          candidate: JULY_2026_CANDIDATE,
          details: "explicit period metadata 2026-07",
        },
        FILENAME_PERIOD: { status: "CONFLICTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A07 trend_year_conflict", () => {
  it("filename June 2026 vs trends corroborating June 2025 -> TRUSTED_SIGNALS_CONFLICT, suggest June 2026; trends evidence ends CONFLICTS", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        trendsHeading: "Trends March to June",
        trendsYear: 2025,
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", { start: "2026-06-01", end: "2026-06-30" });
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        TRENDS_PERIOD_CORROBORATION: {
          source: "trendsHeading+trendsYear",
          status: "CONFLICTS",
          candidate: { month: 6, year: 2025, start: "2025-06-01", end: "2025-06-30" },
          details: 'heading "Trends March to June" with trendsYear 2025 -> end month 6/2025',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A08 schema_drift_missing_expected_content", () => {
  it("schemaMatched=false on an otherwise filename-matching file -> EXPECTED_CONTENT_SIGNAL_MISSING", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        schemaMatched: false,
      })
    );
    expectAmbiguous(result, "EXPECTED_CONTENT_SIGNAL_MISSING", { start: "2026-06-01", end: "2026-06-30" });
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        SOURCE_SCHEMA_MATCH: {
          status: "CONFLICTS",
          candidate: null,
          details: "workbook does not match the configured Onkaparinga schema",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });

  it("schemaMatched=true but the configured overview heading is unparseable -> EXPECTED_CONTENT_SIGNAL_MISSING", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        overviewHeading: "###garbled###",
      })
    );
    expectAmbiguous(result, "EXPECTED_CONTENT_SIGNAL_MISSING", { start: "2026-06-01", end: "2026-06-30" });
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "INVALID",
          candidate: null,
          details: 'heading "###garbled###" does not contain a recognisable month',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A09 invalid_filename_period", () => {
  it("a recognisable Onkaparinga prefix with a malformed (2-digit) year -> INVALID_FILENAME_PERIOD", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-26.xlsx" })
    );
    expectAmbiguous(result, "INVALID_FILENAME_PERIOD", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: {
          status: "INVALID",
          candidate: null,
          details: "recognisable Onkaparinga filename prefix with a malformed month/year token",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-A10 invalid_period_range", () => {
  it("validateCandidateRange rejects an end-before-start candidate range with INVALID_PERIOD_RANGE", () => {
    const outcome = validateCandidateRange("2026-06-30", "2026-06-01");
    expect(outcome).toEqual({ valid: false, reasonCode: "INVALID_PERIOD_RANGE" });
  });

  it("validateCandidateRange rejects a calendar-invalid date (Feb 30) with INVALID_PERIOD_RANGE", () => {
    const outcome = validateCandidateRange("2026-02-01", "2026-02-30");
    expect(outcome).toEqual({ valid: false, reasonCode: "INVALID_PERIOD_RANGE" });
  });

  it("validateCandidateRange accepts a valid ordered range", () => {
    expect(validateCandidateRange("2026-06-01", "2026-06-30")).toEqual({ valid: true });
  });
});

// ─── ABSENT / INCOMPLETE ──────────────────────────────────────────────

describe("ONK-RPD-B01 current_data_csv_absent", () => {
  it("data.csv with no trusted file-level signal -> ABSENT / NO_TRUSTED_PERIOD_SIGNAL", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "data.csv",
        nonAuthoritativeEvidence: { operationalRowDatesPresent: true },
      })
    );
    expectAbsent(result, "NO_TRUSTED_PERIOD_SIGNAL");
    expect(result.evidence).toEqual(
      evidenceFixture({
        OPERATIONAL_ROW_DATES: {
          status: "IGNORED",
          details: "operationalRowDatesPresent present but never used to determine period",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-B02 generic_xlsx_no_period_signal", () => {
  it("a generic, schema-matched xlsx with zero period signals -> ABSENT / NO_TRUSTED_PERIOD_SIGNAL", () => {
    const result = detectOnkaparingaReportingPeriod(input({ originalFilename: "generic-export.xlsx" }));
    expectAbsent(result, "NO_TRUSTED_PERIOD_SIGNAL");
    expect(result.evidence).toEqual(evidenceFixture({}));
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-B03 operational_rows_only_absent", () => {
  it("operational row dates present is ignored and does not change the ABSENT outcome", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ nonAuthoritativeEvidence: { operationalRowDatesPresent: true } })
    );
    expectAbsent(result, "NO_TRUSTED_PERIOD_SIGNAL");
    expect(result.evidence).toEqual(
      evidenceFixture({
        OPERATIONAL_ROW_DATES: {
          status: "IGNORED",
          details: "operationalRowDatesPresent present but never used to determine period",
        },
      })
    );
  });
});

describe("ONK-RPD-B04 upload_timestamp_only_absent", () => {
  it("upload timestamp present is ignored and does not change the ABSENT outcome", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ nonAuthoritativeEvidence: { uploadTimestampPresent: true } })
    );
    expectAbsent(result, "NO_TRUSTED_PERIOD_SIGNAL");
    expect(result.evidence).toEqual(
      evidenceFixture({
        UPLOAD_TIMESTAMP: {
          status: "IGNORED",
          details: "uploadTimestampPresent present but never used to determine period",
        },
      })
    );
  });
});

describe("ONK-RPD-B05 file_timestamp_only_absent", () => {
  it("file/XLSX-modified timestamp present is ignored and does not change the ABSENT outcome", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ nonAuthoritativeEvidence: { fileTimestampPresent: true, xlsxModifiedTimestampPresent: true } })
    );
    expectAbsent(result, "NO_TRUSTED_PERIOD_SIGNAL");
    expect(result.evidence).toEqual(
      evidenceFixture({
        FILE_TIMESTAMP: {
          status: "IGNORED",
          details: "fileTimestampPresent present but never used to determine period",
        },
      })
    );
  });
});

describe("ONK-RPD-B06 multiperiod_trends_only", () => {
  it("a trends range with no corroborating year, alone, is AMBIGUOUS / MULTIPERIOD_TREND_ONLY (not a false EXACT/ABSENT)", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ trendsHeading: "Trends March to June", trendsYear: null })
    );
    expectAmbiguous(result, "MULTIPERIOD_TREND_ONLY", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        TRENDS_PERIOD_CORROBORATION: {
          status: "MISSING",
          candidate: null,
          details: 'heading "Trends March to June" spans 3-6 with no corroborating year',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

describe("ONK-RPD-B07 unrelated_file_absent", () => {
  it("a completely unrelated schema/filename -> ABSENT / UNRECOGNISED_SOURCE_SCHEMA", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "quarterly-financial-summary.xlsx", schemaMatched: false })
    );
    expectAbsent(result, "UNRECOGNISED_SOURCE_SCHEMA");
    expect(result.evidence).toEqual(
      evidenceFixture({
        SOURCE_SCHEMA_MATCH: {
          status: "CONFLICTS",
          candidate: null,
          details: "workbook does not match the configured Onkaparinga schema",
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });
});

// ─── MANUAL ───────────────────────────────────────────────────────────

describe("ONK-RPD-M01 ambiguous_manual_accept", () => {
  it("an AMBIGUOUS detector outcome still allows a valid manual selection", () => {
    const detector = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx" })
    );
    expect(detector.outcome).toBe("AMBIGUOUS");
    expect(detector.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
      })
    );
    const manual = validateManualSelection("2026-06-01", "2026-06-30");
    expect(manual).toEqual({ valid: true, start: "2026-06-01", end: "2026-06-30", reasonCode: "MANUAL_SELECTION_VALID" });
    assertMatchesSchema("manualSelectionResult", manual);
  });
});

describe("ONK-RPD-M02 absent_manual_select", () => {
  it("an ABSENT detector outcome still allows a valid manual selection", () => {
    const detector = detectOnkaparingaReportingPeriod(input({ originalFilename: "generic-export.xlsx" }));
    expect(detector.outcome).toBe("ABSENT");
    expect(detector.evidence).toEqual(evidenceFixture({}));
    const manual = validateManualSelection("2026-01-01", "2026-01-31");
    expect(manual).toMatchObject({ valid: true, reasonCode: "MANUAL_SELECTION_VALID" });
    assertMatchesSchema("manualSelectionResult", manual);
  });
});

describe("ONK-RPD-M03 manual_override_of_suggestion", () => {
  it("manual selection may pick a different period than the detector's own suggestion, with no forced precedence", () => {
    const detector = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-june-2026.xlsx",
        overviewHeading: "Overview July",
      })
    );
    expect(detector.suggestedPeriod).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(detector.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 7, year: null, start: null, end: null },
          details: 'heading "Overview July" -> month 7',
        },
      })
    );
    const manual = validateManualSelection("2026-08-01", "2026-08-31");
    expect(manual).toEqual({ valid: true, start: "2026-08-01", end: "2026-08-31", reasonCode: "MANUAL_SELECTION_VALID" });
  });
});

describe("validateManualSelection — missing boundaries", () => {
  it("missing start -> MANUAL_SELECTION_MISSING_START", () => {
    expect(validateManualSelection(null, "2026-01-31")).toEqual({
      valid: false,
      reasonCode: "MANUAL_SELECTION_MISSING_START",
    });
  });
  it("missing end -> MANUAL_SELECTION_MISSING_END", () => {
    expect(validateManualSelection("2026-01-01", undefined)).toEqual({
      valid: false,
      reasonCode: "MANUAL_SELECTION_MISSING_END",
    });
  });
  it("start after end -> MANUAL_SELECTION_INVALID_RANGE", () => {
    expect(validateManualSelection("2026-02-01", "2026-01-01")).toEqual({
      valid: false,
      reasonCode: "MANUAL_SELECTION_INVALID_RANGE",
    });
  });
});

// ─── GATE ─────────────────────────────────────────────────────────────

describe("ONK-RPD-G01 policy_off_absent_does_not_block", () => {
  it("reportingPeriodRequired=false with no persisted period -> allowed true / PERIOD_OPTIONAL", () => {
    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: false,
      persistedPeriod: null,
      detectorResult: null,
    });
    expect(result).toEqual({ allowed: true, reasonCode: "PERIOD_OPTIONAL" });
    assertMatchesSchema("confirmationEligibilityResult", result);
  });
});

describe("ONK-RPD-G02 policy_on_exact_not_persisted_blocks", () => {
  it("reportingPeriodRequired=true, EXACT detector result, nothing persisted -> allowed false / PERIOD_REQUIRED_NOT_PERSISTED", () => {
    const detectorResult = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx", overviewHeading: "Overview June" })
    );
    expect(detectorResult.outcome).toBe("EXACT");
    expect(detectorResult.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: true,
      persistedPeriod: null,
      detectorResult,
    });
    expect(result).toEqual({ allowed: false, reasonCode: "PERIOD_REQUIRED_NOT_PERSISTED" });
    assertMatchesSchema("confirmationEligibilityResult", result);
  });
});

describe("ONK-RPD-G03 policy_on_ambiguous_blocks", () => {
  it("reportingPeriodRequired=true, AMBIGUOUS detector result -> allowed false / PERIOD_REQUIRED_AMBIGUOUS", () => {
    const detectorResult = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx" })
    );
    expect(detectorResult.outcome).toBe("AMBIGUOUS");
    expect(detectorResult.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JUNE_2026_CANDIDATE, details: "strict filename period 2026-06" },
      })
    );
    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: true,
      persistedPeriod: null,
      detectorResult,
    });
    expect(result).toEqual({ allowed: false, reasonCode: "PERIOD_REQUIRED_AMBIGUOUS" });
    assertMatchesSchema("confirmationEligibilityResult", result);
  });
});

describe("ONK-RPD-G04 policy_on_absent_blocks", () => {
  it("reportingPeriodRequired=true, ABSENT detector result -> allowed false / PERIOD_REQUIRED_ABSENT", () => {
    const detectorResult = detectOnkaparingaReportingPeriod(input({ originalFilename: "generic-export.xlsx" }));
    expect(detectorResult.outcome).toBe("ABSENT");
    expect(detectorResult.evidence).toEqual(evidenceFixture({}));
    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: true,
      persistedPeriod: null,
      detectorResult,
    });
    expect(result).toEqual({ allowed: false, reasonCode: "PERIOD_REQUIRED_ABSENT" });
    assertMatchesSchema("confirmationEligibilityResult", result);
  });
});

describe("gate — policy true + complete persisted period -> allowed true / PERIOD_PRESENT regardless of policy", () => {
  it("a complete valid persisted period always satisfies the gate", () => {
    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: true,
      persistedPeriod: { start: "2026-06-01", end: "2026-06-30" },
      detectorResult: null,
    });
    expect(result).toEqual({ allowed: true, reasonCode: "PERIOD_PRESENT" });
  });
});

// ─── IMMUTABILITY ─────────────────────────────────────────────────────

describe("ONK-RPD-I01 historical_import_null_period_not_backfilled", () => {
  it("a null persisted period is never backfilled by this module — evaluateConfirmationEligibility is a pure calculation with no side effect on its input", () => {
    const persistedPeriod = null;
    const input1 = { reportingPeriodRequired: true, persistedPeriod, detectorResult: null };
    const before = JSON.stringify(input1);
    const result = evaluateConfirmationEligibility(input1);
    expect(JSON.stringify(input1)).toBe(before);
    expect(input1.persistedPeriod).toBeNull();
    expect(result.reasonCode).toBe("PERIOD_REQUIRED_ABSENT");
  });

  it("the module contains no backfill/write vocabulary at all (re-confirms static containment)", () => {
    const code = stripComments(read(SERVICE_PATH));
    expect(code).not.toMatch(/backfill/i);
    expect(code).not.toMatch(/UPDATE\s+\w+\s+SET/i);
  });
});

describe("ONK-RPD-I02 confirmed_period_immutable_under_detector", () => {
  it("a complete persisted period always wins the gate, even when a fresh detector run disagrees with it", () => {
    const conflictingDetectorResult = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "city of onkaparinga-month-july-2026.xlsx",
        overviewHeading: "Overview July",
      })
    );
    expect(conflictingDetectorResult.outcome).toBe("EXACT");
    expect(conflictingDetectorResult.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(conflictingDetectorResult.evidence).toEqual(
      evidenceFixture({
        FILENAME_PERIOD: { status: "SUPPORTS", candidate: JULY_2026_CANDIDATE, details: "strict filename period 2026-07" },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 7, year: null, start: null, end: null },
          details: 'heading "Overview July" -> month 7',
        },
      })
    );

    const result = evaluateConfirmationEligibility({
      reportingPeriodRequired: true,
      persistedPeriod: { start: "2026-06-01", end: "2026-06-30" },
      detectorResult: conflictingDetectorResult,
    });
    expect(result).toEqual({ allowed: true, reasonCode: "PERIOD_PRESENT" });
  });
});

// ─── Concern #1 regression coverage: EXACT must never coexist with a
// trusted content/trends contradiction, even when filename is silent ───

describe("explicit metadata vs trusted content conflict (beyond filename)", () => {
  it("explicit metadata July 2026 vs a schema-matched overview heading of June -> TRUSTED_SIGNALS_CONFLICT, not a false EXACT", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "generic-upload.xlsx",
        explicitPeriodMetadata: "2026-07",
        overviewHeading: "Overview June",
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        EXPLICIT_PERIOD_METADATA: {
          status: "CONFLICTS",
          candidate: JULY_2026_CANDIDATE,
          details: "explicit period metadata 2026-07",
        },
        WORKBOOK_OVERVIEW_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
      })
    );
  });

  it("explicit metadata vs a conflicting overview heading is NOT surfaced when schemaMatched=false (content is untrusted)", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "generic-upload.xlsx",
        explicitPeriodMetadata: "2026-07",
        overviewHeading: "Overview June",
        schemaMatched: false,
      })
    );
    expectExact(result, "EXACT_EXPLICIT_METADATA", "2026-07-01", "2026-07-31");
  });

  it("explicit metadata agreeing with content stays EXACT_EXPLICIT_METADATA (no false conflict)", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "generic-upload.xlsx",
        explicitPeriodMetadata: "2026-07",
        overviewHeading: "Overview July",
      })
    );
    expectExact(result, "EXACT_EXPLICIT_METADATA", "2026-07-01", "2026-07-31");
  });
});

// ─── Concern #6 regression coverage: strict filename grammar rejects
// loose prefix/suffix junk rather than silently matching or silently
// ignoring it ─────────────────────────────────────────────────────────

describe("filename grammar strictness — no loose prefix/suffix acceptance", () => {
  it("trailing junk after a well-formed month/year token is rejected as INVALID, not silently matched", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga-month-june-2026-final.xlsx" })
    );
    expectAmbiguous(result, "INVALID_FILENAME_PERIOD", null);
  });

  it("junk prefixed before the required 'city of onkaparinga' prefix is UNRELATED, not loosely recognised", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "final-city of onkaparinga-month-june-2026.xlsx", schemaMatched: false })
    );
    expectAbsent(result, "UNRECOGNISED_SOURCE_SCHEMA");
  });

  it("a filename that merely happens to contain a month word, with no Onkaparinga prefix, is UNRELATED", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "june-report.xlsx", schemaMatched: false })
    );
    expectAbsent(result, "UNRECOGNISED_SOURCE_SCHEMA");
  });

  it("an inserted word between 'onkaparinga' and 'month' breaks the strict grammar (UNRELATED)", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({ originalFilename: "city of onkaparinga foo month-june-2026.xlsx", schemaMatched: false })
    );
    expectAbsent(result, "UNRECOGNISED_SOURCE_SCHEMA");
  });
});

// ─── Content-only + trends-year corroboration policy (6.2C2 final
// edge-case policy): no filename/explicit candidate, but a trusted
// content heading month agreeing with a trusted trends end-month+year
// corroborates a complete EXACT period; disagreement is a genuine
// TRUSTED_SIGNALS_CONFLICT, never a silent best guess ────────────────

describe("content-only + trends-year corroboration policy", () => {
  it("content month June + Trends March-to-June + trendsYear 2026 -> EXACT_CORROBORATED, June 2026", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        overviewHeading: "Overview June",
        trendsHeading: "Trends March to June",
        trendsYear: 2026,
      })
    );
    expectExact(result, "EXACT_CORROBORATED", "2026-06-01", "2026-06-30");
    expect(result.suggestedPeriod).toBeNull();
    expect(result.evidence).toEqual(
      evidenceFixture({
        WORKBOOK_OVERVIEW_MONTH: {
          status: "SUPPORTS",
          candidate: { month: 6, year: null, start: null, end: null },
          details: 'heading "Overview June" -> month 6',
        },
        TRENDS_PERIOD_CORROBORATION: {
          source: "trendsHeading+trendsYear",
          status: "SUPPORTS",
          candidate: JUNE_2026_CANDIDATE,
          details: 'heading "Trends March to June" with trendsYear 2026 -> end month 6/2026',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });

  it("content month May + Trends March-to-June + trendsYear 2026 -> AMBIGUOUS / TRUSTED_SIGNALS_CONFLICT", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        overviewHeading: "Overview May",
        trendsHeading: "Trends March to June",
        trendsYear: 2026,
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", null);
    expect(result.evidence).toEqual(
      evidenceFixture({
        WORKBOOK_OVERVIEW_MONTH: {
          status: "CONFLICTS",
          candidate: { month: 5, year: null, start: null, end: null },
          details: 'heading "Overview May" -> month 5',
        },
        TRENDS_PERIOD_CORROBORATION: {
          source: "trendsHeading+trendsYear",
          status: "CONFLICTS",
          candidate: JUNE_2026_CANDIDATE,
          details: 'heading "Trends March to June" with trendsYear 2026 -> end month 6/2026',
        },
      })
    );
    assertMatchesSchema("detectorResult", result);
  });

  it("content headings disagree with each other -> remains TRUSTED_SIGNALS_CONFLICT even with a corroborating trends year present", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        overviewHeading: "Overview June",
        serviceExceptionTotalsHeading: "Service Exception Totals July",
        trendsHeading: "Trends March to June",
        trendsYear: 2026,
      })
    );
    expectAmbiguous(result, "TRUSTED_SIGNALS_CONFLICT", null);
  });

  it("trends has no trusted year -> remains MULTIPERIOD_TREND_ONLY, not a false EXACT", () => {
    const result = detectOnkaparingaReportingPeriod(
      input({
        overviewHeading: "Overview June",
        trendsHeading: "Trends March to June",
        trendsYear: null,
      })
    );
    expectAmbiguous(result, "MONTH_WITHOUT_YEAR", null);
  });
});

// ─── Global invariants fixture ────────────────────────────────────────

describe("global invariants — fixed-value assertion fixture", () => {
  const invariants = {
    database_write_count: 0,
    production_configuration_write_count: 0,
    source_system_toggle_write_count: 0,
    file_mutation_count: 0,
    prohibited_evidence_sources_used_for_period: {
      operational_row_dates: false,
      upload_timestamp: false,
      filesystem_timestamp: false,
      xlsx_modified_timestamp: false,
    },
    silent_conflict_resolution: false,
    historical_backfill: false,
  };

  it("matches the globalInvariants schema shape", () => {
    assertMatchesSchema("globalInvariants", invariants);
  });

  it("no evidence item this module can produce ever reports a NON_AUTHORITATIVE-authority item as anything but IGNORED", () => {
    const allResults = [
      detectOnkaparingaReportingPeriod(
        input({
          originalFilename: "generic.xlsx",
          nonAuthoritativeEvidence: {
            operationalRowDatesPresent: true,
            uploadTimestampPresent: true,
            fileTimestampPresent: true,
            xlsxModifiedTimestampPresent: true,
          },
        })
      ),
      detectOnkaparingaReportingPeriod(input({ originalFilename: "generic.xlsx" })),
    ];
    for (const result of allResults) {
      for (const evidence of result.evidence) {
        if (evidence.authority === "NON_AUTHORITATIVE") {
          expect(evidence.status).toBe("IGNORED");
        }
      }
    }
  });

  it("non-authoritative flags never change the outcome (proves they cannot silently influence period/suggestion)", () => {
    const withFlags = detectOnkaparingaReportingPeriod(
      input({
        originalFilename: "generic.xlsx",
        nonAuthoritativeEvidence: {
          operationalRowDatesPresent: true,
          uploadTimestampPresent: true,
          fileTimestampPresent: true,
          xlsxModifiedTimestampPresent: true,
        },
      })
    );
    const withoutFlags = detectOnkaparingaReportingPeriod(input({ originalFilename: "generic.xlsx" }));
    expect(withFlags.outcome).toBe(withoutFlags.outcome);
    expect(withFlags.reasonCode).toBe(withoutFlags.reasonCode);
    expect(withFlags.period).toEqual(withoutFlags.period);
    expect(withFlags.suggestedPeriod).toEqual(withoutFlags.suggestedPeriod);
  });

  it("a conflict outcome never leaves `period` non-null — conflicts are never silently resolved to a best guess", () => {
    const cases = [
      detectOnkaparingaReportingPeriod(
        input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx", overviewHeading: "Overview July" })
      ),
      detectOnkaparingaReportingPeriod(
        input({ overviewHeading: "Overview June", serviceExceptionTotalsHeading: "Service Exception Totals July" })
      ),
      detectOnkaparingaReportingPeriod(
        input({ originalFilename: "city of onkaparinga-month-june-2026.xlsx", explicitPeriodMetadata: "2026-07" })
      ),
    ];
    for (const result of cases) {
      expect(result.reasonCode).toBe("TRUSTED_SIGNALS_CONFLICT");
      expect(result.outcome).toBe("AMBIGUOUS");
      expect(result.period).toBeNull();
    }
  });
});

// ─── Schema self-containment ────────────────────────────────────────────

describe("onkaparingaDetector.schema.json — self-containment", () => {
  it("is valid, parseable JSON with the expected top-level $defs", () => {
    const expectedDefs = [
      "detectorResult",
      "evidenceItem",
      "manualSelectionResult",
      "confirmationEligibilityResult",
      "globalInvariants",
    ];
    for (const name of expectedDefs) {
      expect(defs[name]).toBeDefined();
    }
  });

  it("declares additionalProperties:false on every object-shaped $def", () => {
    for (const [name, def] of Object.entries(defs) as [string, Record<string, unknown>][]) {
      if (def.type === "object" && def.properties) {
        expect(def.additionalProperties, `${name} must declare additionalProperties:false`).toBe(false);
      }
    }
  });

  it("declares Draft 2020-12 as its $schema", () => {
    expect(schemaDoc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});

// ─── Schema / TypeScript enum synchronization ──────────────────────────
//
// Requirement: schema enums and object fields must stay synchronized
// with TypeScript semantics. Rather than trust that by inspection, this
// extracts each exported TS union type's literal members directly from
// source and diffs them (as sets) against the corresponding JSON Schema
// $def's `enum`, so any future drift in either file fails the suite.

function extractUnionMembers(source: string, typeName: string): string[] {
  const re = new RegExp(`export type ${typeName} =([\\s\\S]*?);\\n`, "m");
  const match = re.exec(source);
  if (!match) throw new Error(`type ${typeName} not found in source`);
  return Array.from(match[1].matchAll(/"([A-Z_]+)"/g)).map((m) => m[1]);
}

describe("schema/TypeScript enum synchronization", () => {
  const source = read(SERVICE_PATH);

  const syncCases: { tsName: string; defName: string }[] = [
    { tsName: "DetectionOutcome", defName: "detectionOutcome" },
    { tsName: "DetectorReasonCode", defName: "detectorReasonCode" },
    { tsName: "EvidenceType", defName: "evidenceType" },
    { tsName: "EvidenceAuthority", defName: "evidenceAuthority" },
    { tsName: "EvidenceStatus", defName: "evidenceStatus" },
    { tsName: "ManualSelectionReasonCode", defName: "manualSelectionReasonCode" },
    { tsName: "GateReasonCode", defName: "gateReasonCode" },
  ];

  for (const { tsName, defName } of syncCases) {
    it(`${tsName} TS union matches ${defName} schema enum exactly (same members, no drift)`, () => {
      const tsMembers = extractUnionMembers(source, tsName).sort();
      expect(tsMembers.length).toBeGreaterThan(0);
      const schemaMembers = [...(defs[defName].enum as string[])].sort();
      expect(schemaMembers).toEqual(tsMembers);
    });
  }
});

// ─── Test-ID coverage: count and uniqueness ────────────────────────────

describe("test-ID coverage — count and uniqueness", () => {
  it("declares exactly 31 unique ONK-RPD-* IDs, matching the required set", () => {
    const testSource = read(TEST_PATH);
    const found = Array.from(testSource.matchAll(/ONK-RPD-([A-Z]\d\d)/g)).map((m) => m[1]);
    expect(found.length).toBe(31);
    expect(new Set(found).size).toBe(31);

    const requiredSuffixes = [
      "E01", "E02", "E03", "E04", "E05",
      "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10",
      "B01", "B02", "B03", "B04", "B05", "B06", "B07",
      "M01", "M02", "M03",
      "G01", "G02", "G03", "G04",
      "I01", "I02",
    ];
    expect(requiredSuffixes.length).toBe(31);
    expect(new Set(found)).toEqual(new Set(requiredSuffixes));
  });
});
