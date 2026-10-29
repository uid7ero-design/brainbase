import type { AnalysisReadiness } from "./contracts";
import { evaluateProfileCount, type EvaluateProfileCountResult, type ProfileCountResult, type ProfileCountEvidence } from "./profileCounts";

// Mirrors the pinned identity fields in the persisted profile-run lineage.
// These values must be supplied by a trusted loader; equality is not proof
// of authorization, current upload pointers, or successful persisted status.
export interface AnalysisDatasetContext {
  organisationId: string;
  uploadId: string;
  importBatchId: string;
  normalizationRunId: string;
  datasetProfileRunId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileVersionId: string;
}

const CONTEXT_KEYS = [
  "organisationId", "uploadId", "importBatchId", "normalizationRunId",
  "datasetProfileRunId", "sourceSchemaVersionId", "sourceSchemaWorksheetId",
  "worksheetMappingProfileVersionId",
] as const satisfies readonly (keyof AnalysisDatasetContext)[];

export interface ScopedAnalysisSnapshot<T> {
  context: AnalysisDatasetContext;
  snapshot: T;
}

export type EvaluateScopedProfileCountResult =
  | { ok: true; result: ProfileCountResult & { context: AnalysisDatasetContext } }
  | Extract<EvaluateProfileCountResult, { ok: false }>
  | { ok: false; code: "DATASET_CONTEXT_INVALID" | "DATASET_CONTEXT_MISMATCH" };

function validContext(context: AnalysisDatasetContext): boolean {
  return typeof context === "object" && context !== null &&
    CONTEXT_KEYS.every((key) => typeof context[key] === "string" && context[key].trim().length > 0);
}

export function validateAnalysisDatasetContexts(
  expected: AnalysisDatasetContext,
  contexts: readonly AnalysisDatasetContext[],
): { ok: true } | { ok: false; code: "DATASET_CONTEXT_INVALID" | "DATASET_CONTEXT_MISMATCH" } {
  if (![expected, ...contexts].every(validContext)) {
    return { ok: false, code: "DATASET_CONTEXT_INVALID" };
  }
  if (contexts.some((context) => CONTEXT_KEYS.some((key) => expected[key] !== context[key]))) {
    return { ok: false, code: "DATASET_CONTEXT_MISMATCH" };
  }
  return { ok: true };
}

// Projection only; callers validate before copying. Never retain unknown
// metadata or a mutable context reference in an accepted result.
export function copyAnalysisDatasetContext(context: AnalysisDatasetContext): AnalysisDatasetContext {
  return Object.fromEntries(CONTEXT_KEYS.map((key) => [key, context[key]])) as unknown as AnalysisDatasetContext;
}

// Checks compatibility with the expected context supplied by the caller.
// This pure wrapper does not resolve database pointers or access rights.
export function evaluateScopedProfileCount(
  expected: AnalysisDatasetContext,
  readiness: ScopedAnalysisSnapshot<AnalysisReadiness>,
  input: unknown,
  profile: ScopedAnalysisSnapshot<ProfileCountEvidence>,
): EvaluateScopedProfileCountResult {
  const checked = validateAnalysisDatasetContexts(expected, [readiness.context, profile.context]);
  if (!checked.ok) return checked;
  const evaluated = evaluateProfileCount(readiness.snapshot, input, profile.snapshot);
  if (!evaluated.ok) return evaluated;
  const context = copyAnalysisDatasetContext(expected);
  return { ok: true, result: { ...evaluated.result, context } };
}
