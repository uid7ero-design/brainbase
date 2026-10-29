import { evaluateRunsPilotReview, type RunsPilotReview } from "../schemaProfiles/runsPilotReview";
import { preparationJson } from "./preparationTransport";

export type MappingSnapshot = { ok: true; kind: "NOT_APPLICABLE" } | { ok: true; kind: "SETUP" | "PINNED";
  fingerprint: string; version: number; canSave: boolean; saved: boolean; confirmed: boolean; review: RunsPilotReview };
export function parseMappingSnapshot(raw: unknown): MappingSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (d.ok !== true) return null;
  if (d.kind === "NOT_APPLICABLE") return Object.keys(d).sort().join(",") === "kind,ok" ? { ok: true, kind: "NOT_APPLICABLE" } : null;
  if (!["SETUP", "PINNED"].includes(d.kind as string) || Object.keys(d).sort().join(",") !== "canSave,confirmed,fingerprint,kind,ok,review,saved,version" ||
    typeof d.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(d.fingerprint) ||
    typeof d.version !== "number" || !Number.isSafeInteger(d.version) || d.version < 1 ||
    typeof d.canSave !== "boolean" || typeof d.saved !== "boolean" || typeof d.confirmed !== "boolean" || (d.confirmed && !d.saved)) return null;
  const result = evaluateRunsPilotReview(d.review);
  if (!result.ok || (d.saved && (!result.reviewComplete || result.blockers.length))) return null;
  return { ok: true, kind: d.kind as "SETUP" | "PINNED", fingerprint: d.fingerprint, version: d.version,
    canSave: d.canSave, saved: d.saved, confirmed: d.confirmed, review: result.review };
}
const codes = new Set(["MAPPING_STALE", "MAPPING_NOT_READY", "MAPPING_REVIEW_INVALID", "MAPPING_ALREADY_STARTED"]);
export async function mappingSetupRequest(uploadId: string, signal: AbortSignal, action?: { action: "SAVE"; fingerprint: string; review: RunsPilotReview } | { action: "CONFIRM"; fingerprint: string }) {
  const { response, body } = await preparationJson(`/api/data-hub/worksheets/${encodeURIComponent(uploadId)}/mapping-setup`, action ? "POST" : "GET", signal, action);
  if (!response.ok) {
    const code = body && typeof body === "object" && "code" in body ? (body as { code: unknown }).code : null;
    throw new Error(typeof code === "string" && codes.has(code) ? code : "MAPPING_SETUP_UNAVAILABLE");
  }
  const snapshot = parseMappingSnapshot(body);
  if (!snapshot) throw new Error("RESPONSE_INVALID");
  return snapshot;
}
