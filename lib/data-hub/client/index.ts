// Data Hub 5A.3B — public barrel for the browser orchestration client.
// NO UI here (no React/JSX/component of any kind) — see this package's own
// governing spec (Phase 5A.3B). 5A.3C consumes this barrel to build the
// actual rendered flow.

export {
  DataHubIllegalDumpingImportSession,
  createIllegalDumpingImportSession,
  resolveUploadPathname,
} from "./orchestrator";
export type {
  DataHubImportState,
  DataHubOrchestratorConfig,
  ImportBatchHandle,
  StartImportOptions,
} from "./orchestrator";

export { generateIdempotencyKey } from "./fileHash";

export { uploadFileDirectToBlob } from "./blobUpload";
export type { DirectUploadInput, DirectUploadResult, DirectUploadSuccess, DirectUploadFailure } from "./blobUpload";

export * from "./types";

export {
  confirmIllegalDumping,
  finalizeImportBatch,
  getImportBatch,
  initiateImportBatch,
  inspectCsvWorksheet,
  listWorksheetsForBatch,
} from "./httpClient";
export type { HttpClientConfig, CallOptions, InitiateCallInput } from "./httpClient";
