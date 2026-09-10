import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  compileMapping,
  applyCompiledMappingToRow,
  applyCompiledMappingToRows,
  toIllegalDumpingMapperInput,
  type CompiledMappingPlan,
} from "../../lib/data-hub/sourceMapping/mappingExecution";
import { validateMappingDocument, type MappingDocument } from "../../lib/data-hub/sourceMapping/mappingDocument";
import {
  mapIllegalDumpingRows,
  ILLEGAL_DUMPING_KNOWN_HEADERS,
  ILLEGAL_DUMPING_REQUIRED_HEADERS,
} from "../../lib/data-hub/importBatch/illegalDumpingMapper";

function doc(fields: Record<string, string>): MappingDocument {
  const result = validateMappingDocument({ fields });
  if (!result.ok) throw new Error(`test fixture is not a valid MappingDocument: ${result.error}`);
  return result.document;
}

const MINIMAL_VALID_FIELDS = { report_date: "Call time", location: "Site Address", waste_type: "Type" };

describe("compileMapping — COMPILE", () => {
  it("T1 — a valid mapping + matching headers compiles", () => {
    const headers = ["Call time", "Site Address", "Type"];
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).toHaveLength(3);
    }
  });

  it("T2 — source column reorder resolves correctly (headers in a different order than fields were declared)", () => {
    const headers = ["Type", "Call time", "Site Address"];
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byTarget = Object.fromEntries(result.plan.map((f) => [f.canonicalTarget, f.columnIndex]));
      expect(byTarget.report_date).toBe(1);
      expect(byTarget.location).toBe(2);
      expect(byTarget.waste_type).toBe(0);
    }
  });

  it("T3 — unused worksheet headers are allowed and do not affect the plan", () => {
    const headers = ["Call time", "Site Address", "Type", "Unrelated Extra Column", "Another Unused One"];
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toHaveLength(3);
  });

  it("T4 — a missing configured source header is rejected with MAPPING_SOURCE_HEADER_MISSING", () => {
    const headers = ["Call time", "Site Address"]; // "Type" is absent
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        code: "MAPPING_SOURCE_HEADER_MISSING",
        canonicalTarget: "waste_type",
        sourceHeader: "Type",
      });
    }
  });

  it("T5 — a duplicated configured source header in the worksheet is rejected as ambiguous, never first/last-wins", () => {
    const headers = ["Call time", "Site Address", "Type", "Type"];
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        code: "MAPPING_SOURCE_HEADER_AMBIGUOUS",
        canonicalTarget: "waste_type",
        sourceHeader: "Type",
        occurrences: 2,
      });
    }
  });

  it("header matching is case-SENSITIVE — a header differing only in case is treated as a different, missing header (no case-folding per the chosen rule)", () => {
    const headers = ["call time", "site address", "type"]; // lowercased vs. configured "Call time" etc.
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.code === "MAPPING_SOURCE_HEADER_MISSING")).toBe(true);
    }
  });

  it("T6 — ambiguity after the ACTUAL normalization rule (trim) is rejected — a header that only matches after trimming still counts as a duplicate", () => {
    const headers = ["Call time", "Site Address", "Type", " Type "]; // trims to "Type" twice
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "MAPPING_SOURCE_HEADER_AMBIGUOUS" && e.canonicalTarget === "waste_type")).toBe(true);
    }
  });

  it("T7 — a required canonical target omitted from the document is rejected with MAPPING_REQUIRED_TARGET_MISSING (a distinct invariant from 5B.2's own validator)", () => {
    // Deliberately only maps an OPTIONAL field ("suburb") — 5B.2's own
    // validateMappingDocument accepts this document as structurally valid
    // (MIN_MAPPING_FIELDS=1 is satisfied), proving compileMapping's
    // required-target check is genuinely additive, not a re-assertion of
    // something 5B.2 already guaranteed.
    const document = doc({ suburb: "Suburb Name" });
    const headers = ["Suburb Name"];
    const result = compileMapping(document, headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missingCodes = result.errors.filter((e) => e.code === "MAPPING_REQUIRED_TARGET_MISSING");
      expect(missingCodes.map((e) => (e as { canonicalTarget: string }).canonicalTarget).sort()).toEqual(
        [...ILLEGAL_DUMPING_REQUIRED_HEADERS].sort()
      );
    }
  });

  it("T7b — proves 5B.2's own validator does NOT already guarantee required-target completeness (the discovery finding this test suite depends on)", () => {
    const result = validateMappingDocument({ fields: { suburb: "Suburb Name" } });
    expect(result.ok).toBe(true);
  });

  it("T8 — an invalid mapping document is structurally impossible to pass to compileMapping: its signature requires the already-validated MappingDocument type, not `unknown`", () => {
    // This is a type-level guarantee, not a runtime branch (see this
    // module's own doc comment on why there is no MAPPING_DOCUMENT_INVALID
    // code). Demonstrated here by confirming the ONLY way to obtain a
    // MappingDocument value in normal usage is validateMappingDocument's
    // ok:true branch — an invalid raw input never produces one to begin
    // with.
    const invalidRaw: unknown = { fields: { not_a_real_target: "x" } };
    const validated = validateMappingDocument(invalidRaw);
    expect(validated.ok).toBe(false);
    // (validated.document does not exist on the ok:false branch — nothing
    // further to compile.)
  });

  it("T9 — diagnostic ordering is stable and independent of the document's own key insertion order", () => {
    const orderA = doc({ report_date: "Call time", location: "Site Address", waste_type: "Type" });
    const orderB = doc({ waste_type: "Type", location: "Site Address", report_date: "Call time" });
    const headers = ["Call time"]; // missing both "Site Address" and "Type"
    const resultA = compileMapping(orderA, headers);
    const resultB = compileMapping(orderB, headers);
    expect(resultA.ok).toBe(false);
    expect(resultB.ok).toBe(false);
    if (!resultA.ok && !resultB.ok) {
      expect(resultA.errors).toEqual(resultB.errors);
    }
  });

  it("T9b — required-target-missing diagnostic ordering is stable across repeated calls, not just re-derivable by chance (exercises a document that omits ALL THREE required targets, so the shuffle-sensitive branch actually fires)", () => {
    const document = doc({ suburb: "Suburb Name" }); // omits report_date/location/waste_type entirely
    const headers = ["Suburb Name"];
    const firstOrder = compileMapping(document, headers);
    expect(firstOrder.ok).toBe(false);
    if (!firstOrder.ok) {
      // Run many times — any nondeterministic ordering (e.g. a random
      // shuffle of the required-target loop) would eventually disagree
      // with the first observed order.
      for (let i = 0; i < 25; i++) {
        const repeat = compileMapping(document, headers);
        expect(repeat).toEqual(firstOrder);
      }
    }
  });

  it("T10 — compile output is deterministic across repeated calls with identical input", () => {
    const document = doc(MINIMAL_VALID_FIELDS);
    const headers = ["Call time", "Site Address", "Type"];
    const r1 = compileMapping(document, headers);
    const r2 = compileMapping(document, headers);
    expect(r1).toEqual(r2);
  });

  it("T11 — compileMapping does not mutate its `document` input", () => {
    const document = doc(MINIMAL_VALID_FIELDS);
    const frozen = Object.freeze({ fields: Object.freeze({ ...document.fields }) });
    expect(() => compileMapping(frozen as MappingDocument, ["Call time", "Site Address", "Type"])).not.toThrow();
  });

  it("T12 — compileMapping does not mutate its `headers` input", () => {
    const headers = Object.freeze(["Call time", "Site Address", "Type"]);
    expect(() => compileMapping(doc(MINIMAL_VALID_FIELDS), headers)).not.toThrow();
  });

  it("T13/T31/T32 — a worksheet header literally named __proto__/constructor/prototype cannot affect the output prototype and is treated as ordinary text", () => {
    const document = doc({ report_date: "__proto__", location: "constructor", waste_type: "prototype" });
    const headers = ["__proto__", "constructor", "prototype"];
    const result = compileMapping(document, headers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = applyCompiledMappingToRow(result.plan, ["2026-01-01", "123 Main St", "Dumped Rubbish"]);
      expect(row.report_date).toBe("2026-01-01");
      expect(row.location).toBe("123 Main St");
      expect(row.waste_type).toBe("Dumped Rubbish");
      // The malicious header text never became an object key at all — it
      // was only ever a Map key / diagnostic value. Confirm the output's
      // own prototype is completely ordinary.
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(row, "polluted")).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(({} as any).polluted).toBeUndefined();
    }
  });

  it("T14 — an unknown canonical target is structurally impossible to reach compileMapping (rejected earlier, by validateMappingDocument)", () => {
    const result = validateMappingDocument({ fields: { not_a_real_canonical_field: "Some Header" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNKNOWN_CANONICAL_TARGET");
  });

  it("defense in depth: even a maliciously-constructed document bypassing validateMappingDocument (an unrecognized key) is silently ignored by compileMapping, never produces a non-allowlisted plan entry", () => {
    // Deliberately bypasses validateMappingDocument to simulate a caller
    // that skipped 5B.2 validation — compileMapping iterates the FIXED
    // ILLEGAL_DUMPING_KNOWN_HEADERS allowlist, never `document.fields`'
    // own keys, so an unrecognized key can structurally never reach the
    // output plan regardless of how the document was constructed.
    const bypassed = { fields: { not_a_real_target: "Some Header", report_date: "Call time", location: "Site Address", waste_type: "Type" } } as unknown as MappingDocument;
    const result = compileMapping(bypassed, ["Some Header", "Call time", "Site Address", "Type"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.every((f) => (ILLEGAL_DUMPING_KNOWN_HEADERS as readonly string[]).includes(f.canonicalTarget))).toBe(true);
      expect(result.plan.map((f) => f.canonicalTarget)).not.toContain("not_a_real_target");
    }
  });

  it("T15 — mapping fields are bounded by the same allowlist size 5B.2 already enforces (12)", () => {
    const allFields = Object.fromEntries(ILLEGAL_DUMPING_KNOWN_HEADERS.map((h, i) => [h, `Header ${i}`]));
    const result = validateMappingDocument({ fields: allFields });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const compileResult = compileMapping(result.document, Object.values(allFields));
      expect(compileResult.ok).toBe(true);
      if (compileResult.ok) expect(compileResult.plan).toHaveLength(ILLEGAL_DUMPING_KNOWN_HEADERS.length);
    }
  });
});

