import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { decodeCsvOnly, CsvOnlyDecodeError } from "../csvOnlyDecoder";
import { ILLEGAL_DUMPING_REQUIRED_HEADERS, IllegalDumpingMappingError, mapIllegalDumpingRows, validateIllegalDumpingHeaders } from "./illegalDumpingMapper";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";
import { validateMappingDocument, type MappingDocument } from "../sourceMapping/mappingDocument";
import { compileMapping, applyCompiledMappingToRows, toIllegalDumpingMapperInput, type CanonicalRawRow, type CompileMappingDiagnostic } from "../sourceMapping/mappingExecution";

// Data Hub 5A.3C.0 — dark^H^H live (route-wrapped) bounded, read-only CSV
// worksheet preview service. Design authority: the completed 5A.3C.0
// read-only discovery (see that phase's own report — sections D-M). This
// file implements exactly the architecture that discovery selected; it
// does not introduce any new design decision.
//
// AUTH BOUNDARY: identical discipline to every other importBatch service
// (initiate.ts/finalize.ts/inspectCsvWorksheet.ts/confirmWorksheet.ts/
// read.ts) — this function accepts an already-resolved trusted context
// (organisationId, worksheetId) as plain parameters. It never resolves its
// own auth/session. The route wrapping this service
// (app/api/data-hub/worksheets/[id]/preview/route.ts) enforces manager+
// role authorization via requireRole("manager") and derives organisationId
// exclusively from the resolved session, never from request input.
//
// TENANT-BEFORE-STORAGE (security-critical, discovery Section 13): the
// tenant+lineage-scoped worksheet lookup (Step 1), the eligibility check
// (Step 2), the tenant-scoped parent batch lookup (Step 3), the format gate
// (Step 4), and — 5B.4C — frozen mapping-lineage RESOLUTION (Step 4.5, for
// a mapped worksheet only) ALL happen before storage.get() is ever called
// (Step 5). A caller supplying another organisation's worksheet id, or a
// worksheet with broken/foreign/corrupt frozen mapping lineage, can never
// cause this service to locate, HEAD, GET, decode, or hash that tenant's
// storage object — Steps 1-4.5 must all succeed, tenant-scoped, before
// Step 5 is ever reached.
//
// READ-ONLY: this function performs ZERO Prisma writes of any kind — no
// upload.update*, no importBatch.update*, no illegalDumping.createMany, no
// $transaction. It never confirms, imports, or mutates worksheet/batch
// status. It must NEVER import confirmWorksheet.ts or call
// confirmDataHubWorksheet.
//
// SCOPE: CSV-classified batches only, identical discipline to
// inspectCsvWorksheet.ts/confirmWorksheet.ts. This file MUST NOT import
// xlsx or workbookParser.ts, directly or transitively.
//
// BOUNDING (discovery Section H/I/M): decodeCsvOnly() already bounds the
// underlying parse work identically to inspect/confirm (MAX_SOURCE_FILE_BYTES
// at the storage layer, CSV_ONLY_LIMITS post-parse) — this service adds NO
// new parsing primitive and does not attempt to make the decode itself
// cheaper (discovery's own conclusion: a bounded preview built by slicing
// decodeCsvOnly's output costs the same CPU/memory as full inspect/confirm
// for the same file — a disclosed, accepted characteristic, not a defect).
// What IS new here are three RESPONSE-only bounds (PREVIEW_MAX_SAMPLE_ROWS/
// COLUMNS/CELL_CHARS below), which bound only the SERIALIZED payload size,
// never the shared decoder itself.

/** Response-only bounds — local to this file, not shared with any other
 * Data Hub decode path. No existing repo constant governs "how many rows
 * to show a human" (discovery Section M); these are new. */
const PREVIEW_MAX_SAMPLE_ROWS = 20;
const PREVIEW_MAX_SAMPLE_COLUMNS = 50;
const PREVIEW_MAX_CELL_CHARS = 200;

// CSV always yields exactly one worksheet, always index 0, always named
// "CSV" — matches inspectCsvWorksheet.ts's own CSV_WORKSHEET_INDEX/
// CSV_WORKSHEET_NAME constants exactly (duplicated rather than imported,
// consistent with this codebase's established convention of duplicating
// small format-structural literals across sibling CSV-only files rather
// than creating a shared import edge for a two-constant pair).
const CSV_WORKSHEET_INDEX = 0;
const CSV_WORKSHEET_NAME = "CSV";

