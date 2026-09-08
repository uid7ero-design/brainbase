import { describe, it, expect } from "vitest";
import { validateSelectedFile, FILE_INPUT_ACCEPT } from "@/app/data-hub/import/fileValidation";
import { MAX_SOURCE_FILE_BYTES } from "@/lib/data-hub/limits";

// Data Hub 5A.3C.1 — pure file-selection advisory checks (T3, T4, T5).
// Behavioral tests against validateSelectedFile — no DOM, no rendering.
// ADVISORY ONLY: `ok:false` never blocks session.start() from being called
// by the caller — only surfaces a warning. The server remains authoritative.

function makeFile(name: string, size: number, type = "text/csv"): File {
  return new File([new Uint8Array(Math.max(size, 0))], name, { type });
}

describe("validateSelectedFile — T3/T4/T5", () => {
  it("T3: a real .csv file with a plausible size produces no warnings", () => {
    const result = validateSelectedFile(makeFile("worksheet.csv", 1024));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("T4: a .xlsx file produces an advisory warning, not a hard error/exception", () => {
    const result = validateSelectedFile(
      makeFile("worksheet.xlsx", 1024, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => /csv/i.test(w))).toBe(true);
  });

  it("T5: a file larger than MAX_SOURCE_FILE_BYTES produces an oversize advisory", () => {
    const result = validateSelectedFile(makeFile("big.csv", MAX_SOURCE_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => /larger|maximum/i.test(w))).toBe(true);
  });

  it("an empty file produces a warning", () => {
    const result = validateSelectedFile(makeFile("empty.csv", 0));
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => /empty/i.test(w))).toBe(true);
  });

  it("the file input's accept string is CSV-only and never mentions xlsx/xls", () => {
    expect(FILE_INPUT_ACCEPT.toLowerCase()).toContain("csv");
    expect(FILE_INPUT_ACCEPT.toLowerCase()).not.toMatch(/xlsx|xls\b|spreadsheet/);
  });
});
