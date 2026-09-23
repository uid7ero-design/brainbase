import { prisma } from "../../prisma";
import { inspectCsvWorksheet, type InspectCsvWorksheetFailureCode } from "./inspectCsvWorksheet";
import type { PersistedWorksheetDescriptor } from "./inspectWorksheets";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";
import { classifyFormat } from "../fileSignatures";

// Data Hub 6.2D1 — the live inspect route's format dispatcher. Routes one
// tenant-scoped ImportBatch to exactly one EXISTING structural inspection
// service, chosen solely from the batch's own persisted, server-classified
// content_type (initiate.ts's classifyFormat at batch creation — immutable
// thereafter). It owns NO inspection, storage, hashing, parsing, or
// persistence logic of its own; both delegates re-run their own
// tenant-scoped lookup, READY gate, storage GET, SHA-256 re-verification,
// and exact-set idempotency policy unchanged.
//
// DISPATCH (no fallback of any kind between branches):
//   csv  -> inspectCsvWorksheet (xlsx-free; byte-for-byte the pre-6.2D1
//           path — delegated BEFORE any other gate here, so every CSV
//           outcome, including its own BATCH_NOT_READY ordering, is exactly
//           what that service alone returns)
//   xlsx -> inspectWorksheets (archive-guarded inspectWorkbook; structural
//           worksheet lineage only). inspectWorkbook classifies by FILENAME,
//           so the persisted original_filename must independently classify
//           as xlsx too (the same pin detectWorksheetReportingPeriod.ts
//           uses) — that pins the archive-guarded xlsx branch, never the
//           unguarded xls one. Any disagreement -> UNSUPPORTED_FORMAT.
//           Loaded by dynamic import on this branch ONLY, so a CSV request
//           never loads inspectWorksheets/workbookParser/xlsx at all.
//   xls and anything else -> UNSUPPORTED_FORMAT, before any storage access.
//           Legacy XLS remains dark in the live flow even though
//           inspectWorksheets itself could parse it — it has no archive
//           guard equivalent and no approved live contract.
//
// XLSX INSPECTION IS NOT XLSX IMPORT: previewWorksheet.ts and
// confirmWorksheet.ts both keep their own independent CSV-only gates
// (content_type !== "csv" -> UNSUPPORTED_FORMAT), which this module never
// touches. Structurally inspecting an XLSX batch persists AWAITING_CONFIRMATION
// / INELIGIBLE worksheet rows and nothing else.
//
// AUTH BOUNDARY: identical discipline to both delegates — accepts an
// already-resolved trusted context only. The route wrapping this module
// enforces requireRole("manager") and derives organisationId from the
// session, never from request input. The request body is never read, so no
// caller-supplied format, filename, or extension can influence dispatch.

export interface InspectImportBatchTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  importBatchId: string;
}

// Every InspectWorksheetsFailureCode is also an InspectCsvWorksheetFailureCode
// (the CSV union is the superset — it adds UNSUPPORTED_FORMAT), so the route's
// existing exhaustive status map covers both delegates unchanged.
export type InspectImportBatchFailureCode = InspectCsvWorksheetFailureCode;

export type InspectImportBatchResult =
  | { ok: true; worksheets: PersistedWorksheetDescriptor[] }
  | { ok: false; code: InspectImportBatchFailureCode; message: string };

function fail(code: InspectImportBatchFailureCode): InspectImportBatchResult {
  return { ok: false, code, message: getMessageTemplate(code as FailureCode) };
}

function filenameClassifiesAsXlsx(filename: string): boolean {
  try {
    return classifyFormat({ filename }) === "xlsx";
  } catch {
    return false;
  }
}

export async function inspectImportBatch(context: InspectImportBatchTrustedContext): Promise<InspectImportBatchResult> {
  const { organisationId, importBatchId } = context;

  // Tenant-scoped via the compound id_organisation_id key — a wrong-tenant
  // and a nonexistent batch are indistinguishable (BATCH_NOT_FOUND), and
  // neither ever reaches a delegate or storage.
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: importBatchId, organisation_id: organisationId } },
    select: { status: true, content_type: true, original_filename: true, deleted_at: true },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("BATCH_NOT_FOUND");
  }

  if (batch.content_type === "csv") {
    return inspectCsvWorksheet({ organisationId, importBatchId });
  }

  // Same gate order inspectCsvWorksheet already applied to non-CSV batches
  // before 6.2D1 (not-found -> not-ready -> format).
  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }

  if (batch.content_type === "xlsx" && filenameClassifiesAsXlsx(batch.original_filename)) {
    const { inspectWorksheets } = await import("./inspectWorksheets");
    return inspectWorksheets({ organisationId, importBatchId });
  }

  return fail("UNSUPPORTED_FORMAT");
}