export interface PreviewWorksheetTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetId: string;
}

// 5B.4C — frozen-lineage mapped-preview summary. Deliberately excludes the
// raw mapping_document (the compiled/applied structural output below is
// already the safe, derived projection a caller needs) and excludes
// SourceMapping.active_mapping_version_id (this summary describes exactly
// the FROZEN version consumed for this one response, never "whatever is
// currently active" — see previewWorksheet's own Step 7.5 for the frozen-
// lineage consumption rule this type exists to carry).
export interface WorksheetPreviewMappingSummary {
  mappingVersionId: string;
  sourceMappingId: string;
  versionNumber: number;
  /** True only if compileMapping produced zero diagnostics against this
   * worksheet's real headers. False does not mean the MappingVersion
   * itself is invalid — it means THIS worksheet's headers don't currently
   * satisfy it (missing/ambiguous source header, or a required canonical
   * target not configured at all). */
  structurallyValid: boolean;
  /** Safe, server-owned diagnostic codes only (canonical target + the
   * mapping's own configured source header name — never row/customer
   * data). Empty when structurallyValid is true. */
  mappingErrors: readonly CompileMappingDiagnostic[];
  /** Bounded, same length as sampleRows, canonical-field-keyed. Empty when
   * structurallyValid is false (nothing to apply the plan to). */
  mappedSampleRows: CanonicalRawRow[];
  /** True if the mapped bounded sample fed the existing, unmodified
   * Illegal Dumping domain mapper without it throwing — proves mapping
   * output is domain-mapper-compatible for this preview call. False on any
   * row/business-value rejection (business logic remains the domain
   * mapper's own, never re-implemented here) OR when structurallyValid is
   * false (nothing to feed). Never leaks the raw domain error message. */
  domainRowsValid: boolean;
}

export interface WorksheetPreviewDTO {
  worksheetId: string;
  worksheetName: string;
  worksheetIndex: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[][];
  sampleRowCount: number;
  truncated: boolean;
  requiredHeadersPresent: boolean;
  missingRequiredHeaders: string[];
  /** Null for a legacy worksheet (Upload.mapping_version_id IS NULL) — the
   * existing, unchanged behavior. Present only when this worksheet has
   * frozen mapping lineage, describing exactly that frozen version — never
   * a dynamically-resolved "current active" version. */
  mapping: WorksheetPreviewMappingSummary | null;
}

export type PreviewWorksheetFailureCode =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "UNSUPPORTED_FORMAT"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED"
  // 5B.4C — frozen mapping lineage cannot be resolved (missing MappingVersion,
  // foreign tenant, or cross-source corruption between the batch's own
  // source_system_id and the mapping's own source_system_id). Deliberately
  // ONE code covering every one of those reasons — never distinguished, to
  // avoid leaking foreign-tenant/cross-source existence.
  | "MAPPING_LINEAGE_UNAVAILABLE"
  // 5B.4C — the frozen MappingVersion's own stored mapping_document fails
  // 5B.2's validateMappingDocument when revalidated at use time. Presence of
  // frozen lineage means it must be honored or fail — never a silent
  // legacy-path fallback.
  | "MAPPING_DOCUMENT_INVALID";

export type PreviewWorksheetResult =
  | { ok: true; preview: WorksheetPreviewDTO }
  | { ok: false; code: PreviewWorksheetFailureCode; message: string };

