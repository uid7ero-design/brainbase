import { SEMANTIC_ROLES, type SemanticRole } from "../semanticInference/contracts";
import { SEMANTIC_CLARIFICATION_REASONS } from "../semanticInference/clarification";
import { SEMANTIC_FIELD_CLASSES, type SemanticFieldClass } from "../semanticInference/schemaSynthesis";
import { DATA_QUALITY_OBSERVATION_CODES, type DataQualityObservationCode } from "../dataQuality/contracts";
import type { DataQualityReviewDecision } from "../dataQuality/reviewResolution";
import { copyAnalysisDatasetContext, validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "../analysis/scopedProfileCounts";
import { analysisFailureReference } from "../analysis/failureReference";
import { fetchPlanningText } from "./planningTransport";

export const MAX_REVIEW_FIELDS = 1_000;
type QualityIdentity = { code: DataQualityObservationCode; scope: "DATASET" | "COLUMN"; sourceSchemaColumnId?: string };
export type ReviewPlan = { datasetProfileRunId: string;
  clarification: { columns: { sourceSchemaColumnId: string; resolutionState: "RESOLVED" | "CLARIFICATION_REQUIRED"; candidateRoles: SemanticRole[]; reasons: string[] }[] };
  fieldLabels: { sourceSchemaColumnId: string; label: string }[];
  quality: { items: (QualityIdentity & { action: "ACKNOWLEDGE_NOTICE" | "REVIEW_DATASET" | "REVIEW_COLUMN" })[] } | null };
export type SessionReview = { revision: number;
  schema: { context: AnalysisDatasetContext; snapshot: { fields: { sourceSchemaColumnId: string; semanticRole: SemanticRole; fieldClass: SemanticFieldClass; resolutionSource: "AUTO_HIGH_CONFIDENCE" | "CLARIFIED_CHOICE" }[] } };
  quality: { context: AnalysisDatasetContext; snapshot: { state: "READY" | "READY_WITH_ACKNOWLEDGED_NOTICES" | "HOLD_FOR_REMEDIATION";
    items: (QualityIdentity & { decision: DataQualityReviewDecision })[] } } };
const invalid = (): never => { throw new Error("RESPONSE_INVALID"); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]))) return invalid();
  // Copy own data so inherited properties cannot become accepted metadata.
  return Object.assign(Object.create(null), value);
}
function closed(value: unknown, keys: string[]) {
  const row = record(value); if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalid(); return row;
}
const id = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 512 ? value : invalid();
const list = (value: unknown, max: number) => Array.isArray(value) && value.length <= max && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean) ? value as unknown[] : invalid();
const fieldsList = (value: unknown) => { if (Array.isArray(value) && value.length > MAX_REVIEW_FIELDS) throw new Error("REVIEW_FIELD_LIMIT"); return list(value, MAX_REVIEW_FIELDS); };
const enumeration = <T extends string>(value: unknown, choices: readonly T[]): T => typeof value === "string" && (choices as readonly string[]).includes(value) ? value as T : invalid();
const versions = (row: Record<string, unknown>, keys: string[]) => { if (keys.some(key => row[key] !== "v1")) invalid(); };
const distinct = (values: string[]) => { if (new Set(values).size !== values.length) invalid(); };
function qualityItems(value: unknown, fields: Set<string>, kind: "action"): NonNullable<ReviewPlan["quality"]>["items"];
function qualityItems(value: unknown, fields: Set<string>, kind: "decision"): SessionReview["quality"]["snapshot"]["items"];
function qualityItems(value: unknown, fields: Set<string>, kind: "action" | "decision") {
  const items = list(value, (MAX_REVIEW_FIELDS + 1) * DATA_QUALITY_OBSERVATION_CODES.length).map(value => {
    const row = record(value), code = enumeration(row.code, DATA_QUALITY_OBSERVATION_CODES), scope = enumeration(row.scope, ["DATASET", "COLUMN"] as const);
    const column = scope === "COLUMN" ? id(row.sourceSchemaColumnId) : undefined;
    if ((column && !fields.has(column)) || (scope === "DATASET" && row.sourceSchemaColumnId !== undefined)) invalid();
    const identity = { code, scope, ...(column === undefined ? {} : { sourceSchemaColumnId: column }) };
    if (kind === "decision") return { ...identity, decision: enumeration(row.decision, ["ACKNOWLEDGE", "CONTINUE", "HOLD"] as const) };
    const action = enumeration(row.action, ["ACKNOWLEDGE_NOTICE", "REVIEW_DATASET", "REVIEW_COLUMN"] as const);
    if (action !== "ACKNOWLEDGE_NOTICE" && action !== (scope === "COLUMN" ? "REVIEW_COLUMN" : "REVIEW_DATASET")) invalid();
    return { ...identity, action };
  });
  distinct(items.map(item => JSON.stringify([item.code, item.scope, item.sourceSchemaColumnId ?? null])));
  return items;
}
export function decodeReviewPlan(body: unknown, expectedProfile?: string): ReviewPlan {
  const value = closed(body, ["ok", "datasetProfileRunId", "clarification", "quality", "fieldLabels"]);
  if (value.ok !== true) invalid(); const profile = id(value.datasetProfileRunId);
  if (expectedProfile !== undefined && profile !== expectedProfile) throw new Error("REVIEW_PROFILE_CHANGED");
  const clarification = record(value.clarification); versions(clarification, ["clarificationVersion", "inferenceVersion", "profilerVersion"]);
  const columns = fieldsList(clarification.columns).map(value => {
    const row = record(value), sourceSchemaColumnId = id(row.sourceSchemaColumnId);
    const resolutionState = enumeration(row.resolutionState, ["RESOLVED", "CLARIFICATION_REQUIRED"] as const);
    const candidateRoles = list(row.candidateRoles, SEMANTIC_ROLES.length).map(role => enumeration(role, SEMANTIC_ROLES)); distinct(candidateRoles);
    if (resolutionState === "RESOLVED" && candidateRoles.length !== 1) invalid();
    const reasons = list(row.reasons, SEMANTIC_CLARIFICATION_REASONS.length).map(reason => enumeration(reason, SEMANTIC_CLARIFICATION_REASONS)); distinct(reasons);
    return { sourceSchemaColumnId, resolutionState, candidateRoles, reasons };
  });
  distinct(columns.map(column => column.sourceSchemaColumnId));
  const fieldLabels = fieldsList(value.fieldLabels).map((value, index) => {
    const row = record(value), sourceSchemaColumnId = id(row.sourceSchemaColumnId);
    if (sourceSchemaColumnId !== columns[index]?.sourceSchemaColumnId || typeof row.label !== "string" || !row.label.trim() || row.label.length > 4096) return invalid();
    return { sourceSchemaColumnId, label: row.label };
  });
  if (fieldLabels.length !== columns.length) invalid();
  let quality: ReviewPlan["quality"] = null;
  if (value.quality !== null) {
    const row = record(value.quality); versions(row, ["reviewVersion", "qualityVersion", "profilerVersion", "schemaVersion"]);
    quality = { items: qualityItems(row.items, new Set(columns.map(column => column.sourceSchemaColumnId)), "action") };
  }
  return { datasetProfileRunId: profile, clarification: { columns }, fieldLabels, quality };
}
export function decodeSessionReview(body: unknown, uploadId: string, expectedProfile: string, expectedFieldIds?: string[]): SessionReview {
  const value = closed(body, ["ok", "revision", "schema", "quality"]); if (value.ok !== true || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) invalid();
  const schema = record(value.schema), quality = record(value.quality), context = record(schema.context) as unknown as AnalysisDatasetContext;
  const qualityContext = record(quality.context) as unknown as AnalysisDatasetContext;
  if (!validateAnalysisDatasetContexts(context, [qualityContext]).ok || context.uploadId !== uploadId) throw new Error("DATASET_CONTEXT_MISMATCH");
  if (context.datasetProfileRunId !== expectedProfile) throw new Error("REVIEW_PROFILE_CHANGED");
  Object.values(copyAnalysisDatasetContext(context)).forEach(id);
  const snapshot = record(schema.snapshot), resolved = record(quality.snapshot);
  versions(snapshot, ["schemaVersion", "resolutionVersion", "inferenceVersion", "profilerVersion"]);
  versions(resolved, ["resolutionVersion", "reviewVersion", "qualityVersion", "profilerVersion", "schemaVersion"]);
  const fields = fieldsList(snapshot.fields).map(value => {
    const row = record(value); return { sourceSchemaColumnId: id(row.sourceSchemaColumnId), semanticRole: enumeration(row.semanticRole, SEMANTIC_ROLES),
      fieldClass: enumeration(row.fieldClass, SEMANTIC_FIELD_CLASSES), resolutionSource: enumeration(row.resolutionSource, ["AUTO_HIGH_CONFIDENCE", "CLARIFIED_CHOICE"] as const) };
  }); distinct(fields.map(field => field.sourceSchemaColumnId));
  if (expectedFieldIds && (fields.length !== expectedFieldIds.length || fields.some(field => !expectedFieldIds.includes(field.sourceSchemaColumnId)))) invalid();
  const items = qualityItems(resolved.items, new Set(fields.map(field => field.sourceSchemaColumnId)), "decision");
  const state = enumeration(resolved.state, ["READY", "READY_WITH_ACKNOWLEDGED_NOTICES", "HOLD_FOR_REMEDIATION"] as const);
  if ((state === "HOLD_FOR_REMEDIATION") !== items.some(item => item.decision === "HOLD") ||
    (state !== "HOLD_FOR_REMEDIATION" && (state === "READY_WITH_ACKNOWLEDGED_NOTICES") !== items.some(item => item.decision === "ACKNOWLEDGE"))) invalid();
  return { revision: value.revision as number, schema: { context: copyAnalysisDatasetContext(context), snapshot: { fields } },
    quality: { context: copyAnalysisDatasetContext(qualityContext), snapshot: { state, items } } };
}
export function decodeReviewSave(body: unknown): number {
  const row = closed(body, ["ok", "revision"]); if (row.ok !== true || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1) return invalid(); return row.revision as number;
}
export async function requestReviewJson(url: string, controller: AbortController, body?: unknown): Promise<unknown> {
  const response = await fetchPlanningText(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }, controller);
  if (!response.ok) throw new Error(response.code === "PLANNING_RESPONSE_INVALID" ? "RESPONSE_INVALID" : response.code);
  let value: Record<string, unknown>; try { value = record(JSON.parse(response.text)); } catch { return invalid(); }
  if (!response.httpOk || value.ok !== true) throw new Error(analysisFailureReference(value.code));
  return value;
}
