// Data Hub 5B.2 — Source System / Mapping administrative service contracts.
//
// AUTH BOUNDARY: exactly the same discipline as lib/data-hub/importBatch/
// read.ts — every exported service function in this domain accepts an
// already-resolved trusted context (organisationId, actor userId where
// relevant) as plain parameters. Services never import lib/org.ts and
// never resolve their own session; the HTTP route layer
// (app/api/data-hub/source-systems/**, source-mappings/**,
// mapping-versions/**) is the only place requireRole() is called, and it
// passes session.organisationId (never session.homeOrganisationId, never
// anything from request input) into these services.
//
// This slice is administrative persistence only — no mapping execution,
// no import-flow integration. ImportBatch.source_system_id and
// Upload.mapping_version_id (5B.1) remain entirely unwritten by anything
// in this module.

import { Prisma } from "@prisma/client";
import type { MappingDocument } from "./mappingDocument";

export type SourceMappingFailureCode =
  | "NOT_FOUND"
  | "SOURCE_SYSTEM_NOT_FOUND"
  | "SOURCE_MAPPING_NOT_FOUND"
  | "MAPPING_VERSION_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DUPLICATE_NAME"
  | "SOURCE_SYSTEM_INACTIVE"
  | "SOURCE_MAPPING_INACTIVE"
  | "VERSION_ALLOCATION_CONFLICT"
  | "VERSION_MISMATCH"
  | "INVALID_CURSOR"
  | "INVALID_LIMIT";

const MESSAGES: Record<SourceMappingFailureCode, string> = {
  NOT_FOUND: "The requested record was not found.",
  SOURCE_SYSTEM_NOT_FOUND: "Source system not found.",
  SOURCE_MAPPING_NOT_FOUND: "Source mapping not found.",
  MAPPING_VERSION_NOT_FOUND: "Mapping version not found.",
  VALIDATION_ERROR: "The request was not valid.",
  DUPLICATE_NAME: "A record with this name already exists.",
  SOURCE_SYSTEM_INACTIVE: "This source system is inactive.",
  SOURCE_MAPPING_INACTIVE: "This source mapping is inactive.",
  VERSION_ALLOCATION_CONFLICT: "Could not allocate a mapping version number. Please retry.",
  VERSION_MISMATCH: "That mapping version does not belong to this source mapping.",
  INVALID_CURSOR: "The pagination cursor provided is not valid. Request the first page again without a cursor.",
  INVALID_LIMIT: "The requested page size is not valid.",
};

export function messageFor(code: SourceMappingFailureCode): string {
  return MESSAGES[code];
}

export function fail<C extends SourceMappingFailureCode>(code: C): { ok: false; code: C; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Detects a specific Prisma P2002 unique-constraint violation for a given
 * SET of columns. Prisma's `err.meta.target` shape is NOT stable across
 * constraint styles: for some constraints it is the single DB constraint
 * name as one string (e.g. "source_mappings_source_system_id_name_key"),
 * for others (observed under real concurrent load against a real
 * Postgres instance — see
 * scripts/tests/datahubSourceMappingServices.integration.test.ts's own
 * concurrency proof) it is an ARRAY of the individual column names
 * instead (e.g. ["source_mapping_id", "version_number"]). This checks
 * that every required column name appears SOMEWHERE across the
 * (possibly multi-element) target, regardless of which shape Prisma
 * happened to report — never assumes one specific shape.
 */
export function isUniqueViolationOn(err: unknown, requiredColumns: readonly string[]): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const targets: string[] = typeof target === "string" ? [target] : Array.isArray(target) ? target.filter((t): t is string => typeof t === "string") : [];
  if (targets.length === 0) return false;
  const haystack = targets.join(" ");
  return requiredColumns.every((col) => haystack.includes(col));
}

// ---------------------------------------------------------------------------
// DTOs — explicit field-by-field mapping only, never a raw Prisma row and
// never `...row`. No credential/storage/config field exists on any of
// these models to leak, but the discipline is kept identical to the rest
// of lib/data-hub for consistency and future-proofing.
// ---------------------------------------------------------------------------

export interface SourceSystemDTO {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceMappingDTO {
  id: string;
  sourceSystemId: string;
  name: string;
  active: boolean;
  activeMappingVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MappingVersionDTO {
  id: string;
  sourceMappingId: string;
  versionNumber: number;
  mappingDocument: MappingDocument;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Trusted contexts / inputs
// ---------------------------------------------------------------------------

export interface TrustedActor {
  organisationId: string;
  userId: string;
}

export type ActiveFilter = "true" | "false" | "all";

export interface ListPageInput {
  cursor?: string;
  limit?: number;
}

export interface ListPageResult<T> {
  items: T[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
