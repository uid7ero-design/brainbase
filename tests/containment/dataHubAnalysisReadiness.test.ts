import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAnalysisReadiness,
} from "@/lib/data-hub/analysis";
import type {
  SemanticDatasetSchemaDraft,
  SemanticSchemaFieldDraft,
} from "@/lib/data-hub/semanticInference/schemaSynthesis";
import type {
  DataQualityReviewResolution,
} from "@/lib/data-hub/dataQuality/reviewResolution";

function field(
  sourceSchemaColumnId: string,
  fieldClass: SemanticSchemaFieldDraft["fieldClass"],
): SemanticSchemaFieldDraft {
  const roleByClass: Record<
    SemanticSchemaFieldDraft["fieldClass"],
    SemanticSchemaFieldDraft["semanticRole"]
  > = {
    TEXT_ATTRIBUTE: "TEXT",
    IDENTIFIER: "IDENTIFIER",
    DIMENSION: "CATEGORICAL_DIMENSION",
    FLAG: "BOOLEAN_FLAG",
    MEASURE: "MEASURE",
    TEMPORAL: "TEMPORAL",
    GEO_COORDINATE: "GEO_LATITUDE",
  };

  return {
    sourceSchemaColumnId,
    semanticRole: roleByClass[fieldClass],
    fieldClass,
    recordKeyCandidate: false,
    confidence: "HIGH",
    evidence: [],
    resolutionSource: "AUTO_HIGH_CONFIDENCE",
  };
}

function schema(
  fields: SemanticSchemaFieldDraft[],
): SemanticDatasetSchemaDraft {
  return {
    schemaVersion: "v1",
    resolutionVersion: "v1",
    inferenceVersion: "v1",
    profilerVersion: "v1",
    recordKeyCandidateState: "NONE",
    fields,
  };
}

function quality(
  state: DataQualityReviewResolution["state"],
): DataQualityReviewResolution {
  return {
    resolutionVersion: "v1",
    reviewVersion: "v1",
    qualityVersion: "v1",
    profilerVersion: "v1",
    schemaVersion: "v1",
    state,
    itemCount: 0,
    acknowledgedNoticeCount:
      state === "READY_WITH_ACKNOWLEDGED_NOTICES" ? 1 : 0,
    continuedReviewCount: 0,
    heldReviewCount: state === "HOLD_FOR_REMEDIATION" ? 1 : 0,
    items: [],
  };
}

describe("D4D5A analysis readiness", () => {
  it("returns READY for quality-approved aligned inputs", () => {
    const result = buildAnalysisReadiness(
      schema([field("c1", "MEASURE")]),
      quality("READY"),
    );

    expect(result).toEqual({
      ok: true,
      readiness: {
        readinessVersion: "v1",
        schemaVersion: "v1",
        profilerVersion: "v1",
        qualityResolutionVersion: "v1",
        state: "READY",
        fieldCount: 1,
        catalog: {
          textAttributes: [],
          identifiers: [],
          dimensions: [],
          flags: [],
          measures: ["c1"],
          temporals: [],
          geoCoordinates: [],
        },
      },
    });
  });

  it("propagates acknowledged-notice readiness without blocking analysis", () => {
    const result = buildAnalysisReadiness(
      schema([field("c1", "TEXT_ATTRIBUTE")]),
      quality("READY_WITH_ACKNOWLEDGED_NOTICES"),
    );

    expect(result).toMatchObject({
      ok: true,
      readiness: {
        state: "READY_WITH_ACKNOWLEDGED_NOTICES",
      },
    });
  });

  it("blocks readiness when quality is held for remediation", () => {
    const result = buildAnalysisReadiness(
      schema([field("c1", "MEASURE")]),
      quality("HOLD_FOR_REMEDIATION"),
    );

    expect(result).toMatchObject({
      ok: true,
      readiness: {
        state: "BLOCKED_QUALITY_HOLD",
      },
    });
  });

  it("catalogs every generic semantic field class without inventing analysis scores", () => {
    const result = buildAnalysisReadiness(
      schema([
        field("text", "TEXT_ATTRIBUTE"),
        field("id", "IDENTIFIER"),
        field("dim", "DIMENSION"),
        field("flag", "FLAG"),
        field("measure", "MEASURE"),
        field("time", "TEMPORAL"),
        field("geo", "GEO_COORDINATE"),
      ]),
      quality("READY"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.readiness.catalog).toEqual({
      textAttributes: ["text"],
      identifiers: ["id"],
      dimensions: ["dim"],
      flags: ["flag"],
      measures: ["measure"],
      temporals: ["time"],
      geoCoordinates: ["geo"],
    });
    expect(JSON.stringify(result)).not.toContain("score");
  });

  it("preserves governed field order within each catalog class", () => {
    const result = buildAnalysisReadiness(
      schema([
        field("z", "MEASURE"),
        field("a", "TEXT_ATTRIBUTE"),
        field("m", "MEASURE"),
      ]),
      quality("READY"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);

    expect(result.readiness.catalog.measures).toEqual(["z", "m"]);
    expect(result.readiness.catalog.textAttributes).toEqual(["a"]);
  });

  it("fails closed on schema-version lineage mismatch", () => {
    const q = quality("READY");
    q.schemaVersion = "different" as typeof q.schemaVersion;

    expect(
      buildAnalysisReadiness(schema([field("c1", "MEASURE")]), q),
    ).toEqual({
      ok: false,
      code: "SCHEMA_QUALITY_LINEAGE_MISMATCH",
    });
  });

  it("fails closed on profiler-version lineage mismatch", () => {
    const q = quality("READY");
    q.profilerVersion = "different" as typeof q.profilerVersion;

    expect(
      buildAnalysisReadiness(schema([field("c1", "MEASURE")]), q),
    ).toEqual({
      ok: false,
      code: "SCHEMA_QUALITY_LINEAGE_MISMATCH",
    });
  });

  it("keeps analysis readiness pure and dependency-bounded", () => {
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
