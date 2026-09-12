import { describe, it, expect } from "vitest";
import { computeCanonicalHash, findDuplicateSourceExternalId, CANONICAL_HASH_FIELDS } from "@/lib/data-hub/importBatch/reconciliation";
import type { MappedIllegalDumpingRow } from "@/lib/data-hub/importBatch/illegalDumpingMapper";

// Data Hub 6.1B — pure, deterministic reconciliation helper tests. Written
// BEFORE Step 8's transaction-level wiring (TDD ordering per the approved
// implementation plan) — these prove the hash/duplicate-detection
// contracts in complete isolation from any DB/transaction code.

function baseRow(overrides: Partial<MappedIllegalDumpingRow> = {}): MappedIllegalDumpingRow {
  return {
    report_date: new Date(Date.UTC(2024, 0, 15)),
    location: "Main St",
    suburb: "Riverside",
    zone: "North",
    waste_type: "tyres",
    volume_estimate: "small",
    severity: "MEDIUM",
    status: "OPEN",
    crew_assigned: null,
    resolution_date: null,
    cost_estimate: null,
    notes: null,
    ...overrides,
  };
}

describe("CANONICAL_HASH_FIELDS", () => {
  it("covers exactly the 12 governed MappedIllegalDumpingRow fields, in a fixed order", () => {
    expect(CANONICAL_HASH_FIELDS).toEqual([
      "report_date",
      "location",
      "suburb",
      "zone",
      "waste_type",
      "volume_estimate",
      "severity",
      "status",
      "crew_assigned",
      "resolution_date",
      "cost_estimate",
      "notes",
    ]);
  });

  it("does not include the identity field (source_external_id is not a MappedIllegalDumpingRow property at all)", () => {
    expect(CANONICAL_HASH_FIELDS).not.toContain("source_external_id");
  });
});

describe("computeCanonicalHash — determinism", () => {
  it("A. is a 64-character lowercase hex SHA-256 digest", () => {
    const hash = computeCanonicalHash(baseRow());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("B. is deterministic — identical input always produces the identical hash", () => {
    const row = baseRow();
    expect(computeCanonicalHash(row)).toBe(computeCanonicalHash(row));
    expect(computeCanonicalHash(baseRow())).toBe(computeCanonicalHash(baseRow()));
  });

  it("C. changing any single governed field changes the hash", () => {
    const original = computeCanonicalHash(baseRow());
    expect(computeCanonicalHash(baseRow({ location: "Oak Ave" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ waste_type: "mattress" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ severity: "HIGH" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ status: "RESOLVED" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ crew_assigned: "Team A" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ cost_estimate: 150 }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ notes: "follow up" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ suburb: "Other" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ zone: "South" }))).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ volume_estimate: "large" }))).not.toBe(original);
    expect(
      computeCanonicalHash(baseRow({ resolution_date: new Date(Date.UTC(2024, 1, 1)) }))
    ).not.toBe(original);
    expect(computeCanonicalHash(baseRow({ report_date: new Date(Date.UTC(2024, 0, 16)) }))).not.toBe(original);
  });

  it("D. never relies on arbitrary JS object property ordering — a row built with keys in a different insertion order still hashes identically", () => {
    const a = baseRow();
    const b: MappedIllegalDumpingRow = {
      notes: a.notes,
      cost_estimate: a.cost_estimate,
      resolution_date: a.resolution_date,
      crew_assigned: a.crew_assigned,
      status: a.status,
      severity: a.severity,
      volume_estimate: a.volume_estimate,
      waste_type: a.waste_type,
      zone: a.zone,
      suburb: a.suburb,
      location: a.location,
      report_date: a.report_date,
    };
    expect(computeCanonicalHash(a)).toBe(computeCanonicalHash(b));
  });
});

describe("computeCanonicalHash — normalization", () => {
  it("E. null and undefined-equivalent optional fields (already normalized to null by the mapper) hash identically", () => {
    const withNull = baseRow({ suburb: null });
    const alsoNull = baseRow({ suburb: null });
    expect(computeCanonicalHash(withNull)).toBe(computeCanonicalHash(alsoNull));
  });

  it("F. two Date objects representing the same UTC calendar day (constructed differently) hash identically", () => {
    const a = baseRow({ report_date: new Date(Date.UTC(2024, 0, 15, 0, 0, 0)) });
    const b = baseRow({ report_date: new Date(Date.UTC(2024, 0, 15)) });
    expect(computeCanonicalHash(a)).toBe(computeCanonicalHash(b));
  });

  it("G. a numeric cost_estimate is never rounded or stringified differently across calls", () => {
    const a = baseRow({ cost_estimate: 199.5 });
    const b = baseRow({ cost_estimate: 199.5 });
    expect(computeCanonicalHash(a)).toBe(computeCanonicalHash(b));
    expect(computeCanonicalHash(baseRow({ cost_estimate: 199.5 }))).not.toBe(
      computeCanonicalHash(baseRow({ cost_estimate: 199.05 }))
    );
  });

  it("H. every field explicitly null produces a stable, reproducible hash (not a crash, not NaN-derived instability)", () => {
    const allNull = baseRow({
      suburb: null,
      zone: null,
      volume_estimate: null,
      crew_assigned: null,
      resolution_date: null,
      cost_estimate: null,
      notes: null,
    });
    const hash1 = computeCanonicalHash(allNull);
    const hash2 = computeCanonicalHash(allNull);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("findDuplicateSourceExternalId", () => {
  it("I. returns null when every value is unique", () => {
    expect(findDuplicateSourceExternalId(["A", "B", "C"])).toBeNull();
  });

  it("J. returns the first repeated value when a duplicate exists", () => {
    expect(findDuplicateSourceExternalId(["A", "B", "A"])).toBe("A");
  });

  it("K. returns null for an empty list", () => {
    expect(findDuplicateSourceExternalId([])).toBeNull();
  });

  it("L. returns null for a single-element list", () => {
    expect(findDuplicateSourceExternalId(["ONLY-ONE"])).toBeNull();
  });

  it("M. is case-sensitive — 'EXT-1' and 'ext-1' are not treated as duplicates (no invented normalization)", () => {
    expect(findDuplicateSourceExternalId(["EXT-1", "ext-1"])).toBeNull();
  });

  it("N. preserves leading-zero-distinct values as genuinely distinct strings ('007' !== '7')", () => {
    expect(findDuplicateSourceExternalId(["007", "7"])).toBeNull();
  });

  it("O. detects a duplicate that appears three times, still reporting on first repeat", () => {
    expect(findDuplicateSourceExternalId(["X", "Y", "X", "X"])).toBe("X");
  });
});
