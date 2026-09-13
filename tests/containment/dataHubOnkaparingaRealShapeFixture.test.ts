import { describe, it, expect } from "vitest";
import { decodeCsvOnly } from "../../lib/data-hub/csvOnlyDecoder";
import {
  compileMapping,
  applyCompiledMappingToRows,
  toIllegalDumpingMapperInput,
} from "../../lib/data-hub/sourceMapping/mappingExecution";
import { validateMappingDocument, type MappingDocument } from "../../lib/data-hub/sourceMapping/mappingDocument";
import { mapIllegalDumpingRows, IllegalDumpingMappingError } from "../../lib/data-hub/importBatch/illegalDumpingMapper";

// Data Hub 6.1C1 — synthetic, non-PII fixture reproducing the REAL
// Onkaparinga export's structural shape (27 headers, the exact real header
// names, DD-MM-YYYY HH:mm datetimes, quoted multiline Notes, a leading-zero
// Ticket #, and the exact three real Status values), exercised through the
// SAME pipeline Production Preview actually uses: decodeCsvOnly ->
// compileMapping -> applyCompiledMappingToRows -> toIllegalDumpingMapperInput
// -> mapIllegalDumpingRows. No real customer row/PII value appears anywhere
// in this file — every value below is a placeholder authored for this test.
//
// This is the fixture that would have caught BOTH real compatibility gaps
// (the DD-MM-YYYY HH:mm date format and the "Completed w/exception" status
// value) before the first real Production upload attempt, had it existed
// then — it exists now specifically so a future mapping-document change for
// this same SourceSystem is regression-tested against the real shape, not
// just against the generic/synthetic fixtures used elsewhere in this suite.

// The exact 27 real Onkaparinga export headers, in their real order.
const ONKAPARINGA_HEADERS = [
  "Ticket #",
  "Reference",
  "Category",
  "Type",
  "Account Name",
  "Account #",
  "Property ID/Acct #",
  "Lot Number",
  "Unit Number",
  "Street Number",
  "Site Address",
  "Site Suburb",
  "Postcode",
  "Zone",
  "Run Service",
  "Bin Type",
  "Status",
  "Reason",
  "Action",
  "Authorisation",
  "Caller Name",
  "Caller Number",
  "Call time",
  "Closed timestamp",
  "Scheduled date",
  "Run name",
  "Notes",
];

// The exact active mapping_document configured for the real Production
// Onkaparinga SourceMapping (context, reproduced here only as a fixture
// input — this test never touches Production and never re-authors the
// real configuration).
const ONKAPARINGA_MAPPING_FIELDS: Record<string, string> = {
  source_external_id: "Ticket #",
  report_date: "Call time",
  location: "Site Address",
  suburb: "Site Suburb",
  zone: "Zone",
  waste_type: "Type",
  status: "Status",
  crew_assigned: "Run name",
  resolution_date: "Closed timestamp",
  notes: "Notes",
};

function onkaparingaMappingDocument(): MappingDocument {
  const result = validateMappingDocument({ fields: ONKAPARINGA_MAPPING_FIELDS });
  if (!result.ok) throw new Error(`fixture mapping_document is invalid: ${result.error}`);
  return result.document;
}

// One synthetic data row matching ONKAPARINGA_HEADERS' exact column order.
// Every value is a placeholder — never a real customer record.
function syntheticRow(overrides: Partial<Record<(typeof ONKAPARINGA_HEADERS)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    "Ticket #": "00123",
    Reference: "REF-0001",
    Category: "Illegal Dumping",
    Type: "Green waste",
    "Account Name": "Sample Account",
    "Account #": "ACC-0001",
    "Property ID/Acct #": "PROP-0001",
    "Lot Number": "12",
    "Unit Number": "",
    "Street Number": "1",
    "Site Address": "1 Example Street",
    "Site Suburb": "Sampletown",
    Postcode: "5000",
    Zone: "North",
    "Run Service": "Weekly",
    "Bin Type": "240L",
    Status: "Resolved",
    Reason: "Reported by resident",
    Action: "Collected and disposed",
    Authorisation: "Approved",
    "Caller Name": "Sample Caller",
    "Caller Number": "0000000000",
    "Call time": "13-05-2026 13:57",
    "Closed timestamp": "28-08-2026 12:00",
    "Scheduled date": "20-05-2026",
    "Run name": "Crew A",
    Notes: "Site inspected on arrival.",
  };
  const merged = { ...base, ...overrides };
  return ONKAPARINGA_HEADERS.map((h) => merged[h] ?? "");
}

function csvField(value: string): string {
  // RFC4180 quoting: any field containing a comma, double quote, or
  // newline must be wrapped in double quotes, with embedded quotes doubled.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(rows: string[][]): Buffer {
  const lines = [ONKAPARINGA_HEADERS, ...rows].map((row) => row.map(csvField).join(","));
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf-8");
}

