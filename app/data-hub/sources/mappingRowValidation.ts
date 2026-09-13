// Data Hub 6.1C — pure, DOM-free client-side UX validation for the
// MappingVersion creation form. Mirrors, but never replaces, the server's
// authoritative checks in lib/data-hub/sourceMapping/mappingDocument.ts's
// validateMappingDocument (structure/vocabulary/length/duplicates) plus the
// "required for a governed Illegal Dumping import" list — the server has
// NO "required targets present" check at MappingVersion-creation time
// today (only at worksheet Confirm, via the mapper's own required-header
// check), so this exists specifically to surface that gap early as UX,
// never as a substitute for server enforcement.
//
// Kept in its own file (no React/DOM import) so it is independently
// unit-testable and reusable, rather than embedded inline in
// SourcesAdminClient.tsx.

import { MAX_SOURCE_HEADER_LENGTH } from "@/lib/data-hub/sourceMapping/mappingDocument";
import { ILLEGAL_DUMPING_REQUIRED_HEADERS } from "@/lib/data-hub/importBatch/illegalDumpingMapper";

export interface MappingFieldRow {
  canonicalTarget: string;
  sourceHeader: string;
}

/**
 * Returns a human-readable validation error, or null if the rows are valid
 * enough to submit. Blank rows (empty sourceHeader) are treated as unused
 * and ignored, exactly like the server (validateMappingDocument only sees
 * whatever the caller actually includes in `fields`).
 */
export function validateMappingRows(rows: readonly MappingFieldRow[]): string | null {
  const nonEmptyRows = rows.filter((r) => r.sourceHeader.trim().length > 0);

  if (nonEmptyRows.length === 0) {
    return "At least one field mapping is required.";
  }

  for (const row of nonEmptyRows) {
    if (row.sourceHeader.trim().length > MAX_SOURCE_HEADER_LENGTH) {
      return `The source column for "${row.canonicalTarget}" exceeds ${MAX_SOURCE_HEADER_LENGTH} characters.`;
    }
  }

  const targets = nonEmptyRows.map((r) => r.canonicalTarget);
  if (new Set(targets).size !== targets.length) {
    return "Each canonical target can only be mapped once.";
  }

  const headers = nonEmptyRows.map((r) => r.sourceHeader.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) {
    return "Each source column can only be mapped to one canonical target.";
  }

  const missingRequired = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter((req) => !targets.includes(req));
  if (missingRequired.length > 0) {
    return `Missing required canonical target(s): ${missingRequired.join(", ")}.`;
  }

  return null;
}

/** Builds the exact mapping_document `fields` payload from the rows, in the
 * same shape validateMappingDocument on the server expects: keys are
 * canonical targets, values are the caller-supplied source header
 * strings. Blank rows are omitted. */
export function buildMappingDocumentFields(rows: readonly MappingFieldRow[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    const header = row.sourceHeader.trim();
    if (header.length > 0) fields[row.canonicalTarget] = header;
  }
  return fields;
}
