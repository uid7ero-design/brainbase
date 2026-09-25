import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_DIFFERENCE_CODES,
  compareDifferences,
  matchObservedWorkbookStructure,
  planHeaderRowReads,
  type GovernedSchemaInput,
  type ObservedWorkbookInput,
  type ObservedWorksheetInput,
  type SchemaMatchReport,
} from "@/lib/data-hub/schemaMatch/schemaMatcher";

// Data Hub 6.2D3C — pure governed structural matcher. The governed input is
// built from the committed D3B STRUCTURAL manifest (sheet names + literal
// headers only — no row values exist in it), exactly as the seed inserts it:
// DRAFT, every sheet/column OPTIONAL, header row 3 (Trends: none).

const ROOT = path.resolve(__dirname, "../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "config/data-hub/onkaparinga-monthly-operations-v1.json"), "utf8"));

type ManifestSheet = { ordinal: number; logicalKey: string; name: string; headerRowOneBased: number | null; columns: { header: string }[] };

function governedJuneV1(): GovernedSchemaInput {
  return {
    sourceSchemaVersionId: "dhcfg-onk-mwco-sv1",
    versionNumber: 1,
    status: "DRAFT",
    worksheets: (MANIFEST.worksheets as ManifestSheet[]).map((w) => ({
      logicalKey: w.logicalKey,
      expectedName: w.name,
      ordinalHint: w.ordinal,
      presence: "OPTIONAL" as const,
      headerRowOneBased: w.headerRowOneBased,
      columns: w.columns.map((c, ordinal) => ({ ordinal, sourceHeader: c.header, presence: "OPTIONAL" as const })),
    })),
  };
}

/** The observed structure of a workbook identical to the governed one. */
function exactObserved(governed: GovernedSchemaInput = governedJuneV1()): ObservedWorkbookInput {
  return {
    worksheets: governed.worksheets.map((g, index) => ({
      index,
      name: g.expectedName,
      visibility: "visible" as const,
      isEmpty: false,
      headerRow: g.columns.length > 0 ? { status: "ok" as const, cells: g.columns.map((c) => c.sourceHeader) } : { status: "notRead" as const },
    })),
  };
}

function withSheet(observed: ObservedWorkbookInput, name: string, edit: (w: ObservedWorksheetInput) => ObservedWorksheetInput): ObservedWorkbookInput {
  return { worksheets: observed.worksheets.map((w) => (w.name === name ? edit(w) : w)) };
}

function cellsOf(observed: ObservedWorkbookInput, name: string): (string | null)[] {
  const w = observed.worksheets.find((x) => x.name === name)!;
  if (w.headerRow.status !== "ok") throw new Error("no cells");
  return [...w.headerRow.cells];
}

function withCells(observed: ObservedWorkbookInput, name: string, cells: (string | null)[]): ObservedWorkbookInput {
  return withSheet(observed, name, (w) => ({ ...w, headerRow: { status: "ok", cells } }));
}

function reindex(worksheets: ObservedWorksheetInput[]): ObservedWorkbookInput {
  return { worksheets: worksheets.map((w, index) => ({ ...w, index })) };
}

function run(observed: ObservedWorkbookInput, governed: GovernedSchemaInput = governedJuneV1()): SchemaMatchReport {
  return matchObservedWorkbookStructure({ observed, governedSchema: governed });
}

function codes(report: SchemaMatchReport): string[] {
  return report.differences.map((d) => d.code);
}

describe("6.2D3C matcher — governed June-v1 fixture sanity", () => {
  it("is the production-like D3B shape: 14 sheets, 295 columns, DRAFT, all OPTIONAL, header row 3", () => {
    const g = governedJuneV1();
    expect(g.worksheets).toHaveLength(14);
    expect(g.worksheets.reduce((n, w) => n + w.columns.length, 0)).toBe(295);
    expect(g.worksheets.find((w) => w.expectedName === "Trends")).toMatchObject({ columns: [], headerRowOneBased: null });
    expect(new Set(g.worksheets.filter((w) => w.columns.length > 0).map((w) => w.headerRowOneBased))).toEqual(new Set([3]));
  });
});

describe("6.2D3C matcher — exact structure", () => {
  it("exact June-v1 structure => EXACT_MATCH with zero differences and truthful counts", () => {
    const r = run(exactObserved());
    expect(r).toEqual({
      reportVersion: 1,
      sourceSchemaVersionId: "dhcfg-onk-mwco-sv1",
      sourceSchemaVersionNumber: 1,
      sourceSchemaStatus: "DRAFT",
      result: "EXACT_MATCH",
      exactMatch: true,
      blocking: false,
      observedWorksheetCount: 14,
      governedWorksheetCount: 14,
      matchedWorksheetCount: 14,
      missingRequiredWorksheetCount: 0,
      missingOptionalWorksheetCount: 0,
      unexpectedWorksheetCount: 0,
      totalDifferenceCount: 0,
      blockingDifferenceCount: 0,
      warningDifferenceCount: 0,
      differences: [],
    });
  });

  it("worksheet physical reorder alone is NOT drift (ordinal_hint is informational)", () => {
    const reversed = reindex([...exactObserved().worksheets].reverse());
    expect(run(reversed)).toMatchObject({ result: "EXACT_MATCH", differences: [] });
  });

  it("duplicate Ticket Tasks 'Notes' (27, 32) and Service Exception Totals 'Garbage' (1, 5) unchanged => exact", () => {
    const o = exactObserved();
    expect(cellsOf(o, "Ticket Tasks").flatMap((h, i) => (h === "Notes" ? [i] : []))).toEqual([27, 32]);
    expect(cellsOf(o, "Service Exception Totals").flatMap((h, i) => (h === "Garbage" ? [i] : []))).toEqual([1, 5]);
    expect(run(o).result).toBe("EXACT_MATCH");
  });

  it("Trends (zero governed columns) matches by name only: no column comparison, no invented drift, whatever its header row", () => {
    for (const headerRow of [{ status: "notRead" as const }, { status: "rowAbsent" as const }, { status: "ok" as const, cells: ["Anything", "Else"] }]) {
      const r = run(withSheet(exactObserved(), "Trends", (w) => ({ ...w, headerRow })));
      expect(r.result).toBe("EXACT_MATCH");
      expect(r.matchedWorksheetCount).toBe(14);
    }
  });
});

describe("6.2D3C matcher — worksheet-level drift", () => {
  it("optional sheet absent => MATCH_WITH_NON_BLOCKING_DRIFT + one MISSING_OPTIONAL_WORKSHEET (WARNING)", () => {
    const r = run(reindex(exactObserved().worksheets.filter((w) => w.name !== "Vouchers")));
    expect(r.result).toBe("MATCH_WITH_NON_BLOCKING_DRIFT");
    expect(r.blocking).toBe(false);
    expect(r.differences).toEqual([
      expect.objectContaining({
        code: "MISSING_OPTIONAL_WORKSHEET",
        severity: "WARNING",
        worksheetLogicalKey: "vouchers",
        governedWorksheetName: "Vouchers",
        governedWorksheetOrdinalHint: 8,
        observedWorksheetIndex: null,
        governedPresence: "OPTIONAL",
      }),
    ]);
    expect(r).toMatchObject({ matchedWorksheetCount: 13, missingOptionalWorksheetCount: 1, missingRequiredWorksheetCount: 0, warningDifferenceCount: 1 });
  });

  it("unexpected visible, hidden and empty sheets are each UNEXPECTED_WORKSHEET (WARNING) — hidden/empty never silently ignored", () => {
    const o = reindex([
      ...exactObserved().worksheets,
      { index: 0, name: "Scratch", visibility: "visible", isEmpty: false, headerRow: { status: "notRead" } },
      { index: 0, name: "Lookup", visibility: "hidden", isEmpty: false, headerRow: { status: "notRead" } },
      { index: 0, name: "Deep", visibility: "veryHidden", isEmpty: true, headerRow: { status: "notRead" } },
    ]);
    const r = run(o);
    expect(r.result).toBe("MATCH_WITH_NON_BLOCKING_DRIFT");
    expect(r.unexpectedWorksheetCount).toBe(3);
    expect(r.differences.map((d) => [d.code, d.severity, d.observedWorksheetName, d.observedWorksheetIndex])).toEqual([
      ["UNEXPECTED_WORKSHEET", "WARNING", "Scratch", 14],
      ["UNEXPECTED_WORKSHEET", "WARNING", "Lookup", 15],
      ["UNEXPECTED_WORKSHEET", "WARNING", "Deep", 16],
    ]);
  });

  it("renamed worksheet => missing governed + unexpected observed; never fuzzy; WORKSHEET_NAME_MISMATCH never emitted", () => {
    for (const renamed of ["Run", "runs", "RUNS", "Runs ", " Runs", "Runs."]) {
      const r = run(withSheet(exactObserved(), "Runs", (w) => ({ ...w, name: renamed })));
      expect(codes(r).sort()).toEqual(["MISSING_OPTIONAL_WORKSHEET", "UNEXPECTED_WORKSHEET"]);
      expect(codes(r)).not.toContain("WORKSHEET_NAME_MISMATCH");
      expect(r.differences.find((d) => d.code === "UNEXPECTED_WORKSHEET")!.observedWorksheetName).toBe(renamed);
    }
  });

  it("governed sheet present but hidden or empty => SHEET_UNMATCHABLE (WARNING for OPTIONAL), not matched, never decoded", () => {
    for (const edit of [{ visibility: "hidden" as const }, { visibility: "veryHidden" as const }, { isEmpty: true }]) {
      const r = run(withSheet(exactObserved(), "Jobs", (w) => ({ ...w, ...edit, headerRow: { status: "notRead" } })));
      expect(r.differences).toEqual([expect.objectContaining({ code: "SHEET_UNMATCHABLE", severity: "WARNING", governedWorksheetName: "Jobs", observedWorksheetIndex: 5 })]);
      expect(r.matchedWorksheetCount).toBe(13);
      expect(r.result).toBe("MATCH_WITH_NON_BLOCKING_DRIFT");
    }
  });

  it("a governed name observed twice => one BLOCKING SHEET_UNMATCHABLE per occurrence", () => {
    const o = reindex([...exactObserved().worksheets, { ...exactObserved().worksheets[2] }]);
    const r = run(o);
    expect(r.differences.map((d) => [d.code, d.severity, d.observedWorksheetIndex])).toEqual([
      ["SHEET_UNMATCHABLE", "BLOCKING", 2],
      ["SHEET_UNMATCHABLE", "BLOCKING", 14],
    ]);
    expect(r.result).toBe("BLOCKING_DRIFT");
  });

  it("a completely different (changed-schema) workbook => UNMATCHABLE, blocking, with the structural differences listed", () => {
    const r = run({ worksheets: [{ index: 0, name: "Summary 2027", visibility: "visible", isEmpty: false, headerRow: { status: "notRead" } }] });
    expect(r).toMatchObject({ result: "UNMATCHABLE", exactMatch: false, blocking: true, matchedWorksheetCount: 0, missingOptionalWorksheetCount: 14, unexpectedWorksheetCount: 1 });
    expect(r.totalDifferenceCount).toBe(15);
  });
});

describe("6.2D3C matcher — column-level drift and precedence", () => {
  it("changed single header => one deterministic COLUMN_HEADER_CHANGED (WARNING while DRAFT + OPTIONAL)", () => {
    const cells = cellsOf(exactObserved(), "Runs");
    cells[2] = "Run Name";
    const r = run(withCells(exactObserved(), "Runs", cells));
    expect(r.result).toBe("MATCH_WITH_NON_BLOCKING_DRIFT");
    expect(r.differences).toEqual([
      {
        code: "COLUMN_HEADER_CHANGED",
        severity: "WARNING",
        worksheetLogicalKey: "runs",
        governedWorksheetName: "Runs",
        observedWorksheetName: "Runs",
        governedWorksheetOrdinalHint: 2,
        observedWorksheetIndex: 2,
        governedColumnOrdinal: 2,
        observedColumnOrdinal: 2,
        governedHeader: "Run",
        observedHeader: "Run Name",
        governedPresence: "OPTIONAL",
        messageKey: "dataHub.schemaMatch.columnHeaderChanged",
        deterministicKey: '["COLUMN_HEADER_CHANGED","runs",2,2,2,"Run"]',
      },
    ]);
  });

  it("case, punctuation and whitespace changes are drift (exact literal comparison)", () => {
    for (const [ordinal, changed] of [[0, "ID"], [0, "id"], [0, "Id "], [12, "Ave Bin Weight."], [12, "Ave  Bin Weight"]] as const) {
      const cells = cellsOf(exactObserved(), "Runs");
      cells[ordinal] = changed;
      const r = run(withCells(exactObserved(), "Runs", cells));
      expect(codes(r), changed).toEqual(["COLUMN_HEADER_CHANGED"]);
      expect(r.differences[0].observedHeader).toBe(changed);
    }
    const overview = cellsOf(exactObserved(), "Overview");
    overview[7] = "Ave Wt/Bin";
    expect(codes(run(withCells(exactObserved(), "Overview", overview)))).toEqual(["COLUMN_HEADER_CHANGED"]);
  });

  it("the Definitions 'Defintion' typo is governed literally: correcting it is drift", () => {
    const cells = cellsOf(exactObserved(), "Definitions");
    cells[cells.indexOf("Defintion")] = "Definition";
    expect(codes(run(withCells(exactObserved(), "Definitions", cells)))).toEqual(["COLUMN_HEADER_CHANGED"]);
  });

  it("unique headers swapped => exactly two COLUMN_POSITION_CHANGED (no extra header-changed/missing/unexpected noise)", () => {
    const cells = cellsOf(exactObserved(), "Vouchers");
    [cells[4], cells[5]] = [cells[5], cells[4]];
    const r = run(withCells(exactObserved(), "Vouchers", cells));
    expect(r.differences.map((d) => [d.code, d.governedHeader, d.governedColumnOrdinal, d.observedColumnOrdinal])).toEqual([
      ["COLUMN_POSITION_CHANGED", "Status", 4, 5],
      ["COLUMN_POSITION_CHANGED", "Expiration", 5, 4],
    ]);
  });

  it("appended / removed columns => UNEXPECTED_COLUMN / MISSING_OPTIONAL_COLUMN at exact ordinals", () => {
    const extra = run(withCells(exactObserved(), "Prestart Checks", [...cellsOf(exactObserved(), "Prestart Checks"), "Odometer"]));
    expect(extra.differences.map((d) => [d.code, d.observedColumnOrdinal, d.observedHeader])).toEqual([["UNEXPECTED_COLUMN", 6, "Odometer"]]);
    const fewer = run(withCells(exactObserved(), "Prestart Checks", cellsOf(exactObserved(), "Prestart Checks").slice(0, 5)));
    expect(fewer.differences.map((d) => [d.code, d.governedColumnOrdinal, d.governedHeader])).toEqual([["MISSING_OPTIONAL_COLUMN", 5, "Time"]]);
  });

  it("a blank / non-text header cell is reported with observedHeader null", () => {
    const cells = cellsOf(exactObserved(), "Prestart Checks");
    cells[1] = null;
    const r = run(withCells(exactObserved(), "Prestart Checks", cells));
    expect(r.differences.map((d) => [d.code, d.governedHeader, d.observedHeader])).toEqual([["COLUMN_HEADER_CHANGED", "Driver", null]]);
  });

  it("duplicate 'Notes' count reduced / increased / moved => DUPLICATE_HEADER_SHAPE_CHANGED, identity by ordinal", () => {
    const base = cellsOf(exactObserved(), "Ticket Tasks");
    const reduced = run(withCells(exactObserved(), "Ticket Tasks", base.slice(0, 32)));
    expect(reduced.differences.map((d) => [d.code, d.governedHeader])).toEqual([["DUPLICATE_HEADER_SHAPE_CHANGED", "Notes"]]);

    const increased = run(withCells(exactObserved(), "Ticket Tasks", [...base, "Notes"]));
    expect(increased.differences.map((d) => [d.code, d.governedHeader])).toEqual([["DUPLICATE_HEADER_SHAPE_CHANGED", "Notes"]]);

    // Last Notes moved from 32 to 30; the two headers it displaced shift by one.
    const moved = [...base.slice(0, 30), "Notes", base[30], base[31]];
    const r = run(withCells(exactObserved(), "Ticket Tasks", moved));
    expect(r.differences.map((d) => [d.code, d.governedHeader, d.governedColumnOrdinal, d.observedColumnOrdinal])).toEqual([
      ["COLUMN_POSITION_CHANGED", "Service Exceptions", 30, 31],
      ["COLUMN_POSITION_CHANGED", "Resolution Note", 31, 32],
      ["DUPLICATE_HEADER_SHAPE_CHANGED", "Notes", null, null],
    ]);
  });

  it("Service Exception Totals duplicate 'Garbage': second renamed => shape change + the new text as UNEXPECTED_COLUMN", () => {
    const cells = cellsOf(exactObserved(), "Service Exception Totals");
    cells[5] = "Garbage 2";
    const r = run(withCells(exactObserved(), "Service Exception Totals", cells));
    expect(r.differences.map((d) => [d.code, d.severity, d.governedHeader, d.observedColumnOrdinal, d.observedHeader])).toEqual([
      ["UNEXPECTED_COLUMN", "WARNING", null, 5, "Garbage 2"],
      ["DUPLICATE_HEADER_SHAPE_CHANGED", "WARNING", "Garbage", null, null],
    ]);
  });

  it("a unique governed header that now appears twice is a duplicate-shape change, never collapsed by name", () => {
    const cells = cellsOf(exactObserved(), "Prestart Checks");
    cells.push("Driver");
    expect(run(withCells(exactObserved(), "Prestart Checks", cells)).differences.map((d) => [d.code, d.governedHeader])).toEqual([
      ["DUPLICATE_HEADER_SHAPE_CHANGED", "Driver"],
    ]);
  });
});

describe("6.2D3C matcher — header row, limits, required, internal errors", () => {
  it("header row absent or with ZERO governed overlap => single BLOCKING HEADER_ROW_UNRESOLVED; the row's text is never echoed", () => {
    const absent = run(withSheet(exactObserved(), "Jobs", (w) => ({ ...w, headerRow: { status: "rowAbsent" } })));
    expect(absent.differences).toEqual([expect.objectContaining({ code: "HEADER_ROW_UNRESOLVED", severity: "BLOCKING", governedWorksheetName: "Jobs" })]);
    expect(absent.result).toBe("BLOCKING_DRIFT");

    const dataLike = ["Jane Citizen", "0412 345 678", "12 Example St"];
    const r = run(withCells(exactObserved(), "Jobs", dataLike));
    expect(codes(r)).toEqual(["HEADER_ROW_UNRESOLVED"]);
    for (const secret of dataLike) expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("review F1: a data row sharing ONE cell with a governed header is not a header row — nothing echoed", () => {
    const dataRow = ["Jane Citizen", "Driver", "12 Secret St"];
    const r = run(withCells(exactObserved(), "Prestart Checks", dataRow));
    expect(codes(r)).toEqual(["HEADER_ROW_UNRESOLVED"]);
    expect(JSON.stringify(r)).not.toMatch(/Jane|Secret St/);
    // Exactly half of the governed positions present still resolves.
    const half = ["Vehicle", "Driver", "Result", "X1", "X2", "X3"];
    expect(codes(run(withCells(exactObserved(), "Prestart Checks", half)))).not.toContain("HEADER_ROW_UNRESOLVED");
  });

  it("review F2: a duplicate-shape change on a REQUIRED duplicate, or under a non-DRAFT schema, is BLOCKING", () => {
    const g = governedJuneV1();
    g.worksheets.find((w) => w.expectedName === "Ticket Tasks")!.columns[32].presence = "REQUIRED";
    const reduced = cellsOf(exactObserved(g), "Ticket Tasks").slice(0, 32);
    const r = run(withCells(exactObserved(g), "Ticket Tasks", reduced), g);
    expect(r.differences).toEqual([expect.objectContaining({ code: "DUPLICATE_HEADER_SHAPE_CHANGED", severity: "BLOCKING", governedHeader: "Notes" })]);
    expect(r.result).toBe("BLOCKING_DRIFT");
    const active = { ...governedJuneV1(), status: "ACTIVE" };
    const renamed = cellsOf(exactObserved(active), "Ticket Tasks");
    renamed[32] = "Other";
    expect(run(withCells(exactObserved(active), "Ticket Tasks", renamed), active).differences.find((d) => d.code === "DUPLICATE_HEADER_SHAPE_CHANGED")!.severity).toBe("BLOCKING");
  });

  it("governed sheet with columns but no governed header row => HEADER_ROW_UNRESOLVED; plan never reads it", () => {
    const g = governedJuneV1();
    g.worksheets.find((w) => w.expectedName === "Jobs")!.headerRowOneBased = null;
    expect(codes(run(exactObserved(), g))).toEqual(["HEADER_ROW_UNRESOLVED"]);
    expect(planHeaderRowReads(exactObserved().worksheets, g).map((p) => p.index)).not.toContain(5);
  });

  it("STRUCTURAL_LIMIT_EXCEEDED and ambiguous header reads are BLOCKING", () => {
    expect(run(withSheet(exactObserved(), "Loads", (w) => ({ ...w, headerRow: { status: "limitExceeded" } }))).differences).toEqual([
      expect.objectContaining({ code: "STRUCTURAL_LIMIT_EXCEEDED", severity: "BLOCKING" }),
    ]);
    expect(run(withSheet(exactObserved(), "Loads", (w) => ({ ...w, headerRow: { status: "ambiguous" } }))).differences).toEqual([
      expect.objectContaining({ code: "SHEET_UNMATCHABLE", severity: "BLOCKING" }),
    ]);
  });

  it("REQUIRED synthetic governed sheet / column missing => BLOCKING; required header change BLOCKING; ACTIVE optional change BLOCKING", () => {
    const g = governedJuneV1();
    g.worksheets.find((w) => w.expectedName === "Vouchers")!.presence = "REQUIRED";
    const noVouchers = run(reindex(exactObserved(g).worksheets.filter((w) => w.name !== "Vouchers")), g);
    expect(noVouchers).toMatchObject({ result: "BLOCKING_DRIFT", blocking: true, missingRequiredWorksheetCount: 1 });
    expect(noVouchers.differences).toEqual([expect.objectContaining({ code: "MISSING_REQUIRED_WORKSHEET", severity: "BLOCKING", governedPresence: "REQUIRED" })]);

    const g2 = governedJuneV1();
    g2.worksheets.find((w) => w.expectedName === "Prestart Checks")!.columns[5].presence = "REQUIRED";
    const cells = cellsOf(exactObserved(g2), "Prestart Checks").slice(0, 5);
    expect(run(withCells(exactObserved(g2), "Prestart Checks", cells), g2).differences).toEqual([
      expect.objectContaining({ code: "MISSING_REQUIRED_COLUMN", severity: "BLOCKING", governedHeader: "Time" }),
    ]);
    const changed = [...cellsOf(exactObserved(g2), "Prestart Checks")];
    changed[5] = "Clock";
    expect(run(withCells(exactObserved(g2), "Prestart Checks", changed), g2).differences[0]).toMatchObject({ code: "COLUMN_HEADER_CHANGED", severity: "BLOCKING" });

    const active = { ...governedJuneV1(), status: "ACTIVE" };
    const runs = cellsOf(exactObserved(active), "Runs");
    runs[0] = "ID";
    expect(run(withCells(exactObserved(active), "Runs", runs), active).differences[0]).toMatchObject({ code: "COLUMN_HEADER_CHANGED", severity: "BLOCKING" });
  });

  it("an eligible governed sheet whose header was not read (caller ignored the plan) => BLOCKING MATCHER_INTERNAL_ERROR", () => {
    const r = run(withSheet(exactObserved(), "Runs", (w) => ({ ...w, headerRow: { status: "notRead" } })));
    expect(r.differences).toEqual([expect.objectContaining({ code: "MATCHER_INTERNAL_ERROR", severity: "BLOCKING", governedWorksheetName: "Runs" })]);
  });

  it("invalid governed definitions (non-contiguous ordinals, duplicate expected names) => MATCHER_INTERNAL_ERROR, never a guess", () => {
    const g = governedJuneV1();
    g.worksheets.find((w) => w.expectedName === "Runs")!.columns[3].ordinal = 99;
    expect(codes(run(exactObserved(governedJuneV1()), g))).toEqual(["MATCHER_INTERNAL_ERROR"]);
    const dup = governedJuneV1();
    dup.worksheets.push({ ...dup.worksheets[2], logicalKey: "runs_again", ordinalHint: 14 });
    expect(codes(run(exactObserved(governedJuneV1()), dup)).filter((c) => c === "MATCHER_INTERNAL_ERROR")).toHaveLength(2);
  });

  it("a thrown internal failure => UNMATCHABLE with a single MATCHER_INTERNAL_ERROR and no error text", () => {
    const r = matchObservedWorkbookStructure({ observed: { worksheets: null as never }, governedSchema: governedJuneV1() });
    expect(r).toMatchObject({ result: "UNMATCHABLE", blocking: true, totalDifferenceCount: 1 });
    expect(r.differences[0]).toMatchObject({ code: "MATCHER_INTERNAL_ERROR", severity: "BLOCKING", messageKey: "dataHub.schemaMatch.matcherInternalError" });
    expect(JSON.stringify(r)).not.toMatch(/TypeError|Cannot read|Error:/);
  });

  it("an empty governed schema is UNMATCHABLE", () => {
    expect(run(exactObserved(), { ...governedJuneV1(), worksheets: [] }).result).toBe("UNMATCHABLE");
  });
});

describe("6.2D3C matcher — determinism", () => {
  function noisy(): ObservedWorkbookInput {
    let o = reindex([...exactObserved().worksheets.filter((w) => w.name !== "Vouchers")].reverse());
    o = { worksheets: [...o.worksheets, { index: o.worksheets.length, name: "Extra", visibility: "hidden", isEmpty: true, headerRow: { status: "notRead" } }] };
    const runs = cellsOf(o, "Runs");
    runs[1] = "date";
    runs.push("Extra Col");
    o = withCells(o, "Runs", runs);
    o = withCells(o, "Ticket Tasks", cellsOf(o, "Ticket Tasks").slice(0, 32));
    return o;
  }

  it("same inputs => byte-identical JSON reports", () => {
    expect(JSON.stringify(run(noisy()))).toBe(JSON.stringify(run(noisy())));
    expect(run(noisy())).toEqual(run(noisy()));
  });

  it("governed worksheet/column array order does not change the report", () => {
    const shuffled = governedJuneV1();
    shuffled.worksheets.reverse();
    for (const w of shuffled.worksheets) w.columns.reverse();
    expect(JSON.stringify(run(noisy(), shuffled))).toBe(JSON.stringify(run(noisy())));
  });

  it("differences are sorted by governed ordinal hint, observed index, column ordinals (nulls last), code, key", () => {
    const r = run(noisy());
    expect(r.totalDifferenceCount).toBeGreaterThan(4);
    for (let i = 1; i < r.differences.length; i++) expect(compareDifferences(r.differences[i - 1], r.differences[i])).toBeLessThanOrEqual(0);
    expect(r.differences.at(-1)).toMatchObject({ code: "UNEXPECTED_WORKSHEET", observedWorksheetName: "Extra" });
    expect(new Set(r.differences.map((d) => d.deterministicKey)).size).toBe(r.differences.length);
  });

  it("deterministicKey is JSON-array structural identity only (never observed header text) and parses back", () => {
    for (const d of run(noisy()).differences) {
      const parsed = JSON.parse(d.deterministicKey);
      expect(parsed).toEqual([d.code, d.worksheetLogicalKey, d.observedWorksheetIndex, d.governedColumnOrdinal, d.observedColumnOrdinal, d.governedHeader]);
      if (d.observedHeader !== null && d.observedHeader !== d.governedHeader) expect(d.deterministicKey).not.toContain(d.observedHeader);
    }
  });

  it("report/difference shapes carry exactly the structural fields — no filename, user, timestamp, rows or values", () => {
    const r = run(noisy());
    expect(Object.keys(r)).toEqual([
      "reportVersion", "sourceSchemaVersionId", "sourceSchemaVersionNumber", "sourceSchemaStatus", "result", "exactMatch", "blocking",
      "observedWorksheetCount", "governedWorksheetCount", "matchedWorksheetCount", "missingRequiredWorksheetCount", "missingOptionalWorksheetCount",
      "unexpectedWorksheetCount", "totalDifferenceCount", "blockingDifferenceCount", "warningDifferenceCount", "differences",
    ]);
    for (const d of r.differences) {
      expect(Object.keys(d)).toEqual([
        "code", "severity", "worksheetLogicalKey", "governedWorksheetName", "observedWorksheetName", "governedWorksheetOrdinalHint",
        "observedWorksheetIndex", "governedColumnOrdinal", "observedColumnOrdinal", "governedHeader", "observedHeader", "governedPresence",
        "messageKey", "deterministicKey",
      ]);
      expect(SCHEMA_DIFFERENCE_CODES).toContain(d.code);
    }
    expect(r.totalDifferenceCount).toBe(r.blockingDifferenceCount + r.warningDifferenceCount);
  });
});

describe("6.2D3C matcher — header read plan", () => {
  it("reads only visible, non-empty, uniquely-named governed sheets that define columns; sorted by index", () => {
    const o = reindex([
      ...[...exactObserved().worksheets].reverse(),
      { index: 0, name: "Unexpected", visibility: "visible", isEmpty: false, headerRow: { status: "notRead" } },
    ]);
    const withHiddenJobs = withSheet(o, "Jobs", (w) => ({ ...w, visibility: "hidden" }));
    const plan = planHeaderRowReads(withHiddenJobs.worksheets, governedJuneV1());
    const names = plan.map((p) => withHiddenJobs.worksheets[p.index].name);
    expect(names).not.toContain("Trends");
    expect(names).not.toContain("Jobs");
    expect(names).not.toContain("Unexpected");
    expect(plan).toHaveLength(12);
    expect(plan.every((p) => p.headerRowOneBased === 3)).toBe(true);
    expect(plan.map((p) => p.index)).toEqual([...plan.map((p) => p.index)].sort((a, b) => a - b));
  });

  it("the matcher module is pure: no Prisma, storage, parser, clock, randomness or locale comparison", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/data-hub/schemaMatch/schemaMatcher.ts"), "utf8");
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/prisma|Date\.|new Date|Math\.random|localeCompare|console\.|similarity|levenshtein|toLowerCase|toUpperCase|trim\(/);
  });
});