function fail(code: PreviewWorksheetFailureCode): PreviewWorksheetResult {
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

function truncateCell(cell: string): string {
  return cell.length > PREVIEW_MAX_CELL_CHARS ? `${cell.slice(0, PREVIEW_MAX_CELL_CHARS)}…(truncated)` : cell;
}

function boundColumns(row: string[]): string[] {
  return row.slice(0, PREVIEW_MAX_SAMPLE_COLUMNS).map(truncateCell);
}

/**
 * Produces a bounded, read-only, truthful content preview of a DATA_HUB
 * CSV worksheet: real server-derived headers, a bounded sample of actual
 * rows, and required-illegal-dumping-header presence — never the entire
 * file, never an unbounded sample, never any storage locator/token.
 *
 * Flow: tenant+lineage-scoped worksheet lookup -> eligibility check
 * (AWAITING_CONFIRMATION or IMPORTED only) -> tenant-scoped parent
 * ImportBatch lookup (READY, non-tombstoned, via the worksheet's own
 * persisted import_batch_id, never caller input) -> CSV-only format gate
 * -> bounded RawFileStore.get() -> mandatory SHA-256 re-verification
 * against the batch's own persisted sha256 (every call, never trusting a
 * prior inspect/preview's verification) -> xlsx-free CSV decode -> a
 * non-throwing required-header presence check -> response-only
 * row/column/cell bounding -> DTO. No database write of any kind.
 */
export async function previewWorksheet(context: PreviewWorksheetTrustedContext): Promise<PreviewWorksheetResult> {
  const { organisationId, worksheetId } = context;

  // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup. id,
  // organisation_id, and lineage_kind are ALL part of the SAME predicate —
  // never fetch-by-id-then-check. Nonexistent, wrong-tenant, and
  // LEGACY-lineage all collapse to the identical WORKSHEET_NOT_FOUND
  // outcome, reusing read.ts's/confirmWorksheet.ts's own established
  // code/semantics verbatim. NO storage access has happened yet. ----
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { id: true, import_batch_id: true, canonical_status: true, mapping_version_id: true },
  });
  if (!worksheet || worksheet.import_batch_id === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  // ---- Step 2 — eligibility. Only AWAITING_CONFIRMATION (the core "review
  // before confirming" use case) and IMPORTED (historical review — mirrors
  // confirmDataHubWorksheet's own idempotent permissiveness for an
  // already-imported worksheet, never treated as an error there) are
  // previewable. INELIGIBLE/SKIPPED/any other value are rejected
  // identically via WORKSHEET_NOT_ELIGIBLE — deliberately not
  // distinguished further, mirroring WORKSHEET_NOT_FOUND's own
  // non-existence-leaking discipline. NO storage access has happened yet. ----
  if (worksheet.canonical_status !== "AWAITING_CONFIRMATION" && worksheet.canonical_status !== "IMPORTED") {
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  // ---- Step 3 — parent ImportBatch lookup, via the worksheet's OWN
  // persisted import_batch_id (never caller input), tenant-scoped via the
  // compound id_organisation_id key. Must be READY and non-tombstoned —
  // mirrors confirmWorksheet.ts's own Step 3 exactly. NO storage access
  // has happened yet. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
    select: { status: true, content_type: true, sha256: true, deleted_at: true, source_system_id: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("WORKSHEET_NOT_FOUND");
  }
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }
  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 4 — CSV-only format gate, using only trusted persisted
  // metadata, BEFORE any storage access. XLS/XLSX batches never reach
  // storage.get() from this service at all. ----
  if (batch.content_type !== "csv") {
    return fail("UNSUPPORTED_FORMAT");
  }

  // ---- Step 4.5 — 5B.4C FROZEN MAPPING LINEAGE RESOLUTION. Reached only
  // when this worksheet has a persisted Upload.mapping_version_id — a
  // legacy worksheet (NULL) skips this block entirely and takes the
  // completely unchanged legacy path below. Deliberately placed BEFORE
  // storage access (mirrors the existing TENANT-BEFORE-STORAGE discipline
  // of Steps 1-4): an unresolvable/corrupt frozen lineage is a gate
  // failure, not a content problem, so it must never cause a storage
  // read. This block NEVER resolves SourceMapping.active_mapping_version_id
  // and NEVER falls back to the latest/MAX(version_number) — the ONLY
  // authoritative lookup key is the exact frozen id captured from Step 1's
  // own read above, used consistently for every lookup below (one exact ID
  // drives the entire response — no re-read, no possibility of a
  // metadata/output version mismatch even under concurrent 5B.4B
  // reselection of THIS worksheet). Only the (header-dependent)
  // compileMapping/apply/domain-check step remains deferred until after
  // decode (Step 7.5 below) — everything else resolves here. ----
  let resolvedMapping: { mappingVersion: { id: string; version_number: number }; sourceMapping: { id: string }; document: MappingDocument } | null = null;

  if (worksheet.mapping_version_id !== null) {
    const frozenMappingVersionId = worksheet.mapping_version_id;

    // Fetch EXACTLY the frozen version, tenant-scoped. Deliberately no
    // `active` filter of any kind — deactivation of the parent SourceMapping/
    // SourceSystem after this version was frozen must never break
    // consumption of already-frozen lineage (5B.4B's own established rule:
    // `active` is a NEW-selection gate, never a consumption gate).
    const mappingVersion = await prisma.mappingVersion.findUnique({
      where: { id_organisation_id: { id: frozenMappingVersionId, organisation_id: organisationId } },
      select: { id: true, source_mapping_id: true, version_number: true, mapping_document: true },
    });
    if (!mappingVersion) {
      return fail("MAPPING_LINEAGE_UNAVAILABLE");
    }

    // Cross-source corruption check (the one invariant the DB itself cannot
    // express as an FK — 5B.4B's own established application-level
    // invariant, re-verified at consumption time too): the frozen version's
    // own SourceMapping.source_system_id must equal the batch's own
    // authoritative source_system_id. Also tenant-scoped; also no `active`
    // filter (same consumption-vs-selection distinction as above).
    const sourceMapping = await prisma.sourceMapping.findUnique({
      where: { id_organisation_id: { id: mappingVersion.source_mapping_id, organisation_id: organisationId } },
      select: { id: true, source_system_id: true },
    });
    if (!sourceMapping || sourceMapping.source_system_id !== batch.source_system_id) {
      return fail("MAPPING_LINEAGE_UNAVAILABLE");
    }

    // Revalidate the stored document EVERY call — never trust it merely
    // because it passed 5B.2's validator at creation time. A corrupt/
    // invalid stored document fails Preview safely; presence of frozen
    // lineage means it must be honored or fail, never a silent downgrade
    // to the legacy path below.
    const validated = validateMappingDocument(mappingVersion.mapping_document);
    if (!validated.ok) {
      return fail("MAPPING_DOCUMENT_INVALID");
    }

    resolvedMapping = {
      mappingVersion: { id: mappingVersion.id, version_number: mappingVersion.version_number },
      sourceMapping: { id: sourceMapping.id },
      document: validated.document,
    };
  }

  // ---- Step 5 — bounded storage retrieval. ONLY reached after Steps 1-4.5
  // have all succeeded, tenant-scoped. Never a caller-provided path — the
  // storage key is derived exclusively from the trusted organisationId and
  // the worksheet's own persisted import_batch_id. ----
  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, worksheet.import_batch_id);

  let getResult;
  try {
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
      return fail("STORAGE_NOT_FOUND");
    }
    return fail("PROVIDER_FAILURE");
  }

  // ---- Step 6 — mandatory SHA-256 re-verification, unconditional, EVERY
  // invocation, against the batch's own persisted sha256 column only.
  // Never relies on a prior inspect/preview call's own verification — the
  // underlying Blob object could have been deleted/corrupted since. ----
  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // ---- Step 7 — xlsx-free CSV decode. decodeCsvOnly also enforces
  // CSV_ONLY_LIMITS (row/column/cell caps), collapsing both malformed input
  // and oversized input to the single PARSER_REJECTED outcome — matching
  // inspectCsvWorksheet.ts's/confirmWorksheet.ts's own equivalent
  // handling. ----
  let headers: string[];
  let rows: string[][];
  try {
    const table = decodeCsvOnly(getResult.body);
    headers = table.headers;
    rows = table.rows;
  } catch (err) {
    if (err instanceof CsvOnlyDecodeError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  // ---- Step 7.5 — 5B.4C FROZEN MAPPING LINEAGE APPLICATION. Reached only
  // when Step 4.5 above resolved a frozen mapping (resolvedMapping !==
  // null) — a legacy worksheet takes the completely unchanged Step 8
  // legacy path below. Lineage RESOLUTION (existence, cross-source
  // integrity, stored-document validity) already happened in Step 4.5,
  // before storage access; this step only does the header-dependent work
  // that could not happen until the real worksheet headers were decoded. ----
  let mapping: WorksheetPreviewMappingSummary | null = null;

  if (resolvedMapping !== null) {
    const { mappingVersion, sourceMapping, document } = resolvedMapping;

    // Compile against the REAL, FULL (un-bounded) worksheet headers —
    // reuses 5B.3's unmodified compileMapping verbatim. Never re-implements
    // header matching.
    const compiled = compileMapping(document, headers);

    let mappedSampleRows: CanonicalRawRow[] = [];
    let domainRowsValid = false;
    if (compiled.ok) {
      // Apply mapping ONLY to the already-row-bounded sample (Step 9's own
      // PREVIEW_MAX_SAMPLE_ROWS slice, taken here BEFORE any column
      // truncation — columnIndex values are positions in the full,
      // untruncated header row) — never the full worksheet. No second
      // full-file materialization; this is the same array Step 9 below
      // slices again for the raw sampleRows field.
      const boundedRawRowsForMapping = rows.slice(0, PREVIEW_MAX_SAMPLE_ROWS);
      mappedSampleRows = applyCompiledMappingToRows(compiled.plan, boundedRawRowsForMapping);

      // Feed the existing, completely unmodified Illegal Dumping domain
      // mapper via the narrow reshape adapter — proves mapping output is
      // domain-mapper-compatible for this call. Business/value
      // interpretation (dates, statuses, required-value rules) remains
      // exclusively that mapper's own responsibility; nothing here
      // re-implements or duplicates it. A row/business-value rejection is
      // expected, ordinary content variance for a preview sample — it does
      // NOT fail the structural preview, and the raw error is never leaked.
      try {
        const { headers: domainHeaders, rows: domainRows } = toIllegalDumpingMapperInput(mappedSampleRows);
        mapIllegalDumpingRows(domainHeaders, domainRows);
        domainRowsValid = true;
      } catch (err) {
        if (err instanceof IllegalDumpingMappingError) {
          domainRowsValid = false;
        } else {
          throw err;
        }
      }
    }

    mapping = {
      mappingVersionId: mappingVersion.id,
      sourceMappingId: sourceMapping.id,
      versionNumber: mappingVersion.version_number,
      structurallyValid: compiled.ok,
      mappingErrors: compiled.ok ? [] : compiled.errors,
      mappedSampleRows,
      domainRowsValid,
    };
  }

  // ---- Step 8 — required-header presence. For a LEGACY worksheet
  // (mapping === null) this is the completely unchanged existing behavior:
  // validateIllegalDumpingHeaders (the existing, pure, exported check)
  // against the RAW worksheet headers, wrapped so its throw never escapes
  // this service. For a MAPPED worksheet (5B.4C), the equivalent signal is
  // derived from compileMapping's own diagnostics instead — the raw CSV
  // header text is never required to already equal a canonical Illegal
  // Dumping header name when a valid mapping supplies it (Step 7.5 above).
  // Either way these two fields keep the exact same meaning for any
  // caller: "can Review/Confirm proceed". ----
  let requiredHeadersPresent: boolean;
  let missingRequiredHeaders: string[];
  if (mapping !== null) {
    const missingTargets = new Set<string>();
    for (const diagnostic of mapping.mappingErrors) {
      if ((ILLEGAL_DUMPING_REQUIRED_HEADERS as readonly string[]).includes(diagnostic.canonicalTarget)) {
        missingTargets.add(diagnostic.canonicalTarget);
      }
    }
    missingRequiredHeaders = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter((h) => missingTargets.has(h));
    requiredHeadersPresent = missingRequiredHeaders.length === 0;
  } else {
    missingRequiredHeaders = ILLEGAL_DUMPING_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    requiredHeadersPresent = true;
    try {
      validateIllegalDumpingHeaders(headers);
    } catch (err) {
      if (err instanceof IllegalDumpingMappingError) {
        requiredHeadersPresent = false;
      } else {
        throw err;
      }
    }
  }

  // ---- Step 9 — response-only bounding (discovery Section M). Never
  // mutates the shared decoder's own output in place; only the DTO fields
  // below are ever truncated/sliced. ----
  const rowCount = rows.length;
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const sampleRows = rows.slice(0, PREVIEW_MAX_SAMPLE_ROWS).map(boundColumns);
  const sampleRowCount = sampleRows.length;
  const truncated = rowCount > sampleRowCount;
  const boundedHeaders = boundColumns(headers);

  return {
    ok: true,
    preview: {
      worksheetId,
      worksheetName: CSV_WORKSHEET_NAME,
      worksheetIndex: CSV_WORKSHEET_INDEX,
      rowCount,
      columnCount,
      headers: boundedHeaders,
      sampleRows,
      sampleRowCount,
      truncated,
      requiredHeadersPresent,
      missingRequiredHeaders,
      mapping,
    },
  };
}
