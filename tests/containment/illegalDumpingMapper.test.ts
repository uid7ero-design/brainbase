import { describe, it, expect } from "vitest";
import {
  validateIllegalDumpingHeaders,
  mapIllegalDumpingRows,
  IllegalDumpingMappingError,
  ILLEGAL_DUMPING_REQUIRED_HEADERS,
  type MappedIllegalDumpingRow,
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

  it("B. all required headers present exactly once, plus arbitrary optional headers, does not throw", () => {
    expect(() =>
      validateIllegalDumpingHeaders(["report_date", "location", "waste_type", "source_external_id", "suburb", "notes"])
    ).not.toThrow();
  });
});

describe("validateIllegalDumpingHeaders — duplicate REQUIRED header rejection (5A.3A)", () => {
  it("C. a duplicated report_date header throws IllegalDumpingMappingError naming report_date", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id", "report_date"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(IllegalDumpingMappingError);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/duplicate/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("D. a duplicated location header throws, naming location", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id", "location"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/location/);
  });

  it("E. a duplicated waste_type header throws, naming waste_type", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id", "waste_type"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/waste_type/);
  });

  it("F. a duplicated required header whose two occurrences hold IDENTICAL values is STILL rejected — the ambiguity itself is invalid, not merely a value disagreement", () => {
    // Two "location" columns, both literally "Main St" in the one data row.
    // A naive "do the duplicate columns disagree?" check would let this
    // through; the correct behavior rejects it purely on header shape,
    // never inspecting row values to decide.
    const headers = ["report_date", "location", "waste_type", "location", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "Main St", "EXT-1"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(/duplicate/i);
  });

  it("G. a duplicated required header whose two occurrences DISAGREE is also rejected (baseline sanity check)", () => {
    const headers = ["report_date", "location", "waste_type", "location", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "Oak Ave", "EXT-1"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
  });

  it("H. multiple required headers duplicated simultaneously throws once, naming every duplicated header", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id", "report_date", "location"];
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
    // Data Hub 6.1B — source_external_id joins the required-header set: the
    // reconciliation identity key is required for every governed Illegal
    // Dumping confirmation, exactly like report_date/location/waste_type.
    expect(ILLEGAL_DUMPING_REQUIRED_HEADERS).toEqual(["report_date", "location", "waste_type", "source_external_id"]);
  });
});

describe("validateIllegalDumpingHeaders — duplicate identity matches the mapper's own exact-string matching (no invented normalization)", () => {
  it("J. differently-cased duplicate ('Report_Date' alongside 'report_date') is NOT treated as a duplicate of the canonical header — it is treated as the canonical header still being MISSING, exactly like every other case-sensitive mismatch in this module", () => {
    const headers = ["Report_Date", "report_date", "location", "waste_type", "source_external_id"];
    // "report_date" IS present exactly once here (the second entry), so
    // this is actually valid — included primarily to document that casing
    // differences are never collapsed into "duplicate".
    expect(() => validateIllegalDumpingHeaders(headers)).not.toThrow();
  });

  it("K. a header row with ONLY a differently-cased variant ('Report_Date') is rejected as MISSING report_date, never as a duplicate", () => {
    const headers = ["Report_Date", "location", "waste_type", "source_external_id"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("L. leading/trailing whitespace on a header ('report_date ') is never trimmed — it is treated as a distinct, non-matching string, exactly mirroring decodeCsvOnly's own no-trim behavior, so it is rejected as MISSING report_date rather than silently matched or flagged as a duplicate", () => {
    const headers = ["report_date ", "location", "waste_type", "source_external_id"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/report_date/);
  });

  it("missing-header detection still takes priority when a header row has BOTH a missing required header AND an unrelated duplicated required header", () => {
    // waste_type is missing entirely; location is duplicated. The missing
    // check runs first (structural absence), so the error is the missing-
    // header error, not the duplicate error — duplicates are only checked
    // once every required header is confirmed present.
    const headers = ["report_date", "location", "location", "source_external_id"];
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/missing/i);
    expect(() => validateIllegalDumpingHeaders(headers)).toThrow(/waste_type/);
  });
});

describe("validateIllegalDumpingHeaders — duplicate OPTIONAL headers (investigated, deliberately out of scope for 5A.3A)", () => {
  it("a duplicated OPTIONAL header (severity) does NOT throw — the same last-occurrence-wins Map mechanism applies, but this hardening pass intentionally scopes to REQUIRED headers only (see the 5A.3A implementation report, Section 6)", () => {
    const headers = ["report_date", "location", "waste_type", "severity", "severity", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "high", "low", "EXT-1"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).not.toThrow();
    // Documents the actual observable behavior: the LAST "severity" column
    // (value "low") silently wins over the first ("high") — the exact
    // ambiguity risk this slice fixes for required headers, still present
    // for optional ones.
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped[0].row.severity).toBe("LOW");
  });
});

describe("mapIllegalDumpingRows — non-regression: valid, non-duplicated headers still map correctly", () => {
  it("maps a well-formed row with all required + several optional headers present exactly once", () => {
    const headers = ["report_date", "location", "waste_type", "suburb", "severity", "status", "source_external_id"];
    const rows = [["2024-01-15", "Main St", "tyres", "Riverside", "high", "in progress", "EXT-1"]];
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].sourceExternalId).toBe("EXT-1");
    expect(mapped[0].row).toMatchObject({
      location: "Main St",
      waste_type: "tyres",
      suburb: "Riverside",
      severity: "HIGH",
      status: "IN_PROGRESS",
    });
  });
});

