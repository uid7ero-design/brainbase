export type ReviewStatus = { statusVersion: "v1"; uploadId: string } & (
  | { state: "PREPARATION_REQUIRED" | "REVIEW_REQUIRED" }
  | { state: "REVIEWED" | "REVIEWED_WITH_NOTICES" | "QUALITY_HOLD"; datasetProfileRunId: string; reviewRevision: number }
);

// Metadata/navigation only. A decoded observation is never execution authority.
export function decodeReviewStatus(body: unknown, uploadId: string): ReviewStatus {
  const invalid = () => { throw new Error("RESPONSE_INVALID"); };
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(body);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]))) return invalid();
  if (["statusVersion", "uploadId", "state"].some(key => !Object.hasOwn(body, key))) return invalid();
  const value = body as Record<string, unknown>;
  if (value.statusVersion !== "v1" || value.uploadId !== uploadId || typeof uploadId !== "string" || !uploadId.trim() || uploadId.length > 512) return invalid();
  const reviewed = ["REVIEWED", "REVIEWED_WITH_NOTICES", "QUALITY_HOLD"].includes(value.state as string);
  if (!reviewed && !["PREPARATION_REQUIRED", "REVIEW_REQUIRED"].includes(value.state as string)) return invalid();
  const keys = reviewed ? ["statusVersion", "uploadId", "state", "datasetProfileRunId", "reviewRevision"] : ["statusVersion", "uploadId", "state"];
  if (Reflect.ownKeys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) return invalid();
  if (!reviewed) return { statusVersion: "v1", uploadId, state: value.state as "PREPARATION_REQUIRED" | "REVIEW_REQUIRED" };
  if (typeof value.datasetProfileRunId !== "string" || !value.datasetProfileRunId.trim() || value.datasetProfileRunId.length > 512 ||
      typeof value.reviewRevision !== "number" || !Number.isSafeInteger(value.reviewRevision) || value.reviewRevision < 1) return invalid();
  return { statusVersion: "v1", uploadId, state: value.state as "REVIEWED" | "REVIEWED_WITH_NOTICES" | "QUALITY_HOLD",
    datasetProfileRunId: value.datasetProfileRunId, reviewRevision: value.reviewRevision };
}
