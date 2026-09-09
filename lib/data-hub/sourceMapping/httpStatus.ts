// Data Hub 5B.2 — deterministic SourceMappingFailureCode -> HTTP status
// mapping, shared by every route under app/api/data-hub/{source-systems,
// source-mappings,mapping-versions}/**. Never exposes the raw Prisma
// error or a stack trace; only this repository's own stable
// code/message pair (see types.ts's messageFor()).

import type { SourceMappingFailureCode } from "./types";

export function statusForFailureCode(code: SourceMappingFailureCode): number {
  switch (code) {
    case "SOURCE_SYSTEM_NOT_FOUND":
    case "SOURCE_MAPPING_NOT_FOUND":
    case "MAPPING_VERSION_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "VALIDATION_ERROR":
    case "INVALID_CURSOR":
    case "INVALID_LIMIT":
      return 400;
    case "DUPLICATE_NAME":
    case "SOURCE_SYSTEM_INACTIVE":
    case "SOURCE_MAPPING_INACTIVE":
    case "VERSION_MISMATCH":
      return 409;
    case "VERSION_ALLOCATION_CONFLICT":
      return 503;
    default:
      return 500;
  }
}
