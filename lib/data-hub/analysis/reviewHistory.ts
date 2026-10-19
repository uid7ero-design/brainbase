import { SEMANTIC_ROLES, type SemanticRole } from "../semanticInference/contracts";
import { DATA_QUALITY_OBSERVATION_CODES, type DataQualityObservationCode } from "../dataQuality/contracts";
import type { DataQualityReviewDecision } from "../dataQuality/reviewResolution";
import type { AnalysisReviewDecisionInput } from "./reviewDecisionInput";
import { copyAnalysisDatasetContext, validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "./scopedProfileCounts";

export const REVIEW_HISTORY_PAGE_SIZE = 10;
export const MAX_HISTORY_FIELDS = 1_000;
export const MAX_HISTORY_QUALITY = (MAX_HISTORY_FIELDS + 1) * DATA_QUALITY_OBSERVATION_CODES.length;
export type ReviewHistoryQuery = { datasetProfileRunId: string; expectedReviewRevision: number } &
  ({ kind: "page"; beforeRevision: number | null } | { kind: "compare"; baselineRevision: number });
export type ReviewHistoryEntry = { revision: number; semanticChoiceCount: number; qualityDecisionCount: number;
  acknowledgedNoticeCount: number; continuedReviewCount: number; heldReviewCount: number };
export type ReviewHistoryPage = { historyVersion: "v1"; context: AnalysisDatasetContext; currentReviewRevision: number;
  beforeRevision: number | null; nextBeforeRevision: number | null; entries: ReviewHistoryEntry[] };
type QualityIdentity = { code: DataQualityObservationCode; scope: "DATASET" | "COLUMN"; sourceSchemaColumnId?: string };
export type ReviewComparison = { comparisonVersion: "v1"; context: AnalysisDatasetContext; currentReviewRevision: number; baselineRevision: number;
  semanticChanges: { sourceSchemaColumnId: string; fromRole: SemanticRole | null; toRole: SemanticRole | null }[];
  qualityChanges: (QualityIdentity & { fromDecision: DataQualityReviewDecision | null; toDecision: DataQualityReviewDecision | null })[] };
const invalid = (): never => { throw new Error("RESPONSE_INVALID"); };
const id = (value: unknown): string => typeof value === "string" && !!value.trim() && value.length <= 512 ? value : invalid();
const positive = (value: unknown): number => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : invalid();
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]))) return invalid();
  return Object.assign(Object.create(null), value);
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 || Array.from({ length: value.length }, (_, i) => descriptors[i]).some(d => !d?.enumerable || !("value" in d))) return invalid();
  return value;
}
function context(value: unknown, expected: AnalysisDatasetContext) {
  const row = closed(value, Object.keys(copyAnalysisDatasetContext(expected))) as unknown as AnalysisDatasetContext;
  Object.values(row).forEach(id);
  if (!validateAnalysisDatasetContexts(expected, [row]).ok) return invalid();
  return copyAnalysisDatasetContext(row);
}
export function parseReviewHistoryQuery(params: URLSearchParams, kind: "page" | "compare"): ReviewHistoryQuery | null {
  const required = ["historyVersion", "datasetProfileRunId", "expectedReviewRevision", ...(kind === "compare" ? ["baselineRevision"] : [])];
  const allowed = [...required, ...(kind === "page" ? ["beforeRevision"] : [])];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1) || required.some(key => !params.has(key)) || params.get("historyVersion") !== "v1") return null;
  const integer = (key: string) => { const text = params.get(key); return text && /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null; };
  const revision = integer("expectedReviewRevision"), profile = params.get("datasetProfileRunId");
  if (!revision || !profile?.trim() || profile.length > 512) return null;
  if (kind === "compare") { const baseline = integer("baselineRevision"); return baseline && baseline < revision ? { kind, datasetProfileRunId: profile, expectedReviewRevision: revision, baselineRevision: baseline } : null; }
  const before = params.has("beforeRevision") ? integer("beforeRevision") : null;
  if (params.has("beforeRevision") && (!before || before > revision)) return null;
  return { kind, datasetProfileRunId: profile, expectedReviewRevision: revision, beforeRevision: before };
}
export function summarizeReview(revision: number, input: AnalysisReviewDecisionInput): ReviewHistoryEntry {
  return { revision, semanticChoiceCount: input.semanticChoices.length, qualityDecisionCount: input.qualityDecisions.length,
    acknowledgedNoticeCount: input.qualityDecisions.filter(item => item.decision === "ACKNOWLEDGE").length,
    continuedReviewCount: input.qualityDecisions.filter(item => item.decision === "CONTINUE").length,
    heldReviewCount: input.qualityDecisions.filter(item => item.decision === "HOLD").length };
}
export function compareReviewDecisions(baseline: AnalysisReviewDecisionInput, current: AnalysisReviewDecisionInput) {
  const previousRoles = new Map(baseline.semanticChoices.map(item => [item.sourceSchemaColumnId, item.role]));
  const currentRoles = new Map(current.semanticChoices.map(item => [item.sourceSchemaColumnId, item.role]));
  const semanticChanges: ReviewComparison["semanticChanges"] = [];
  for (const sourceSchemaColumnId of new Set([...previousRoles.keys(), ...currentRoles.keys()])) {
    const fromRole = previousRoles.get(sourceSchemaColumnId) ?? null, toRole = currentRoles.get(sourceSchemaColumnId) ?? null;
    if (fromRole !== toRole) semanticChanges.push({ sourceSchemaColumnId, fromRole, toRole });
  }
  const key = (item: QualityIdentity) => JSON.stringify([item.code, item.scope, item.sourceSchemaColumnId ?? null]);
  const before = new Map(baseline.qualityDecisions.map(item => [key(item), item])), after = new Map(current.qualityDecisions.map(item => [key(item), item]));
  const qualityChanges: ReviewComparison["qualityChanges"] = [];
  for (const identity of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(identity), next = after.get(identity), fromDecision = old?.decision ?? null, toDecision = next?.decision ?? null;
    if (fromDecision !== toDecision) { const item = next ?? old!; qualityChanges.push({ code: item.code, scope: item.scope,
      ...(item.sourceSchemaColumnId === undefined ? {} : { sourceSchemaColumnId: item.sourceSchemaColumnId }), fromDecision, toDecision }); }
  }
  return { semanticChanges, qualityChanges };
}
export function decodeReviewHistory(body: unknown, expected: AnalysisDatasetContext, query: Extract<ReviewHistoryQuery, { kind: "page" }>): ReviewHistoryPage {
  const envelope = closed(body, ["ok", "history"]); if (envelope.ok !== true) return invalid();
  const row = closed(envelope.history, ["historyVersion", "context", "currentReviewRevision", "beforeRevision", "nextBeforeRevision", "entries"]);
  if (row.historyVersion !== "v1" || positive(row.currentReviewRevision) !== query.expectedReviewRevision || row.beforeRevision !== query.beforeRevision) return invalid();
  const lineage = context(row.context, expected); if (lineage.datasetProfileRunId !== query.datasetProfileRunId) return invalid();
  let last = query.beforeRevision ?? Infinity;
  const entries = array(row.entries, REVIEW_HISTORY_PAGE_SIZE).map(value => {
    const entry = closed(value, ["revision", "semanticChoiceCount", "qualityDecisionCount", "acknowledgedNoticeCount", "continuedReviewCount", "heldReviewCount"]);
    const revision = positive(entry.revision); if (revision >= last || revision > query.expectedReviewRevision) return invalid(); last = revision;
    for (const key of ["semanticChoiceCount", "qualityDecisionCount", "acknowledgedNoticeCount", "continuedReviewCount", "heldReviewCount"]) {
      if (!Number.isSafeInteger(entry[key]) || (entry[key] as number) < 0 || (entry[key] as number) > (key === "semanticChoiceCount" ? MAX_HISTORY_FIELDS : MAX_HISTORY_QUALITY)) return invalid();
    }
    if (entry.qualityDecisionCount !== (entry.acknowledgedNoticeCount as number) + (entry.continuedReviewCount as number) + (entry.heldReviewCount as number)) return invalid();
    return { ...entry } as ReviewHistoryEntry;
  });
  if (query.beforeRevision === null && entries[0]?.revision !== query.expectedReviewRevision) return invalid();
  const next = row.nextBeforeRevision === null ? null : positive(row.nextBeforeRevision);
  if (next !== null && (entries.length !== REVIEW_HISTORY_PAGE_SIZE || next !== last || next <= 1)) return invalid();
  return { historyVersion: "v1", context: lineage, currentReviewRevision: query.expectedReviewRevision, beforeRevision: query.beforeRevision, nextBeforeRevision: next, entries };
}
export function decodeReviewComparison(body: unknown, expected: AnalysisDatasetContext, query: Extract<ReviewHistoryQuery, { kind: "compare" }>, fieldIds: readonly string[]): ReviewComparison {
  const envelope = closed(body, ["ok", "comparison"]); if (envelope.ok !== true) return invalid();
  const row = closed(envelope.comparison, ["comparisonVersion", "context", "currentReviewRevision", "baselineRevision", "semanticChanges", "qualityChanges"]);
  if (row.comparisonVersion !== "v1" || positive(row.currentReviewRevision) !== query.expectedReviewRevision || positive(row.baselineRevision) !== query.baselineRevision || query.baselineRevision >= query.expectedReviewRevision) return invalid();
  const lineage = context(row.context, expected); if (lineage.datasetProfileRunId !== query.datasetProfileRunId) return invalid();
  const fields = new Set(fieldIds), seen = new Set<string>();
  const role = (value: unknown) => value === null ? null : typeof value === "string" && (SEMANTIC_ROLES as readonly string[]).includes(value) ? value as SemanticRole : invalid();
  const semanticChanges = array(row.semanticChanges, MAX_HISTORY_FIELDS).map(value => {
    const item = closed(value, ["sourceSchemaColumnId", "fromRole", "toRole"]), column = id(item.sourceSchemaColumnId);
    const fromRole = role(item.fromRole), toRole = role(item.toRole);
    if (!fields.has(column) || seen.has(column) || fromRole === toRole) return invalid(); seen.add(column);
    return { sourceSchemaColumnId: column, fromRole, toRole };
  });
  seen.clear();
  const qualityChanges = array(row.qualityChanges, MAX_HISTORY_QUALITY).map(value => {
    // Check scope without reading a property accessor.
    const descriptors = value && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : {};
    const scope = descriptors.scope?.value;
    if (scope !== "DATASET" && scope !== "COLUMN") return invalid();
    const item = closed(value, ["code", "scope", ...(scope === "COLUMN" ? ["sourceSchemaColumnId"] : []), "fromDecision", "toDecision"]);
    if (!(DATA_QUALITY_OBSERVATION_CODES as readonly unknown[]).includes(item.code)) return invalid();
    const code = item.code as DataQualityObservationCode;
    if (["EMPTY_DATASET", "NO_COLUMNS", "MULTIPLE_RECORD_KEY_CANDIDATES"].includes(code) !== (scope === "DATASET")) return invalid();
    const column = scope === "COLUMN" ? id(item.sourceSchemaColumnId) : undefined;
    if (column !== undefined && !fields.has(column)) return invalid();
    const decision = (value: unknown): DataQualityReviewDecision | null => value === null ? null :
      (code === "COLUMN_PARTIALLY_NULL" || code === "COLUMN_CONSTANT" ? value === "ACKNOWLEDGE" : value === "CONTINUE" || value === "HOLD") ? value as DataQualityReviewDecision : invalid();
    const fromDecision = decision(item.fromDecision), toDecision = decision(item.toDecision), key = JSON.stringify([code, scope, column ?? null]);
    if (fromDecision === toDecision || seen.has(key)) return invalid(); seen.add(key);
    return { code, scope: scope as "DATASET" | "COLUMN", ...(column === undefined ? {} : { sourceSchemaColumnId: column }), fromDecision, toDecision };
  });
  return { comparisonVersion: "v1", context: lineage, currentReviewRevision: query.expectedReviewRevision, baselineRevision: query.baselineRevision, semanticChanges, qualityChanges };
}
