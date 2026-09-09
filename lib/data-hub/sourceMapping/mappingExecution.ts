// Data Hub 5B.3 — pure, deterministic mapping execution.
//
// CORE ARCHITECTURAL RULE (do not violate without separate authorization):
// this module is STRUCTURAL ONLY. It answers "which source column supplies
// which canonical field?" — never "what does this value mean?". Business/
// value-level rules (waste_type interpretation, date parsing semantics,
// status/severity rules, cost/volume semantics) remain exclusively in
// lib/data-hub/importBatch/illegalDumpingMapper.ts and are never moved,
// copied, or re-implemented here. This module never imports a database
// client, never performs network I/O, and is safe to call with the same
// inputs any number of times and get the exact same output.
//
// CANONICAL FIELD SOURCE: reuses illegalDumpingMapper.ts's own exported
// ILLEGAL_DUMPING_KNOWN_HEADERS / ILLEGAL_DUMPING_REQUIRED_HEADERS
// constants directly (the same import mappingDocument.ts itself uses for
// its allowlist) — never re-derived or duplicated.
//
// REQUIRED-TARGET DISCOVERY NOTE: mappingDocument.ts's validateMappingDocument
// only enforces MIN_MAPPING_FIELDS >= 1 — it does NOT guarantee every
// ILLEGAL_DUMPING_REQUIRED_HEADERS entry is present as a configured
// canonical target. A structurally-valid-per-5B.2 MappingDocument can
// legally omit "report_date"/"location"/"waste_type" entirely. compileMapping
// below therefore independently enforces required-target completeness —
// this is NOT duplicated logic, it is a distinct invariant 5B.2 never
// established.
//
// HEADER MATCHING RULE: EXACT match after trimming ONLY. No case-folding,
// no fuzzy/substring/synonym matching. Rationale: mappingDocument.ts's
// validator already trims and stores the configured source header
// (`rawSourceHeader.trim()`), so the stored value in a persisted
// MappingDocument is always pre-trimmed — but lib/data-hub/csvOnlyDecoder.ts
// does NOT trim worksheet header text (confirmed by direct read: its
// `toHeaderStrings` only stringifies cells, no .trim()/case-fold call
// anywhere in that module). Comparing an already-trimmed configured value
// against a raw worksheet header would silently fail to match a header with
// benign incidental whitespace (e.g. a trailing space from a hand-edited
// CSV) even though a human would consider them identical — trimming the
// WORKSHEET header only, at compile time, for comparison purposes, closes
// that gap without introducing a second, divergent normalization layer:
// the illegalDumpingMapper.ts fixed-header path is completely untouched
// and keeps its own exact/untrimmed `headers.includes(h)` matching, which
// this module never re-implements or overrides.
//
// DUPLICATE-HEADER SEMANTICS: if a worksheet's headers, once trimmed,
// contain more than one occurrence of a configured source header string,
// resolution for that canonical target is AMBIGUOUS and rejected outright
// — never first-occurrence-wins, never last-occurrence-wins. This is
// deliberately STRICTER than illegalDumpingMapper.ts's own fixed-header
// Map-based lookup (which silently keeps the last occurrence for a
// duplicated header name) — that existing, narrower behavior is
// unmodified here (see illegalDumpingMapper.ts's own "5A.3A" doc comment)
// but this new, caller-configurable generic path must not repeat it.

import {
  ILLEGAL_DUMPING_KNOWN_HEADERS,
  ILLEGAL_DUMPING_REQUIRED_HEADERS,
} from "../importBatch/illegalDumpingMapper";
import type { MappingDocument } from "./mappingDocument";

/** The literal union of every legal canonical target field name — derived from
 * the same array illegalDumpingMapper.ts and mappingDocument.ts both use,
 * never redeclared. */
export type CanonicalFieldName = (typeof ILLEGAL_DUMPING_KNOWN_HEADERS)[number];

export interface CompiledMappingField {
  readonly canonicalTarget: CanonicalFieldName;
  readonly sourceHeader: string;
  readonly columnIndex: number;
}