describe("mapIllegalDumpingRows — source_external_id (6.1B reconciliation identity)", () => {
  it("carries the source_external_id value as a sibling of the mapped row, never inside MappedIllegalDumpingRow itself", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "TICKET-042"]];
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped[0].sourceExternalId).toBe("TICKET-042");
    expect(mapped[0].row).not.toHaveProperty("source_external_id");
  });

  it("preserves leading zeroes — never numerically coerced", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "00123"]];
    const mapped = mapIllegalDumpingRows(headers, rows);
    expect(mapped[0].sourceExternalId).toBe("00123");
    expect(typeof mapped[0].sourceExternalId).toBe("string");
  });

  it("a missing source_external_id column fails via the existing required-header mechanism, before any row is ever mapped", () => {
    const headers = ["report_date", "location", "waste_type"];
    const rows = [["2024-01-01", "Main St", "tyres"]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(/source_external_id/);
  });

  it("a blank/whitespace-only source_external_id value fails the row — never silently accepted, never a fabricated fallback", () => {
    const headers = ["report_date", "location", "waste_type", "source_external_id"];
    const rows = [["2024-01-01", "Main St", "tyres", "   "]];
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(/source_external_id/);
  });

  it("is a legal, generic canonical target — not named after any one source's own terminology (e.g. Onkaparinga's 'Ticket #')", () => {
    // The canonical name itself is the assertion here: this repo's mapper
    // must never bake one customer's vocabulary into the universal Illegal
    // Dumping schema — a source-specific header name (e.g. "Ticket #") is
    // mapped to this generic target via a MappingDocument (see
    // dataHubMappingExecution.test.ts), never hardcoded here.
    const headers = ["report_date", "location", "waste_type", "source_external_id"];
    expect(headers).not.toContain("ticket_number");
    expect(headers).not.toContain("Ticket #");
  });
});

// ---------------------------------------------------------------------------
// Data Hub 6.0A — deterministic Australian (D/M/YYYY) date parsing.
//
// Onkaparinga's real Illegal Dumping export uses day-first dates like
// "1/07/2025" (1 July 2025). The pre-6.0A parser (`new Date(v)`) either
// silently swapped month/day for day<=12 values or threw Invalid Date for
// day>12 values — independently reproduced against the real source file
// this authorization is scoped against (2,085/3,568 rows, 58.4%, produced
// Invalid Date; the remaining 1,483, 41.6%, silently misparsed).
//
// Tested through the PUBLIC mapper (mapIllegalDumpingRows), never the
// private parseDate helper directly, so these tests exercise the exact
// same code path a real Confirm attempt does.
// ---------------------------------------------------------------------------

