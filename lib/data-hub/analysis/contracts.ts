import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";

export const ANALYSIS_READINESS_VERSION = "v1" as const;

export const ANALYSIS_READINESS_STATES = [
  "READY",
  "READY_WITH_ACKNOWLEDGED_NOTICES",
  "BLOCKED_QUALITY_HOLD",
] as const;

export type AnalysisReadinessState =
  (typeof ANALYSIS_READINESS_STATES)[number];

export const ANALYSIS_READINESS_ERROR_CODES = [
  "SCHEMA_QUALITY_LINEAGE_MISMATCH",
  "QUALITY_STATE_INVALID",
] as const;

export type AnalysisReadinessErrorCode =
  (typeof ANALYSIS_READINESS_ERROR_CODES)[number];

export interface AnalysisFieldCatalog {
  textAttributes: string[];
  identifiers: string[];
  dimensions: string[];
  flags: string[];
  measures: string[];
  temporals: string[];
  geoCoordinates: string[];
}

export interface AnalysisReadiness {
  readinessVersion: typeof ANALYSIS_READINESS_VERSION;
  schemaVersion: SemanticDatasetSchemaDraft["schemaVersion"];
  profilerVersion: SemanticDatasetSchemaDraft["profilerVersion"];
  qualityResolutionVersion: DataQualityReviewResolution["resolutionVersion"];
  state: AnalysisReadinessState;
  fieldCount: number;
  catalog: AnalysisFieldCatalog;
}

export type BuildAnalysisReadinessResult =
  | { ok: true; readiness: AnalysisReadiness }
  | { ok: false; code: AnalysisReadinessErrorCode };