/** Safe structural information only — no DB entity, no Prisma model, no
 * executable closure, no customer data, no mutable global state. */
export type CompiledMappingPlan = readonly CompiledMappingField[];

export type CompileMappingDiagnostic =
  | { readonly code: "MAPPING_REQUIRED_TARGET_MISSING"; readonly canonicalTarget: CanonicalFieldName }
  | {
      readonly code: "MAPPING_SOURCE_HEADER_MISSING";
      readonly canonicalTarget: CanonicalFieldName;
      readonly sourceHeader: string;
    }
  | {
      readonly code: "MAPPING_SOURCE_HEADER_AMBIGUOUS";
      readonly canonicalTarget: CanonicalFieldName;
      readonly sourceHeader: string;
      readonly occurrences: number;
    };

export type CompileMappingResult =
  | { readonly ok: true; readonly plan: CompiledMappingPlan }
  | { readonly ok: false; readonly errors: readonly CompileMappingDiagnostic[] };

/**
 * Compiles a validated MappingDocument against one worksheet's headers into
 * an indexed, reusable plan (or structural diagnostics). O(headers +
 * knownCanonicalFields) — headers are scanned exactly once, never rescanned
 * per row. Never mutates `document` or `headers`.
 *
 * NOTE ON "invalid mapping document": this function's signature requires an
 * already-validated MappingDocument (produced only by
 * mappingDocument.ts's validateMappingDocument), not `unknown` — so a
 * structurally invalid document (wrong shape, unknown canonical target,
 * non-string header, etc.) is a compile-time TypeScript error for any
 * caller, not a runtime branch here. There is deliberately no
 * "MAPPING_DOCUMENT_INVALID" runtime diagnostic in this module: that
 * validation is 5B.2's own, complete responsibility (mappingDocument.ts),
 * and duplicating it here would create two divergent sources of truth for
 * the same rule.
 */
export function compileMapping(document: MappingDocument, headers: readonly string[]): CompileMappingResult {
  const errors: CompileMappingDiagnostic[] = [];

  // 1. Required-target completeness — a distinct invariant 5B.2's own
  // validator does not enforce (see module header). Iterated in the fixed
  // ILLEGAL_DUMPING_REQUIRED_HEADERS order for deterministic diagnostics.
  const configuredTargets = new Set(Object.keys(document.fields));
  for (const requiredTarget of ILLEGAL_DUMPING_REQUIRED_HEADERS) {
    if (!configuredTargets.has(requiredTarget)) {
      errors.push({ code: "MAPPING_REQUIRED_TARGET_MISSING", canonicalTarget: requiredTarget });
    }
  }

  // 2. Build a header index ONCE. Map keys never touch the object
  // prototype chain regardless of the (untrusted) header text they hold —
  // this is what makes a worksheet header literally named "__proto__" or
  // "constructor" structurally inert here: it can only ever become a Map
  // key or a diagnostic VALUE, never an object property key.
  const headerOccurrences = new Map<string, number>();
  const headerFirstIndex = new Map<string, number>();
  headers.forEach((rawHeader, index) => {
    const trimmed = rawHeader.trim();
    headerOccurrences.set(trimmed, (headerOccurrences.get(trimmed) ?? 0) + 1);
    if (!headerFirstIndex.has(trimmed)) {
      headerFirstIndex.set(trimmed, index);
    }
  });

  // 3. Resolve every CONFIGURED canonical target, iterated in the fixed
  // ILLEGAL_DUMPING_KNOWN_HEADERS order — this, combined with step 1's
  // fixed order, makes the full diagnostic list deterministic independent
  // of `document.fields`' own (irrelevant) key insertion order.
  const plan: CompiledMappingField[] = [];
  for (const canonicalTarget of ILLEGAL_DUMPING_KNOWN_HEADERS) {
    const sourceHeader = document.fields[canonicalTarget];
    if (sourceHeader === undefined) continue; // not configured for this document

    const occurrences = headerOccurrences.get(sourceHeader) ?? 0;
    if (occurrences === 0) {
      errors.push({ code: "MAPPING_SOURCE_HEADER_MISSING", canonicalTarget, sourceHeader });
      continue;
    }
    if (occurrences > 1) {
      errors.push({ code: "MAPPING_SOURCE_HEADER_AMBIGUOUS", canonicalTarget, sourceHeader, occurrences });
      continue;
    }
    // Safe: headerFirstIndex is guaranteed to have `sourceHeader` because
    // occurrences === 1 was just confirmed against the same map's keys.
    plan.push({ canonicalTarget, sourceHeader, columnIndex: headerFirstIndex.get(sourceHeader) as number });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, plan };
}

