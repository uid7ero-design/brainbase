import { prepareReviewedProfileCountCatalog, type ProfileCountRequestTemplate } from "./reviewedProfileCountCatalog";
import { admitReviewPlanningScope } from "./reviewPlanningScope";
import type { ReviewedPlanningSnapshot } from "./reviewedProfileCountPlan";
import type { AnalysisDatasetContext } from "./scopedProfileCounts";
import { parsePlanningCatalogResponse, type PlanningExchangeFailure } from "./planningExchange";
import type { ProfileCountAnalysisPlan } from "./profileCountPlan";

export const PLANNING_PAGE_VERSION = "v1" as const;
export const MAX_PLANNING_PAGE_MEASURES = 50;
export interface PlanningPageRequest {
  pageVersion: typeof PLANNING_PAGE_VERSION; datasetProfileRunId: string;
  expectedReviewRevision: number; pageSize: number; offset: number;
}
export interface PlanningCatalogPage {
  pageVersion: typeof PLANNING_PAGE_VERSION; context: AnalysisDatasetContext; reviewRevision: number;
  readinessState: ProfileCountAnalysisPlan["readinessState"]; rowCountRequest: Extract<ProfileCountRequestTemplate, { kind: "ROW_COUNT" }>;
  offset: number; pageSize: number; totalMeasures: number;
  requests: readonly Extract<ProfileCountRequestTemplate, { kind: "AGGREGATE" }>[]; nextOffset: number | null;
}
export type PlanningPageResult = { ok: true; page: PlanningCatalogPage } | PlanningExchangeFailure;
const invalidRequest = { ok: false, code: "PLANNING_PAGE_INVALID" } as const;
const invalidResponse = { ok: false, code: "PLANNING_RESPONSE_INVALID" } as const;
const mismatch = { ok: false, code: "PLANNING_RESPONSE_MISMATCH" } as const;
function record(input: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const keys = Reflect.ownKeys(input); const fields = Object.getOwnPropertyDescriptors(input);
  if (keys.length !== names.length || !names.every(name => keys.includes(name) && fields[name].enumerable && "value" in fields[name])) return null;
  return Object.fromEntries(names.map(name => [name, fields[name].value]));
}
const pageSizeValid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PLANNING_PAGE_MEASURES;
export function parsePlanningPageRequest(input: unknown): { ok: true; request: PlanningPageRequest } | typeof invalidRequest {
  const value = record(input, ["pageVersion", "datasetProfileRunId", "expectedReviewRevision", "pageSize", "offset"]);
  if (!value || value.pageVersion !== PLANNING_PAGE_VERSION || typeof value.datasetProfileRunId !== "string" || !value.datasetProfileRunId.trim() ||
      typeof value.expectedReviewRevision !== "number" || !Number.isSafeInteger(value.expectedReviewRevision) || value.expectedReviewRevision < 1 ||
      !pageSizeValid(value.pageSize) || typeof value.offset !== "number" || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset % value.pageSize !== 0) return invalidRequest;
  return { ok: true, request: value as unknown as PlanningPageRequest };
}
// Query values are canonical decimal strings. Duplicate or extra fields fail.
export function parsePlanningPageQuery(query: URLSearchParams) {
  const keys = [...query.keys()];
  if (new Set(keys).size !== keys.length) return invalidRequest;
  const fields = Object.fromEntries(query.entries());
  for (const key of ["expectedReviewRevision", "pageSize", "offset"]) {
    if (!/^(0|[1-9][0-9]*)$/.test(fields[key] ?? "")) return invalidRequest;
  }
  return parsePlanningPageRequest({ ...fields, expectedReviewRevision: Number(fields.expectedReviewRevision), pageSize: Number(fields.pageSize), offset: Number(fields.offset) });
}
export function buildReviewedPlanningCatalogPage(expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot, input: unknown): PlanningPageResult {
  const parsed = parsePlanningPageRequest(input); if (!parsed.ok) return parsed;
  const checked = admitReviewPlanningScope(expected, review); if (!checked.ok) return checked;
  const request = parsed.request;
  if (request.datasetProfileRunId !== checked.context.datasetProfileRunId) return { ok: false, code: "REVIEW_PROFILE_CHANGED" };
  if (request.expectedReviewRevision !== checked.reviewRevision) return { ok: false, code: "REVIEW_REVISION_MISMATCH" };
  const prepared = prepareReviewedProfileCountCatalog(checked.context, { revision: checked.reviewRevision, schema: review.schema, quality: review.quality });
  if (!prepared.ok) return prepared;
  const total = prepared.measureColumnIds.length;
  if (total === 0 ? request.offset !== 0 : request.offset >= total) return invalidRequest;
  const length = Math.min(request.pageSize, total - request.offset);
  const requests = prepared.measureColumnIds.slice(request.offset, request.offset + length)
    .map(sourceSchemaColumnId => ({ requestVersion: "v1" as const, kind: "AGGREGATE" as const, operator: "COUNT_PRESENT" as const, sourceSchemaColumnId }));
  return { ok: true, page: { pageVersion: PLANNING_PAGE_VERSION, context: prepared.context,
    reviewRevision: prepared.reviewRevision, readinessState: prepared.readinessState,
    rowCountRequest: { requestVersion: "v1", kind: "ROW_COUNT" }, offset: request.offset, pageSize: request.pageSize,
    totalMeasures: total, requests, nextOffset: request.offset + length < total ? request.offset + length : null } };
}
export interface PlanningPageExpectation {
  context: AnalysisDatasetContext; reviewRevision: number; readinessState: string;
  pageSize: number; offset: number; measureColumnIds: readonly string[];
}
// Exact page membership/order is correlated to the loaded reviewed measures.
// Neither response admission nor an offset grants access or field capability.
export function parsePlanningCatalogPageJson(text: unknown, expected: PlanningPageExpectation):
  | { ok: true; response: PlanningPageResult } | typeof invalidResponse | typeof mismatch {
  if (typeof text !== "string") return invalidResponse;
  const pinned = parsePlanningPageRequest({ pageVersion: "v1", datasetProfileRunId: expected.context?.datasetProfileRunId,
    expectedReviewRevision: expected.reviewRevision, pageSize: expected.pageSize, offset: expected.offset });
  if (!pinned.ok || !["READY", "READY_WITH_ACKNOWLEDGED_NOTICES"].includes(expected.readinessState) || !Array.isArray(expected.measureColumnIds)) return invalidResponse;
  const ids: string[] = []; const seen = new Set<string>();
  for (let index = 0; index < expected.measureColumnIds.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(expected.measureColumnIds, index);
    if (!entry || !("value" in entry) || typeof entry.value !== "string" || !entry.value.trim() || seen.has(entry.value)) return invalidResponse;
    ids.push(entry.value); seen.add(entry.value);
  }
  let input: unknown; try { input = JSON.parse(text); } catch { return invalidResponse; }
  const denial = record(input, ["ok", "code"]);
  if (denial?.ok === false) {
    const decoded = parsePlanningCatalogResponse(input, expected);
    return decoded.ok && !decoded.response.ok ? { ok: true, response: decoded.response } : invalidResponse;
  }
  const root = record(input, ["ok", "page"]);
  const page = record(root?.page, ["pageVersion", "context", "reviewRevision", "readinessState", "rowCountRequest", "offset", "pageSize", "totalMeasures", "requests", "nextOffset"]);
  if (!root || root.ok !== true || !page || page.pageVersion !== "v1" || !pageSizeValid(page.pageSize) ||
      typeof page.offset !== "number" || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset % page.pageSize !== 0 ||
      typeof page.totalMeasures !== "number" || !Number.isSafeInteger(page.totalMeasures) || page.totalMeasures < 0 ||
      (page.totalMeasures === 0 ? page.offset !== 0 : page.offset >= page.totalMeasures) || !Array.isArray(page.requests)) return invalidResponse;
  const length = Math.min(page.pageSize, page.totalMeasures - page.offset);
  if (page.requests.length !== length || page.requests.length > MAX_PLANNING_PAGE_MEASURES ||
      page.nextOffset !== (page.offset + length < page.totalMeasures ? page.offset + length : null)) return invalidResponse;
  const entries: unknown[] = [page.rowCountRequest];
  for (let index = 0; index < page.requests.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(page.requests, index); if (!entry || !("value" in entry)) return invalidResponse;
    entries.push(entry.value);
  }
  const decoded = parsePlanningCatalogResponse({ ok: true, catalog: { catalogVersion: "v1", context: page.context,
    reviewRevision: page.reviewRevision, readinessState: page.readinessState, requests: entries } }, expected);
  if (!decoded.ok) return decoded;
  if (!decoded.response.ok) return invalidResponse;
  const catalog = decoded.response.catalog;
  if (page.offset !== expected.offset || page.pageSize !== expected.pageSize || page.totalMeasures !== ids.length ||
      catalog.readinessState !== expected.readinessState) return mismatch;
  const measures = catalog.requests.slice(1) as Extract<ProfileCountRequestTemplate, { kind: "AGGREGATE" }>[];
  if (measures.some((request, index) => request.sourceSchemaColumnId !== ids[expected.offset + index])) return mismatch;
  return { ok: true, response: { ok: true, page: { pageVersion: "v1", context: catalog.context, reviewRevision: catalog.reviewRevision,
    readinessState: catalog.readinessState, rowCountRequest: { requestVersion: "v1", kind: "ROW_COUNT" },
    offset: page.offset, pageSize: page.pageSize, totalMeasures: page.totalMeasures, requests: measures,
    nextOffset: page.nextOffset as number | null } } };
}
