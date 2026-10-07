import type { DatasetProfile } from "../profiling/contracts";
import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";

export const DATA_QUALITY_VERSION = "v1" as const;

export const DATA_QUALITY_OBSERVATION_CODES = [
  "EMPTY_DATASET",
  "NO_COLUMNS",
  "COLUMN_ALL_NULL",
  "COLUMN_PARTIALLY_NULL",
  "COLUMN_CONSTANT",
  "RECORD_KEY_CANDIDATE_NOT_UNIQUE",
  "RECORD_KEY_CANDIDATE_INCOMPLETE",
  "MULTIPLE_RECORD_KEY_CANDIDATES",
] as const;
export type DataQualityObservationCode =
  (typeof DATA_QUALITY_OBSERVATION_CODES)[number];

export const DATA_QUALITY_SEVERITIES = ["NOTICE", "REVIEW_REQUIRED"] as const;
export type DataQualitySeverity = (typeof DATA_QUALITY_SEVERITIES)[number];

export type DataQualityScope = "DATASET" | "COLUMN";

export interface DataQualityObservation {
  code: DataQualityObservationCode;
  severity: DataQualitySeverity;
  scope: DataQualityScope;
  sourceSchemaColumnId?: string;
}

export type DataQualityStatus =
  | "CLEAN"
  | "OBSERVATIONS_PRESENT"
  | "REVIEW_REQUIRED";

export interface DataQualityAssessment {
  qualityVersion: typeof DATA_QUALITY_VERSION;
  profilerVersion: DatasetProfile["profilerVersion"];
  schemaVersion: SemanticDatasetSchemaDraft["schemaVersion"];
  status: DataQualityStatus;
  observations: DataQualityObservation[];
}

export const DATA_QUALITY_ERROR_CODES = [
  "PROFILE_SCHEMA_LINEAGE_MISMATCH",
] as const;
export type DataQualityErrorCode = (typeof DATA_QUALITY_ERROR_CODES)[number];

export type AssessDataQualityResult =
  | { ok: true; assessment: DataQualityAssessment }
  | { ok: false; code: DataQualityErrorCode };