describe("Onkaparinga real-shape fixture — end-to-end through the actual Preview pipeline (6.1C1)", () => {
  it("A. decodes to exactly 27 headers, matching the real export's own column count", () => {
    const bytes = buildCsv([syntheticRow()]);
    const decoded = decodeCsvOnly(bytes);
    expect(decoded.headers).toHaveLength(27);
    expect(decoded.headers).toEqual(ONKAPARINGA_HEADERS);
  });

  it("B. a quoted multiline Notes field decodes as one single field value, not split into extra rows/columns", () => {
    const notesWithNewlineAndComma = "Line one of the note.\nLine two, including a comma inside quotes.";
    const bytes = buildCsv([syntheticRow({ Notes: notesWithNewlineAndComma })]);
    const decoded = decodeCsvOnly(bytes);
    expect(decoded.rows).toHaveLength(1);
    expect(decoded.rows[0]).toHaveLength(27);
    const notesIndex = decoded.headers.indexOf("Notes");
    expect(decoded.rows[0][notesIndex]).toBe(notesWithNewlineAndComma);
  });

  it("C. the full pipeline (decode -> compileMapping -> applyCompiledMappingToRows -> toIllegalDumpingMapperInput -> mapIllegalDumpingRows) succeeds for a Resolved row with a leading-zero Ticket # and the real DD-MM-YYYY HH:mm dates", () => {
    const bytes = buildCsv([syntheticRow()]);
    const decoded = decodeCsvOnly(bytes);

    const compileResult = compileMapping(onkaparingaMappingDocument(), decoded.headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;

    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, decoded.rows);
    const { headers: mapperHeaders, rows: mapperRows } = toIllegalDumpingMapperInput(canonicalRows);
    const mapped = mapIllegalDumpingRows(mapperHeaders, mapperRows);

    expect(mapped).toHaveLength(1);
    const { row, sourceExternalId } = mapped[0];
    expect(sourceExternalId).toBe("00123"); // leading zero preserved, still a string
    expect(typeof sourceExternalId).toBe("string");
    expect(row.location).toBe("1 Example Street");
    expect(row.suburb).toBe("Sampletown");
    expect(row.zone).toBe("North");
    expect(row.waste_type).toBe("Green waste");
    expect(row.status).toBe("RESOLVED");
    expect(row.crew_assigned).toBe("Crew A");
    expect(row.notes).toBe("Site inspected on arrival.");
    // Call time "13-05-2026 13:57" -> report_date
    expect(row.report_date.getUTCFullYear()).toBe(2026);
    expect(row.report_date.getUTCMonth()).toBe(4); // May
    expect(row.report_date.getUTCDate()).toBe(13);
    expect(row.report_date.getUTCHours()).toBe(13);
    expect(row.report_date.getUTCMinutes()).toBe(57);
    // Closed timestamp "28-08-2026 12:00" -> resolution_date
    expect(row.resolution_date).not.toBeNull();
    expect(row.resolution_date!.getUTCFullYear()).toBe(2026);
    expect(row.resolution_date!.getUTCMonth()).toBe(7); // August
    expect(row.resolution_date!.getUTCDate()).toBe(28);
  });

  it("D. \"Completed w/exception\" (the second real observed Status value) succeeds end-to-end and maps to RESOLVED", () => {
    const bytes = buildCsv([
      syntheticRow({
        "Ticket #": "00456",
        Status: "Completed w/exception",
        "Call time": "9-3-2026 08:05", // single-digit day/month, real second observed example shape
        "Closed timestamp": "",
      }),
    ]);
    const decoded = decodeCsvOnly(bytes);
    const compileResult = compileMapping(onkaparingaMappingDocument(), decoded.headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, decoded.rows);
    const { headers: mapperHeaders, rows: mapperRows } = toIllegalDumpingMapperInput(canonicalRows);
    const mapped = mapIllegalDumpingRows(mapperHeaders, mapperRows);

    expect(mapped).toHaveLength(1);
    expect(mapped[0].sourceExternalId).toBe("00456");
    expect(mapped[0].row.status).toBe("RESOLVED");
    expect(mapped[0].row.resolution_date).toBeNull(); // blank Closed timestamp -> null, no throw
    expect(mapped[0].row.report_date.getUTCMonth()).toBe(2); // March
    expect(mapped[0].row.report_date.getUTCDate()).toBe(9);
  });

  it("E. \"Abandoned\" (the third real observed Status value) still fails closed end-to-end — this fixture proves the 6.1C1 decision holds through the FULL real pipeline, not just the mapper in isolation", () => {
    const bytes = buildCsv([syntheticRow({ "Ticket #": "00789", Status: "Abandoned" })]);
    const decoded = decodeCsvOnly(bytes);
    const compileResult = compileMapping(onkaparingaMappingDocument(), decoded.headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, decoded.rows);
    const { headers: mapperHeaders, rows: mapperRows } = toIllegalDumpingMapperInput(canonicalRows);
    expect(() => mapIllegalDumpingRows(mapperHeaders, mapperRows)).toThrow(IllegalDumpingMappingError);
  });

  it("F. multiple rows (Resolved + Completed w/exception) in one worksheet all map successfully together, matching the real file's actual row count expectation", () => {
    const bytes = buildCsv([
      syntheticRow({ "Ticket #": "00111" }),
      syntheticRow({ "Ticket #": "00222", Status: "Completed w/exception", "Closed timestamp": "" }),
    ]);
    const decoded = decodeCsvOnly(bytes);
    expect(decoded.rows).toHaveLength(2);
    const compileResult = compileMapping(onkaparingaMappingDocument(), decoded.headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, decoded.rows);
    const { headers: mapperHeaders, rows: mapperRows } = toIllegalDumpingMapperInput(canonicalRows);
    const mapped = mapIllegalDumpingRows(mapperHeaders, mapperRows);
    expect(mapped).toHaveLength(2);
    expect(mapped.map((m) => m.sourceExternalId)).toEqual(["00111", "00222"]);
  });
});
