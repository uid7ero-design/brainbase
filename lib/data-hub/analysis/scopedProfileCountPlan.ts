import { buildProfileCountPlan, type BuildProfileCountPlanResult,
  type ProfileCountAnalysisPlan } from "./profileCountPlan";
import type { AnalysisReadiness } from "./contracts";
import { copyAnalysisDatasetContext, validateAnalysisDatasetContexts,
  type AnalysisDatasetContext, type ScopedAnalysisSnapshot } from "./scopedProfileCounts";

export type BuildScopedProfileCountPlanResult =
  | { ok: true; plan: ScopedAnalysisSnapshot<ProfileCountAnalysisPlan> }
  | Extract<BuildProfileCountPlanResult, { ok: false }>
  | { ok: false; code: "DATASET_CONTEXT_INVALID" | "DATASET_CONTEXT_MISMATCH" };

// Pure intent planning over trusted metadata. Matching lineage is not proof
// of access, freshness, saved review status or sufficient profile statistics.
export function buildScopedProfileCountPlan(
  expected: AnalysisDatasetContext,
  readiness: ScopedAnalysisSnapshot<AnalysisReadiness>,
  input: unknown,
): BuildScopedProfileCountPlanResult {
  const checked = validateAnalysisDatasetContexts(expected, [readiness.context]);
  if (!checked.ok) return checked;
  const planned = buildProfileCountPlan(readiness.snapshot, input);
  if (!planned.ok) return planned;
  return { ok: true, plan: { context: copyAnalysisDatasetContext(expected), snapshot: planned.plan } };
}
