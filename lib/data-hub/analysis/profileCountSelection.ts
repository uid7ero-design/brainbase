import { MAX_PROFILE_COUNT_BUNDLE_REQUESTS } from "./profileCountBundleInput";
import { buildReviewedProfileCountBundle, type BuildReviewedProfileCountBundleResult } from "./reviewedProfileCountBundle";
import type { ReviewedPlanningSnapshot } from "./reviewedProfileCountPlan";
import type { AnalysisDatasetContext } from "./scopedProfileCounts";
import type { ProfileCountRequestTemplate } from "./reviewedProfileCountCatalog";
import { admitReviewPlanningScope } from "./reviewPlanningScope";

export const PROFILE_COUNT_SELECTION_VERSION = "v1" as const;
export interface ProfileCountSelection {
  selectionVersion: typeof PROFILE_COUNT_SELECTION_VERSION;
  expectedReviewRevision: number;
  includeRowCount: boolean;
  measureColumnIds: readonly string[];
}
export type ParseProfileCountSelectionResult =
  | { ok: true; selection: ProfileCountSelection }
  | { ok: false; code: "PROFILE_SELECTION_INVALID" };

// Closed scalar selection; distinct measure identities preserve caller order.
// This parser does not consult a catalog or grant a field capability.
export function parseProfileCountSelectionInput(input: unknown): ParseProfileCountSelectionResult {
  const invalid = { ok: false, code: "PROFILE_SELECTION_INVALID" } as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid;
  const names = ["selectionVersion", "expectedReviewRevision", "includeRowCount", "measureColumnIds"] as const;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || !names.every(name => keys.includes(name))) return invalid;
  const fields = Object.getOwnPropertyDescriptors(input);
  if (!names.every(name => fields[name].enumerable && "value" in fields[name])) return invalid;
  const version = fields.selectionVersion.value;
  const revision = fields.expectedReviewRevision.value;
  const includeRowCount = fields.includeRowCount.value;
  const source = fields.measureColumnIds.value;
  if (version !== PROFILE_COUNT_SELECTION_VERSION || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof includeRowCount !== "boolean" || !Array.isArray(source)) return invalid;
  const length = source.length;
  const total = length + (includeRowCount ? 1 : 0);
  if (total < 1 || total > MAX_PROFILE_COUNT_BUNDLE_REQUESTS) return invalid;
  const ids: string[] = []; const seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(source, index);
    if (!entry || !("value" in entry) || typeof entry.value !== "string" || !entry.value.trim() || seen.has(entry.value)) return invalid;
    seen.add(entry.value); ids.push(entry.value);
  }
  return { ok: true, selection: { selectionVersion: PROFILE_COUNT_SELECTION_VERSION,
    expectedReviewRevision: revision, includeRowCount, measureColumnIds: ids } };
}

export type BuildReviewedProfileCountSelectionResult =
  | BuildReviewedProfileCountBundleResult
  | { ok: false; code: "PROFILE_SELECTION_INVALID" };

// Catalog-independent revalidation: selected identities must still be reviewed
// measures on the supplied authorized snapshot. Catalogs are not replay tokens.
export function buildReviewedProfileCountSelection(
  expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot, input: unknown,
): BuildReviewedProfileCountSelectionResult {
  const checked = admitReviewPlanningScope(expected, review);
  if (!checked.ok) return checked;
  const parsed = parseProfileCountSelectionInput(input);
  if (!parsed.ok) return parsed;
  const selection = parsed.selection;
  const requests: ProfileCountRequestTemplate[] = [];
  if (selection.includeRowCount) requests.push({ requestVersion: "v1", kind: "ROW_COUNT" });
  for (const sourceSchemaColumnId of selection.measureColumnIds) {
    requests.push({ requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId, operator: "COUNT_PRESENT" });
  }
  // Capture the admitted revision; do not reread a caller-owned revision value.
  return buildReviewedProfileCountBundle(checked.context,
    { revision: checked.reviewRevision, schema: review.schema, quality: review.quality },
    { bundleVersion: "v1", expectedReviewRevision: selection.expectedReviewRevision, requests });
}
