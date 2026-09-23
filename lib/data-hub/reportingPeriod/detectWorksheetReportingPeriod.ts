import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { probeWorkbookCells, WorkbookParserError } from "../workbookParser";
import { classifyFormat } from "../fileSignatures";
import { getMessageTemplate } from "../importBatch/failureTaxonomy";
import {
  detectOnkaparingaReportingPeriod,
  type DetectionOutcome,
  type DetectorReasonCode,
  type PeriodBounds,
} from "./onkaparingaDetector";
import {
  ONKAPARINGA_HEADING_ADDRESS,
  ONKAPARINGA_WORKBOOK_SHEETS,
  resolveReportingPeriodDetectorProfile,
  type ReportingPeriodDetectorProfile,
} from "./sourceProfiles";

// Data Hub 6.2C3 — READ-ONLY worksheet reporting-period detection service.
//
// Wires the pure 6.2C2 detector (onkaparingaDetector.ts, unchanged) to a
// real DATA_HUB worksheet. It never persists anything: ZERO Prisma writes,
// no $transaction. Accepting a detected period is a separate, explicit
// operator action (acceptDetectedWorksheetPeriod.ts), which re-runs this
// service server-side rather than trusting any client-held result.
//
// AUTH BOUNDARY: identical to every importBatch service — trusted context
// (organisationId, worksheetId) only; the route owns requireRole("manager")
// and sources organisationId from the resolved session exclusively.
//
// ORDER (security-critical — every step before storage is tenant-scoped):
//   A. tenant + DATA_HUB lineage-scoped worksheet lookup; must be
//      AWAITING_CONFIRMATION (detection only exists to inform a still-open
//      review — a locked worksheet never needs it, never touches storage).
//   B. parent ImportBatch via the worksheet's OWN import_batch_id,
//      tenant-scoped, non-deleted.
//   C. parent source_system_id -> SourceSystem, tenant-scoped. NULL source,
//      or an unresolvable one -> NOT APPLICABLE.
//   D. detector profile from the exact SourceSystem name
//      (sourceProfiles.ts). No profile -> NOT APPLICABLE.
//   E. storage is read ONLY for an applicable profile, a READY batch, and
//      a format whose content can actually carry the profile's signals
//      (xlsx). CSV/XLS never touch storage: the profile defines no
//      structural reporting-period signal for them, and operational row
//      dates are NEVER a period signal (6.2C2 hard rule).
//   F. bytes re-hashed against the batch's persisted sha256 before parsing.
//   G. parsing only through workbookParser.ts's probeWorkbookCells (size
//      cap, signature, archive guard, bounded sheetRows).
//
// PRIVACY: the returned DTO carries only controlled enums and ISO dates.
// The detector's evidence array (which can quote heading text) and every
// probed cell value stay inside this function — never returned, never
// logged. Parser failures collapse to PARSER_REJECTED with the taxonomy's
// generic message; the parser's own error text is never surfaced.

export interface DetectWorksheetReportingPeriodTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetId: string;
}

/** The deliberately narrow, wire-safe projection of a DetectorResult. */
export interface SafeReportingPeriodDetection {
  outcome: DetectionOutcome;
  period: PeriodBounds | null;
  suggestedPeriod: PeriodBounds | null;
  reasonCode: DetectorReasonCode;
  requiresManualSelection: boolean;
}

export type DetectWorksheetReportingPeriodFailureCode =
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_NOT_ELIGIBLE"
  | "BATCH_NOT_READY"
  | "STORAGE_NOT_FOUND"
  | "PROVIDER_FAILURE"
  | "STORAGE_INTEGRITY_MISMATCH"
  | "PARSER_REJECTED";

export interface DetectionProvenance {
  importBatchId: string;
  sourceSystemId: string;
  sha256: string;
  status: string;
  contentType: string;
  originalFilename: string;
}

export type DetectWorksheetReportingPeriodResult =
  | { ok: true; applicable: false }
  | {
      ok: true;
      applicable: true;
      profile: ReportingPeriodDetectorProfile;
      detection: SafeReportingPeriodDetection;
      /** Server-internal provenance, used by the accept service to re-verify
       * nothing moved between detection and its conditional write. Holds
       * every batch field the outcome was derived from. Never serialised by
       * the route. */
      provenance: DetectionProvenance;
    }
  | { ok: false; code: DetectWorksheetReportingPeriodFailureCode; message: string };

function fail(code: DetectWorksheetReportingPeriodFailureCode): DetectWorksheetReportingPeriodResult {
  return { ok: false, code, message: getMessageTemplate(code) };
}

const NOT_APPLICABLE: DetectWorksheetReportingPeriodResult = { ok: true, applicable: false };

// The operational CSV export (the only format the live inspect path accepts
// today) carries no reporting-period structure; its only dates are
// per-row operational timestamps, which are never a period signal.
const CSV_ABSENT: SafeReportingPeriodDetection = {
  outcome: "ABSENT",
  period: null,
  suggestedPeriod: null,
  reasonCode: "NO_TRUSTED_PERIOD_SIGNAL",
  requiresManualSelection: true,
};

