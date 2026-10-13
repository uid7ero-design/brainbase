import { ANALYSIS_READINESS_VERSION } from "./contracts";
import { ANALYSIS_PLAN_VERSION } from "./plan";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { SEMANTIC_SCHEMA_VERSION } from "../semanticInference/schemaSynthesis";
import { DATA_QUALITY_REVIEW_RESOLUTION_VERSION } from "../dataQuality/reviewResolution";
import { parseAnalysisRequestInput } from "./requestValidation";
import { parseProfileCountSelectionInput, type ProfileCountSelection } from "./profileCountSelection";
import { PROFILE_COUNT_BUNDLE_VERSION, MAX_PROFILE_COUNT_BUNDLE_REQUESTS } from "./profileCountBundleInput";
import { PROFILE_COUNT_REQUEST_CATALOG_VERSION, type ReviewedProfileCountRequestCatalog,
  type ProfileCountRequestTemplate } from "./reviewedProfileCountCatalog";
import type { ProfileCountAnalysisPlan } from "./profileCountPlan";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext, type ScopedAnalysisSnapshot } from "./scopedProfileCounts";

const contextKeys = ["organisationId", "uploadId", "importBatchId", "normalizationRunId", "datasetProfileRunId",
  "sourceSchemaVersionId", "sourceSchemaWorksheetId", "worksheetMappingProfileVersionId"] as const;
const planKeys = ["planVersion", "readinessVersion", "schemaVersion", "profilerVersion", "qualityResolutionVersion", "readinessState", "operation"];
const loadingCodes = ["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND", "REVIEW_NOT_FOUND", "REVIEW_RECORD_INVALID",
  "REVIEW_READ_FAILED", "CONTEXT_INPUT_INVALID", "CONTEXT_READ_FAILED", "PROFILE_NOT_COMPLETE",
  "PROFILE_LINEAGE_MISMATCH", "PROFILE_EVIDENCE_INVALID", "PROFILER_VERSION_UNSUPPORTED", "REVIEW_PROFILE_CHANGED"] as const;
const failureCodes = ["DATASET_CONTEXT_INVALID", "DATASET_CONTEXT_MISMATCH", "REVIEW_REVISION_INVALID",
  "REVIEW_REVISION_MISMATCH", "PROFILE_SELECTION_INVALID", "PROFILE_BUNDLE_INVALID", "QUALITY_HOLD",
  "SCHEMA_QUALITY_LINEAGE_MISMATCH", "QUALITY_STATE_INVALID", "READINESS_CATALOG_INVALID",
  "PROFILE_PLAN_VERSION_UNSUPPORTED", "PROFILE_OPERATION_NOT_SUPPORTED", "UNSUPPORTED_CAPABILITY_VERSION",
  "INVALID_REQUEST", "CAPABILITY_NOT_AVAILABLE", "PLAN_KIND_NOT_SUPPORTED", ...loadingCodes] as const;
const admissionCodes = new Set<string>(["DATASET_CONTEXT_INVALID", "DATASET_CONTEXT_MISMATCH", "REVIEW_REVISION_INVALID",
  "REVIEW_REVISION_MISMATCH", "PROFILE_SELECTION_INVALID", "PROFILE_BUNDLE_INVALID", ...loadingCodes]);

export interface PlanningExchangeFailure { ok: false; code: (typeof failureCodes)[number]; requestIndex?: number }
export function isPlanningFailureCode(value: unknown): value is PlanningExchangeFailure["code"] {
  return typeof value === "string" && failureCodes.some(code => code === value);
}
export interface PlanningCatalogExpectation { context: AnalysisDatasetContext; reviewRevision: number }
export interface PlanningSelectionExpectation {
  context: AnalysisDatasetContext;
  readinessState: ProfileCountAnalysisPlan["readinessState"];
  selection: ProfileCountSelection;
}
export interface PlanningSelectionResponse {
  ok: true; bundleVersion: typeof PROFILE_COUNT_BUNDLE_VERSION; reviewRevision: number;
  plans: ScopedAnalysisSnapshot<ProfileCountAnalysisPlan>[];
}
export type ParsePlanningExchangeResult<T> =
  | { ok: true; response: T | PlanningExchangeFailure }
  | { ok: false; code: "PLANNING_RESPONSE_INVALID" | "PLANNING_RESPONSE_MISMATCH" };
