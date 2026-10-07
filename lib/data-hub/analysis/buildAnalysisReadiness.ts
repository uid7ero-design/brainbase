import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";
import {
  ANALYSIS_READINESS_VERSION,
  type AnalysisFieldCatalog,
  type AnalysisReadinessState,
  type BuildAnalysisReadinessResult,
} from "./contracts";

function lineageMatches(
  schema: SemanticDatasetSchemaDraft,
  quality: DataQualityReviewResolution,
): boolean {
  return (
    schema.schemaVersion === quality.schemaVersion &&
    schema.profilerVersion === quality.profilerVersion
  );
}

function emptyCatalog(): AnalysisFieldCatalog {
  return {
    textAttributes: [],
    identifiers: [],
    dimensions: [],
    flags: [],
    measures: [],
    temporals: [],
    geoCoordinates: [],
  };
}

function catalogFields(
  schema: SemanticDatasetSchemaDraft,
): AnalysisFieldCatalog {
  const catalog = emptyCatalog();

  for (const field of schema.fields) {
    switch (field.fieldClass) {
      case "TEXT_ATTRIBUTE":
        catalog.textAttributes.push(field.sourceSchemaColumnId);
        break;
      case "IDENTIFIER":
        catalog.identifiers.push(field.sourceSchemaColumnId);
        break;
      case "DIMENSION":
        catalog.dimensions.push(field.sourceSchemaColumnId);
        break;
      case "FLAG":
        catalog.flags.push(field.sourceSchemaColumnId);
        break;
      case "MEASURE":
        catalog.measures.push(field.sourceSchemaColumnId);
        break;
      case "TEMPORAL":
        catalog.temporals.push(field.sourceSchemaColumnId);
        break;
      case "GEO_COORDINATE":
        catalog.geoCoordinates.push(field.sourceSchemaColumnId);
        break;
    }
  }

  return catalog;
}

function readinessState(
  quality: DataQualityReviewResolution,
): AnalysisReadinessState {
  if (quality.state === "HOLD_FOR_REMEDIATION") {
    return "BLOCKED_QUALITY_HOLD";
  }
  if (quality.state === "READY_WITH_ACKNOWLEDGED_NOTICES") {
    return "READY_WITH_ACKNOWLEDGED_NOTICES";
  }
  return "READY";
}

export function buildAnalysisReadiness(
  schema: SemanticDatasetSchemaDraft,
  quality: DataQualityReviewResolution,
): BuildAnalysisReadinessResult {
  if (!lineageMatches(schema, quality)) {
    return { ok: false, code: "SCHEMA_QUALITY_LINEAGE_MISMATCH" };
  }

  return {
    ok: true,
    readiness: {
      readinessVersion: ANALYSIS_READINESS_VERSION,
      schemaVersion: schema.schemaVersion,
      profilerVersion: schema.profilerVersion,
      qualityResolutionVersion: quality.resolutionVersion,
      state: readinessState(quality),
      fieldCount: schema.fields.length,
      catalog: catalogFields(schema),
    },
  };
}
