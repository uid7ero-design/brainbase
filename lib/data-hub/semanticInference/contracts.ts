import type { DatasetProfile } from "../profiling/contracts";

export const SEMANTIC_INFERENCE_VERSION = "v1" as const;

export const SEMANTIC_ROLES = [
  "TEXT",
  "IDENTIFIER",
  "RECORD_KEY",
  "CATEGORICAL_DIMENSION",
  "BOOLEAN_FLAG",
  "MEASURE",
  "TEMPORAL",
  "DURATION",
  "PERCENTAGE",
  "CURRENCY",
  "GEO_LATITUDE",
  "GEO_LONGITUDE",
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

export const SEMANTIC_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type SemanticConfidence = (typeof SEMANTIC_CONFIDENCE_LEVELS)[number];

export const SEMANTIC_EVIDENCE_CODES = [
  "VALUE_KIND_STRING",
  "VALUE_KIND_IDENTIFIER",
  "VALUE_KIND_BOOLEAN",
  "VALUE_KIND_INTEGER",
  "VALUE_KIND_DECIMAL",
  "VALUE_KIND_DATE",
  "VALUE_KIND_TIME",
  "VALUE_KIND_DATETIME",
  "VALUE_KIND_DURATION",
  "VALUE_KIND_PERCENTAGE",
  "VALUE_KIND_CURRENCY",
  "VALUE_KIND_LATITUDE",
  "VALUE_KIND_LONGITUDE",
  "UNIT_PRESENT",
  "COMPLETE",
  "SPARSE",
  "ALL_NULL",
  "CONSTANT",
  "UNIQUE_AMONG_NON_NULL",
  "NON_UNIQUE_NON_CONSTANT",
  "ZERO_ROWS",
] as const;

export type SemanticEvidenceCode = (typeof SEMANTIC_EVIDENCE_CODES)[number];

export interface SemanticRoleCandidate {
  role: SemanticRole;
  confidence: SemanticConfidence;
  evidence: SemanticEvidenceCode[];
}

export type SemanticCandidateState = "NO_CANDIDATE" | "ONE_CANDIDATE" | "MULTIPLE_CANDIDATES";

export interface ColumnSemanticInference {
  sourceSchemaColumnId: string;
  state: SemanticCandidateState;
  candidates: SemanticRoleCandidate[];
}

export interface DatasetSemanticInference {
  inferenceVersion: typeof SEMANTIC_INFERENCE_VERSION;
  profilerVersion: DatasetProfile["profilerVersion"];
  columns: ColumnSemanticInference[];
}