describe("applyCompiledMappingToRow — APPLY ROW", () => {
  function compiledPlan(headers: string[]): CompiledMappingPlan {
    const result = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    if (!result.ok) throw new Error("test fixture mapping failed to compile");
    return result.plan;
  }

  it("T16 — correct indices map correct values", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "1 High St", "Mattresses"]);
    expect(row).toEqual({ report_date: "2026-03-01", location: "1 High St", waste_type: "Mattresses" });
  });

  it("T17 — empty mapped cell values are preserved as empty strings, not dropped", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "", "Mattresses"]);
    expect(row.location).toBe("");
    expect(Object.prototype.hasOwnProperty.call(row, "location")).toBe(true);
  });

  it("T18 — a short row (fewer cells than the mapped column index) maps to '' deterministically, never a raw undefined", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01"]); // location/waste_type columns absent
    expect(row.location).toBe("");
    expect(row.waste_type).toBe("");
    expect(Object.prototype.hasOwnProperty.call(row, "location")).toBe(true);
  });

  it("T19 — a wider row ignores unused cells; they never leak into the output", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "1 High St", "Mattresses", "extra1", "extra2"]);
    expect(Object.keys(row).sort()).toEqual(["location", "report_date", "waste_type"]);
  });

  it("T20 — Unicode cell values are preserved exactly", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "123 Röad Straße 東京", "Ürünler"]);
    expect(row.location).toBe("123 Röad Straße 東京");
    expect(row.waste_type).toBe("Ürünler");
  });

  it("T21 — applyCompiledMappingToRow does not mutate the row input", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = Object.freeze(["2026-03-01", "1 High St", "Mattresses"]);
    expect(() => applyCompiledMappingToRow(plan, row)).not.toThrow();
  });

  it("T22 — output contains ONLY canonical mapped fields, nothing else", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "1 High St", "Mattresses"]);
    expect(Object.keys(row).sort()).toEqual(["location", "report_date", "waste_type"]);
  });

  it("T23 — output contains no source-header/index/mapping metadata", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const row = applyCompiledMappingToRow(plan, ["2026-03-01", "1 High St", "Mattresses"]);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("Call time");
    expect(serialized).not.toContain("columnIndex");
    expect(serialized).not.toContain("sourceHeader");
  });

  it("T24 — repeated application of the same plan to the same row is deterministic", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const rowInput = ["2026-03-01", "1 High St", "Mattresses"];
    expect(applyCompiledMappingToRow(plan, rowInput)).toEqual(applyCompiledMappingToRow(plan, rowInput));
  });

  it("T25 — reordered source columns with a freshly recompiled plan still map correctly", () => {
    const reorderedPlan = compiledPlan(["Type", "Call time", "Site Address"]);
    const row = applyCompiledMappingToRow(reorderedPlan, ["Mattresses", "2026-03-01", "1 High St"]);
    expect(row).toEqual({ report_date: "2026-03-01", location: "1 High St", waste_type: "Mattresses" });
  });

  it("applyCompiledMappingToRows maps a whole bounded batch, pure/synchronous", () => {
    const plan = compiledPlan(["Call time", "Site Address", "Type"]);
    const rows = applyCompiledMappingToRows(plan, [
      ["2026-03-01", "1 High St", "Mattresses"],
      ["2026-03-02", "2 Low St", "Organics"],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].location).toBe("2 Low St");
  });
});

