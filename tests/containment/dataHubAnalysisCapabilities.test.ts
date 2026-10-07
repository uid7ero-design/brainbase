import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAnalysisCapabilities,
  type AnalysisReadiness,
} from "@/lib/data-hub/analysis";

function readiness(
  overrides: Partial<AnalysisReadiness> = {},
): AnalysisReadiness {
  return {
    readinessVersion: "v1",
    schemaVersion: "v1",
    profilerVersion: "v1",
    qualityResolutionVersion: "v1",
    state: "READY",
    fieldCount: 0,
    catalog: {
      textAttributes: [],
      identifiers: [],
      dimensions: [],
      flags: [],
      measures: [],
      temporals: [],
      geoCoordinates: [],
    },
    ...overrides,
  };
}

describe("D4D5B analysis capabilities", () => {
  it("exposes ROW_COUNT for a ready dataset", () => {
    expect(buildAnalysisCapabilities(readiness())).toEqual({
      capabilityVersion: "v1",
      readinessVersion: "v1",
      state: "AVAILABLE",
      datasetCapabilities: ["ROW_COUNT"],
      fieldCapabilities: [],
    });
  });

  it("blocks all capabilities while quality is on hold", () => {
    expect(
      buildAnalysisCapabilities(
        readiness({ state: "BLOCKED_QUALITY_HOLD" }),
      ),
    ).toEqual({
      capabilityVersion: "v1",
      readinessVersion: "v1",
      state: "BLOCKED_QUALITY_HOLD",
      datasetCapabilities: [],
      fieldCapabilities: [],
    });
  });

  it("keeps acknowledged-notice readiness available", () => {
    expect(
      buildAnalysisCapabilities(
        readiness({ state: "READY_WITH_ACKNOWLEDGED_NOTICES" }),
      ),
    ).toMatchObject({
      state: "AVAILABLE",
      datasetCapabilities: ["ROW_COUNT"],
    });
  });

  it("maps generic catalog classes to closed field capabilities", () => {
    const result = buildAnalysisCapabilities(
      readiness({
        fieldCount: 7,
        catalog: {
          textAttributes: ["text"],
          identifiers: ["id"],
          dimensions: ["dim"],
          flags: ["flag"],
          measures: ["measure"],
          temporals: ["time"],
          geoCoordinates: ["geo"],
        },
      }),
    );

    expect(result.fieldCapabilities).toEqual([
      { sourceSchemaColumnId: "text", capability: "TEXT_REFERENCE" },
      { sourceSchemaColumnId: "id", capability: "IDENTIFIER_REFERENCE" },
      { sourceSchemaColumnId: "dim", capability: "GROUP_BY" },
      { sourceSchemaColumnId: "flag", capability: "GROUP_BY" },
      { sourceSchemaColumnId: "measure", capability: "AGGREGATE" },
      { sourceSchemaColumnId: "time", capability: "TIME_AXIS" },
      { sourceSchemaColumnId: "geo", capability: "GEO_AXIS" },
    ]);
  });

  it("does not claim free-text or identifiers are groupable", () => {
    const result = buildAnalysisCapabilities(
      readiness({
        fieldCount: 2,
        catalog: {
          textAttributes: ["text"],
          identifiers: ["id"],
          dimensions: [],
          flags: [],
          measures: [],
          temporals: [],
          geoCoordinates: [],
        },
      }),
    );

    expect(result.fieldCapabilities).toEqual([
      { sourceSchemaColumnId: "text", capability: "TEXT_REFERENCE" },
      { sourceSchemaColumnId: "id", capability: "IDENTIFIER_REFERENCE" },
    ]);
    expect(result.fieldCapabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "GROUP_BY" }),
      ]),
    );
  });

  it("preserves governed order within each readiness catalog class", () => {
    const result = buildAnalysisCapabilities(
      readiness({
        fieldCount: 4,
        catalog: {
          textAttributes: [],
          identifiers: [],
          dimensions: ["z", "a"],
          flags: [],
          measures: ["m2", "m1"],
          temporals: [],
          geoCoordinates: [],
        },
      }),
    );

    expect(result.fieldCapabilities).toEqual([
      { sourceSchemaColumnId: "z", capability: "GROUP_BY" },
      { sourceSchemaColumnId: "a", capability: "GROUP_BY" },
      { sourceSchemaColumnId: "m2", capability: "AGGREGATE" },
      { sourceSchemaColumnId: "m1", capability: "AGGREGATE" },
    ]);
  });

  it("is deterministic and carries no source values or free-form rationale", () => {
    const input = readiness({
      fieldCount: 1,
      catalog: {
        textAttributes: [],
        identifiers: [],
        dimensions: ["category-id"],
        flags: [],
        measures: [],
        temporals: [],
        geoCoordinates: [],
      },
    });

    const first = buildAnalysisCapabilities(input);
    const second = buildAnalysisCapabilities(input);

    expect(first).toEqual(second);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("value");
  });

  it("keeps capability derivation pure and dependency-bounded", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "analysis");
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
