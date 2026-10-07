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
  synthesizeSemanticDatasetSchema,
} from "@/lib/data-hub/semanticInference";
import { assessDataQuality } from "@/lib/data-hub/dataQuality";

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

function profiled(input: DatasetProfileInput) {
  const result = profileDataset(input);
  if (!result.ok) throw new Error("expected profileDataset to succeed");
  return result.profile;
}

function schema(
  profile: ReturnType<typeof profiled>,
  choices: Parameters<typeof resolveDatasetSemantics>[1] = [],
) {
  const inferred = inferDatasetSemantics(profile);
  const resolved = resolveDatasetSemantics(inferred, choices);
  if (!resolved.ok) throw new Error(resolved.code);
  return synthesizeSemanticDatasetSchema(resolved.resolved);
}

describe("D4D4A pure data-quality observations", () => {
  it("returns CLEAN when no structural observations are present", () => {
    const profile = profiled({
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

    expect(assessDataQuality(profile, schema(profile))).toEqual({
      ok: true,
      assessment: {
        qualityVersion: "v1",
        profilerVersion: "v1",
        schemaVersion: "v1",
        status: "CLEAN",
        observations: [],
      },
    });
  });

  it("surfaces empty-dataset and no-column observations without inventing a score", () => {
    const profile = profiled({ rowCount: 0, columns: [] });

    const result = assessDataQuality(profile, schema(profile));
    expect(result).toEqual({
      ok: true,
      assessment: {
        qualityVersion: "v1",
        profilerVersion: "v1",
        schemaVersion: "v1",
        status: "REVIEW_REQUIRED",
        observations: [
          {
            code: "EMPTY_DATASET",
            severity: "REVIEW_REQUIRED",
            scope: "DATASET",
          },
          {
            code: "NO_COLUMNS",
            severity: "REVIEW_REQUIRED",
            scope: "DATASET",
          },
        ],
      },
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("score");
  });

  it("distinguishes all-null, partially-null and constant structural observations", () => {
    const profile = profiled({
      rowCount: 3,
      columns: [
        column({
          sourceSchemaColumnId: "all-null",
          cells: [1, 2, 3].map((n) => ({
            sourceRowNumber: n,
            normalizedValue: null,
          })),
        }),
        column({
          sourceSchemaColumnId: "partial",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "A" },
            { sourceRowNumber: 2, normalizedValue: null },
            { sourceRowNumber: 3, normalizedValue: "B" },
          ],
        }),
        column({
          sourceSchemaColumnId: "constant",
          cells: [1, 2, 3].map((n) => ({
            sourceRowNumber: n,
            normalizedValue: "same",
          })),
        }),
      ],
    });

    const result = assessDataQuality(
      profile,
      schema(profile, [
        { sourceSchemaColumnId: "all-null", role: "TEXT" },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.assessment.status).toBe("REVIEW_REQUIRED");
    expect(result.assessment.observations).toEqual([
      {
        code: "COLUMN_ALL_NULL",
        severity: "REVIEW_REQUIRED",
        scope: "COLUMN",
        sourceSchemaColumnId: "all-null",
      },
      {
        code: "COLUMN_PARTIALLY_NULL",
        severity: "NOTICE",
        scope: "COLUMN",
        sourceSchemaColumnId: "partial",
      },
      {
        code: "COLUMN_CONSTANT",
        severity: "NOTICE",
        scope: "COLUMN",
        sourceSchemaColumnId: "constant",
      },
    ]);
  });

  it("marks multiple record-key candidates for review without choosing one", () => {
    const profile = profiled({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "key-a",
          valueKind: "IDENTIFIER",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "A1" },
            { sourceRowNumber: 2, normalizedValue: "A2" },
          ],
        }),
        column({
          sourceSchemaColumnId: "key-b",
          valueKind: "IDENTIFIER",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "B1" },
            { sourceRowNumber: 2, normalizedValue: "B2" },
          ],
        }),
      ],
    });

    const result = assessDataQuality(
      profile,
      schema(profile, [
        { sourceSchemaColumnId: "key-a", role: "RECORD_KEY" },
        { sourceSchemaColumnId: "key-b", role: "RECORD_KEY" },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.assessment.observations[0]).toEqual({
      code: "MULTIPLE_RECORD_KEY_CANDIDATES",
      severity: "REVIEW_REQUIRED",
      scope: "DATASET",
    });
  });

  it("defensively flags invalid record-key structural evidence", () => {
    const profile = profiled({
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId: "id",
          valueKind: "IDENTIFIER",
          cells: [
            { sourceRowNumber: 1, normalizedValue: "A" },
            { sourceRowNumber: 2, normalizedValue: "A" },
          ],
        }),
      ],
    });

    const draft = schema(profile);
    draft.fields[0] = {
      ...draft.fields[0],
      semanticRole: "RECORD_KEY",
      fieldClass: "IDENTIFIER",
      recordKeyCandidate: true,
    };
    draft.recordKeyCandidateState = "ONE";

    const result = assessDataQuality(profile, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.assessment.observations).toEqual([
      {
        code: "COLUMN_CONSTANT",
        severity: "NOTICE",
        scope: "COLUMN",
        sourceSchemaColumnId: "id",
      },
      {
        code: "RECORD_KEY_CANDIDATE_NOT_UNIQUE",
        severity: "REVIEW_REQUIRED",
        scope: "COLUMN",
        sourceSchemaColumnId: "id",
      },
    ]);
  });

  it("fails closed when profile and semantic-schema lineage do not align", () => {
    const profile = profiled({
      rowCount: 1,
      columns: [
        column({
          sourceSchemaColumnId: "a",
          valueKind: "BOOLEAN",
          cells: [{ sourceRowNumber: 1, normalizedValue: true }],
        }),
      ],
    });
    const draft = schema(profile);
    draft.fields[0] = {
      ...draft.fields[0],
      sourceSchemaColumnId: "other",
    };

    expect(assessDataQuality(profile, draft)).toEqual({
      ok: false,
      code: "PROFILE_SCHEMA_LINEAGE_MISMATCH",
    });
  });

  it("is deterministic and does not expose source values", () => {
    const secret = "SECRET-QUALITY-VALUE";
    const profile = profiled({
      rowCount: 2,
      columns: [
        column({
          cells: [
            { sourceRowNumber: 1, normalizedValue: secret },
            { sourceRowNumber: 2, normalizedValue: null },
          ],
        }),
      ],
    });
    const draft = schema(profile);

    const first = assessDataQuality(profile, draft);
    const second = assessDataQuality(profile, draft);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(secret);
  });

  it("keeps the data-quality layer pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "dataQuality");
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
