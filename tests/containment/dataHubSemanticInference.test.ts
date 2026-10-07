import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import type { DatasetProfileInput, ProfileColumnInput } from "@/lib/data-hub/profiling/contracts";
import {
  SEMANTIC_INFERENCE_VERSION,
  inferDatasetSemantics,
} from "@/lib/data-hub/semanticInference";

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

function profile(input: DatasetProfileInput) {
  const result = profileDataset(input);
  if (!result.ok) throw new Error("expected profileDataset to succeed");
  return result.profile;
}

describe("D4D2A semantic inference foundation", () => {
  it("is deterministic and preserves governed column order", () => {
    const p = profile({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "z",
          valueKind: "BOOLEAN",
          cells: [
            { sourceRowNumber: 1, normalizedValue: true },
            { sourceRowNumber: 2, normalizedValue: false },
          ],
        }),
        column({
          sourceSchemaColumnId: "a",
          valueKind: "DATE",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "2026-01-01" },
            { sourceRowNumber: 2, normalizedValue: "2026-01-02" },
          ],
        }),
      ],
    });

    const first = inferDatasetSemantics(p);
    const second = inferDatasetSemantics(p);

    expect(first).toEqual(second);
    expect(first.inferenceVersion).toBe(SEMANTIC_INFERENCE_VERSION);
    expect(first.columns.map((c) => c.sourceSchemaColumnId)).toEqual(["z", "a"]);
    expect(first.columns[0].candidates[0]).toMatchObject({ role: "BOOLEAN_FLAG", confidence: "HIGH" });
    expect(first.columns[1].candidates[0]).toMatchObject({ role: "TEMPORAL", confidence: "HIGH" });
  });

  it("emits a cautious record-key candidate only for complete unique IDENTIFIER evidence", () => {
    const p = profile({
      rowCount: 3,
      columns: [
        column({
          valueKind: "IDENTIFIER",
          cells: [1, 2, 3].map((n) => ({ sourceRowNumber: n, normalizedValue: `ID-${n}` })),
        }),
      ],
    });

    const inferred = inferDatasetSemantics(p).columns[0];
    expect(inferred.state).toBe("MULTIPLE_CANDIDATES");
    expect(inferred.candidates).toEqual([
      expect.objectContaining({ role: "IDENTIFIER", confidence: "HIGH" }),
      expect.objectContaining({
        role: "RECORD_KEY",
        confidence: "MEDIUM",
        evidence: expect.arrayContaining(["COMPLETE", "UNIQUE_AMONG_NON_NULL"]),
      }),
    ]);
  });

  it("does not call a repeated textual column a key; it can only surface a categorical-dimension candidate", () => {
    const p = profile({
      rowCount: 4,
      columns: [
        column({
          valueKind: "STRING",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "A" },
            { sourceRowNumber: 2, normalizedValue: "B" },
            { sourceRowNumber: 3, normalizedValue: "A" },
            { sourceRowNumber: 4, normalizedValue: "B" },
          ],
        }),
      ],
    });

    const inferred = inferDatasetSemantics(p).columns[0];
    expect(inferred.candidates.map((c) => c.role)).toEqual(["TEXT", "CATEGORICAL_DIMENSION"]);
    expect(inferred.candidates).not.toEqual(expect.arrayContaining([expect.objectContaining({ role: "RECORD_KEY" })]));
  });

  it("raises measure confidence only when a governed unit is present", () => {
    const p = profile({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "unitless",
          valueKind: "DECIMAL",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "1.5" },
            { sourceRowNumber: 2, normalizedValue: "2.5" },
          ],
        }),
        column({
          sourceSchemaColumnId: "mass",
          valueKind: "DECIMAL",
          sourceUnit: "kg",
          normalizedUnit: "kg",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "1.5" },
            { sourceRowNumber: 2, normalizedValue: "2.5" },
          ],
        }),
      ],
    });

    const [unitless, mass] = inferDatasetSemantics(p).columns;
    expect(unitless.candidates[0]).toMatchObject({ role: "MEASURE", confidence: "MEDIUM" });
    expect(mass.candidates[0]).toMatchObject({ role: "MEASURE", confidence: "HIGH" });
    expect(mass.candidates[0].evidence).toContain("UNIT_PRESENT");
  });

  it("maps governed specialist kinds without inventing domain-specific meaning", () => {
    const cases = [
      ["DURATION", "DURATION"],
      ["PERCENTAGE", "PERCENTAGE"],
      ["CURRENCY", "CURRENCY"],
      ["LATITUDE", "GEO_LATITUDE"],
      ["LONGITUDE", "GEO_LONGITUDE"],
    ] as const;

    for (const [valueKind, role] of cases) {
      const unit = valueKind === "DURATION" ? "s" : valueKind === "PERCENTAGE" ? "%" : valueKind === "CURRENCY" ? "AUD" : null;
      const p = profile({
        rowCount: 1,
        columns: [
          column({
            valueKind,
            sourceUnit: unit,
            normalizedUnit: unit,
            cells: [{ sourceRowNumber: 1, normalizedValue: valueKind === "LATITUDE" ? "-34.9" : valueKind === "LONGITUDE" ? "138.6" : "1" }],
          }),
        ],
      });
      expect(inferDatasetSemantics(p).columns[0].candidates[0]).toMatchObject({ role, confidence: "HIGH" });
    }
  });

  it("makes all-null and zero-row caution signals explicit in evidence", () => {
    const allNull = profile({
      rowCount: 2,
      columns: [
        column({
          valueKind: "STRING",
          cells: [
            { sourceRowNumber: 1, normalizedValue: null },
            { sourceRowNumber: 2, normalizedValue: null },
          ],
        }),
      ],
    });
    expect(inferDatasetSemantics(allNull).columns[0].candidates[0].evidence).toContain("ALL_NULL");

    const zeroRows = profile({ rowCount: 0, columns: [column({ valueKind: "BOOLEAN" })] });
    expect(inferDatasetSemantics(zeroRows).columns[0].candidates[0].evidence).toEqual(
      expect.arrayContaining(["ZERO_ROWS", "COMPLETE"]),
    );
  });

  it("never re-emits source values from the profile boundary", () => {
    const secret = "SENSITIVE-EXAMPLE-123";
    const p = profile({
      rowCount: 1,
      columns: [
        column({
          valueKind: "STRING",
          cells: [{ sourceRowNumber: 1, normalizedValue: secret }],
        }),
      ],
    });

    const serialized = JSON.stringify(inferDatasetSemantics(p));
    expect(serialized).not.toContain(secret);
  });

  it("keeps the semantic-inference library pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "semanticInference");
    const source = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n");

    for (const forbidden of [
      "@prisma",
      "lib/db",
      "lib/prisma",
      "node:fs",
      "node:path",
      "fetch(",
      "axios",
      "openai",
      "anthropic",
      "Date.now",
      "Math.random",
      "process.env",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