const invalid = { ok: false, code: "PLANNING_RESPONSE_INVALID" } as const;
const mismatch = { ok: false, code: "PLANNING_RESPONSE_MISMATCH" } as const;

// Closed own data only. No getters or custom array iterators are invoked.
function record(input: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || !names.every(name => keys.includes(name))) return null;
  const fields = Object.getOwnPropertyDescriptors(input);
  if (!names.every(name => fields[name].enumerable && "value" in fields[name])) return null;
  return Object.fromEntries(names.map(name => [name, fields[name].value]));
}
function array(input: unknown): unknown[] | null {
  if (!Array.isArray(input)) return null;
  const length = input.length; const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(input, index);
    if (!entry || !("value" in entry)) return null;
    result.push(entry.value);
  }
  return result;
}
function tag(input: unknown): boolean | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const field = Object.getOwnPropertyDescriptor(input, "ok");
  return field?.enumerable && "value" in field && typeof field.value === "boolean" ? field.value : undefined;
}
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const ready = (value: unknown): value is ProfileCountAnalysisPlan["readinessState"] => value === "READY" || value === "READY_WITH_ACKNOWLEDGED_NOTICES";
function context(input: unknown): AnalysisDatasetContext | null {
  const value = record(input, contextKeys);
  if (!value || !contextKeys.every(key => typeof value[key] === "string" && (value[key] as string).trim())) return null;
  return value as unknown as AnalysisDatasetContext;
}
function failure(input: unknown, requestCount?: number): PlanningExchangeFailure | null {
  const base = record(input, ["ok", "code"]);
  const value = base ?? (requestCount === undefined ? null : record(input, ["ok", "code", "requestIndex"]));
  if (!value || value.ok !== false || !isPlanningFailureCode(value.code)) return null;
  if (!base && (requestCount === undefined || admissionCodes.has(value.code as string) || typeof value.requestIndex !== "number" ||
      !Number.isSafeInteger(value.requestIndex) || value.requestIndex < 0 || value.requestIndex >= requestCount)) return null;
  return { ok: false, code: value.code as PlanningExchangeFailure["code"],
    ...(!base ? { requestIndex: value.requestIndex as number } : {}) };
}

// Validation of a planning description only; even a decoded success is not
// provenance, current-state proof or an execution grant. Inspect response.ok.
export function parsePlanningCatalogResponse(input: unknown, expected: PlanningCatalogExpectation):
  ParsePlanningExchangeResult<{ ok: true; catalog: ReviewedProfileCountRequestCatalog }> {
  const pinned = context(expected.context);
  if (!pinned || !revision(expected.reviewRevision)) return invalid;
  if (tag(input) === false) {
    const denied = failure(input); return denied ? { ok: true, response: denied } : invalid;
  }
  const root = record(input, ["ok", "catalog"]);
  const catalog = record(root?.catalog, ["catalogVersion", "context", "reviewRevision", "readinessState", "requests"]);
  if (!root || root.ok !== true || !catalog || catalog.catalogVersion !== PROFILE_COUNT_REQUEST_CATALOG_VERSION ||
      !revision(catalog.reviewRevision) || !ready(catalog.readinessState)) return invalid;
  const scoped = context(catalog.context); const entries = array(catalog.requests);
  if (!scoped || !entries?.length) return invalid;
  const requests: ProfileCountRequestTemplate[] = []; const ids = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const parsed = parseAnalysisRequestInput(entries[index]);
    if (!parsed.ok) return invalid;
    const request = parsed.request;
    if (index === 0) {
      if (request.kind !== "ROW_COUNT") return invalid;
      requests.push({ requestVersion: "v1", kind: "ROW_COUNT" });
    } else {
      if (request.kind !== "AGGREGATE" || request.operator !== "COUNT_PRESENT" || ids.has(request.sourceSchemaColumnId)) return invalid;
      ids.add(request.sourceSchemaColumnId);
      requests.push({ requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: request.sourceSchemaColumnId, operator: "COUNT_PRESENT" });
    }
  }
  if (!validateAnalysisDatasetContexts(pinned, [scoped]).ok || catalog.reviewRevision !== expected.reviewRevision) return mismatch;
  return { ok: true, response: { ok: true, catalog: { catalogVersion: PROFILE_COUNT_REQUEST_CATALOG_VERSION,
    context: scoped, reviewRevision: catalog.reviewRevision, readinessState: catalog.readinessState, requests } } };
}

