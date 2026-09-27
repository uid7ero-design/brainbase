import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readWorksheetDataRows, WorkbookParserError } from "@/lib/data-hub/workbookParser";

// Data Hub 6.2D4B — behavioral proof for readWorksheetDataRows:
//   1. source_row_number is the TRUE 1-based physical Excel row, preserved
//      exactly across interspersed blank rows (correction 3 — never a
//      post-filtering sequential index).
//   2. governed columns are read at their own EXACT ordinals, never
//      assumed contiguous or starting at 0 (correction 4) — this fixture
//      uses non-contiguous ordinals (0 and 3, skipping 1 and 2) so a
//      regression to positional/contiguous reading cannot pass silently.

type SheetSpec = { name: string; rows: unknown[][] };

function buildSpreadsheet(sheets: SheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  wb.Workbook = { Sheets: sheets.map(() => ({ Hidden: 0 })) };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function toBytes(buf: Buffer): Uint8Array {
  return new Uint8Array(buf);
}

describe("readWorksheetDataRows — physical row identity + non-contiguous governed ordinals", () => {
  it("preserves the true 1-based physical row number across interspersed blank rows", async () => {
    // Row 1 (1-based) = header. Row 2 = data. Row 3 = BLANK. Row 4 = data.
    // Row 5 = BLANK. Row 6 = data.
    const rows = [
      ["Code", "Ignored1", "Ignored2", "Amount"], // header row, physical row 1
      ["A1", "x", "x", 10], // physical row 2
      [], // physical row 3 — blank
      ["A2", "x", "x", 20], // physical row 4
      [], // physical row 5 — blank
      ["A3", "x", "x", 30], // physical row 6
    ];
    const buf = buildSpreadsheet([{ name: "Data", rows }]);

    const result = await readWorksheetDataRows(
      toBytes(buf),
      { filename: "physical-rows.xlsx" },
      {
        index: 0,
        headerRowOneBased: 1,
        // Non-contiguous ordinals: only column 0 ("Code") and column 3
        // ("Amount") are governed — columns 1 and 2 are never read.
        governedColumns: [
          { id: "col-code", ordinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC" },
          { id: "col-amount", ordinal: 3, sourceHeader: "Amount", sensitivityClass: "PUBLIC" },
        ],
        maxRowsToRead: 100,
      }
    );

    expect(result.exhausted).toBe(true);
    // Exactly 3 non-blank data rows returned — blank rows are never
    // materialized as rows at all.
    expect(result.rows).toHaveLength(3);

    // The critical assertion: source_row_number is the TRUE physical row,
    // not a 1/2/3 sequential re-index. If a regression reintroduced
    // sheet_to_json's blankrows:false array-index behavior, this would
    // instead read 2, 3, 4.
    expect(result.rows.map((r) => r.sourceRowOneBased)).toEqual([2, 4, 6]);
  });

  it("reads each governed column at its own exact ordinal, never positionally/contiguously", async () => {
    const rows = [
      ["Code", "SkippedA", "SkippedB", "Amount"],
      ["A1", "SHOULD-NEVER-APPEAR", "SHOULD-NEVER-APPEAR", 99],
    ];
    const buf = buildSpreadsheet([{ name: "Data", rows }]);

    const result = await readWorksheetDataRows(
      toBytes(buf),
      { filename: "ordinals.xlsx" },
      {
        index: 0,
        headerRowOneBased: 1,
        governedColumns: [
          { id: "col-code", ordinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC" },
          { id: "col-amount", ordinal: 3, sourceHeader: "Amount", sensitivityClass: "PUBLIC" },
        ],
        maxRowsToRead: 100,
      }
    );

    expect(result.rows).toHaveLength(1);
    const cells = result.rows[0].cells;
    expect(cells).toHaveLength(2);
    // Cell identity is carried verbatim from the governed column address —
    // never re-derived positionally.
    expect(cells[0]).toMatchObject({ id: "col-code", ordinal: 0, sourceHeader: "Code", value: "A1" });
    expect(cells[1]).toMatchObject({ id: "col-amount", ordinal: 3, sourceHeader: "Amount", value: 99 });
    // Neither skipped column's text ever leaks into a returned cell value.
    expect(JSON.stringify(cells)).not.toContain("SHOULD-NEVER-APPEAR");
  });

  it("resumeAfterSourceRowOneBased continues from the true physical row, not a row count", async () => {
    const rows = [
      ["Code"],
      ["A1"], // physical row 2
      [], // physical row 3 — blank
      ["A2"], // physical row 4
      ["A3"], // physical row 5
    ];
    const buf = buildSpreadsheet([{ name: "Data", rows }]);
    const governedColumns = [{ id: "col-code", ordinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC" }];

    const first = await readWorksheetDataRows(
      toBytes(buf),
      { filename: "resume.xlsx" },
      { index: 0, headerRowOneBased: 1, governedColumns, maxRowsToRead: 1 }
    );
    expect(first.rows.map((r) => r.sourceRowOneBased)).toEqual([2]);
    expect(first.exhausted).toBe(false);

    const second = await readWorksheetDataRows(
      toBytes(buf),
      { filename: "resume.xlsx" },
      { index: 0, headerRowOneBased: 1, governedColumns, resumeAfterSourceRowOneBased: first.rows[0].sourceRowOneBased, maxRowsToRead: 100 }
    );
    // Resumes correctly PAST the blank row 3, landing on 4 then 5 — never
    // re-reads row 2, and never skips based on a row COUNT.
    expect(second.rows.map((r) => r.sourceRowOneBased)).toEqual([4, 5]);
    expect(second.exhausted).toBe(true);
  });

  it("rejects an empty governedColumns list rather than silently reading nothing", async () => {
    const buf = buildSpreadsheet([{ name: "Data", rows: [["Code"], ["A1"]] }]);
    await expect(
      readWorksheetDataRows(
        toBytes(buf),
        { filename: "empty.xlsx" },
        { index: 0, headerRowOneBased: 1, governedColumns: [], maxRowsToRead: 10 }
      )
    ).rejects.toThrow();
  });

  it("still enforces WorkbookParserError for an out-of-range worksheet index", async () => {
    const buf = buildSpreadsheet([{ name: "Data", rows: [["Code"], ["A1"]] }]);
    await expect(
      readWorksheetDataRows(
        toBytes(buf),
        { filename: "oob.xlsx" },
        { index: 5, headerRowOneBased: 1, governedColumns: [{ id: "c", ordinal: 0, sourceHeader: "Code", sensitivityClass: "PUBLIC" }], maxRowsToRead: 10 }
      )
    ).rejects.toThrow(WorkbookParserError);
  });
});
