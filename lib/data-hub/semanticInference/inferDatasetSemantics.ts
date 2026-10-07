import type { ColumnReviewEvidence, DatasetReviewEvidence, ValueKind } from "../profiling/contracts";
import {
  SEMANTIC_INFERENCE_VERSION,
  type ColumnSemanticInference,
  type DatasetSemanticInference,
  type SemanticConfidence,
  type SemanticEvidenceCode,
  type SemanticRole,
  type SemanticRoleCandidate,
} from "./contracts";

const VALUE_KIND_EVIDENCE: Record<ValueKind, SemanticEvidenceCode> = {
  STRING: "VALUE_KIND_STRING",
  IDENTIFIER: "VALUE_KIND_IDENTIFIER",
  INTEGER: "VALUE_KIND_INTEGER",
  DECIMAL: "VALUE_KIND_DECIMAL",
  BOOLEAN: "VALUE_KIND_BOOLEAN",
  DATE: "VALUE_KIND_DATE",
  TIME: "VALUE_KIND_TIME",
  DATETIME: "VALUE_KIND_DATETIME",
  DURATION: "VALUE_KIND_DURATION",
  PERCENTAGE: "VALUE_KIND_PERCENTAGE",
  CURRENCY: "VALUE_KIND_CURRENCY",
  LATITUDE: "VALUE_KIND_LATITUDE",
  LONGITUDE: "VALUE_KIND_LONGITUDE",
};

function structuralEvidence(column: ColumnReviewEvidence): SemanticEvidenceCode[] {
  const evidence: SemanticEvidenceCode[] = [VALUE_KIND_EVIDENCE[column.valueKind]];

  if (column.sourceUnit !== null || column.normalizedUnit !== null) evidence.push("UNIT_PRESENT");
  if (column.rowCount === 0) evidence.push("ZERO_ROWS");
  if (column.isComplete) evidence.push("COMPLETE");
  if (column.isSparse) evidence.push("SPARSE");
  if (column.isAllNull) evidence.push("ALL_NULL");
  if (column.isConstant) evidence.push("CONSTANT");
  if (column.isUniqueAmongNonNull) evidence.push("UNIQUE_AMONG_NON_NULL");
  if (column.nonNullCount > 0 && !column.isUniqueAmongNonNull && !column.isConstant) evidence.push("NON_UNIQUE_NON_CONSTANT");

  return evidence;
}

function candidate(
  role: SemanticRole,
  confidence: SemanticConfidence,
  baseEvidence: SemanticEvidenceCode[],
  extraEvidence: SemanticEvidenceCode[] = [],
): SemanticRoleCandidate {
  const evidence = [...baseEvidence, ...extraEvidence.filter((code) => !baseEvidence.includes(code))];
  return { role, confidence, evidence };
}

function observedConfidence(column: ColumnReviewEvidence, otherwise: SemanticConfidence = "HIGH"): SemanticConfidence {
  return column.rowCount === 0 || column.isAllNull ? "MEDIUM" : otherwise;
}

function directRole(column: ColumnReviewEvidence, evidence: SemanticEvidenceCode[]): SemanticRoleCandidate {
  switch (column.valueKind) {
    case "STRING":
      return candidate("TEXT", observedConfidence(column), evidence);
    case "IDENTIFIER":
      return candidate("IDENTIFIER", observedConfidence(column), evidence);
    case "BOOLEAN":
      return candidate("BOOLEAN_FLAG", observedConfidence(column), evidence);
    case "DATE":
    case "TIME":
    case "DATETIME":
      return candidate("TEMPORAL", observedConfidence(column), evidence);
    case "DURATION":
      return candidate("DURATION", observedConfidence(column), evidence);
    case "PERCENTAGE":
      return candidate("PERCENTAGE", observedConfidence(column), evidence);
    case "CURRENCY":
      return candidate("CURRENCY", observedConfidence(column), evidence);
    case "LATITUDE":
      return candidate("GEO_LATITUDE", observedConfidence(column), evidence);
    case "LONGITUDE":
      return candidate("GEO_LONGITUDE", observedConfidence(column), evidence);
    case "INTEGER":
    case "DECIMAL": {
      const unitBackedConfidence: SemanticConfidence =
        column.sourceUnit !== null || column.normalizedUnit !== null ? "HIGH" : "MEDIUM";
      return candidate("MEASURE", observedConfidence(column, unitBackedConfidence), evidence);
    }
  }
}

export function inferColumnSemantics(column: ColumnReviewEvidence): ColumnSemanticInference {
  const evidence = structuralEvidence(column);
  const candidates: SemanticRoleCandidate[] = [directRole(column, evidence)];

  // Complete + unique IDENTIFIER evidence supports a key candidate, but
  // does not prove key semantics. Keep it MEDIUM and explicit.
  if (
    column.valueKind === "IDENTIFIER" &&
    column.rowCount > 0 &&
    column.isComplete &&
    column.isUniqueAmongNonNull
  ) {
    candidates.push(candidate("RECORD_KEY", "MEDIUM", evidence, ["COMPLETE", "UNIQUE_AMONG_NON_NULL"]));
  }

  // Repeated, non-constant textual evidence is compatible with a
  // categorical dimension. No cardinality threshold is invented here.
  if (
    (column.valueKind === "STRING" || column.valueKind === "IDENTIFIER") &&
    column.nonNullCount > 0 &&
    !column.isUniqueAmongNonNull &&
    !column.isConstant
  ) {
    candidates.push(candidate("CATEGORICAL_DIMENSION", "MEDIUM", evidence, ["NON_UNIQUE_NON_CONSTANT"]));
  }

  return {
    sourceSchemaColumnId: column.sourceSchemaColumnId,
    state: candidates.length === 0 ? "NO_CANDIDATE" : candidates.length === 1 ? "ONE_CANDIDATE" : "MULTIPLE_CANDIDATES",
    candidates,
  };
}

export function inferDatasetSemantics(profile: DatasetReviewEvidence): DatasetSemanticInference {
  return {
    inferenceVersion: SEMANTIC_INFERENCE_VERSION,
    profilerVersion: profile.profilerVersion,
    columns: profile.columns.map(inferColumnSemantics),
  };
}