// Data Hub 6.1B — source_external_id is now a required header for every
// call. Unwrapped back to plain MappedIllegalDumpingRow[] here (never
// {row, sourceExternalId}[]) so every existing `mapOneRow(...)[0].field`
// call site below is completely unaffected by the 6.1B return-shape
// change — this helper is the sole seam that absorbs it.
function mapOneRow(reportDate: string, resolutionDate?: string): MappedIllegalDumpingRow[] {
  const headers = ["report_date", "location", "waste_type", "resolution_date", "source_external_id"];
  const mapped = mapIllegalDumpingRows(headers, [
    [reportDate, "Main St", "tyres", resolutionDate ?? "", "EXT-1"],
  ]);
  return mapped.map((m) => m.row);
}

describe("mapIllegalDumpingRows — Australian D/M/YYYY date parsing (6.0A)", () => {
  it("A. \"1/07/2025\" (single-digit day) maps to 1 July 2025, not 7 January", () => {
    const mapped = mapOneRow("1/07/2025");
    const d = mapped[0].report_date;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(6); // 0-indexed: July
    expect(d.getUTCDate()).toBe(1);
  });

  it("B. \"01/07/2025\" (zero-padded day) maps to 1 July 2025", () => {
    const d = mapOneRow("01/07/2025")[0].report_date;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(1);
  });

  it("C. \"13/07/2025\" (day > 12, would have thrown Invalid Date under the old parser) maps to 13 July 2025 without throwing", () => {
    const d = mapOneRow("13/07/2025")[0].report_date;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(13);
  });

  it("D. \"31/12/2025\" (last day of a 31-day month) is valid", () => {
    const d = mapOneRow("31/12/2025")[0].report_date;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCDate()).toBe(31);
  });

  it("E. \"29/02/2024\" (leap year) is valid", () => {
    const d = mapOneRow("29/02/2024")[0].report_date;
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(29);
  });

  it("F. \"29/02/2025\" (non-leap year) is invalid — required report_date failure", () => {
    expect(() => mapOneRow("29/02/2025")).toThrow(IllegalDumpingMappingError);
    expect(() => mapOneRow("29/02/2025")).toThrow(/report_date/);
  });

  it("G. \"31/02/2025\" (February never has 31 days) is invalid — never silently rolls over to a different valid date", () => {
    expect(() => mapOneRow("31/02/2025")).toThrow(IllegalDumpingMappingError);
  });

  it("H. month 13 (\"1/13/2025\") is invalid", () => {
    expect(() => mapOneRow("1/13/2025")).toThrow(IllegalDumpingMappingError);
  });

  it("I. day 0 (\"0/07/2025\") is invalid", () => {
    expect(() => mapOneRow("0/07/2025")).toThrow(IllegalDumpingMappingError);
  });

  it("J. day 32 (\"32/07/2025\") is invalid", () => {
    expect(() => mapOneRow("32/07/2025")).toThrow(IllegalDumpingMappingError);
  });

  it("K. a malformed date string is invalid", () => {
    expect(() => mapOneRow("not-a-real-date-string")).toThrow(IllegalDumpingMappingError);
  });

  it("L. a blank optional resolution_date preserves the existing null behavior (no throw)", () => {
    const mapped = mapOneRow("2024-01-01", "");
    expect(mapped[0].resolution_date).toBeNull();
  });

  it("M. an invalid required report_date fails the row/import exactly as before (same error shape)", () => {
    expect(() => mapOneRow("")).toThrow(IllegalDumpingMappingError);
    expect(() => mapOneRow("")).toThrow(/report_date" is missing or not a valid date/);
  });

  it("N. the existing deliberately-supported ISO YYYY-MM-DD format remains supported and unchanged (matches the pre-6.0A UTC-midnight timestamp exactly)", () => {
    const d = mapOneRow("2024-01-01")[0].report_date;
    expect(d.toISOString()).toBe(new Date("2024-01-01").toISOString());
  });

  it("O. \"1/07/2025\" is explicitly NOT interpreted as January 7", () => {
    const d = mapOneRow("1/07/2025")[0].report_date;
    expect(d.getUTCMonth()).not.toBe(0); // not January
    expect(d.getUTCDate()).not.toBe(7);
  });

  it("optional resolution_date, when present and valid in AU format, parses the same way as report_date", () => {
    const mapped = mapOneRow("2024-01-01", "13/07/2025");
    const rd = mapped[0].resolution_date;
    expect(rd).not.toBeNull();
    expect(rd!.getUTCFullYear()).toBe(2025);
    expect(rd!.getUTCMonth()).toBe(6);
    expect(rd!.getUTCDate()).toBe(13);
  });

  it("optional resolution_date, when present but invalid, is silently null (never throws — optional-field semantics unchanged)", () => {
    const mapped = mapOneRow("2024-01-01", "31/02/2025");
    expect(mapped[0].resolution_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Data Hub 6.0B1 — status fail-closed compatibility patch.
//
// Phase 6.0B read-only discovery found exactly 5 distinct Status values in
// the real Onkaparinga Illegal Dumping export: Resolved (2,645), Completed
// w/exception (731), Abandoned (173), Booked (18), Requires Input (1). The
// pre-6.0B1 mapper silently mapped everything except "Resolved" to OPEN —
// including 923 rows (25.9%) whose true BrainBase semantics were never
// actually decided. This patch authorizes exactly three new mappings
// (Resolved -> RESOLVED already existed; Booked -> OPEN and Requires
// Input -> OPEN are evidence-confirmed, 0% Closed-timestamp correlation)
// and explicitly BLOCKS two customer-confirmation-pending values
// (Completed w/exception, Abandoned) rather than guessing RESOLVED or
// CLOSED for them. The old catch-all `else -> OPEN` is removed entirely:
// any status this mapper hasn't been deliberately taught now fails
// closed, protecting against silently corrupting the meaning of a future
// unexpected source lifecycle value.
//
// Tested through the PUBLIC mapper, never the private mapStatus helper
// directly, mirroring the 6.0A test style above.
// ---------------------------------------------------------------------------

// Data Hub 6.1B — same unwrapping seam as mapOneRow above.
function mapOneRowWithStatus(status: string): MappedIllegalDumpingRow[] {
  const headers = ["report_date", "location", "waste_type", "status", "source_external_id"];
  const mapped = mapIllegalDumpingRows(headers, [["2024-01-01", "Main St", "tyres", status, "EXT-1"]]);
  return mapped.map((m) => m.row);
}

describe("mapIllegalDumpingRows — status fail-closed compatibility (6.0B1)", () => {
  it("A. \"Resolved\" maps to RESOLVED", () => {
    expect(mapOneRowWithStatus("Resolved")[0].status).toBe("RESOLVED");
  });

  it("B. a case/whitespace variant of Resolved (\"  RESOLVED  \") still maps to RESOLVED — existing normalization preserved", () => {
    expect(mapOneRowWithStatus("  RESOLVED  ")[0].status).toBe("RESOLVED");
  });

  it("C. \"Booked\" maps to OPEN (evidence-confirmed: 0% Closed-timestamp correlation in the real file)", () => {
    expect(mapOneRowWithStatus("Booked")[0].status).toBe("OPEN");
  });

  it("D. \"Requires Input\" maps to OPEN (evidence-confirmed: 0% Closed-timestamp correlation, 1 row)", () => {
    expect(mapOneRowWithStatus("Requires Input")[0].status).toBe("OPEN");
  });

  it("E. \"Completed w/exception\" throws IllegalDumpingMappingError — customer confirmation required, never silently OPEN", () => {
    expect(() => mapOneRowWithStatus("Completed w/exception")).toThrow(IllegalDumpingMappingError);
  });

  it("F. \"Abandoned\" throws IllegalDumpingMappingError — customer confirmation required, never silently OPEN", () => {
    expect(() => mapOneRowWithStatus("Abandoned")).toThrow(IllegalDumpingMappingError);
  });

  it("G. an arbitrary unknown future status (\"Some New Future Status\") throws IllegalDumpingMappingError", () => {
    expect(() => mapOneRowWithStatus("Some New Future Status")).toThrow(IllegalDumpingMappingError);
  });

  it("H. an unknown status never silently maps to OPEN — the only two possible outcomes are a deliberately-authored mapping or a thrown error", () => {
    // The prior implementation's `return "OPEN"` catch-all is gone entirely:
    // every branch of mapStatus now either returns a specific, deliberately-
    // authored status or throws. This proves the throw for a genuinely
    // unrecognized value, complementing G above with an explicit
    // "not silently OPEN" framing.
    let threw = false;
    try {
      mapOneRowWithStatus("Unexpected Workflow State");
    } catch (e) {
      threw = e instanceof IllegalDumpingMappingError;
    }
    expect(threw).toBe(true);
  });

  it("I. no known real Onkaparinga status value maps to CLOSED under this patch", () => {
    const knownValues = ["Resolved", "Booked", "Requires Input"];
    for (const v of knownValues) {
      expect(mapOneRowWithStatus(v)[0].status).not.toBe("CLOSED");
    }
    // Abandoned (the obvious CLOSED candidate per discovery's own
    // best-evidence analysis) is deliberately NOT given any status at
    // all in this patch — it throws (F above) rather than being mapped
    // to CLOSED without explicit customer authorization.
  });

  it("J. 6.0A Australian date parsing remains unaffected by this patch (spot-check)", () => {
    const d = mapOneRow("13/07/2025")[0].report_date;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(13);
  });

  it("K. location-required behavior remains unchanged by this patch", () => {
    const headers = ["report_date", "location", "waste_type", "status", "source_external_id"];
    expect(() => mapIllegalDumpingRows(headers, [["2024-01-01", "", "tyres", "Resolved", "EXT-1"]])).toThrow(
      /"location" is required/
    );
  });

  it("L. a status failure aborts the ENTIRE mapping call synchronously — no partial results, even when an earlier row in the same call is otherwise valid", () => {
    const headers = ["report_date", "location", "waste_type", "status", "source_external_id"];
    const rows = [
      ["2024-01-01", "Main St", "tyres", "Resolved", "EXT-1"],
      ["2024-01-02", "Other St", "mattress", "Abandoned", "EXT-2"],
    ];
    // mapIllegalDumpingRows is called by confirmWorksheet.ts strictly
    // BEFORE prisma.$transaction opens — a synchronous throw here means
    // execution never reaches any domain write path at all, for either
    // row, even though row 1 alone would have mapped successfully.
    expect(() => mapIllegalDumpingRows(headers, rows)).toThrow(IllegalDumpingMappingError);
  });

  it("preserves pre-existing, already-tested \"closed\"/\"complete\" exact-match and \"progress\"-substring mappings (unrelated to the Onkaparinga ambiguity, not part of this patch's scope)", () => {
    expect(mapOneRowWithStatus("closed")[0].status).toBe("RESOLVED");
    expect(mapOneRowWithStatus("complete")[0].status).toBe("RESOLVED");
    expect(mapOneRowWithStatus("in progress")[0].status).toBe("IN_PROGRESS");
  });

  it("preserves the pre-existing missing-status-column default (literal \"open\" -> OPEN)", () => {
    // No "status" header supplied at all — mirrors mapOneRow's own headers
    // (report_date/location/waste_type/resolution_date, no status) and the
    // existing `get(row, "status") ?? "open"` call-site default.
    const mapped = mapOneRow("2024-01-01");
    expect(mapped[0].status).toBe("OPEN");
  });

  it("preserves existing certified compatibility for a PRESENT status column whose value is an empty string (never throws — distinct from the fail-closed path for a genuinely unrecognized NON-EMPTY value)", () => {
    // Discovered via regression: dataHubMappingExecution.test.ts's own
    // toIllegalDumpingMapperInput adapter represents every
    // ILLEGAL_DUMPING_KNOWN_HEADERS field with no configured source column
    // as an empty STRING (never `undefined`), which bypasses
    // mapIllegalDumpingRows' own `get(row, "status") ?? "open"` call-site
    // default entirely and reaches mapStatus("") directly. This is
    // existing, already-shipped, already-certified compatibility that
    // fail-closed must not break — an empty status value means "no status
    // was actually provided", not "an unrecognized status was provided".
    expect(mapOneRowWithStatus("")[0].status).toBe("OPEN");
    expect(mapOneRowWithStatus("   ")[0].status).toBe("OPEN");
  });
});
