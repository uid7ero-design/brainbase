import type { AnalysisCapabilitySet } from "./capabilities";

export const ANALYSIS_REQUEST_VERSION = "v1" as const;

// Requests describe intent only. COUNT_PRESENT is the only supported aggregate
// operator; a generic AGGREGATE intent remains valid but cannot yet be planned.
export type AnalysisRequest =
  | { requestVersion: typeof ANALYSIS_REQUEST_VERSION; kind: "ROW_COUNT" }
  | {
      requestVersion: typeof ANALYSIS_REQUEST_VERSION;
      kind: "GROUP_BY";
      sourceSchemaColumnId: string;
    }
  | {
      requestVersion: typeof ANALYSIS_REQUEST_VERSION;
      kind: "AGGREGATE";
      sourceSchemaColumnId: string;
      operator?: "COUNT_PRESENT";
    };

export type AnalysisRequestErrorCode =
  | "QUALITY_HOLD"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_CAPABILITY_VERSION"
  | "CAPABILITY_NOT_AVAILABLE";

export type ValidateAnalysisRequestResult =
  | { ok: true; request: AnalysisRequest }
  | { ok: false; code: AnalysisRequestErrorCode };

export function validateAnalysisRequest(
  capabilities: AnalysisCapabilitySet,
  input: unknown,
): ValidateAnalysisRequestResult {
  if (capabilities.state === "BLOCKED_QUALITY_HOLD") {
    return { ok: false, code: "QUALITY_HOLD" };
  }
  if (
    capabilities.capabilityVersion !== "v1" ||
    capabilities.readinessVersion !== "v1" ||
    capabilities.state !== "AVAILABLE"
  ) {
    return { ok: false, code: "UNSUPPORTED_CAPABILITY_VERSION" };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const request = input as Record<string, unknown>;
  if (request.requestVersion !== ANALYSIS_REQUEST_VERSION) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const keys = Object.keys(request);
  const hasOperator = keys.includes("operator");
  if (request.kind === "ROW_COUNT") {
    if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("requestVersion")) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    if (!capabilities.datasetCapabilities.includes("ROW_COUNT")) {
      return { ok: false, code: "CAPABILITY_NOT_AVAILABLE" };
    }
    return { ok: true, request: { requestVersion: "v1", kind: "ROW_COUNT" } };
  }
  if (
    (request.kind !== "GROUP_BY" && request.kind !== "AGGREGATE") ||
    typeof request.sourceSchemaColumnId !== "string" ||
    request.sourceSchemaColumnId.trim().length === 0 ||
    keys.length !== (hasOperator ? 4 : 3) ||
    (hasOperator && (request.kind !== "AGGREGATE" || request.operator !== "COUNT_PRESENT")) ||
    !keys.includes("kind") || !keys.includes("requestVersion") ||
    !keys.includes("sourceSchemaColumnId")
  ) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  if (!capabilities.fieldCapabilities.some(
    (entry) => entry.sourceSchemaColumnId === request.sourceSchemaColumnId &&
      entry.capability === request.kind,
  )) {
    return { ok: false, code: "CAPABILITY_NOT_AVAILABLE" };
  }
  if (request.kind === "AGGREGATE" && hasOperator) {
    return {
      ok: true,
      request: {
        requestVersion: "v1", kind: "AGGREGATE",
        sourceSchemaColumnId: request.sourceSchemaColumnId,
        operator: "COUNT_PRESENT",
      },
    };
  }
  return {
    ok: true,
    request: {
      requestVersion: "v1",
      kind: request.kind,
      sourceSchemaColumnId: request.sourceSchemaColumnId,
    },
  };
}