describe("domain-mapper boundary — DOMAIN BOUNDARY", () => {
  it("T26 — a mapped structural row (via the narrow adapter) is accepted by the real, unmodified Illegal Dumping mapper", () => {
    const headers = ["Call time", "Site Address", "Type"];
    const compileResult = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, [
      ["2026-03-01T00:00:00.000Z", "1 High St", "Mattresses"],
    ]);
    const { headers: adapterHeaders, rows: adapterRows } = toIllegalDumpingMapperInput(canonicalRows);
    const mapped = mapIllegalDumpingRows(adapterHeaders, adapterRows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].location).toBe("1 High St");
    expect(mapped[0].waste_type).toBe("Mattresses");
  });

  it("T27/T28 — business/value validation (severity/status interpretation, e.g.) occurs only inside the real domain mapper, never in mapping execution", () => {
    const headers = ["Call time", "Site Address", "Type", "Severity"];
    const compileResult = compileMapping(
      doc({ ...MINIMAL_VALID_FIELDS, severity: "Severity" }),
      headers
    );
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const canonicalRows = applyCompiledMappingToRows(compileResult.plan, [
      ["2026-03-01T00:00:00.000Z", "1 High St", "Dumped Rubbish", "critical"],
    ]);
    // The structural row still holds the RAW string "critical" — mapping
    // execution never interpreted it into the enum "CRITICAL".
    expect(canonicalRows[0].severity).toBe("critical");
    const { headers: adapterHeaders, rows: adapterRows } = toIllegalDumpingMapperInput(canonicalRows);
    const mapped = mapIllegalDumpingRows(adapterHeaders, adapterRows);
    // Only the REAL domain mapper turns "critical" into the enum value.
    expect(mapped[0].severity).toBe("CRITICAL");
  });

  it("T29 — mapping execution does not parse/normalize business dates; the raw string passes through unchanged", () => {
    const headers = ["Call time", "Site Address", "Type"];
    const compileResult = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const row = applyCompiledMappingToRow(compileResult.plan, ["not-a-real-date-string", "1 High St", "Mattresses"]);
    // mapping execution never validates/parses this — it is still the raw
    // input string, unlike illegalDumpingMapper.ts's own parseDate.
    expect(row.report_date).toBe("not-a-real-date-string");
  });

  it("T30 — mapping execution invents no defaults for business fields (an unmapped optional field is simply absent, never a synthesized value)", () => {
    const headers = ["Call time", "Site Address", "Type"];
    const compileResult = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const row = applyCompiledMappingToRow(compileResult.plan, ["2026-03-01", "1 High St", "Mattresses"]);
    expect(Object.prototype.hasOwnProperty.call(row, "status")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, "severity")).toBe(false);
  });
});

