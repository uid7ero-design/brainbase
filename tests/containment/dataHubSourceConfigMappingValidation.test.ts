import { describe, it, expect } from "vitest";
import { validateMappingRows, buildMappingDocumentFields, type MappingFieldRow } from "@/app/data-hub/sources/mappingRowValidation";
import { ILLEGAL_DUMPING_REQUIRED_HEADERS } from "@/lib/data-hub/importBatch/illegalDumpingMapper";
import { validateMappingDocument, MAX_SOURCE_HEADER_LENGTH } from "@/lib/data-hub/sourceMapping/mappingDocument";

// Data Hub 6.1C — pure, DOM-free client-side UX validation tests for the
// MappingVersion creation form. Written to mirror the server's own
// authoritative validateMappingDocument contract wherever the two overlap,
// and to independently prove the ONE gap the server does not cover today
// (required-canonical-target presence at creation time) — never asserting
// this client check REPLACES server enforcement.

function rows(...pairs: [string, string][]): MappingFieldRow[] {
  return pairs.map(([canonicalTarget, sourceHeader]) => ({ canonicalTarget, sourceHeader }));
}

const VALID_COMPLETE_ROWS = rows(
  ["report_date", "Report Date"],
  ["location", "Location"],
  ["waste_type", "Waste Type"],
  ["source_external_id", "Ticket #"]
);

describe("validateMappingRows", () => {
  it("accepts a complete, valid set of rows covering every required target", () => {
    expect(validateMappingRows(VALID_COMPLETE_ROWS)).toBeNull();
  });

  it("supports the Onkaparinga case: Ticket # mapped to the generic source_external_id target", () => {
    const result = validateMappingRows(VALID_COMPLETE_ROWS);
    expect(result).toBeNull();
    const fields = buildMappingDocumentFields(VALID_COMPLETE_ROWS);
    expect(fields.source_external_id).toBe("Ticket #");
    // The platform-wide canonical key is always the generic name, never
    // the source's own terminology.
    expect(Object.keys(fields)).not.toContain("Ticket #");
    expect(Object.keys(fields)).not.toContain("ticket_number");
  });

  it("rejects an empty set of rows (all blank source headers)", () => {
    const result = validateMappingRows(rows(["report_date", ""], ["location", "  "]));
    expect(result).toMatch(/at least one field mapping/i);
  });

  it("reports every currently required canonical target by name when all are missing", () => {
    const result = validateMappingRows(rows(["notes", "Notes"]));
    for (const req of ILLEGAL_DUMPING_REQUIRED_HEADERS) {
      expect(result).toContain(req);
    }
  });

  it("reports exactly the missing subset when only some required targets are present", () => {
    const result = validateMappingRows(rows(["report_date", "Report Date"], ["location", "Location"]));
    expect(result).toContain("waste_type");
    expect(result).toContain("source_external_id");
    expect(result).not.toContain("report_date,");
  });

  it("rejects a source header exceeding MAX_SOURCE_HEADER_LENGTH", () => {
    const tooLong = "x".repeat(MAX_SOURCE_HEADER_LENGTH + 1);
    const result = validateMappingRows([...VALID_COMPLETE_ROWS.slice(0, 3), { canonicalTarget: "source_external_id", sourceHeader: tooLong }]);
    expect(result).toMatch(/exceeds/i);
  });

  it("accepts a source header at exactly MAX_SOURCE_HEADER_LENGTH", () => {
    const maxLen = "x".repeat(MAX_SOURCE_HEADER_LENGTH);
    const result = validateMappingRows([...VALID_COMPLETE_ROWS.slice(0, 3), { canonicalTarget: "source_external_id", sourceHeader: maxLen }]);
    expect(result).toBeNull();
  });

  it("rejects the same canonical target assigned twice", () => {
    const result = validateMappingRows([...VALID_COMPLETE_ROWS, { canonicalTarget: "report_date", sourceHeader: "Another Date Column" }]);
    expect(result).toMatch(/only be mapped once/i);
  });

  it("rejects the same source header (case-insensitive) feeding two canonical targets", () => {
    const result = validateMappingRows(rows(["report_date", "Ticket #"], ["location", "Location"], ["waste_type", "Waste Type"], ["source_external_id", "ticket #"]));
    expect(result).toMatch(/only be mapped to one canonical target/i);
  });

  it("ignores blank rows entirely — they never count toward duplicates or required coverage", () => {
    const result = validateMappingRows([...VALID_COMPLETE_ROWS, { canonicalTarget: "notes", sourceHeader: "" }]);
    expect(result).toBeNull();
  });
});

describe("buildMappingDocumentFields", () => {
  it("omits blank rows from the built fields object", () => {
    const fields = buildMappingDocumentFields([...VALID_COMPLETE_ROWS, { canonicalTarget: "notes", sourceHeader: "   " }]);
    expect(fields.notes).toBeUndefined();
    expect(Object.keys(fields)).toHaveLength(4);
  });

  it("trims whitespace from source headers", () => {
    const fields = buildMappingDocumentFields(rows(["report_date", "  Report Date  "]));
    expect(fields.report_date).toBe("Report Date");
  });

  it("produces a document the server's own validateMappingDocument accepts", () => {
    const fields = buildMappingDocumentFields(VALID_COMPLETE_ROWS);
    const result = validateMappingDocument({ fields });
    expect(result.ok).toBe(true);
  });
});
