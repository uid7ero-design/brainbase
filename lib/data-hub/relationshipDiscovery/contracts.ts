import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { SemanticConfidence } from "../semanticInference/contracts";

export const RELATIONSHIP_DISCOVERY_VERSION = "v1" as const;

export const RELATIONSHIP_CANDIDATE_KINDS = [
  "POTENTIAL_IDENTIFIER_JOIN",
] as const;
export type RelationshipCandidateKind =
  (typeof RELATIONSHIP_CANDIDATE_KINDS)[number];

export const RELATIONSHIP_EVIDENCE_CODES = [
  "EXACT_GOVERNED_LABEL_MATCH",
  "LEFT_IDENTIFIER_CLASS",
  "RIGHT_IDENTIFIER_CLASS",
  "LEFT_RECORD_KEY_CANDIDATE",
  "RIGHT_RECORD_KEY_CANDIDATE",
] as const;
export type RelationshipEvidenceCode =
  (typeof RELATIONSHIP_EVIDENCE_CODES)[number];

export const RELATIONSHIP_DISCOVERY_ERROR_CODES = [
  "DUPLICATE_DATASET_ID",
  "DUPLICATE_COLUMN_METADATA",
  "UNKNOWN_COLUMN_METADATA",
  "MISSING_COLUMN_METADATA",
  "EMPTY_GOVERNED_LABEL",
] as const;
export type RelationshipDiscoveryErrorCode =
  (typeof RELATIONSHIP_DISCOVERY_ERROR_CODES)[number];

export interface RelationshipColumnMetadata {
  sourceSchemaColumnId: string;
  governedLabel: string;
}

export interface RelationshipDatasetInput {
  datasetId: string;
  schema: SemanticDatasetSchemaDraft;
  columns: RelationshipColumnMetadata[];
}

export interface RelationshipEndpoint {
  datasetId: string;
  sourceSchemaColumnId: string;
}

export interface RelationshipCandidate {
  kind: RelationshipCandidateKind;
  left: RelationshipEndpoint;
  right: RelationshipEndpoint;
  confidence: SemanticConfidence;
  evidence: RelationshipEvidenceCode[];
}

export type RelationshipCandidateState = "NONE" | "ONE" | "MULTIPLE";

export interface RelationshipDiscoveryResult {
  discoveryVersion: typeof RELATIONSHIP_DISCOVERY_VERSION;
  state: RelationshipCandidateState;
  candidates: RelationshipCandidate[];
}

export type DiscoverRelationshipCandidatesResult =
  | { ok: true; result: RelationshipDiscoveryResult }
  | {
      ok: false;
      code: RelationshipDiscoveryErrorCode;
      datasetId: string;
      sourceSchemaColumnId?: string;
    };
