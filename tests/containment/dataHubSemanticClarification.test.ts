import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import type {
  DatasetProfileInput,
  ProfileColumnInput,
} from "@/lib/data-hub/profiling/contracts";
import {
  buildDatasetSemanticClarificationPlan,
  inferDatasetSemantics,
} from "@/lib/data-hub/semanticInference";

function column(
  overrides: Partial<ProfileColumnInput>,
): ProfileColumnInput {
  return {
    sourceSchemaColumnId: "col-1",
    valueKind: "STRING",
    sourceUnit: null,
    normalizedUnit: null,
    cells: [],
    ...overrides,
  };
}

function infer(input: DatasetProfileInput) {
  const profiled = profileDataset(input);
  if (!profiled.ok) throw new Error("expected profileDataset to succeed");
  return inferDatasetSemantics(profiled.profile);
}

describe("D4D2B semantic clarification planning", () => {
  it("resolves a single HIGH-confidence direct role without clarification", () => {
    const inference = infer({
      rowCount: 2,
      columns: [
        column({
          valueKind: "BOOLEAN",
          cells: [
            { sourceRowNumber: 1, normalizedValue: true },
            { sourceRowNumber: 2, normalizedValue: false },
          ],
        }),
      ],
    });

    expect(buildDatasetSemanticClarificationPlan(inference)).toMatchObject({
      clarificationVersion: "v1",
      requiresClarification: false,
      columns: [
        {
          resolutionState: "RESOLVED",
          candidateRoles: ["BOOLEAN_FLAG"],
          highestConfidence: "HIGH",
          reasons: [],
        },
      ],
    });
  });

  it("requires clarification when multiple candidates remain plausible", () => {
    const inference = infer({
      rowCount: 3,
      columns: [
        column({
          valueKind: "IDENTIFIER",
          cells: [1, 2, 3].map((n) => ({
            sourceRowNumber: n,
            normalizedValue: `ID-${n}`,
          })),
        }),
      ],
    });

    const plan = buildDatasetSemanticClarificationPlan(inference);

    expect(plan.requiresClarification).toBe(true);
    expect(plan.columns[0]).toEqual({
      sourceSchemaColumnId: "col-1",
      resolutionState: "CLARIFICATION_REQUIRED",
      candidateRoles: ["IDENTIFIER", "RECORD_KEY"],
      highestConfidence: "HIGH",
      reasons: ["MULTIPLE_CANDIDATES"],
    });
  });

  it("requires clarification for a single MEDIUM-confidence unitless measure", () => {
    const inference = infer({
      rowCount: 2,
      columns: [
        column({
          valueKind: "DECIMAL",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "1.5" },
            { sourceRowNumber: 2, normalizedValue: "2.5" },
          ],
        }),
      ],
    });

    expect(buildDatasetSemanticClarificationPlan(inference).columns[0]).toMatchObject({
      resolutionState: "CLARIFICATION_REQUIRED",
      candidateRoles: ["MEASURE"],
      highestConfidence: "MEDIUM",
      reasons: ["NON_HIGH_CONFIDENCE"],
    });
  });

  it("surfaces all-null evidence as a clarification reason", () => {
    const inference = infer({
      rowCount: 2,
      columns: [
        column({
          valueKind: "DATE",
          cells: [
            { sourceRowNumber: 1, normalizedValue: null },
            { sourceRowNumber: 2, normalizedValue: null },
          ],
        }),
      ],
    });

    expect(buildDatasetSemanticClarificationPlan(inference).columns[0]).toMatchObject({
      resolutionState: "CLARIFICATION_REQUIRED",
      highestConfidence: "MEDIUM",
      reasons: ["NON_HIGH_CONFIDENCE", "ALL_NULL_EVIDENCE"],
    });
  });

  it("surfaces zero-row evidence as a clarification reason", () => {
    const inference = infer({
      rowCount: 0,
      columns: [column({ valueKind: "CURRENCY", sourceUnit: "AUD", normalizedUnit: "AUD" })],
    });

    expect(buildDatasetSemanticClarificationPlan(inference).columns[0]).toMatchObject({
      resolutionState: "CLARIFICATION_REQUIRED",
      highestConfidence: "MEDIUM",
      reasons: ["NON_HIGH_CONFIDENCE", "ZERO_ROWS_EVIDENCE"],
    });
  });

  it("preserves governed column order and candidate order", () => {
    const inference = infer({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "zeta",
          valueKind: "STRING",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "A" },
            { sourceRowNumber: 2, normalizedValue: "B" },
          ],
        }),
        column({
          sourceSchemaColumnId: "alpha",
          valueKind: "BOOLEAN",
          cells: [
            { sourceRowNumber: 1, normalizedValue: true },
            { sourceRowNumber: 2, normalizedValue: false },
          ],
        }),
      ],
    });

    expect(
      buildDatasetSemanticClarificationPlan(inference).columns.map((c) => c.sourceSchemaColumnId),
    ).toEqual(["zeta", "alpha"]);
  });

  it("is deterministic and contains no free-form source-derived text", () => {
    const inference = infer({
      rowCount: 3,
      columns: [
        column({
          valueKind: "STRING",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "Secret A" },
            { sourceRowNumber: 2, normalizedValue: "Secret B" },
            { sourceRowNumber: 3, normalizedValue: "Secret A" },
          ],
        }),
      ],
    });

    const first = buildDatasetSemanticClarificationPlan(inference);
    const second = buildDatasetSemanticClarificationPlan(inference);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("Secret A");
    expect(JSON.stringify(first)).not.toContain("Secret B");
  });

  it("keeps clarification planning pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "semanticInference");
    const source = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n")
      .toLowerCase();

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
      "date.now",
      "math.random",
      "process.env",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
