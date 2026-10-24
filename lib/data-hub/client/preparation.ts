import { preparationJson } from "./preparationTransport";

export const PREPARATION_STEPS = ["stage", "normalize", "profile"] as const;
export type PreparationStep = typeof PREPARATION_STEPS[number];
export type PreparationStatus = "NOT_READY" | "NOT_STARTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABANDONED";
export type PreparationSnapshot = Record<PreparationStep, { status: PreparationStatus; rowCount?: number }>;
const statuses: readonly string[] = ["NOT_READY", "NOT_STARTED", "RUNNING", "SUCCEEDED", "FAILED", "ABANDONED"];
const failureCodes = new Set(["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND", "STAGING_INELIGIBLE", "NORMALIZATION_INELIGIBLE",
  "PROFILE_DOCUMENT_INVALID", "NORMALIZATION_PLAN_INVALID", "NORMALIZATION_BLOCKED", "PROFILE_INPUT_INVALID",
  "INTERACTIVE_PROFILE_LIMIT", "RUN_ALREADY_IN_PROGRESS", "LEASE_LOST", "PROFILER_VERSION_UNSUPPORTED"]);

export async function preparationRequest(uploadId: string, step: PreparationStep, method: "GET" | "POST", signal: AbortSignal) {
  const { response, body } = await preparationJson(`/api/data-hub/worksheets/${encodeURIComponent(uploadId)}/${step}`, method, signal);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("RESPONSE_INVALID");
  const data = body as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    const code = response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : response.status === 404 ? "UPLOAD_NOT_FOUND"
      : typeof data.code === "string" && failureCodes.has(data.code) ? data.code : "PREPARATION_FAILED";
    throw new Error(code);
  }
  if ((method === "GET" && response.status !== 200) || typeof data.status !== "string" || !statuses.includes(data.status) ||
      (step !== "profile" && data.status === "NOT_READY") ||
      (method === "POST" && !["RUNNING", "SUCCEEDED"].includes(data.status)) ||
      (method === "POST" && response.status !== (data.status === "RUNNING" ? 202 : 200))) throw new Error("RESPONSE_INVALID");
  const validCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (data.rowCount !== undefined && !validCount(data.rowCount)) throw new Error("RESPONSE_INVALID");
  if (step === "profile" && data.status === "SUCCEEDED" && (!validCount(data.rowCount) || !validCount(data.columnCount))) {
    throw new Error("RESPONSE_INVALID");
  }
  return { status: data.status as PreparationStatus, ...(data.rowCount === undefined ? {} : { rowCount: data.rowCount as number }) };
}

export async function readPreparationStatus(uploadId: string, signal: AbortSignal): Promise<PreparationSnapshot> {
  const statuses = await Promise.all(PREPARATION_STEPS.map(step => preparationRequest(uploadId, step, "GET", signal)));
  return { stage: statuses[0], normalize: statuses[1], profile: statuses[2] };
}
