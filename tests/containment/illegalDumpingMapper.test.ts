import { describe, it, expect } from "vitest";
import {
  validateIllegalDumpingHeaders,
  mapIllegalDumpingRows,
  IllegalDumpingMappingError,
  ILLEGAL_DUMPING_REQUIRED_HEADERS,
} from "@/lib/data-hub/importBatch/illegalDumpingMapper";

// Data Hub 5A.3A — duplicate-required-CSV-header fail-closed hardening.
//
// Direct unit-level proof for illegalDumpingMapper.ts's own header
// validation, independent of confirmWorksheet.ts's mocked-behavioral tests
// (which additionally prove the PARSER_REJECTED outcome + no-transaction
// side effect at the service boundary — see confirmWorksheet.test.ts).
//
// Background: mapIllegalDumpingRows' column index is built via
// `new Map(headers.map((h, i) => [h, i]))`, which silently keeps only the
// LAST occurrence's column index for a header name appearing more than
// once. Lookup is always by exact header name (never position), so this
// can never misdirect a value into the wrong FIELD — but it can silently
// substitute a value from the wrong physical column into a correctly-
// identified REQUIRED field. validateIllegalDumpingHeaders (called first,
// unconditionally, by mapIllegalDumpingRows) now rejects that ambiguity
// outright, before the ambiguous Map is ever constructed.

describe("validateIllegalDumpingHeaders — baseline (missing headers, pre-existing behavior)", () => {
  it("A. a header row missing a required column throws IllegalDumpingMappingError", () => {
    expect(() => validateIllegalDumpingHeaders(["report_date", "location"])).toThrow(IllegalDumpingMappingError);
    expect(() => validateIllegalDumpingHeaders(["report_date", "location"])).toThrow(/waste_type/);
  });

  it("B. all three required headers present exactly once, plus arbitrary optional headers, does not throw", () => {
    expect(() =>
      validateIllegalDumpingHeaders(["report_date", "location", "waste_type", "suburb", "notes"])
    ).not.toThrow();
  });
});

describe("validateIllegalDumpingHeaders — duplicate REQUIRED header rejection (5A.3A)", () => {
  it("C. a duplicated report_date header throws IllegalDumpingMappingError naming report_date", () => {
    const headers = ["report_date", "location", "waste_type", "report_date"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(IllegalDumpingMappingError);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/duplicate/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("D. a duplicated location header throws, naming location", () => {
    const headers = ["report_date", "location", "waste_type", "location"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/location/);
  });

  it("E. a duplicated waste_type header throws, naming waste_type", () => {
    const headers = ["report_date", "location", "waste_type", "waste_type"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/waste_type/);
  });

  it("F. a duplicated required header whose two occurrences hold IDENTICAL values is STILL rejected — the ambiguity itself is invalid, not merely a value disagreement", () => {
    // Two "location" columns, both literally "Main St" in the one data row.
    // A naive "do the duplicate columns disagree?" check would let this
    // through; the correct behavior rejects it purely on header shape,
    // never inspecting row values to decide.
    const headers = ["report_date", "location", "waste_type", "location"];
    const rows = [["2024-01-01", "Main St", "tyres", "Main St"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(/duplicate/i);
  });

  it("G. a duplicated required header whose two occurrences DISAGREE is also rejected (baseline sanity check)", () => {
    const headers = ["report_date", "location", "waste_type", "location"];
    const rows = [["2024-01-01", "Main St", "tyres", "Oak Ave"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
  });

  it("H. multiple required headers duplicated simultaneously throws once, naming every duplicated header", () => {
    const headers = ["report_date", "location", "waste_type", "report_date", "location"];
    let caught: unknown;
    try {
      validateIllegalDumpingHeaders(headers);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IllegalDumpingMappingError);
    expect((caught as Error).message).toMatch(/report_date/);
    expect((caught as Error).message).toMatch(/location/);
    expect((caught as Error).message).not.toMatch(/waste_type/);
  });

  it("I. every required header individually and in combination is covered by ILLEGAL_DUMPING_REQUIRED_HEADERS (no hardcoded drift in this test file)", () => {
    expect(ILLEGAL_DUMPING_REQUIRED_HEADERS).toEqual(["report_date", "location", "waste_type"]);
  });
});

describe("validateIllegalDumpingHeaders — duplicate identity matches the mapper's own exact-string matching (no invented normalization)", () => {
  it("J. differently-cased duplicate ('Report_Date' alongside 'report_date') is NOT treated as a duplicate of the canonical header — it is treated as the canonical header still being MISSING, exactly like every other case-sensitive mismatch in this module", () => {
    const headers = ["Report_Date", "report_date", "location", "waste_type"];
    // "report_date" IS present exactly once here (the second entry), so
    // this is actually valid — included primarily to document that casing
    // differences are never collapsed into "duplicate".
    expect(() => validateIllegalDumpingHeaders(headers)).not.toThrow();
  });

  it("K. a header row with ONLY a differently-cased variant ('Report_Date') is rejected as MISSING report_date, never as a duplicate", () => {
    const headers = ["Report_Date", "location", "waste_type"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("L. leading/trailing whitespace on a header ('report_date ') is never trimmed — it is treated as a distinct, non-matching string, exactly mirroring decodeCsvOnly's own no-trim behavior, so it is rejected as MISSING report_date rather than silently matched or flagged as a duplicate", () => {
    const headers = ["report_date ", "location", "waste_type"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("missing-header detection still takes priority when a header row has BOTH a missing required header AND an unrelated duplicated required header", () => {
    // waste_type is missing entirely; location is duplicated. The missing
    // check runs first (structural absence), so the error is the missing-
    // header error, not the duplicate error — duplicates are only checked
    // once every required header is confirmed present.
    const headers = ["report_date", "location", "location"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/waste_type/);
  });
});

describe("validateIllegalDumpingHeaders — duplicate OPTIONAL headers (investigated, deliberately out of scope for 5A.3A)", () => {
  it("a duplicated OPTIONAL header (severity) does NOT throw — the same last-occurrence-wins Map mechanism applies, but this hardening pass intentionally scopes to REQUIRED headers only (see the 5A.3A implementation report, Section 6)", () => {
    const headers = ["report_date", "location", "waste_type", "severity", "severity"];
    const rows = [["2024-01-01", "Main St", "tyres", "high", "low"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).not.toThrow();
    // Documents the actual observable behavior: the LAST "severity" column
    // (value "low") silently wins over the first ("high") — the exact
    // ambiguity risk this slice fixes for required headers, still present
    // for optional ones.
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped[0].severity).toBe("LOW");
  });
});

describe("mapIllegalDumpingRows — non-regression: valid, non-duplicated headers still map correctly", () => {
  it("maps a well-formed row with all required + several optional headers present exactly once", () => {
    const headers = ["report_date", "location", "waste_type", "suburb", "severity", "status"];
    const rows = [["2024-01-15", "Main St", "tyres", "Riverside", "high", "in progress"]];
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      location: "Main St",
      waste_type: "tyres",
      suburb: "Riverside",
      severity: "HIGH",
      status: "IN_PROGRESS",
    });
  });
});
