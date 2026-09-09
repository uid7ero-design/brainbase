import { describe, it, expect } from "vitest";
import {
  validateMappingDocument,
  CANONICAL_TARGET_FIELDS,
  MAX_MAPPING_FIELDS,
  MAX_SOURCE_HEADER_LENGTH,
} from "@/lib/data-hub/sourceMapping/mappingDocument";

// Data Hub 5B.2 — pure-function behavioral tests for the mapping-document
// structural contract. No DB involved — this is the input-validation
// layer that runs BEFORE anything ever reaches Postgres.

describe("validateMappingDocument", () => {
  it("T31 — accepts a valid minimal document", () => {
    const result = validateMappingDocument({ fields: { report_date: "Call time", location: "Site Address" } });
    expect(result.ok).toBe(true);
  });

  it("T32 — rejects malformed top-level values (array, primitive, null)", () => {
    expect(validateMappingDocument([]).ok).toBe(false);
    expect(validateMappingDocument("not an object").ok).toBe(false);
    expect(validateMappingDocument(42).ok).toBe(false);
    expect(validateMappingDocument(null).ok).toBe(false);
    expect(validateMappingDocument(undefined).ok).toBe(false);
  });

  it("T33 — rejects a missing/empty fields object", () => {
    expect(validateMappingDocument({}).ok).toBe(false);
    const r = validateMappingDocument({ fields: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("EMPTY_FIELDS");
  });

  it("T34 — rejects an unknown canonical target field name", () => {
    const r = validateMappingDocument({ fields: { made_up_field: "Some Column" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("UNKNOWN_CANONICAL_TARGET");
  });

  it("T35 — a document exactly at the entry-count bound succeeds; the bound cannot structurally be exceeded", () => {
    const atBound: Record<string, string> = {};
    // Distinct source headers per key, since a repeated header would
    // instead trigger the separate DUPLICATE_SOURCE_HEADER rule (T39) —
    // this test isolates the entry-COUNT bound only.
    CANONICAL_TARGET_FIELDS.forEach((key, i) => {
      atBound[key] = `Column ${i}`;
    });
    expect(Object.keys(atBound).length).toBe(MAX_MAPPING_FIELDS);
    const result = validateMappingDocument({ fields: atBound });
    expect(result.ok).toBe(true);
    // Object keys are inherently unique, so there is no legal JS object
    // with MORE entries than CANONICAL_TARGET_FIELDS.length using only
    // legal (allowlisted) keys — the bound is structurally, not just
    // behaviorally, enforced. A key outside the allowlist is separately
    // rejected by UNKNOWN_CANONICAL_TARGET (T34) before count is ever
    // relevant.
  });

  it("T36 — rejects oversized source-header strings", () => {
    const overlong = "x".repeat(MAX_SOURCE_HEADER_LENGTH + 1);
    const r = validateMappingDocument({ fields: { report_date: overlong } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("SOURCE_HEADER_TOO_LONG");
  });

  it("T37 — rejects executable/script-like structure (non-string source header)", () => {
    const r1 = validateMappingDocument({ fields: { report_date: { $eval: "process.exit()" } } });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toBe("SOURCE_HEADER_NOT_STRING");

    const r2 = validateMappingDocument({ fields: { report_date: () => "x" } });
    expect(r2.ok).toBe(false);
  });

  it("T38 — rejects any value-transformation/rule structure (only plain strings are legal values)", () => {
    const r = validateMappingDocument({
      fields: { report_date: "Call time" },
      transform: { report_date: "toUpperCase" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("UNKNOWN_TOP_LEVEL_KEY");
  });

  it("T39 — duplicate/ambiguous source-column assignment is rejected (conservative rule)", () => {
    const r = validateMappingDocument({ fields: { report_date: "Same Column", location: "Same Column" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("DUPLICATE_SOURCE_HEADER");
  });

  it("duplicate detection is case-insensitive", () => {
    const r = validateMappingDocument({ fields: { report_date: "Call Time", location: "call time" } });
    expect(r.ok).toBe(false);
  });

  it("T40 — rejects unknown top-level fields beyond `fields`", () => {
    const r = validateMappingDocument({ fields: { report_date: "x" }, extra: "not allowed" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("UNKNOWN_TOP_LEVEL_KEY");
  });

  it("rejects empty/whitespace-only source header", () => {
    const r = validateMappingDocument({ fields: { report_date: "   " } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("SOURCE_HEADER_EMPTY");
  });

  it("trims source header whitespace on success", () => {
    const r = validateMappingDocument({ fields: { report_date: "  Call time  " } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.fields.report_date).toBe("Call time");
  });

  it("never persists the original untrusted object reference — returns a freshly-built document", () => {
    const inputFields: Record<string, string> = { report_date: "Call time" };
    const input = { fields: inputFields };
    const r = validateMappingDocument(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Mutating the ORIGINAL input object after validation must not affect
    // the returned document — proving the validator built a fresh object
    // rather than returning a reference into caller-controlled memory.
    inputFields.report_date = "mutated after validation";
    expect(r.document.fields.report_date).toBe("Call time");
  });

  it("no field name/value in CANONICAL_TARGET_FIELDS looks like Phase 6/reconciliation/credential concepts", () => {
    const forbidden = [
      "external_id",
      "source_external_id",
      "reconciliation_status",
      "canonical_hash",
      "credential",
      "password",
      "api_key",
      "token",
    ];
    for (const target of CANONICAL_TARGET_FIELDS) {
      expect(forbidden).not.toContain(target);
    }
  });
});