/** Canonical output keys are exclusively drawn from the CompiledMappingPlan's
 * own `canonicalTarget` values, which in turn are exclusively drawn from
 * ILLEGAL_DUMPING_KNOWN_HEADERS — a fixed, server-owned allowlist. Untrusted
 * worksheet header/row text is therefore structurally incapable of becoming
 * an output object property key, regardless of its content. */
export type CanonicalRawRow = Readonly<Partial<Record<CanonicalFieldName, string>>>;

/**
 * Applies a compiled plan to exactly one decoded worksheet row. O(mapped
 * fields) — never rescans headers. Never mutates `plan` or `row`.
 *
 * Row-width handling (matches lib/data-hub/csvOnlyDecoder.ts's own
 * null/undefined -> "" convention, never leaking a raw `undefined`):
 *   - a row SHORTER than the mapped column index -> "" (empty string)
 *   - a row WIDER than any mapped column index -> the extra cells are
 *     simply never read; they cannot leak into the output because the
 *     output is built exclusively from `plan`'s own resolved indices.
 */
export function applyCompiledMappingToRow(plan: CompiledMappingPlan, row: readonly string[]): CanonicalRawRow {
  const result: Partial<Record<CanonicalFieldName, string>> = {};
  for (const field of plan) {
    const cell = row[field.columnIndex];
    result[field.canonicalTarget] = cell === undefined ? "" : cell;
  }
  return result;
}

/**
 * Pure batch helper: applies a compiled plan to every row in a caller-owned,
 * already-bounded array. No streaming, no DB/network, synchronous. Callers
 * that already enforce a row-count bound (e.g. csvOnlyDecoder.ts's own
 * CSV_ONLY_LIMITS) are expected to keep doing so before calling this —
 * this function does not itself impose a new limit.
 */
export function applyCompiledMappingToRows(plan: CompiledMappingPlan, rows: readonly (readonly string[])[]): CanonicalRawRow[] {
  return rows.map((row) => applyCompiledMappingToRow(plan, row));
}

/**
 * DOMAIN-MAPPER BOUNDARY ADAPTER — the narrowest possible reshape, no
 * business logic. lib/data-hub/importBatch/illegalDumpingMapper.ts's own
 * mapIllegalDumpingRows(headers, rows) expects the legacy POSITIONAL shape
 * (a fixed header array + parallel string[][] rows), not this module's
 * KEYED CanonicalRawRow objects. This function exists ONLY to reshape keyed
 * rows back into that positional contract — using illegalDumpingMapper.ts's
 * own ILLEGAL_DUMPING_KNOWN_HEADERS as the fixed column order — so the
 * real, completely unmodified mapIllegalDumpingRows can be called with
 * mapping-executor output. It does not interpret, validate, or default any
 * value; a missing canonical field on a given row becomes "" (empty
 * string), which mapIllegalDumpingRows' OWN existing required-field checks
 * (report_date/location/waste_type) already reject exactly as they would
 * for any other missing-required-column CSV. This function is not called
 * by any runtime import-flow code in this slice — it exists to prove, in
 * tests, that structural mapping output is domain-mapper-compatible.
 */
export function toIllegalDumpingMapperInput(canonicalRows: readonly CanonicalRawRow[]): {
  headers: string[];
  rows: string[][];
} {
  const headers = [...ILLEGAL_DUMPING_KNOWN_HEADERS];
  const rows = canonicalRows.map((canonicalRow) => headers.map((field) => canonicalRow[field] ?? ""));
  return { headers, rows };
}
