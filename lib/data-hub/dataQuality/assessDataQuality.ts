import type { ColumnReviewEvidence, DatasetReviewEvidence } from "../profiling/contracts";
import type {
  SemanticDatasetSchemaDraft,
  SemanticSchemaFieldDraft,
} from "../semanticInference/schemaSynthesis";
import {
  DATA_QUALITY_VERSION,
  type AssessDataQualityResult,
  type DataQualityObservation,
  type DataQualityStatus,
} from "./contracts";

function lineageMatches(
  profile: DatasetReviewEvidence,
  schema: SemanticDatasetSchemaDraft,
): boolean {
  if (profile.profilerVersion !== schema.profilerVersion) return false;
  if (profile.columns.length !== schema.fields.length) return false;

  return profile.columns.every(
    (column, index) =>
      column.sourceSchemaColumnId ===
      schema.fields[index]?.sourceSchemaColumnId,
  );
}

function columnObservations(
  column: ColumnReviewEvidence,
  field: SemanticSchemaFieldDraft,
): DataQualityObservation[] {
  const observations: DataQualityObservation[] = [];
  const sourceSchemaColumnId = column.sourceSchemaColumnId;

  if (column.isAllNull) {
    observations.push({
      code: "COLUMN_ALL_NULL",
      severity: "REVIEW_REQUIRED",
      scope: "COLUMN",
      sourceSchemaColumnId,
    });
  } else if (column.isSparse) {
    observations.push({
      code: "COLUMN_PARTIALLY_NULL",
      severity: "NOTICE",
      scope: "COLUMN",
      sourceSchemaColumnId,
    });
  }

  if (column.isConstant) {
    observations.push({
      code: "COLUMN_CONSTANT",
      severity: "NOTICE",
      scope: "COLUMN",
      sourceSchemaColumnId,
    });
  }

  if (field.recordKeyCandidate && !column.isUniqueAmongNonNull) {
    observations.push({
      code: "RECORD_KEY_CANDIDATE_NOT_UNIQUE",
      severity: "REVIEW_REQUIRED",
      scope: "COLUMN",
      sourceSchemaColumnId,
    });
  }

  if (field.recordKeyCandidate && !column.isComplete) {
    observations.push({
      code: "RECORD_KEY_CANDIDATE_INCOMPLETE",
      severity: "REVIEW_REQUIRED",
      scope: "COLUMN",
      sourceSchemaColumnId,
    });
  }

  return observations;
}

function assessmentStatus(
  observations: readonly DataQualityObservation[],
): DataQualityStatus {
  if (observations.length === 0) return "CLEAN";
  if (
    observations.some(
      (observation) => observation.severity === "REVIEW_REQUIRED",
    )
  ) {
    return "REVIEW_REQUIRED";
  }
  return "OBSERVATIONS_PRESENT";
}

export function assessDataQuality(
  profile: DatasetReviewEvidence,
  schema: SemanticDatasetSchemaDraft,
): AssessDataQualityResult {
  if (!lineageMatches(profile, schema)) {
    return { ok: false, code: "PROFILE_SCHEMA_LINEAGE_MISMATCH" };
  }

  const observations: DataQualityObservation[] = [];

  if (profile.rowCount === 0) {
    observations.push({
      code: "EMPTY_DATASET",
      severity: "REVIEW_REQUIRED",
      scope: "DATASET",
    });
  }

  if (profile.columnCount === 0) {
    observations.push({
      code: "NO_COLUMNS",
      severity: "REVIEW_REQUIRED",
      scope: "DATASET",
    });
  }

  if (schema.recordKeyCandidateState === "MULTIPLE") {
    observations.push({
      code: "MULTIPLE_RECORD_KEY_CANDIDATES",
      severity: "REVIEW_REQUIRED",
      scope: "DATASET",
    });
  }

  for (let index = 0; index < profile.columns.length; index += 1) {
    observations.push(
      ...columnObservations(profile.columns[index], schema.fields[index]),
    );
  }

  return {
    ok: true,
    assessment: {
      qualityVersion: DATA_QUALITY_VERSION,
      profilerVersion: profile.profilerVersion,
      schemaVersion: schema.schemaVersion,
      status: assessmentStatus(observations),
      observations,
    },
  };
}
