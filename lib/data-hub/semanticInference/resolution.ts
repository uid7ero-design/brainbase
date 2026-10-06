import type {
  DatasetSemanticInference,
  SemanticConfidence,
  SemanticEvidenceCode,
  SemanticRole,
} from "./contracts";
import {
  buildDatasetSemanticClarificationPlan,
  type DatasetSemanticClarificationPlan,
} from "./clarification";

export const SEMANTIC_RESOLUTION_VERSION = "v1" as const;

export const SEMANTIC_RESOLUTION_ERROR_CODES = [
  "CHOICE_REQUIRED",
  "UNKNOWN_COLUMN",
  "DUPLICATE_CHOICE",
  "ROLE_NOT_CANDIDATE",
  "CHOICE_NOT_ALLOWED_FOR_AUTO_RESOLVED_COLUMN",
] as const;

export type SemanticResolutionErrorCode =
  (typeof SEMANTIC_RESOLUTION_ERROR_CODES)[number];

export type SemanticResolutionSource =
  | "AUTO_HIGH_CONFIDENCE"
  | "CLARIFIED_CHOICE";

export interface SemanticClarificationChoice {
  sourceSchemaColumnId: string;
  role: SemanticRole;
}

export interface ResolvedColumnSemantic {
  sourceSchemaColumnId: string;
  role: SemanticRole;
  confidence: SemanticConfidence;
  evidence: SemanticEvidenceCode[];
  resolutionSource: SemanticResolutionSource;
}

export interface ResolvedDatasetSemantics {
  resolutionVersion: typeof SEMANTIC_RESOLUTION_VERSION;
  inferenceVersion: DatasetSemanticInference["inferenceVersion"];
  profilerVersion: DatasetSemanticInference["profilerVersion"];
  columns: ResolvedColumnSemantic[];
}

export type ResolveDatasetSemanticsResult =
  | { ok: true; resolved: ResolvedDatasetSemantics }
  | {
      ok: false;
      code: SemanticResolutionErrorCode;
      sourceSchemaColumnId: string;
    };

function choiceMap(
  choices: readonly SemanticClarificationChoice[],
): ResolveDatasetSemanticsResult | Map<string, SemanticRole> {
  const map = new Map<string, SemanticRole>();

  for (const choice of choices) {
    if (map.has(choice.sourceSchemaColumnId)) {
      return {
        ok: false,
        code: "DUPLICATE_CHOICE",
        sourceSchemaColumnId: choice.sourceSchemaColumnId,
      };
    }
    map.set(choice.sourceSchemaColumnId, choice.role);
  }

  return map;
}

export function resolveDatasetSemantics(
  inference: DatasetSemanticInference,
  choices: readonly SemanticClarificationChoice[] = [],
): ResolveDatasetSemanticsResult {
  const plan: DatasetSemanticClarificationPlan =
    buildDatasetSemanticClarificationPlan(inference);
  const mapped = choiceMap(choices);
  if (!(mapped instanceof Map)) return mapped;

  const knownColumns = new Set(
    inference.columns.map((column) => column.sourceSchemaColumnId),
  );

  for (const choice of choices) {
    if (!knownColumns.has(choice.sourceSchemaColumnId)) {
      return {
        ok: false,
        code: "UNKNOWN_COLUMN",
        sourceSchemaColumnId: choice.sourceSchemaColumnId,
      };
    }
  }

  const columns: ResolvedColumnSemantic[] = [];

  for (let index = 0; index < inference.columns.length; index += 1) {
    const column = inference.columns[index];
    const clarification = plan.columns[index];
    const selectedRole = mapped.get(column.sourceSchemaColumnId);

    if (clarification.resolutionState === "RESOLVED") {
      if (selectedRole !== undefined) {
        return {
          ok: false,
          code: "CHOICE_NOT_ALLOWED_FOR_AUTO_RESOLVED_COLUMN",
          sourceSchemaColumnId: column.sourceSchemaColumnId,
        };
      }

      const candidate = column.candidates[0];
      if (!candidate || candidate.confidence !== "HIGH") {
        return {
          ok: false,
          code: "CHOICE_REQUIRED",
          sourceSchemaColumnId: column.sourceSchemaColumnId,
        };
      }

      columns.push({
        sourceSchemaColumnId: column.sourceSchemaColumnId,
        role: candidate.role,
        confidence: candidate.confidence,
        evidence: [...candidate.evidence],
        resolutionSource: "AUTO_HIGH_CONFIDENCE",
      });
      continue;
    }

    if (selectedRole === undefined) {
      return {
        ok: false,
        code: "CHOICE_REQUIRED",
        sourceSchemaColumnId: column.sourceSchemaColumnId,
      };
    }

    const candidate = column.candidates.find(
      (entry) => entry.role === selectedRole,
    );
    if (!candidate) {
      return {
        ok: false,
        code: "ROLE_NOT_CANDIDATE",
        sourceSchemaColumnId: column.sourceSchemaColumnId,
      };
    }

    columns.push({
      sourceSchemaColumnId: column.sourceSchemaColumnId,
      role: candidate.role,
      confidence: candidate.confidence,
      evidence: [...candidate.evidence],
      resolutionSource: "CLARIFIED_CHOICE",
    });
  }

  return {
    ok: true,
    resolved: {
      resolutionVersion: SEMANTIC_RESOLUTION_VERSION,
      inferenceVersion: inference.inferenceVersion,
      profilerVersion: inference.profilerVersion,
      columns,
    },
  };
}
