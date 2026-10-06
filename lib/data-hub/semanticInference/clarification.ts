import type {
  ColumnSemanticInference,
  DatasetSemanticInference,
  SemanticConfidence,
  SemanticEvidenceCode,
  SemanticRole,
} from "./contracts";

export const SEMANTIC_CLARIFICATION_VERSION = "v1" as const;

export const SEMANTIC_CLARIFICATION_REASONS = [
  "NO_CANDIDATE",
  "MULTIPLE_CANDIDATES",
  "NON_HIGH_CONFIDENCE",
  "ALL_NULL_EVIDENCE",
  "ZERO_ROWS_EVIDENCE",
] as const;

export type SemanticClarificationReason =
  (typeof SEMANTIC_CLARIFICATION_REASONS)[number];

export type SemanticResolutionState =
  | "RESOLVED"
  | "CLARIFICATION_REQUIRED";

export interface ColumnSemanticClarification {
  sourceSchemaColumnId: string;
  resolutionState: SemanticResolutionState;
  candidateRoles: SemanticRole[];
  highestConfidence: SemanticConfidence | null;
  reasons: SemanticClarificationReason[];
}

export interface DatasetSemanticClarificationPlan {
  clarificationVersion: typeof SEMANTIC_CLARIFICATION_VERSION;
  inferenceVersion: DatasetSemanticInference["inferenceVersion"];
  profilerVersion: DatasetSemanticInference["profilerVersion"];
  requiresClarification: boolean;
  columns: ColumnSemanticClarification[];
}

const CONFIDENCE_RANK: Record<SemanticConfidence, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function highestConfidence(
  column: ColumnSemanticInference,
): SemanticConfidence | null {
  let best: SemanticConfidence | null = null;
  for (const candidate of column.candidates) {
    if (
      best === null ||
      CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[best]
    ) {
      best = candidate.confidence;
    }
  }
  return best;
}

function hasEvidence(
  column: ColumnSemanticInference,
  evidence: SemanticEvidenceCode,
): boolean {
  return column.candidates.some((candidate) =>
    candidate.evidence.includes(evidence),
  );
}

export function buildColumnSemanticClarification(
  column: ColumnSemanticInference,
): ColumnSemanticClarification {
  const reasons: SemanticClarificationReason[] = [];
  const confidence = highestConfidence(column);

  if (column.candidates.length === 0) {
    reasons.push("NO_CANDIDATE");
  }

  if (column.candidates.length > 1) {
    reasons.push("MULTIPLE_CANDIDATES");
  }

  if (confidence !== null && confidence !== "HIGH") {
    reasons.push("NON_HIGH_CONFIDENCE");
  }

  if (hasEvidence(column, "ALL_NULL")) {
    reasons.push("ALL_NULL_EVIDENCE");
  }

  if (hasEvidence(column, "ZERO_ROWS")) {
    reasons.push("ZERO_ROWS_EVIDENCE");
  }

  const resolutionState: SemanticResolutionState =
    reasons.length === 0 ? "RESOLVED" : "CLARIFICATION_REQUIRED";

  return {
    sourceSchemaColumnId: column.sourceSchemaColumnId,
    resolutionState,
    candidateRoles: column.candidates.map((candidate) => candidate.role),
    highestConfidence: confidence,
    reasons,
  };
}

export function buildDatasetSemanticClarificationPlan(
  inference: DatasetSemanticInference,
): DatasetSemanticClarificationPlan {
  const columns = inference.columns.map(buildColumnSemanticClarification);

  return {
    clarificationVersion: SEMANTIC_CLARIFICATION_VERSION,
    inferenceVersion: inference.inferenceVersion,
    profilerVersion: inference.profilerVersion,
    requiresClarification: columns.some(
      (column) => column.resolutionState === "CLARIFICATION_REQUIRED",
    ),
    columns,
  };
}