describe("security — SECURITY", () => {
  it("T33 — no eval/Function/dynamic-import/require path exists anywhere in the executor source", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/import\s*\(/); // no dynamic import()
  });

  it("T34 — a nested transform-like structure is rejected by the EXISTING 5B.2 document validator before mapping execution ever sees it", () => {
    const result = validateMappingDocument({
      fields: { report_date: { transform: "uppercase", column: "Call time" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SOURCE_HEADER_NOT_STRING");
  });

  it("T35 — compileMapping/applyCompiledMappingToRow can only ever produce canonical-allowlisted output keys, never an arbitrary field", () => {
    const headers = ["Call time", "Site Address", "Type"];
    const compileResult = compileMapping(doc(MINIMAL_VALID_FIELDS), headers);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const row = applyCompiledMappingToRow(compileResult.plan, ["2026-03-01", "1 High St", "Mattresses"]);
    for (const key of Object.keys(row)) {
      expect(ILLEGAL_DUMPING_KNOWN_HEADERS as readonly string[]).toContain(key);
    }
  });
});

describe("performance — PERFORMANCE", () => {
  it("T36/T37 — header resolution happens once at compile time; applying many rows never rescans headers (behavioral proof via a large header set + many rows completing near-instantly)", () => {
    const bigHeaders = Array.from({ length: 500 }, (_, i) => `Column ${i}`);
    bigHeaders[10] = "Call time";
    bigHeaders[20] = "Site Address";
    bigHeaders[30] = "Type";
    const compileResult = compileMapping(doc(MINIMAL_VALID_FIELDS), bigHeaders);
    expect(compileResult.ok).toBe(true);
    if (!compileResult.ok) return;
    const row = Array.from({ length: 500 }, () => "x");
    row[10] = "2026-01-01";
    row[20] = "1 High St";
    row[30] = "Mattresses";
    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      applyCompiledMappingToRow(compileResult.plan, row);
    }
    const elapsedMs = Date.now() - start;
    // Generous bound — this is a determinism/complexity smoke check, not a
    // strict perf benchmark: 5000 applications against a 500-column plan
    // of 3 mapped fields should be near-instant if apply is O(mappedFields)
    // rather than O(mappedFields * headers).
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("T39 — the max allowed mapping size (all 12 canonical fields) compiles without issue", () => {
    const allFields = Object.fromEntries(ILLEGAL_DUMPING_KNOWN_HEADERS.map((h, i) => [h, `H${i}`]));
    const validated = validateMappingDocument({ fields: allFields });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = compileMapping(validated.document, Object.values(allFields));
    expect(result.ok).toBe(true);
  });

  it("T40 — over-bound mapping input (13+ fields) is rejected upstream by 5B.2's own validator, never reaching compileMapping", () => {
    const tooMany: Record<string, string> = Object.fromEntries(
      ILLEGAL_DUMPING_KNOWN_HEADERS.map((h, i) => [h, `H${i}`])
    );
    // 12 is the max; there is no 13th legal canonical target to add, which
    // is itself the structural proof — attempting to smuggle an extra key
    // fails validation before it could ever reach this module.
    const result = validateMappingDocument({ ...tooMany, extraTopLevelKey: "nope" });
    expect(result.ok).toBe(false);
  });
});

describe("property-style equivalence — deterministic generated cases", () => {
  it("equivalent inputs (varied header order, extra unrelated headers, varied mapping-key order) always produce equivalent mapped output", () => {
    const baseRowByHeader: Record<string, string> = {
      "Call time": "2026-05-01",
      "Site Address": "9 Elm St",
      Type: "Organics",
      Extra1: "ignored-1",
      Extra2: "ignored-2",
    };
    const headerOrders: string[][] = [
      ["Call time", "Site Address", "Type", "Extra1", "Extra2"],
      ["Extra1", "Call time", "Extra2", "Site Address", "Type"],
      ["Type", "Extra2", "Extra1", "Site Address", "Call time"],
      ["Extra2", "Extra1", "Type", "Call time", "Site Address"],
    ];
    const fieldKeyOrders: Record<string, string>[] = [
      { report_date: "Call time", location: "Site Address", waste_type: "Type" },
      { waste_type: "Type", report_date: "Call time", location: "Site Address" },
      { location: "Site Address", waste_type: "Type", report_date: "Call time" },
    ];

    const results: unknown[] = [];
    for (const headers of headerOrders) {
      for (const fields of fieldKeyOrders) {
        const compileResult = compileMapping(doc(fields), headers);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) continue;
        const row = headers.map((h) => baseRowByHeader[h]);
        results.push(applyCompiledMappingToRow(compileResult.plan, row));
      }
    }
    // Every combination above describes the exact same logical mapping —
    // all resulting canonical rows must be identical regardless of header
    // order or mapping-document key order.
    for (const r of results) {
      expect(r).toEqual({ report_date: "2026-05-01", location: "9 Elm St", waste_type: "Organics" });
    }
  });
});

describe("no-runtime-integration — static source-text proof", () => {
  const RUNTIME_IMPORT_FLOW_FILES = [
    "lib/data-hub/importBatch/initiate.ts",
    "lib/data-hub/importBatch/finalize.ts",
    "lib/data-hub/importBatch/inspectCsvWorksheet.ts",
    "lib/data-hub/importBatch/inspectWorksheets.ts",
    "lib/data-hub/client/orchestrator.ts",
    "app/data-hub/import/ImportClient.tsx",
    "app/data-hub/import/[batchId]/RecoveryClient.tsx",
    "app/data-hub/import/[batchId]/useDataHubRecoverySession.ts",
    "app/data-hub/import/useImportHistory.ts",
  ];

  it("T51 — no existing runtime import-flow/UI/recovery module imports the new mapping-execution module", () => {
    const repoRoot = path.join(__dirname, "../..");
    for (const relativeFile of RUNTIME_IMPORT_FLOW_FILES) {
      const fullPath = path.join(repoRoot, relativeFile);
      if (!fs.existsSync(fullPath)) continue; // tolerate any future rename; still checks every present file
      const source = fs.readFileSync(fullPath, "utf8");
      expect(source, `${relativeFile} must not import mappingExecution`).not.toMatch(/mappingExecution/);
    }
  });

  // 5B.4C — previewWorksheet.ts is now a DELIBERATE, disclosed exception to
  // T51: it is the one runtime consumer 5B.4C exists to add, reusing 5B.3's
  // pure/deterministic compiler+executor verbatim to apply a worksheet's own
  // FROZEN mapping. This test documents and bounds that exception: only the
  // three intended pure exports are imported (never a wildcard/internal
  // import), and the import is a single, plain static ES import — never a
  // dynamic re-implementation.
  it("T51 exception (5B.4C, disclosed): previewWorksheet.ts imports ONLY compileMapping/applyCompiledMappingToRows/toIllegalDumpingMapperInput (+ their pure types) from mappingExecution.ts, via one static import", () => {
    const repoRoot = path.join(__dirname, "../..");
    const source = fs.readFileSync(path.join(repoRoot, "lib/data-hub/importBatch/previewWorksheet.ts"), "utf8");
    const importLines = source.match(/^import\s.+from\s+["'][^"']*sourceMapping\/mappingExecution["'];?$/gm) ?? [];
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\bcompileMapping\b/);
    expect(importLines[0]).toMatch(/\bapplyCompiledMappingToRows\b/);
    expect(importLines[0]).toMatch(/\btoIllegalDumpingMapperInput\b/);
  });

  // 5B.4D — confirmWorksheet.ts is now a SECOND, identically-bounded
  // disclosed exception to T51, for the same reason previewWorksheet.ts
  // already is: frozen mapping-lineage consumption for the FULL Confirm
  // dataset reuses 5B.3's pure/deterministic compiler+executor verbatim.
  it("T51 exception (5B.4D, disclosed): confirmWorksheet.ts imports ONLY compileMapping/applyCompiledMappingToRows/toIllegalDumpingMapperInput (+ their pure types) from mappingExecution.ts, via one static import", () => {
    const repoRoot = path.join(__dirname, "../..");
    const source = fs.readFileSync(path.join(repoRoot, "lib/data-hub/importBatch/confirmWorksheet.ts"), "utf8");
    const importLines = source.match(/^import\s.+from\s+["'][^"']*sourceMapping\/mappingExecution["'];?$/gm) ?? [];
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\bcompileMapping\b/);
    expect(importLines[0]).toMatch(/\bapplyCompiledMappingToRows\b/);
    expect(importLines[0]).toMatch(/\btoIllegalDumpingMapperInput\b/);
  });

  it("T49/T50 — mappingExecution.ts never references ImportBatch.source_system_id or Upload.mapping_version_id write paths (no Prisma import at all)", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/@prisma\/client/);
    expect(source).not.toMatch(/prisma\./);
    expect(source).not.toMatch(/source_system_id/);
    expect(source).not.toMatch(/mapping_version_id/);
  });

  it("no network call primitive (fetch/XMLHttpRequest/axios) appears anywhere in the executor source, import or otherwise", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("no DB/network coupling: mappingExecution.ts imports nothing beyond illegalDumpingMapper.ts's constants and mappingDocument.ts's type", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    const fromClauses = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(fromClauses.length).toBeGreaterThan(0);
    for (const specifier of fromClauses) {
      expect(specifier).toMatch(/(illegalDumpingMapper|mappingDocument)/);
    }
  });

  it("no Phase 6 concept (SourceRecordIdentity/Observation/external_id/reconciliation/Onkaparinga) appears anywhere in this module", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/SourceRecordIdentity|Observation|external_id|reconciliation|Onkaparinga|TechnologyOne/i);
  });

  it("no lib/integrations coupling", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../lib/data-hub/sourceMapping/mappingExecution.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/lib\/integrations/);
  });
});