function plan(input: unknown): ProfileCountAnalysisPlan | null {
  const row = record(input, planKeys);
  const value = row ?? record(input, [...planKeys, "sourceSchemaColumnId", "missingValuePolicy"]);
  if (!value || value.planVersion !== ANALYSIS_PLAN_VERSION || value.readinessVersion !== ANALYSIS_READINESS_VERSION ||
      value.schemaVersion !== SEMANTIC_SCHEMA_VERSION || value.profilerVersion !== DATASET_PROFILER_VERSION ||
      value.qualityResolutionVersion !== DATA_QUALITY_REVIEW_RESOLUTION_VERSION || !ready(value.readinessState)) return null;
  if (row ? value.operation !== "ROW_COUNT" : (value.operation !== "COUNT_PRESENT" ||
      typeof value.sourceSchemaColumnId !== "string" || !value.sourceSchemaColumnId.trim() || value.missingValuePolicy !== "EXCLUDE_MISSING")) return null;
  return value as unknown as ProfileCountAnalysisPlan;
}
export function parsePlanningSelectionResponse(input: unknown, expected: PlanningSelectionExpectation):
  ParsePlanningExchangeResult<PlanningSelectionResponse> {
  const pinned = context(expected.context); const selected = parseProfileCountSelectionInput(expected.selection);
  const readinessState = expected.readinessState;
  if (!pinned || !selected.ok || !ready(readinessState)) return invalid;
  const selection = selected.selection;
  const count = selection.measureColumnIds.length + (selection.includeRowCount ? 1 : 0);
  if (tag(input) === false) {
    const denied = failure(input, count); return denied ? { ok: true, response: denied } : invalid;
  }
  const root = record(input, ["ok", "bundleVersion", "reviewRevision", "plans"]);
  if (!root || root.ok !== true || root.bundleVersion !== PROFILE_COUNT_BUNDLE_VERSION || !revision(root.reviewRevision) ||
      !Array.isArray(root.plans) || root.plans.length < 1 || root.plans.length > MAX_PROFILE_COUNT_BUNDLE_REQUESTS) return invalid;
  const entries = array(root.plans); if (!entries) return invalid;
  const plans: ScopedAnalysisSnapshot<ProfileCountAnalysisPlan>[] = [];
  for (const entry of entries) {
    const scoped = record(entry, ["context", "snapshot"]);
    const identity = context(scoped?.context); const snapshot = plan(scoped?.snapshot);
    if (!scoped || !identity || !snapshot) return invalid;
    plans.push({ context: identity, snapshot });
  }
  if (root.reviewRevision !== selection.expectedReviewRevision || plans.length !== count) return mismatch;
  for (let index = 0; index < plans.length; index++) {
    const { context: identity, snapshot } = plans[index];
    const row = selection.includeRowCount && index === 0;
    const measure = selection.measureColumnIds[index - (selection.includeRowCount ? 1 : 0)];
    if (!validateAnalysisDatasetContexts(pinned, [identity]).ok || snapshot.readinessState !== readinessState ||
        (row ? snapshot.operation !== "ROW_COUNT" : snapshot.operation !== "COUNT_PRESENT" || snapshot.sourceSchemaColumnId !== measure)) return mismatch;
  }
  return { ok: true, response: { ok: true, bundleVersion: PROFILE_COUNT_BUNDLE_VERSION, reviewRevision: root.reviewRevision, plans } };
}

// Format errors retain no response snippets or parser exception diagnostics.
export function parsePlanningCatalogJson(input: unknown, expected: PlanningCatalogExpectation):
  ReturnType<typeof parsePlanningCatalogResponse> {
  if (typeof input !== "string") return invalid;
  try { return parsePlanningCatalogResponse(JSON.parse(input), expected); } catch { return invalid; }
}
export function parsePlanningSelectionJson(input: unknown, expected: PlanningSelectionExpectation):
  ReturnType<typeof parsePlanningSelectionResponse> {
  if (typeof input !== "string") return invalid;
  try { return parsePlanningSelectionResponse(JSON.parse(input), expected); } catch { return invalid; }
}
