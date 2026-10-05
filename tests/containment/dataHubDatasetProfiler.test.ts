import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { DATASET_PROFILER_VERSION, type DatasetProfileInput, type ProfileColumnInput } from "@/lib/data-hub/profiling/contracts";
import { SafeAccumulator } from "@/lib/data-hub/profiling/safeInt";

// Data Hub 6.2D4D1A — pure dataset profiling engine, comprehensive
// containment tests. Every scenario here calls profileDataset() directly
// (the real, unmodified pure function) — never a mock. See
// lib/data-hub/profiling/contracts.ts for the exact input/output shape.

function column(overrides: Partial<ProfileColumnInput>): ProfileColumnInput {
  return {
    sourceSchemaColumnId: "col-1",
    valueKind: "STRING",
    sourceUnit: null,
    normalizedUnit: null,
    cells: [],
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof profileDataset>) {
  if (!result.ok) throw new Error("expected profileDataset to succeed, got PROFILE_INPUT_INVALID");
  return result.profile;
}

function expectInvalid(result: ReturnType<typeof profileDataset>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result).toEqual({ ok: false, code: "PROFILE_INPUT_INVALID" });
}

// ═══════════════════════════════════════════════════════════════════════
// GENERAL
// ═══════════════════════════════════════════════════════════════════════

