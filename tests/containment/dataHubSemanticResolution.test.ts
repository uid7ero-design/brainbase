import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import type {
  DatasetProfileInput,
  ProfileColumnInput,
} from "@/lib/data-hub/profiling/contracts";
import {
  inferDatasetSemantics,
  resolveDatasetSemantics,
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

describe("D4D2C semantic resolution", () => {
  it("auto-resolves a single HIGH-confidence candidate", () => {
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

    expect(resolveDatasetSemantics(inference)).toEqual({
      ok: true,
      resolved: {
        resolutionVersion: "v1",
        inferenceVersion: "v1",
        profilerVersion: "v1",
        columns: [
          expect.objectContaining({
            sourceSchemaColumnId: "col-1",
            role: "BOOLEAN_FLAG",
            confidence: "HIGH",
            resolutionSource: "AUTO_HIGH_CONFIDENCE",
          }),
        ],
      },
    });
  });

  it("requires an explicit choice for multiple candidates", () => {
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

    expect(resolveDatasetSemantics(inference)).toEqual({
      ok: false,
      code: "CHOICE_REQUIRED",
      sourceSchemaColumnId: "col-1",
    });

    expect(
      resolveDatasetSemantics(inference, [
        { sourceSchemaColumnId: "col-1", role: "RECORD_KEY" },
      ]),
    ).toEqual({
      ok: true,
      resolved: expect.objectContaining({
        columns: [
          expect.objectContaining({
            role: "RECORD_KEY",
            confidence: "MEDIUM",
            resolutionSource: "CLARIFIED_CHOICE",
          }),
        ],
      }),
    });
  });

  it("requires an explicit choice for a single MEDIUM-confidence candidate", () => {
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

    expect(resolveDatasetSemantics(inference)).toMatchObject({
      ok: false,
      code: "CHOICE_REQUIRED",
    });

    expect(
      resolveDatasetSemantics(inference, [
        { sourceSchemaColumnId: "col-1", role: "MEASURE" },
      ]),
    ).toMatchObject({
      ok: true,
      resolved: {
        columns: [
          {
            role: "MEASURE",
            confidence: "MEDIUM",
            resolutionSource: "CLARIFIED_CHOICE",
          },
        ],
      },
    });
  });

  it("rejects a role that was never an inference candidate", () => {
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

    expect(
      resolveDatasetSemantics(inference, [
        { sourceSchemaColumnId: "col-1", role: "CURRENCY" },
      ]),
    ).toEqual({
      ok: false,
      code: "ROLE_NOT_CANDIDATE",
      sourceSchemaColumnId: "col-1",
    });
  });

  it("rejects choices for unknown columns, duplicates, and auto-resolved columns", () => {
    const auto = infer({
      rowCount: 1,
      columns: [
        column({
          valueKind: "BOOLEAN",
          cells: [{ sourceRowNumber: 1, normalizedValue: true }],
        }),
      ],
    });

    expect(
      resolveDatasetSemantics(auto, [
        { sourceSchemaColumnId: "missing", role: "BOOLEAN_FLAG" },
      ]),
    ).toMatchObject({ ok: false, code: "UNKNOWN_COLUMN" });

    expect(
      resolveDatasetSemantics(auto, [
        { sourceSchemaColumnId: "col-1", role: "BOOLEAN_FLAG" },
        { sourceSchemaColumnId: "col-1", role: "BOOLEAN_FLAG" },
      ]),
    ).toMatchObject({ ok: false, code: "DUPLICATE_CHOICE" });

    expect(
      resolveDatasetSemantics(auto, [
        { sourceSchemaColumnId: "col-1", role: "BOOLEAN_FLAG" },
      ]),
    ).toMatchObject({
      ok: false,
      code: "CHOICE_NOT_ALLOWED_FOR_AUTO_RESOLVED_COLUMN",
    });
  });

  it("preserves governed column order and each selected candidate's evidence", () => {
    const inference = infer({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "zeta",
          valueKind: "DECIMAL",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "1" },
            { sourceRowNumber: 2, normalizedValue: "2" },
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

    const result = resolveDatasetSemantics(inference, [
      { sourceSchemaColumnId: "zeta", role: "MEASURE" },
    ]);
    if (!result.ok) throw new Error(result.code);

    expect(result.resolved.columns.map((c) => c.sourceSchemaColumnId)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(result.resolved.columns[0].evidence).toContain("VALUE_KIND_DECIMAL");
    expect(result.resolved.columns[1].evidence).toContain("VALUE_KIND_BOOLEAN");
  });

  it("is deterministic and does not invent free-form rationale", () => {
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

    const choices = [
      { sourceSchemaColumnId: "col-1", role: "CATEGORICAL_DIMENSION" as const },
    ];
    const first = resolveDatasetSemantics(inference, choices);
    const second = resolveDatasetSemantics(inference, choices);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("Secret A");
    expect(JSON.stringify(first)).not.toContain("Secret B");
  });

  it("keeps semantic resolution pure and dependency-bounded", () => {
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
