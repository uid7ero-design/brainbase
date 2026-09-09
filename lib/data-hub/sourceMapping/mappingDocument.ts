// Data Hub 5B.2 — MappingVersion.mapping_document structural contract.
//
// This is deliberately the smallest possible declarative shape: a plain
// object with one key, `fields`, mapping a SERVER-OWNED canonical target
// field name to a caller-supplied source column header string. Nothing
// else is legal here.
//
// SCOPE BOUNDARY (do not expand without a separate authorization): this
// document identifies WHICH source column supplies a canonical field —
// it never carries VALUE-transformation rules, credentials, executable
// content, raw sample rows, or customer data. Those either belong to the
// domain mapper (lib/data-hub/importBatch/illegalDumpingMapper.ts, whose
// own value-level rules — e.g. how a `waste_type` VALUE like "Dumped
// Rubbish" is interpreted — are deliberately NEVER moved here) or are out
// of scope for 5B.2 entirely (Phase 6 value mappings/reconciliation).
//
// CANONICAL TARGET ALLOWLIST: reuses illegalDumpingMapper.ts's own
// exported ILLEGAL_DUMPING_KNOWN_HEADERS constant directly — never
// re-derived or duplicated — because Illegal Dumping is the only
// canonical transactional importer that exists today (5B.2 discovery).
// A client cannot invent a new canonical target field name; every key
// under `fields` must be one of these twelve.

import { ILLEGAL_DUMPING_KNOWN_HEADERS } from "../importBatch/illegalDumpingMapper";

export const CANONICAL_TARGET_FIELDS: readonly string[] = ILLEGAL_DUMPING_KNOWN_HEADERS;

// Bounded by the allowlist itself (a valid document can never legally
// have more entries than there are canonical targets to map), but kept
// as an explicit, independent constant so the bound is provably enforced
// even if the allowlist ever grows unexpectedly large.
export const MAX_MAPPING_FIELDS = CANONICAL_TARGET_FIELDS.length;
export const MAX_SOURCE_HEADER_LENGTH = 200;
export const MIN_MAPPING_FIELDS = 1;

export interface MappingDocument {
  fields: Record<string, string>;
}

export type MappingDocumentValidationError =
  | "NOT_AN_OBJECT"
  | "MISSING_FIELDS"
  | "FIELDS_NOT_AN_OBJECT"
  | "EMPTY_FIELDS"
  | "TOO_MANY_FIELDS"
  | "UNKNOWN_TOP_LEVEL_KEY"
  | "UNKNOWN_CANONICAL_TARGET"
  | "SOURCE_HEADER_NOT_STRING"
  | "SOURCE_HEADER_EMPTY"
  | "SOURCE_HEADER_TOO_LONG"
  | "DUPLICATE_SOURCE_HEADER";

export type MappingDocumentValidationResult =
  | { ok: true; document: MappingDocument }
  | { ok: false; error: MappingDocumentValidationError; detail: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted caller-supplied value against the structural
 * mapping-document contract. Returns a fully-typed, safe-to-persist
 * MappingDocument on success — the caller must persist exactly this
 * returned value (a fresh object built field-by-field below), never the
 * original untrusted input, so that no unexpected extra property can
 * ever reach the database even if some earlier check in this function is
 * ever weakened by a future edit.
 */
export function validateMappingDocument(input: unknown): MappingDocumentValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "NOT_AN_OBJECT", detail: "The mapping document must be a JSON object." };
  }

  const topKeys = Object.keys(input);
  if (!topKeys.includes("fields")) {
    return { ok: false, error: "MISSING_FIELDS", detail: "The mapping document must have a \"fields\" property." };
  }
  if (topKeys.length !== 1) {
    return {
      ok: false,
      error: "UNKNOWN_TOP_LEVEL_KEY",
      detail: "The mapping document may only contain a \"fields\" property.",
    };
  }

  const rawFields = input.fields;
  if (!isPlainObject(rawFields)) {
    return { ok: false, error: "FIELDS_NOT_AN_OBJECT", detail: "\"fields\" must be a JSON object." };
  }

  const entries = Object.entries(rawFields);
  if (entries.length < MIN_MAPPING_FIELDS) {
    return { ok: false, error: "EMPTY_FIELDS", detail: "The mapping document must map at least one field." };
  }
  if (entries.length > MAX_MAPPING_FIELDS) {
    return {
      ok: false,
      error: "TOO_MANY_FIELDS",
      detail: `The mapping document may contain at most ${MAX_MAPPING_FIELDS} field mappings.`,
    };
  }

  const fields: Record<string, string> = {};
  const seenSourceHeaders = new Set<string>();

  for (const [canonicalTarget, rawSourceHeader] of entries) {
    if (!CANONICAL_TARGET_FIELDS.includes(canonicalTarget)) {
      return {
        ok: false,
        error: "UNKNOWN_CANONICAL_TARGET",
        detail: `"${canonicalTarget}" is not a recognized canonical target field.`,
      };
    }
    if (typeof rawSourceHeader !== "string") {
      return {
        ok: false,
        error: "SOURCE_HEADER_NOT_STRING",
        detail: `The source column for "${canonicalTarget}" must be a string.`,
      };
    }
    const sourceHeader = rawSourceHeader.trim();
    if (sourceHeader.length === 0) {
      return {
        ok: false,
        error: "SOURCE_HEADER_EMPTY",
        detail: `The source column for "${canonicalTarget}" must not be empty.`,
      };
    }
    if (sourceHeader.length > MAX_SOURCE_HEADER_LENGTH) {
      return {
        ok: false,
        error: "SOURCE_HEADER_TOO_LONG",
        detail: `The source column for "${canonicalTarget}" exceeds ${MAX_SOURCE_HEADER_LENGTH} characters.`,
      };
    }
    // Conservative rule (5B.2 discovery — no proven current use case for
    // ambiguous multi-target source columns): a single source column may
    // not simultaneously feed two different canonical fields.
    const dedupeKey = sourceHeader.toLowerCase();
    if (seenSourceHeaders.has(dedupeKey)) {
      return {
        ok: false,
        error: "DUPLICATE_SOURCE_HEADER",
        detail: `Source column "${sourceHeader}" is already mapped to another canonical field.`,
      };
    }
    seenSourceHeaders.add(dedupeKey);

    fields[canonicalTarget] = sourceHeader;
  }

  return { ok: true, document: { fields } };
}