describe("general", () => {
  it("zero rows, zero columns -> trivially empty, complete, deterministic profile", () => {
    const profile = expectOk(profileDataset({ rowCount: 0, columns: [] }));
    expect(profile).toEqual({
      profilerVersion: "v1",
      rowCount: 0,
      columnCount: 0,
      totalCellCount: 0,
      nonNullCellCount: 0,
      nullCellCount: 0,
      completeRowCount: 0,
      incompleteRowCount: 0,
      columns: [],
    });
  });

  it("zero columns with nonzero rows -> every row is vacuously complete (0 of 0 required columns present)", () => {
    const profile = expectOk(profileDataset({ rowCount: 5, columns: [] }));
    expect(profile.completeRowCount).toBe(5);
    expect(profile.incompleteRowCount).toBe(0);
    expect(profile.totalCellCount).toBe(0);
  });

  it("zero rows with a declared column -> isComplete true, isAllNull false, isConstant false", () => {
    const profile = expectOk(profileDataset({ rowCount: 0, columns: [column({ valueKind: "STRING", cells: [] })] }));
    const c = profile.columns[0];
    expect(c.rowCount).toBe(0);
    expect(c.nonNullCount).toBe(0);
    expect(c.nullCount).toBe(0);
    expect(c.isComplete).toBe(true);
    expect(c.isAllNull).toBe(false);
    expect(c.isSparse).toBe(false);
    expect(c.isConstant).toBe(false);
    expect(c.isUniqueAmongNonNull).toBe(false);
    expect(c.nullRatio).toBeNull();
    expect(c.nonNullRatio).toBeNull();
  });

  it("all-null column: isAllNull true, isComplete false, isSparse false, ratios exact", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 4,
        columns: [column({ valueKind: "STRING", cells: [1, 2, 3, 4].map((n) => ({ sourceRowNumber: n, normalizedValue: null })) })],
      })
    );
    const c = profile.columns[0];
    expect(c.nonNullCount).toBe(0);
    expect(c.nullCount).toBe(4);
    expect(c.isAllNull).toBe(true);
    expect(c.isComplete).toBe(false);
    expect(c.isSparse).toBe(false);
    expect(c.nullRatio).toBe("1");
    expect(c.nonNullRatio).toBe("0");
  });

  it("complete column (no nulls): isComplete true, isAllNull false, isSparse false", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: `v${n}` })) })],
      })
    );
    const c = profile.columns[0];
    expect(c.isComplete).toBe(true);
    expect(c.isAllNull).toBe(false);
    expect(c.isSparse).toBe(false);
    expect(c.nullRatio).toBe("0");
    expect(c.nonNullRatio).toBe("1");
  });

  it("partially-null column: isSparse true, isComplete false, isAllNull false, exact ratios", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 4,
        columns: [
          column({
            cells: [
              { sourceRowNumber: 1, normalizedValue: "a" },
              { sourceRowNumber: 2, normalizedValue: null },
              { sourceRowNumber: 3, normalizedValue: "b" },
              { sourceRowNumber: 4, normalizedValue: null },
            ],
          }),
        ],
      })
    );
    const c = profile.columns[0];
    expect(c.nonNullCount).toBe(2);
    expect(c.nullCount).toBe(2);
    expect(c.isSparse).toBe(true);
    expect(c.isComplete).toBe(false);
    expect(c.isAllNull).toBe(false);
    expect(c.nullRatio).toBe("0.5");
    expect(c.nonNullRatio).toBe("0.5");
  });

  it("a row with no cell entry at all is treated identically to an explicit null entry", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        // Only row 1 and 3 have an entry; row 2 is entirely absent.
        columns: [
          column({
            cells: [
              { sourceRowNumber: 1, normalizedValue: "a" },
              { sourceRowNumber: 3, normalizedValue: "b" },
            ],
          }),
        ],
      })
    );
    const c = profile.columns[0];
    expect(c.nonNullCount).toBe(2);
    expect(c.nullCount).toBe(1);
  });

  it("constant column: exactly one distinct non-null value -> isConstant true, isUniqueAmongNonNull false", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: "same" })) })],
      })
    );
    const c = profile.columns[0];
    expect(c.isConstant).toBe(true);
    expect(c.distinctNonNullCount).toBe(1);
    expect(c.isUniqueAmongNonNull).toBe(false);
  });

  it("all-distinct column: isUniqueAmongNonNull true, isConstant false", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ valueKind: "IDENTIFIER", cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: `id-${n}` })) })],
      })
    );
    const c = profile.columns[0];
    expect(c.isUniqueAmongNonNull).toBe(true);
    expect(c.isConstant).toBe(false);
    expect(c.distinctNonNullCount).toBe(3);
  });

  it("repeated values: distinctNonNullCount counts unique values, not cells", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 5,
        columns: [
          column({
            valueKind: "IDENTIFIER",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "x" },
              { sourceRowNumber: 2, normalizedValue: "y" },
              { sourceRowNumber: 3, normalizedValue: "x" },
              { sourceRowNumber: 4, normalizedValue: "y" },
              { sourceRowNumber: 5, normalizedValue: "x" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].distinctNonNullCount).toBe(2);
    expect(profile.columns[0].nonNullCount).toBe(5);
  });

  it("governed input column order is preserved verbatim, never sorted", () => {
    const input: DatasetProfileInput = {
      rowCount: 1,
      columns: [
        column({ sourceSchemaColumnId: "zeta", cells: [{ sourceRowNumber: 1, normalizedValue: "z" }] }),
        column({ sourceSchemaColumnId: "alpha", cells: [{ sourceRowNumber: 1, normalizedValue: "a" }] }),
        column({ sourceSchemaColumnId: "mike", cells: [{ sourceRowNumber: 1, normalizedValue: "m" }] }),
      ],
    };
    const profile = expectOk(profileDataset(input));
    expect(profile.columns.map((c) => c.sourceSchemaColumnId)).toEqual(["zeta", "alpha", "mike"]);
  });

  it("deterministic repeated execution: identical input produces byte-equivalent output across 5 calls", () => {
    const input: DatasetProfileInput = {
      rowCount: 4,
      columns: [
        column({ sourceSchemaColumnId: "c1", valueKind: "DECIMAL", cells: [1, 2, 3, 4].map((n) => ({ sourceRowNumber: n, normalizedValue: `${n}.5` })) }),
        column({ sourceSchemaColumnId: "c2", valueKind: "STRING", cells: [{ sourceRowNumber: 1, normalizedValue: "hello" }] }),
      ],
    };
    const serialized = JSON.stringify(expectOk(profileDataset(input)));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(expectOk(profileDataset(input)))).toBe(serialized);
    }
  });

  it("dataset-level completeRowCount/incompleteRowCount reflect cross-column completeness, not per-column completeness", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({ sourceSchemaColumnId: "c1", cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: "x" }))}), // complete
          column({ sourceSchemaColumnId: "c2", cells: [{ sourceRowNumber: 1, normalizedValue: "y" }] }), // only row 1 populated
        ],
      })
    );
    // Row 1: both columns present -> complete. Rows 2/3: c2 missing -> incomplete.
    expect(profile.completeRowCount).toBe(1);
    expect(profile.incompleteRowCount).toBe(2);
    expect(profile.totalCellCount).toBe(6);
    expect(profile.nonNullCellCount).toBe(4);
    expect(profile.nullCellCount).toBe(2);
  });

  it("carries the fixed profiler version", () => {
    expect(DATASET_PROFILER_VERSION).toBe("v1");
    expect(expectOk(profileDataset({ rowCount: 0, columns: [] })).profilerVersion).toBe("v1");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// STRING
// ═══════════════════════════════════════════════════════════════════════

describe("STRING", () => {
  it("length statistics: min/max/total/mean, Unicode code-point aware", () => {
    // "héllo" (5 code points) and an emoji (1 code point, 2 UTF-16 units).
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({
            cells: [
              { sourceRowNumber: 1, normalizedValue: "ab" },
              { sourceRowNumber: 2, normalizedValue: "héllo" },
              { sourceRowNumber: 3, normalizedValue: "🎉" },
            ],
          }),
        ],
      })
    );
    const stats = profile.columns[0].stringStats!;
    expect(stats.minLength).toBe(1); // the emoji: 1 code point
    expect(stats.maxLength).toBe(5); // héllo
    expect(stats.totalLength).toBe(2 + 5 + 1);
    // 8 / 3, truncated (never rounded) to 10 fractional digits.
    expect(stats.meanLength).toBe("2.6666666666");
  });

  it("empty string is counted distinctly from null", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            cells: [
              { sourceRowNumber: 1, normalizedValue: "" },
              { sourceRowNumber: 2, normalizedValue: null },
            ],
          }),
        ],
      })
    );
    const c = profile.columns[0];
    expect(c.nonNullCount).toBe(1);
    expect(c.nullCount).toBe(1);
    expect(c.stringStats!.emptyStringCount).toBe(1);
    expect(c.stringStats!.minLength).toBe(0);
  });

  it("STRING values never appear anywhere in the serialized output", () => {
    const SECRET = "123 Example Street, Secretville";
    const profile = expectOk(
      profileDataset({
        rowCount: 1,
        columns: [column({ cells: [{ sourceRowNumber: 1, normalizedValue: SECRET }] })],
      })
    );
    expect(JSON.stringify(profile)).not.toContain(SECRET);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// IDENTIFIER
// ═══════════════════════════════════════════════════════════════════════

describe("IDENTIFIER", () => {
  it("uniqueness counts behave identically to STRING's distinctness logic", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ valueKind: "IDENTIFIER", cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: `ID-${n}` })) })],
      })
    );
    expect(profile.columns[0].isUniqueAmongNonNull).toBe(true);
  });

  it("IDENTIFIER values never appear anywhere in the serialized output", () => {
    const SECRET_ID = "VEH-REG-9F8731";
    const profile = expectOk(
      profileDataset({
        rowCount: 1,
        columns: [column({ valueKind: "IDENTIFIER", cells: [{ sourceRowNumber: 1, normalizedValue: SECRET_ID }] })],
      })
    );
    expect(JSON.stringify(profile)).not.toContain(SECRET_ID);
  });

  it("leading-zero identifiers remain opaque strings — never coerced, never leaked, uniqueness still correct", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "IDENTIFIER",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "007" },
              { sourceRowNumber: 2, normalizedValue: "07" },
            ],
          }),
        ],
      })
    );
    const c = profile.columns[0];
    // "007" and "07" are DIFFERENT opaque identifier strings (never
    // numerically coerced -- numeric coercion would wrongly collapse them).
    expect(c.distinctNonNullCount).toBe(2);
    expect(JSON.stringify(profile)).not.toContain("007");
    expect(JSON.stringify(profile)).not.toContain('"07"');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BOOLEAN
