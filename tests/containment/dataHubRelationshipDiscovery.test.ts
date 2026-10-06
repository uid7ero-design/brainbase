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
import {
  discoverRelationshipCandidates,
  type RelationshipDatasetInput,
} from "@/lib/data-hub/relationshipDiscovery";

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

function schema(
  input: DatasetProfileInput,
  choices: Parameters<typeof resolveDatasetSemantics>[1] = [],
) {
  const profiled = profileDataset(input);
  if (!profiled.ok) throw new Error("expected profileDataset to succeed");

  const inferred = inferDatasetSemantics(profiled.profile);
  const resolved = resolveDatasetSemantics(inferred, choices);
  if (!resolved.ok) throw new Error(resolved.code);

  return synthesizeSemanticDatasetSchema(resolved.resolved);
}

function dataset(
  datasetId: string,
  sourceSchemaColumnId: string,
  governedLabel: string,
  recordKey: boolean,
): RelationshipDatasetInput {
  const semanticSchema = schema(
    {
      rowCount: 2,
      columns: [
        column({
          sourceSchemaColumnId,
          valueKind: "IDENTIFIER",
          cells: [
            { sourceRowNumber: 1, normalizedValue: `${datasetId}-1` },
            { sourceRowNumber: 2, normalizedValue: `${datasetId}-2` },
          ],
        }),
      ],
    },
    [
      {
        sourceSchemaColumnId,
        role: recordKey ? "RECORD_KEY" : "IDENTIFIER",
      },
    ],
  );

  return {
    datasetId,
    schema: semanticSchema,
    columns: [{ sourceSchemaColumnId, governedLabel }],
  };
}

describe("D4D3A relationship candidate discovery", () => {
  it("emits a cautious candidate for exact governed-label match with one record-key candidate", () => {
    const result = discoverRelationshipCandidates([
      dataset("left", "left-id", "Asset ID", true),
      dataset("right", "right-id", "Asset ID", false),
    ]);

    expect(result).toEqual({
      ok: true,
      result: {
        discoveryVersion: "v1",
        state: "ONE",
        candidates: [
          {
            kind: "POTENTIAL_IDENTIFIER_JOIN",
            left: {
              datasetId: "left",
              sourceSchemaColumnId: "left-id",
            },
            right: {
              datasetId: "right",
              sourceSchemaColumnId: "right-id",
            },
            confidence: "MEDIUM",
            evidence: [
              "EXACT_GOVERNED_LABEL_MATCH",
              "LEFT_IDENTIFIER_CLASS",
              "RIGHT_IDENTIFIER_CLASS",
              "LEFT_RECORD_KEY_CANDIDATE",
            ],
          },
        ],
      },
    });
  });

  it("canonicalizes governed labels without echoing them", () => {
    const result = discoverRelationshipCandidates([
      dataset("a", "a-id", "  Asset   ID ", true),
      dataset("b", "b-id", "asset id", false),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.result.state).toBe("ONE");
    expect(JSON.stringify(result)).not.toContain("Asset ID");
    expect(JSON.stringify(result)).not.toContain("asset id");
  });

  it("does not infer a relationship between two ordinary identifiers without a record-key candidate", () => {
    const result = discoverRelationshipCandidates([
      dataset("a", "a-id", "Asset ID", false),
      dataset("b", "b-id", "Asset ID", false),
    ]);

    expect(result).toEqual({
      ok: true,
      result: {
        discoveryVersion: "v1",
        state: "NONE",
        candidates: [],
      },
    });
  });

  it("does not infer a relationship when governed labels differ", () => {
    const result = discoverRelationshipCandidates([
      dataset("a", "a-id", "Asset ID", true),
      dataset("b", "b-id", "Vehicle ID", false),
    ]);

    expect(result).toMatchObject({
      ok: true,
      result: { state: "NONE", candidates: [] },
    });
  });

  it("preserves deterministic dataset and field traversal order for multiple candidates", () => {
    const result = discoverRelationshipCandidates([
      dataset("first", "first-id", "Asset ID", true),
      dataset("second", "second-id", "Asset ID", false),
      dataset("third", "third-id", "Asset ID", false),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.result.state).toBe("MULTIPLE");
    expect(
      result.result.candidates.map((candidate) => [
        candidate.left.datasetId,
        candidate.right.datasetId,
      ]),
    ).toEqual([
      ["first", "second"],
      ["first", "third"],
    ]);
  });

  it("fails closed on duplicate, unknown, missing and empty metadata", () => {
    const base = dataset("a", "a-id", "Asset ID", true);

    expect(
      discoverRelationshipCandidates([base, { ...base }]),
    ).toMatchObject({ ok: false, code: "DUPLICATE_DATASET_ID" });

    expect(
      discoverRelationshipCandidates([
        {
          ...base,
          columns: [
            { sourceSchemaColumnId: "a-id", governedLabel: "Asset ID" },
            { sourceSchemaColumnId: "a-id", governedLabel: "Asset ID" },
          ],
        },
      ]),
    ).toMatchObject({ ok: false, code: "DUPLICATE_COLUMN_METADATA" });

    expect(
      discoverRelationshipCandidates([
        {
          ...base,
          columns: [
            { sourceSchemaColumnId: "missing", governedLabel: "Asset ID" },
          ],
        },
      ]),
    ).toMatchObject({ ok: false, code: "UNKNOWN_COLUMN_METADATA" });

    expect(
      discoverRelationshipCandidates([{ ...base, columns: [] }]),
    ).toMatchObject({ ok: false, code: "MISSING_COLUMN_METADATA" });

    expect(
      discoverRelationshipCandidates([
        {
          ...base,
          columns: [{ sourceSchemaColumnId: "a-id", governedLabel: "   " }],
        },
      ]),
    ).toMatchObject({ ok: false, code: "EMPTY_GOVERNED_LABEL" });
  });

  it("never exposes governed labels or source values in candidate output", () => {
    const secretLabel = "Highly Sensitive Internal Key";
    const result = discoverRelationshipCandidates([
      dataset("a", "a-id", secretLabel, true),
      dataset("b", "b-id", secretLabel, false),
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretLabel);
    expect(serialized).not.toContain("a-1");
    expect(serialized).not.toContain("b-1");
  });

  it("keeps relationship discovery pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "relationshipDiscovery");
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
