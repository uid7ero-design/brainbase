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

function resolve(
  input: DatasetProfileInput,
  choices: Parameters<typeof resolveDatasetSemantics>[1] = [],
) {
  const profiled = profileDataset(input);
  if (!profiled.ok) throw new Error("expected profileDataset to succeed");

  const inferred = inferDatasetSemantics(profiled.profile);
  const resolved = resolveDatasetSemantics(inferred, choices);
  if (!resolved.ok) throw new Error(resolved.code);
  return resolved.resolved;
}

describe("D4D2D semantic schema synthesis", () => {
  it("maps resolved semantic roles to closed generic field classes", () => {
    const resolved = resolve(
      {
        rowCount: 2,
        columns: [
          column({
            sourceSchemaColumnId: "text",
            valueKind: "STRING",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "A" },
              { sourceRowNumber: 2, normalizedValue: "B" },
            ],
          }),
          column({
            sourceSchemaColumnId: "flag",
            valueKind: "BOOLEAN",
            cells: [
              { sourceRowNumber: 1, normalizedValue: true },
              { sourceRowNumber: 2, normalizedValue: false },
            ],
          }),
          column({
            sourceSchemaColumnId: "money",
            valueKind: "CURRENCY",
            sourceUnit: "AUD",
            normalizedUnit: "AUD",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "1" },
              { sourceRowNumber: 2, normalizedValue: "2" },
            ],
          }),
          column({
            sourceSchemaColumnId: "when",
            valueKind: "DATE",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "2026-01-01" },
              { sourceRowNumber: 2, normalizedValue: "2026-01-02" },
            ],
          }),
          column({
            sourceSchemaColumnId: "lat",
            valueKind: "LATITUDE",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "-34.9" },
              { sourceRowNumber: 2, normalizedValue: "-35" },
            ],
          }),
        ],
      },
    );

    const draft = synthesizeSemanticDatasetSchema(resolved);

    expect(draft.fields.map((field) => field.fieldClass)).toEqual([
      "TEXT_ATTRIBUTE",
      "FLAG",
      "MEASURE",
      "TEMPORAL",
      "GEO_COORDINATE",
    ]);
  });

  it("keeps specialized roles visible rather than collapsing their semantics", () => {
    const resolved = resolve({
      rowCount: 1,
      columns: [
        column({
          sourceSchemaColumnId: "pct",
          valueKind: "PERCENTAGE",
          sourceUnit: "%",
          normalizedUnit: "%",
          cells: [{ sourceRowNumber: 1, normalizedValue: "10" }],
        }),
      ],
    });

    expect(synthesizeSemanticDatasetSchema(resolved).fields[0]).toMatchObject({
      semanticRole: "PERCENTAGE",
      fieldClass: "MEASURE",
    });
  });

  it("marks RECORD_KEY only as a candidate, never as a declared primary key", () => {
    const resolved = resolve(
      {
        rowCount: 2,
        columns: [
          column({
            valueKind: "IDENTIFIER",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "A" },
              { sourceRowNumber: 2, normalizedValue: "B" },
            ],
          }),
        ],
      },
      [{ sourceSchemaColumnId: "col-1", role: "RECORD_KEY" }],
    );

    const draft = synthesizeSemanticDatasetSchema(resolved);
    expect(draft.recordKeyCandidateState).toBe("ONE");
    expect(draft.fields[0]).toMatchObject({
      semanticRole: "RECORD_KEY",
      fieldClass: "IDENTIFIER",
      recordKeyCandidate: true,
    });
    expect(JSON.stringify(draft).toLowerCase()).not.toContain("primarykey");
  });

  it("reports multiple record-key candidates without choosing between them", () => {
    const resolved = resolve(
      {
        rowCount: 2,
        columns: [
          column({
            sourceSchemaColumnId: "a",
            valueKind: "IDENTIFIER",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "A1" },
              { sourceRowNumber: 2, normalizedValue: "A2" },
            ],
          }),
          column({
            sourceSchemaColumnId: "b",
            valueKind: "IDENTIFIER",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "B1" },
              { sourceRowNumber: 2, normalizedValue: "B2" },
            ],
          }),
        ],
      },
      [
        { sourceSchemaColumnId: "a", role: "RECORD_KEY" },
        { sourceSchemaColumnId: "b", role: "RECORD_KEY" },
      ],
    );

    const draft = synthesizeSemanticDatasetSchema(resolved);
    expect(draft.recordKeyCandidateState).toBe("MULTIPLE");
    expect(draft.fields.filter((field) => field.recordKeyCandidate)).toHaveLength(2);
  });

  it("preserves governed field order and resolution provenance", () => {
    const resolved = resolve(
      {
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
      },
      [{ sourceSchemaColumnId: "zeta", role: "MEASURE" }],
    );

    const draft = synthesizeSemanticDatasetSchema(resolved);
    expect(draft.fields.map((field) => field.sourceSchemaColumnId)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect(draft.fields.map((field) => field.resolutionSource)).toEqual([
      "CLARIFIED_CHOICE",
      "AUTO_HIGH_CONFIDENCE",
    ]);
  });

  it("preserves confidence and machine-readable evidence exactly", () => {
    const resolved = resolve(
      {
        rowCount: 2,
        columns: [
          column({
            valueKind: "DECIMAL",
            cells: [
              { sourceRowNumber: 1, normalizedValue: "1" },
              { sourceRowNumber: 2, normalizedValue: "2" },
            ],
          }),
        ],
      },
      [{ sourceSchemaColumnId: "col-1", role: "MEASURE" }],
    );

    const draft = synthesizeSemanticDatasetSchema(resolved);
    expect(draft.fields[0].confidence).toBe(resolved.columns[0].confidence);
    expect(draft.fields[0].evidence).toEqual(resolved.columns[0].evidence);
  });

  it("is deterministic and never contains source values", () => {
    const resolved = resolve(
      {
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
      },
      [{ sourceSchemaColumnId: "col-1", role: "CATEGORICAL_DIMENSION" }],
    );

    const first = synthesizeSemanticDatasetSchema(resolved);
    const second = synthesizeSemanticDatasetSchema(resolved);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("Secret A");
    expect(JSON.stringify(first)).not.toContain("Secret B");
  });

  it("keeps schema synthesis pure and dependency-bounded", () => {
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