// ═══════════════════════════════════════════════════════════════════════

describe("BOOLEAN", () => {
  it("true/false/null counts", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 5,
        columns: [
          column({
            valueKind: "BOOLEAN",
            cells: [
              { sourceRowNumber: 1, normalizedValue: true },
              { sourceRowNumber: 2, normalizedValue: false },
              { sourceRowNumber: 3, normalizedValue: true },
              { sourceRowNumber: 4, normalizedValue: null },
              { sourceRowNumber: 5, normalizedValue: true },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].booleanStats).toEqual({ trueCount: 3, falseCount: 1, nullCount: 1 });
    expect(profile.columns[0].distinctNonNullCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INTEGER / DECIMAL
// ═══════════════════════════════════════════════════════════════════════

describe("INTEGER / DECIMAL", () => {
  it("exact min/max over simple values", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "3.5" }, { sourceRowNumber: 2, normalizedValue: "-1.2" }, { sourceRowNumber: 3, normalizedValue: "10" }] })],
      })
    );
    expect(profile.columns[0].numericStats).toMatchObject({ min: "-1.2", max: "10" });
  });

  it("huge values far beyond Number.MAX_SAFE_INTEGER are compared exactly, never via Number()", () => {
    const huge1 = "99999999999999999999999999999999999999999999999991";
    const huge2 = "99999999999999999999999999999999999999999999999999"; // differs only in the last few digits -- Number() would collapse these
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [column({ valueKind: "INTEGER", cells: [{ sourceRowNumber: 1, normalizedValue: huge1 }, { sourceRowNumber: 2, normalizedValue: huge2 }] })],
      })
    );
    expect(profile.columns[0].numericStats!.max).toBe(huge2);
    expect(profile.columns[0].numericStats!.min).toBe(huge1);
    expect(profile.columns[0].distinctNonNullCount).toBe(2);
  });

  it("Number()/parseFloat would silently corrupt this exact comparison -- confirms the test above is real, not vacuous", () => {
    const huge1 = "99999999999999999999999999999999999999999999999991";
    const huge2 = "99999999999999999999999999999999999999999999999999";
    // If the profiler used Number(), both would collapse to the same
    // double and compareExactDecimal would never be exercised correctly.
    expect(Number(huge1)).toBe(Number(huge2));
  });

  it("negative values participate correctly in min/max/sum/mean", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "-5" }, { sourceRowNumber: 2, normalizedValue: "-1" }, { sourceRowNumber: 3, normalizedValue: "-3" }] })],
      })
    );
    const stats = profile.columns[0].numericStats!;
    expect(stats.min).toBe("-5");
    expect(stats.max).toBe("-1");
    expect(stats.sum).toBe("-9");
    expect(stats.mean).toBe("-3");
  });

  it("decimal scale differences representing equivalent values collapse to one distinct value", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "2.50" }, { sourceRowNumber: 2, normalizedValue: "2.5" }] })],
      })
    );
    expect(profile.columns[0].distinctNonNullCount).toBe(1);
    expect(profile.columns[0].isConstant).toBe(true);
  });

  it("exact sum/mean never uses floating-point division (0.1 + 0.2 style drift is absent)", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "0.1" }, { sourceRowNumber: 2, normalizedValue: "0.2" }, { sourceRowNumber: 3, normalizedValue: "0.3" }] })],
      })
    );
    // Exact BigInt arithmetic: 0.1 + 0.2 + 0.3 = 0.6 exactly, never 0.6000000000000001.
    expect(profile.columns[0].numericStats!.sum).toBe("0.6");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CURRENCY / PERCENTAGE / DURATION