// Legacy XLS is not the monthly workbook's format; no content signal is
// read from it.
const XLS_ABSENT: SafeReportingPeriodDetection = {
  outcome: "ABSENT",
  period: null,
  suggestedPeriod: null,
  reasonCode: "UNRECOGNISED_SOURCE_SCHEMA",
  requiresManualSelection: true,
};

function filenameClassifiesAsXlsx(filename: string): boolean {
  try {
    return classifyFormat({ filename }) === "xlsx";
  } catch {
    return false;
  }
}

export async function detectWorksheetReportingPeriod(
  context: DetectWorksheetReportingPeriodTrustedContext
): Promise<DetectWorksheetReportingPeriodResult> {
  const { organisationId, worksheetId } = context;

  // ---- A. worksheet (tenant + lineage in ONE predicate). ----
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { id: true, import_batch_id: true, canonical_status: true },
  });
  if (!worksheet || worksheet.import_batch_id === null) {
    return fail("WORKSHEET_NOT_FOUND");
  }
  if (worksheet.canonical_status !== "AWAITING_CONFIRMATION") {
    return fail("WORKSHEET_NOT_ELIGIBLE");
  }

  // ---- B. parent batch, tenant-scoped, via the worksheet's own FK. ----
  const batch = await prisma.importBatch.findUnique({
    where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
    select: {
      status: true,
      content_type: true,
      sha256: true,
      deleted_at: true,
      source_system_id: true,
      original_filename: true,
    },
  });
  if (!batch || batch.deleted_at !== null) {
    return fail("WORKSHEET_NOT_FOUND");
  }

  // ---- C. governing SourceSystem, tenant-scoped. ----
  if (batch.source_system_id === null) {
    return NOT_APPLICABLE;
  }
  const sourceSystem = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id: batch.source_system_id, organisation_id: organisationId } },
    select: { name: true },
  });
  if (!sourceSystem) {
    return NOT_APPLICABLE;
  }

  // ---- D. detector profile (exact name match, fail-closed). ----
  const profile = resolveReportingPeriodDetectorProfile(sourceSystem.name);
  if (profile === null) {
    return NOT_APPLICABLE;
  }

  if (batch.status !== "READY") {
    return fail("BATCH_NOT_READY");
  }
  if (!batch.sha256) {
    return fail("PROVIDER_FAILURE");
  }

  const provenance: DetectionProvenance = {
    importBatchId: worksheet.import_batch_id,
    sourceSystemId: batch.source_system_id,
    sha256: batch.sha256,
    status: batch.status,
    contentType: batch.content_type,
    originalFilename: batch.original_filename,
  };

  // ---- E. format gate — only xlsx content can carry this profile's
  // signals; every other format resolves WITHOUT storage access. ----
  if (batch.content_type === "csv") {
    return { ok: true, applicable: true, profile, detection: CSV_ABSENT, provenance };
  }
  // probeWorkbookCells classifies by filename, so the persisted filename
  // must independently classify as xlsx too — that pins the probe to its
  // archive-guarded xlsx branch. Any disagreement fails closed here,
  // still before storage.
  if (batch.content_type !== "xlsx" || !filenameClassifiesAsXlsx(batch.original_filename)) {
    return { ok: true, applicable: true, profile, detection: XLS_ABSENT, provenance };
  }

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

  // ---- F. integrity before any parse. ----
  const computedSha256 = createHash("sha256").update(getResult.body).digest("hex");
  if (computedSha256 !== batch.sha256) {
    return fail("STORAGE_INTEGRITY_MISMATCH");
  }

  // ---- G. bounded structural probe. ----
  const sheets = ONKAPARINGA_WORKBOOK_SHEETS;
  let probe;
  try {
    probe = await probeWorkbookCells(getResult.body, { filename: batch.original_filename }, [
      { sheetName: sheets.overview, address: ONKAPARINGA_HEADING_ADDRESS },
      { sheetName: sheets.serviceExceptionTotals, address: ONKAPARINGA_HEADING_ADDRESS },
      { sheetName: sheets.trends, address: ONKAPARINGA_HEADING_ADDRESS },
    ]);
  } catch (err) {
    if (err instanceof WorkbookParserError) {
      return fail("PARSER_REJECTED");
    }
    throw err;
  }

  const occurrences = (name: string) => probe.sheetNames.filter((n) => n === name).length;
  const schemaMatched = Object.values(sheets).every((name) => occurrences(name) === 1);
  const [overviewHeading, serviceExceptionTotalsHeading, trendsHeading] = probe.cells;

  // trendsYear is deliberately null: no deterministic structural year cell
  // is established for this workbook, and a year is never inferred from
  // operational rows. Filename year + a corroborating content month is
  // sufficient for EXACT (see onkaparingaDetector.ts Rule 3).
  const result = detectOnkaparingaReportingPeriod({
    originalFilename: batch.original_filename,
    schemaMatched,
    overviewHeading,
    serviceExceptionTotalsHeading,
    trendsHeading,
    trendsYear: null,
  });

  return {
    ok: true,
    applicable: true,
    profile,
    detection: {
      outcome: result.outcome,
      period: result.period,
      suggestedPeriod: result.suggestedPeriod,
      reasonCode: result.reasonCode,
      requiresManualSelection: result.requiresManualSelection,
    },
    provenance,
  };
}
