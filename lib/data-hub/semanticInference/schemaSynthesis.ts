import type {
  ResolvedColumnSemantic,
  ResolvedDatasetSemantics,
} from "./resolution";
import type { SemanticRole } from "./contracts";

export const SEMANTIC_SCHEMA_VERSION = "v1" as const;

export const SEMANTIC_FIELD_CLASSES = [
  "TEXT_ATTRIBUTE",
  "IDENTIFIER",
  "DIMENSION",
  "FLAG",
  "MEASURE",
  "TEMPORAL",
  "GEO_COORDINATE",
] as const;

export type SemanticFieldClass = (typeof SEMANTIC_FIELD_CLASSES)[number];

export const RECORD_KEY_CANDIDATE_STATES = [
  "NONE",
  "ONE",
  "MULTIPLE",
] as const;

export type RecordKeyCandidateState =
  (typeof RECORD_KEY_CANDIDATE_STATES)[number];

export interface SemanticSchemaFieldDraft {
  sourceSchemaColumnId: string;
  semanticRole: SemanticRole;
  fieldClass: SemanticFieldClass;
  recordKeyCandidate: boolean;
  confidence: ResolvedColumnSemantic["confidence"];
  evidence: ResolvedColumnSemantic["evidence"];
  resolutionSource: ResolvedColumnSemantic["resolutionSource"];
}

export interface SemanticDatasetSchemaDraft {
  schemaVersion: typeof SEMANTIC_SCHEMA_VERSION;
  resolutionVersion: ResolvedDatasetSemantics["resolutionVersion"];
  inferenceVersion: ResolvedDatasetSemantics["inferenceVersion"];
  profilerVersion: ResolvedDatasetSemantics["profilerVersion"];
  recordKeyCandidateState: RecordKeyCandidateState;
  fields: SemanticSchemaFieldDraft[];
}

const ROLE_FIELD_CLASS: Record<SemanticRole, SemanticFieldClass> = {
  TEXT: "TEXT_ATTRIBUTE",
  IDENTIFIER: "IDENTIFIER",
  RECORD_KEY: "IDENTIFIER",
  CATEGORICAL_DIMENSION: "DIMENSION",
  BOOLEAN_FLAG: "FLAG",
  MEASURE: "MEASURE",
  TEMPORAL: "TEMPORAL",
  DURATION: "MEASURE",
  PERCENTAGE: "MEASURE",
  CURRENCY: "MEASURE",
  GEO_LATITUDE: "GEO_COORDINATE",
  GEO_LONGITUDE: "GEO_COORDINATE",
};

function recordKeyCandidateState(
  fields: readonly SemanticSchemaFieldDraft[],
): RecordKeyCandidateState {
  const count = fields.filter((field) => field.recordKeyCandidate).length;
  if (count === 0) return "NONE";
  if (count === 1) return "ONE";
  return "MULTIPLE";
}

export function synthesizeSemanticDatasetSchema(
  resolved: ResolvedDatasetSemantics,
): SemanticDatasetSchemaDraft {
  const fields: SemanticSchemaFieldDraft[] = resolved.columns.map((column) => ({
    sourceSchemaColumnId: column.sourceSchemaColumnId,
    semanticRole: column.role,
    fieldClass: ROLE_FIELD_CLASS[column.role],
    recordKeyCandidate: column.role === "RECORD_KEY",
    confidence: column.confidence,
    evidence: [...column.evidence],
    resolutionSource: column.resolutionSource,
  }));

  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    resolutionVersion: resolved.resolutionVersion,
    inferenceVersion: resolved.inferenceVersion,
    profilerVersion: resolved.profilerVersion,
    recordKeyCandidateState: recordKeyCandidateState(fields),
    fields,
  };
}