// ═══════════════════════════════════════════════════════════════════════

describe("CURRENCY / PERCENTAGE / DURATION", () => {
  it("CURRENCY is profiled numerically with units preserved, never inferred", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [column({ valueKind: "CURRENCY", sourceUnit: "AUD", normalizedUnit: "AUD", cells: [{ sourceRowNumber: 1, normalizedValue: "10.00" }, { sourceRowNumber: 2, normalizedValue: "20.50" }] })],
      })
    );
    const c = profile.columns[0];
    expect(c.sourceUnit).toBe("AUD");
    expect(c.normalizedUnit).toBe("AUD");
    expect(c.numericStats).toMatchObject({ min: "10", max: "20.5", sum: "30.5" });
  });

  it("PERCENTAGE is profiled numerically with its unit preserved", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [column({ valueKind: "PERCENTAGE", sourceUnit: "%", normalizedUnit: "%", cells: [{ sourceRowNumber: 1, normalizedValue: "50" }, { sourceRowNumber: 2, normalizedValue: "75" }] })],
      })
    );
    expect(profile.columns[0].normalizedUnit).toBe("%");
    expect(profile.columns[0].numericStats).toMatchObject({ min: "50", max: "75" });
  });

  it("DURATION is profiled numerically with its unit preserved, no unit is ever inferred from absence", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [column({ valueKind: "DURATION", sourceUnit: "min", normalizedUnit: "h", cells: [{ sourceRowNumber: 1, normalizedValue: "1" }, { sourceRowNumber: 2, normalizedValue: "2" }] })],
      })
    );
    const c = profile.columns[0];
    expect(c.sourceUnit).toBe("min");
    expect(c.normalizedUnit).toBe("h");
    expect(c.numericStats).toMatchObject({ min: "1", max: "2" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// LATITUDE / LONGITUDE
// ═══════════════════════════════════════════════════════════════════════

describe("LATITUDE / LONGITUDE", () => {
  it("min/max with no geospatial inference — plain exact numeric stats only", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({ sourceSchemaColumnId: "lat", valueKind: "LATITUDE", cells: [{ sourceRowNumber: 1, normalizedValue: "-34.9" }, { sourceRowNumber: 2, normalizedValue: "-33.1" }, { sourceRowNumber: 3, normalizedValue: "-35.5" }] }),
          column({ sourceSchemaColumnId: "lng", valueKind: "LONGITUDE", cells: [{ sourceRowNumber: 1, normalizedValue: "138.6" }, { sourceRowNumber: 2, normalizedValue: "151.2" }] }),
        ],
      })
    );
    expect(profile.columns[0].numericStats).toMatchObject({ min: "-35.5", max: "-33.1" });
    expect(profile.columns[1].numericStats).toMatchObject({ min: "138.6", max: "151.2" });
    // No "location"/geospatial key anywhere on the output.
    expect(JSON.stringify(profile)).not.toMatch(/location|geo|distance/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DATE
// ═══════════════════════════════════════════════════════════════════════

describe("DATE", () => {
  it("correct chronological min/max from canonical DATE strings", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 4,
        columns: [
          column({
            valueKind: "DATE",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2024-06-15" },
              { sourceRowNumber: 2, normalizedValue: "2023-12-31" },
              { sourceRowNumber: 3, normalizedValue: "2024-01-01" },
              { sourceRowNumber: 4, normalizedValue: "2099-01-01" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].temporalStats).toEqual({ min: "2023-12-31", max: "2099-01-01" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TIME
// ═══════════════════════════════════════════════════════════════════════

describe("TIME", () => {
  it("min/max over wall-clock TIME strings", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({
            valueKind: "TIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "14:30:00" },
              { sourceRowNumber: 2, normalizedValue: "06:00:00" },
              { sourceRowNumber: 3, normalizedValue: "23:59:59" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].temporalStats).toEqual({ min: "06:00:00", max: "23:59:59" });
  });

  it("variable-length fractional seconds compare and dedupe correctly (0.1s === 0.10s)", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "TIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "10:00:00.1" },
              { sourceRowNumber: 2, normalizedValue: "10:00:00.10" },
            ],
          }),
        ],
      })
    );
    // Same instant, two different-precision canonical spellings -> one distinct value.
    expect(profile.columns[0].distinctNonNullCount).toBe(1);
  });

  it("fractional-second ordering is numerically correct even with differing digit counts", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({
            valueKind: "TIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "10:00:00.5" }, // 0.5s
              { sourceRowNumber: 2, normalizedValue: "10:00:00.45" }, // 0.45s
              { sourceRowNumber: 3, normalizedValue: "10:00:00.099" }, // 0.099s
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].temporalStats).toEqual({ min: "10:00:00.099", max: "10:00:00.5" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DATETIME
// ═══════════════════════════════════════════════════════════════════════

describe("DATETIME", () => {
  it("min/max without timezone reinterpretation — compares the canonical UTC-instant string as-is", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 3,
        columns: [
          column({
            valueKind: "DATETIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2024-06-15T04:30:00Z" },
              { sourceRowNumber: 2, normalizedValue: "2024-06-14T23:00:00Z" },
              { sourceRowNumber: 3, normalizedValue: "2024-06-15T10:00:00Z" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].temporalStats).toEqual({ min: "2024-06-14T23:00:00Z", max: "2024-06-15T10:00:00Z" });
  });

  it("UNSPECIFIED_LOCAL shape (no trailing Z) is compared consistently within its own column", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "DATETIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2024-06-15T04:30:00" },
              { sourceRowNumber: 2, normalizedValue: "2024-06-14T23:00:00" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].temporalStats).toEqual({ min: "2024-06-14T23:00:00", max: "2024-06-15T04:30:00" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INVALID INPUT
// ═══════════════════════════════════════════════════════════════════════

describe("invalid input", () => {
  it("unsupported valueKind -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "NOT_A_REAL_KIND" as never, cells: [{ sourceRowNumber: 1, normalizedValue: "x" }] })] }));
  });

  it("wrong JSON representation: a JS number for a numeric-like value is rejected (must be the canonical decimal STRING)", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: 5 as unknown as string }] })] }));
  });

  it("wrong JSON representation: a string for a BOOLEAN value is rejected (must be a JS boolean)", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "BOOLEAN", cells: [{ sourceRowNumber: 1, normalizedValue: "true" as unknown as boolean }] })] }));
  });

  it("duplicate column ids -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(
      profileDataset({
        rowCount: 1,
        columns: [column({ sourceSchemaColumnId: "dupe", cells: [] }), column({ sourceSchemaColumnId: "dupe", cells: [] })],
      })
    );
  });

  it("duplicate row numbers within a single column -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            cells: [
              { sourceRowNumber: 1, normalizedValue: "a" },
              { sourceRowNumber: 1, normalizedValue: "b" },
            ],
          }),
        ],
      })
    );
  });

  it("malformed canonical decimal (not strict grammar) -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "12,345.00" }] })] }));
  });

  it("malformed canonical decimal (scientific notation) -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "1.5e10" }] })] }));
  });

  it("INTEGER declared but fractional value supplied -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "INTEGER", cells: [{ sourceRowNumber: 1, normalizedValue: "1.5" }] })] }));
  });

  it("invalid DATE representation (wrong shape) -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "15/06/2024" }] })] }));
  });

  it("invalid TIME representation (wrong shape) -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2:30 PM" }] })] }));
  });

  it("invalid DATETIME representation (wrong shape) -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "not-a-datetime" }] })] }));
  });

  it("negative rowCount -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: -1, columns: [] }));
  });

  it("non-integer rowCount -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1.5, columns: [] }));
  });

  it("sourceRowNumber beyond the declared row universe -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 2, columns: [column({ cells: [{ sourceRowNumber: 3, normalizedValue: "x" }] })] }));
  });

  it("sourceRowNumber zero or negative -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 2, columns: [column({ cells: [{ sourceRowNumber: 0, normalizedValue: "x" }] })] }));
  });

  it("unit outside the governed vocabulary -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DECIMAL", sourceUnit: "lbs" as never, cells: [] })] }));
  });

  it("value-bearing errors are never leaked: the failure result carries no field names or offending values", () => {
    const SECRET = "SHOULD-NEVER-APPEAR-IN-ERROR";
    const result = profileDataset({ rowCount: 1, columns: [column({ valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: SECRET }] })] });
    expect(result).toEqual({ ok: false, code: "PROFILE_INPUT_INVALID" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CANONICAL TEMPORAL VALIDATION (final review remediation)
//
// A regex can only prove a value LOOKS like "YYYY-MM-DD"; it cannot prove
// the calendar date is real. Every case below is accepted by the OLD
// shape-only regex but must now be rejected by the real
// parse-then-re-render-and-compare validation in temporalValidation.ts.
// ═══════════════════════════════════════════════════════════════════════

describe("canonical temporal validation", () => {
  it("DATE: an impossible calendar day (2025-02-30) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "2025-02-30" }] })] }));
  });

  it("DATE: an impossible month (2026-13-01) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-13-01" }] })] }));
  });

  it("DATE: year 0000 (outside the governed 0001-9999 range) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "0000-01-01" }] })] }));
  });

  it("DATE: B2A's own raw-source-only midnight-timestamp accommodation is NOT accepted as a normalized DATE value", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-03-15T00:00:00.000Z" }] })] }));
  });

  it("DATE: a genuinely valid canonical DATE is still accepted", () => {
    expectOk(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-03-15" }] })] }));
  });

  it("TIME: hour 24 (impossible clock) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "24:00:00" }] })] }));
  });

  it("TIME: minute 60 (impossible clock) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "12:60:00" }] })] }));
  });

  it("TIME: second 60 (impossible clock) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "12:00:60" }] })] }));
  });

  it("TIME: the short 'HH:mm' raw-input form is rejected — B2A's normalized output always includes seconds", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "12:30" }] })] }));
  });

  it("TIME: a genuine canonical TIME (with fractional seconds) is still accepted", () => {
    expectOk(profileDataset({ rowCount: 1, columns: [column({ valueKind: "TIME", cells: [{ sourceRowNumber: 1, normalizedValue: "12:30:00.5" }] })] }));
  });

  it("DATETIME: an impossible calendar day is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-02-30T12:00:00Z" }] })] }));
  });

  it("DATETIME: an impossible clock time is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T25:00:00Z" }] })] }));
  });

  it("DATETIME: a numeric source offset (+09:30) is never accepted as normalized profiler input", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00+09:30" }] })] }));
  });

  it("DATETIME: a different numeric source offset (-05:00) is also rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00-05:00" }] })] }));
  });

  it("DATETIME: malformed canonical output (short time form) is rejected", () => {
    expectInvalid(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00Z" }] })] }));
  });

  it("DATETIME: a genuinely valid UTC-instant canonical value is still accepted", () => {
    expectOk(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00Z" }] })] }));
  });

  it("DATETIME: a genuinely valid UNSPECIFIED_LOCAL (no trailing Z) canonical value is still accepted", () => {
    expectOk(profileDataset({ rowCount: 1, columns: [column({ valueKind: "DATETIME", cells: [{ sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00" }] })] }));
  });

  it("DATETIME: a single column mixing trailing-Z and non-Z normalized forms is rejected — one governed timezone policy cannot produce both shapes", () => {
    expectInvalid(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "DATETIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00Z" },
              { sourceRowNumber: 2, normalizedValue: "2026-01-02T08:00:00" },
            ],
          }),
        ],
      })
    );
  });

  it("DATETIME: a column entirely one consistent shape (all-Z) remains valid", () => {
    expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "DATETIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00Z" },
              { sourceRowNumber: 2, normalizedValue: "2026-01-02T08:00:00Z" },
            ],
          }),
        ],
      })
    );
  });

  it("DATETIME: a column entirely one consistent shape (all-UNSPECIFIED_LOCAL) remains valid", () => {
    expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "DATETIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2026-01-01T12:00:00" },
              { sourceRowNumber: 2, normalizedValue: "2026-01-02T08:00:00" },
            ],
          }),
        ],
      })
    );
  });

  it("existing fractional-second comparison behavior is preserved after the canonical-validation tightening", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({
            valueKind: "TIME",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "10:00:00.1" },
              { sourceRowNumber: 2, normalizedValue: "10:00:00.10" },
            ],
          }),
        ],
      })
    );
    expect(profile.columns[0].distinctNonNullCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SAFE INTEGER / COUNT ARITHMETIC (final review remediation)
// ═══════════════════════════════════════════════════════════════════════

describe("safe integer / count arithmetic", () => {
  it("rowCount beyond Number.MAX_SAFE_INTEGER -> PROFILE_INPUT_INVALID, never a thrown error", () => {
    expect(() => profileDataset({ rowCount: Number.MAX_SAFE_INTEGER + 2, columns: [] })).not.toThrow();
    expectInvalid(profileDataset({ rowCount: Number.MAX_SAFE_INTEGER + 2, columns: [] }));
  });

  it("an unsafe (non-integer-representable) sourceRowNumber -> PROFILE_INPUT_INVALID", () => {
    expectInvalid(
      profileDataset({
        rowCount: Number.MAX_SAFE_INTEGER,
        columns: [column({ cells: [{ sourceRowNumber: Number.MAX_SAFE_INTEGER + 10, normalizedValue: "x" }] })],
      })
    );
  });

  it("a pathological (huge but safe) rowCount never throws RangeError, with or without a populated column", () => {
    const hugeRowCount = 5_000_000_000; // far too large to allocate an array of this size
    expect(() => profileDataset({ rowCount: hugeRowCount, columns: [] })).not.toThrow();
    expect(
      () =>
        profileDataset({
          rowCount: hugeRowCount,
          columns: [column({ cells: [{ sourceRowNumber: 1, normalizedValue: "x" }] })],
        })
    ).not.toThrow();
  });

  it("a pathological rowCount with zero columns succeeds and reports every row vacuously complete, without allocating a rowCount-sized structure", () => {
    const hugeRowCount = 5_000_000_000;
    const profile = expectOk(profileDataset({ rowCount: hugeRowCount, columns: [] }));
    expect(profile.rowCount).toBe(hugeRowCount);
    expect(profile.completeRowCount).toBe(hugeRowCount);
    expect(profile.incompleteRowCount).toBe(0);
  });

  it("a pathological rowCount with a sparse column still completes, reporting correct small-scale non-null evidence", () => {
    const hugeRowCount = 5_000_000_000;
    const profile = expectOk(
      profileDataset({
        rowCount: hugeRowCount,
        columns: [column({ cells: [{ sourceRowNumber: 1, normalizedValue: "x" }, { sourceRowNumber: hugeRowCount, normalizedValue: "y" }] })],
      })
    );
    expect(profile.columns[0].nonNullCount).toBe(2);
    expect(profile.columns[0].nullCount).toBe(hugeRowCount - 2);
    // Only row 1 is "complete" (every one of the 1 declared column is
    // non-null there) -- same for the last row -- every OTHER row has no
    // evidence at all for this column, so it is incomplete.
    expect(profile.completeRowCount).toBe(2);
  });

  it("an unsafe totalCellCount (rowCount * columnCount overflowing Number.MAX_SAFE_INTEGER) fails closed", () => {
    // rowCount alone is a safe integer, and each of the 10 columns
    // individually validates fine, but the PRODUCT (rowCount * 10)
    // exceeds Number.MAX_SAFE_INTEGER by roughly 10x.
    const hugeRowCount = Number.MAX_SAFE_INTEGER; // ~9.007e15
    const manyColumns = Array.from({ length: 10 }, (_, i) => column({ sourceSchemaColumnId: `d${i}`, cells: [] }));
    expect(() => profileDataset({ rowCount: hugeRowCount, columns: manyColumns })).not.toThrow();
    expectInvalid(profileDataset({ rowCount: hugeRowCount, columns: manyColumns }));
    // Sanity: the small-scale sibling case (no overflow) still succeeds.
    const smallRowCount = 100_000_000; // 1e8 * 10 columns = 1e9, safely within range.
    const sameShapedColumns = Array.from({ length: 10 }, (_, i) => column({ sourceSchemaColumnId: `c${i}`, cells: [] }));
    expectOk(profileDataset({ rowCount: smallRowCount, columns: sameShapedColumns }));
  });

  it("a STRING column whose total code-point length would overflow Number.MAX_SAFE_INTEGER fails closed rather than silently losing precision", () => {
    // Can't realistically allocate enough real cells to overflow in a unit
    // test, so this proves the SafeAccumulator primitive itself fails
    // closed at the boundary it is responsible for -- profileColumn.ts
    // wires it in directly, with no separate/looser arithmetic path.
    const acc = new SafeAccumulator();
    acc.add(Number.MAX_SAFE_INTEGER);
    acc.add(2);
    expect(acc.result()).toEqual({ ok: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PRIVACY
// ═══════════════════════════════════════════════════════════════════════

describe("privacy", () => {
  it("a representative multi-kind profile never contains any source STRING/IDENTIFIER value, execution token, or raw source content", () => {
    const SECRET_STRING = "456 Confidential Ave";
    const SECRET_IDENTIFIER = "EMP-00451";
    const FAKE_TOKEN = "TOKEN-SECRET-should-not-exist";
    const profile = expectOk(
      profileDataset({
        rowCount: 2,
        columns: [
          column({ sourceSchemaColumnId: "col-str", valueKind: "STRING", cells: [{ sourceRowNumber: 1, normalizedValue: SECRET_STRING }] }),
          column({ sourceSchemaColumnId: "col-id", valueKind: "IDENTIFIER", cells: [{ sourceRowNumber: 1, normalizedValue: SECRET_IDENTIFIER }] }),
          column({ sourceSchemaColumnId: "col-num", valueKind: "DECIMAL", cells: [{ sourceRowNumber: 1, normalizedValue: "42.5" }] }),
          column({ sourceSchemaColumnId: "col-date", valueKind: "DATE", cells: [{ sourceRowNumber: 1, normalizedValue: "2024-01-01" }] }),
          column({ sourceSchemaColumnId: "col-bool", valueKind: "BOOLEAN", cells: [{ sourceRowNumber: 1, normalizedValue: true }] }),
        ],
      })
    );
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain(SECRET_STRING);
    expect(serialized).not.toContain(SECRET_IDENTIFIER);
    expect(serialized).not.toContain(FAKE_TOKEN);
    expect(serialized).not.toMatch(/executionToken|execution_token/i);
    // Only the 5 declared stable column ids are present as "ids" -- no
    // other internal/lineage identifier sneaks in.
    expect(serialized).not.toMatch(/organisationId|organisation_id|actorUserId|runId|rawStagingRunId/i);
  });

  it("no semantic claims are made anywhere in the output (D4D1A is structural-only)", () => {
    const profile = expectOk(
      profileDataset({
        rowCount: 1,
        columns: [column({ valueKind: "IDENTIFIER", cells: [{ sourceRowNumber: 1, normalizedValue: "X-1" }] })],
      })
    );
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toMatch(/semanticRole|vehicle|employee|customer|invoice|primaryKey|primary_key/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MUTATION-STYLE FAIL-LOUD ASSERTIONS
// (static containment checks in place of live mutation tooling, per the
// task's own allowance for a pure-library-only phase)
// ═══════════════════════════════════════════════════════════════════════

describe("fail-loud: would a regression be caught", () => {
  it("a column reorder bug would be caught (order is asserted exactly, not as a set)", () => {
    const input: DatasetProfileInput = {
      rowCount: 1,
      columns: [
        column({ sourceSchemaColumnId: "first", cells: [{ sourceRowNumber: 1, normalizedValue: "1" }] }),
        column({ sourceSchemaColumnId: "second", cells: [{ sourceRowNumber: 1, normalizedValue: "2" }] }),
      ],
    };
    const profile = expectOk(profileDataset(input));
    const ids = profile.columns.map((c) => c.sourceSchemaColumnId);
    expect(ids).not.toEqual(["second", "first"]); // would fail if a sort crept in
    expect(ids).toEqual(["first", "second"]);
  });

  it("a Number()-based numeric comparison regression would be caught by the huge-value test above (re-asserted here for clarity)", () => {
    const a = "99999999999999999999999999999999999999999999999991";
    const b = "99999999999999999999999999999999999999999999999999";
    expect(Number(a) === Number(b)).toBe(true); // Number() cannot distinguish them
    const profile = expectOk(profileDataset({ rowCount: 2, columns: [column({ valueKind: "INTEGER", cells: [{ sourceRowNumber: 1, normalizedValue: a }, { sourceRowNumber: 2, normalizedValue: b }] })] }));
    expect(profile.columns[0].distinctNonNullCount).toBe(2); // the real profiler DOES distinguish them
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PURE BOUNDARY
// ═══════════════════════════════════════════════════════════════════════

describe("pure boundary — static containment", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const PROFILING_DIR = path.join(ROOT, "lib/data-hub/profiling");
  const FILES = fs.readdirSync(PROFILING_DIR).filter((f) => f.endsWith(".ts"));

  function read(file: string): string {
    return fs.readFileSync(path.join(PROFILING_DIR, file), "utf8");
  }
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("imports nothing from Prisma, lib/db, the filesystem, node:net/http/https, or child_process", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not import Prisma`).not.toMatch(/@prisma\/client|generated\/prisma/);
      expect(code, `${file} must not import lib\/db`).not.toMatch(/from ["']\.\.\/\.\.\/db["']|lib\/db/);
      expect(code, `${file} must not import node:fs`).not.toMatch(/from ["']node:fs["']|from ["']fs["']/);
      expect(code, `${file} must not import node:net`).not.toMatch(/from ["']node:net["']|from ["']net["']/);
      expect(code, `${file} must not import node:child_process`).not.toMatch(/child_process/);
      expect(code, `${file} must not import node:http/https`).not.toMatch(/from ["']node:https?["']|from ["']https?["']/);
    }
  });

  it("imports nothing from Next.js/server runtime, storage providers, the workbook parser, or network/fetch", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not import next/server`).not.toMatch(/next\/server/);
      expect(code, `${file} must not import a storage provider`).not.toMatch(/data-hub\/storage|@vercel\/blob/);
      expect(code, `${file} must not import the workbook parser`).not.toMatch(/workbookParser|xlsx/i);
      expect(code, `${file} must not call fetch(`).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("imports nothing AI/model-related", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not import an AI SDK`).not.toMatch(/@anthropic-ai|openai|anthropic/i);
    }
  });

  it("never calls Date.now(), Math.random(), or a random UUID generator — every computation is a deterministic function of its explicit input", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not call Date.now()`).not.toMatch(/Date\.now\s*\(/);
      expect(code, `${file} must not call Math.random()`).not.toMatch(/Math\.random\s*\(/);
      expect(code, `${file} must not call randomUUID()`).not.toMatch(/randomUUID/);
      expect(code, `${file} must not construct new Date()`).not.toMatch(/new Date\s*\(/);
    }
  });

  it("never reads process.env or calls console.*", () => {
    for (const file of FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} must not read process.env`).not.toMatch(/process\.env/);
      expect(code, `${file} must not call console.*`).not.toMatch(/console\./);
    }
  });

  it("every numeric comparison/aggregation goes through the exact-decimal module, never Number()/parseFloat on a governed value string", () => {
    const decimalSource = stripComments(read("profileColumn.ts"));
    expect(decimalSource).not.toMatch(/Number\(\s*(value|c\.normalizedValue|cell\.normalizedValue)/);
    expect(decimalSource).not.toMatch(/parseFloat\(/);
    expect(decimalSource).not.toMatch(/parseInt\(/);
  });

  it("exports the fixed, explicit DATASET_PROFILER_VERSION, not derived from package.json or the current date", () => {
    expect(DATASET_PROFILER_VERSION).toBe("v1");
    const contractsSource = stripComments(read("contracts.ts"));
    expect(contractsSource).not.toMatch(/require\(["']\.\.\/\.\.\/\.\.\/package\.json["']\)/);
    expect(contractsSource).not.toMatch(/new Date\(\)/);
  });
});
