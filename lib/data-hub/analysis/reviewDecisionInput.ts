import { SEMANTIC_ROLES, type SemanticRole } from "../semanticInference/contracts";
import type { SemanticClarificationChoice } from "../semanticInference/resolution";
import { DATA_QUALITY_OBSERVATION_CODES, type DataQualityObservationCode } from "../dataQuality/contracts";
import type { DataQualityReviewDecisionInput } from "../dataQuality/reviewResolution";

export interface AnalysisReviewDecisionInput {
  reviewVersion: "v1";
  datasetProfileRunId: string;
  semanticChoices: SemanticClarificationChoice[];
  qualityDecisions: DataQualityReviewDecisionInput[];
}
export type ParseAnalysisReviewDecisionInputResult =
  | { ok: true; input: AnalysisReviewDecisionInput }
  | { ok: false; code: "REVIEW_INPUT_INVALID" };

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" ||
    !descriptors[key].enumerable || !("value" in descriptors[key]))) return null;
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function dataArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
  }
  return value;
}
function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Closed decision-only input. Identity of the organization/upload/reviewer,
// revision and timestamp belong to the server. The profile pin is a freshness
// precondition, not authority: the save service must resolve and compare it,
// then recompute actual semantic candidates and required quality decisions.
export function parseAnalysisReviewDecisionInput(input: unknown): ParseAnalysisReviewDecisionInputResult {
  const invalid = { ok: false, code: "REVIEW_INPUT_INVALID" } as const;
  try {
    const value = record(input);
    if (!value || !exactKeys(value, ["reviewVersion", "datasetProfileRunId", "semanticChoices", "qualityDecisions"]) ||
      value.reviewVersion !== "v1" || !nonblank(value.datasetProfileRunId)) return invalid;
    const choices = dataArray(value.semanticChoices), decisions = dataArray(value.qualityDecisions);
    if (!choices || !decisions) return invalid;
    const semanticChoices: SemanticClarificationChoice[] = [], qualityDecisions: DataQualityReviewDecisionInput[] = [];
    const seenColumns = new Set<string>(), seenItems = new Set<string>();
    for (const raw of choices) {
      const choice = record(raw);
      if (!choice || !exactKeys(choice, ["sourceSchemaColumnId", "role"]) || !nonblank(choice.sourceSchemaColumnId) ||
        typeof choice.role !== "string" || !(SEMANTIC_ROLES as readonly string[]).includes(choice.role) ||
        seenColumns.has(choice.sourceSchemaColumnId)) return invalid;
      seenColumns.add(choice.sourceSchemaColumnId);
      semanticChoices.push({ sourceSchemaColumnId: choice.sourceSchemaColumnId, role: choice.role as SemanticRole });
    }
    for (const raw of decisions) {
      const item = record(raw);
      if (!item || typeof item.code !== "string" || !(DATA_QUALITY_OBSERVATION_CODES as readonly string[]).includes(item.code)) return invalid;
      const dataset = ["EMPTY_DATASET", "NO_COLUMNS", "MULTIPLE_RECORD_KEY_CANDIDATES"].includes(item.code);
      if (item.scope !== (dataset ? "DATASET" : "COLUMN") || !exactKeys(item, dataset
        ? ["code", "scope", "decision"] : ["code", "scope", "sourceSchemaColumnId", "decision"]) ||
        (!dataset && !nonblank(item.sourceSchemaColumnId))) return invalid;
      const notice = item.code === "COLUMN_PARTIALLY_NULL" || item.code === "COLUMN_CONSTANT";
      if (notice ? item.decision !== "ACKNOWLEDGE" : item.decision !== "CONTINUE" && item.decision !== "HOLD") return invalid;
      const identity = JSON.stringify([item.code, item.scope, dataset ? null : item.sourceSchemaColumnId]);
      if (seenItems.has(identity)) return invalid;
      seenItems.add(identity);
      qualityDecisions.push({ code: item.code as DataQualityObservationCode, scope: dataset ? "DATASET" : "COLUMN",
        ...(dataset ? {} : { sourceSchemaColumnId: item.sourceSchemaColumnId as string }),
        decision: item.decision as DataQualityReviewDecisionInput["decision"] });
    }
    return { ok: true, input: { reviewVersion: "v1", datasetProfileRunId: value.datasetProfileRunId, semanticChoices, qualityDecisions } };
  } catch {
    return invalid;
  }
}
