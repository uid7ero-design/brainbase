import "server-only";
import { prisma } from "../../prisma";
import {
  detectWorksheetReportingPeriod,
  type DetectWorksheetReportingPeriodFailureCode,
} from "./detectWorksheetReportingPeriod";
import { resolveReportingPeriodDetectorProfile } from "./sourceProfiles";

// Data Hub 6.2C3 — explicit operator ACCEPTANCE of an automatically
// detected reporting period.
//
// SERVER-AUTHORITATIVE: the request carries NO dates. This service re-runs
// detectWorksheetReportingPeriod (tenant checks, source profile, storage
// hash, bounded parse) itself, and persists only if the CURRENT result is
// applicable && EXACT. A client can never submit a period and claim it was
// detected — the period written is exactly the one this call just derived.
//
// period_source = "DETECTED" (fixed literal, never caller-chosen). The
// manual route (selectWorksheetPeriod.ts) is untouched and keeps writing
// "MANUAL".
//
// COMPARE-CURRENT-STATE / ONE TRANSACTION: detection (which needs blob I/O)
// runs first, outside any transaction. The transaction then re-reads the
// worksheet, batch, and SourceSystem and requires that nothing detection
// relied on has moved (same batch id; batch still non-deleted and READY with
// the same status, content_type, original_filename, source id and sha256;
// source still maps to the same profile; still AWAITING_CONFIRMATION), and the
// write is a single conditional updateMany whose WHERE repeats every
// eligibility predicate PLUS "no period recorded yet". So:
//   - a concurrent Confirm claim (status leaves AWAITING_CONFIRMATION) ->
//     zero rows -> WORKSHEET_NOT_ELIGIBLE;
//   - a concurrent manual selection landing first (period no longer NULL)
//     -> zero rows -> PERIOD_ALREADY_RECORDED;
//   never a silent overwrite.
//
// EXISTING PERIOD POLICY:
//   - none recorded -> write the detected period.
//   - the SAME dates already recorded with period_source "DETECTED" ->
//     idempotent success, no write.
//   - anything else recorded (different dates, or the same dates recorded
//     MANUALLY) -> PERIOD_ALREADY_RECORDED, no write. Acceptance never
//     replaces an operator's recorded period; the operator can still change
//     it through the manual control.
//
// Does NOT read or change SourceSystem.reporting_period_required: accepting
// is voluntary for an optional-period source, and the Confirm gate keeps
// reading only the persisted Upload.period_start/period_end.

export interface AcceptDetectedWorksheetPeriodTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetId: string;
}

export type AcceptDetectedWorksheetPeriodFailureCode =
  | DetectWorksheetReportingPeriodFailureCode
  | "DETECTION_NOT_APPLICABLE"
  | "DETECTED_PERIOD_NOT_EXACT"
  | "DETECTION_STALE"
  | "PERIOD_ALREADY_RECORDED";

export type AcceptDetectedWorksheetPeriodOutcome =
  | {
      ok: true;
      worksheetUploadId: string;
      periodStart: string;
      periodEnd: string;
      periodSource: "DETECTED";
      /** True when this exact detected period was already recorded and
       * nothing was written by this call. */
      alreadyRecorded: boolean;
    }
  | { ok: false; code: AcceptDetectedWorksheetPeriodFailureCode; message: string };

const ACCEPT_MESSAGES: Record<Exclude<AcceptDetectedWorksheetPeriodFailureCode, DetectWorksheetReportingPeriodFailureCode>, string> = {
  DETECTION_NOT_APPLICABLE: "Automatic reporting-period detection is not available for this worksheet's source.",
  DETECTED_PERIOD_NOT_EXACT: "No exact reporting period was detected for this worksheet. Select a period manually.",
  DETECTION_STALE: "This worksheet changed while the detected period was being checked. Reload and try again.",
  PERIOD_ALREADY_RECORDED:
    "A reporting period is already recorded for this worksheet. Change it with the manual period control if needed.",
};

const WORKSHEET_NOT_ELIGIBLE_MESSAGE =
  "This worksheet is no longer awaiting confirmation, so its reporting period can no longer be changed.";

function fail(code: keyof typeof ACCEPT_MESSAGES): AcceptDetectedWorksheetPeriodOutcome {
  return { ok: false, code, message: ACCEPT_MESSAGES[code] };
}

const ISO_CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The detector only ever emits calendar-valid month bounds; this re-parse
// exists so a malformed value can never reach the DB (fail-closed).
function toUtcDate(value: string): Date | null {
  const match = ISO_CALENDAR_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function acceptDetectedWorksheetPeriod(
  context: AcceptDetectedWorksheetPeriodTrustedContext
): Promise<AcceptDetectedWorksheetPeriodOutcome> {
  const { organisationId, worksheetId } = context;

  // ---- 1. recompute detection from the authoritative file/source. ----
  const detected = await detectWorksheetReportingPeriod({ organisationId, worksheetId });
  if (!detected.ok) {
    return { ok: false, code: detected.code, message: detected.message };
  }
  if (!detected.applicable) {
    return fail("DETECTION_NOT_APPLICABLE");
  }
  if (detected.detection.outcome !== "EXACT" || detected.detection.period === null) {
    return fail("DETECTED_PERIOD_NOT_EXACT");
  }

  const periodStart = toUtcDate(detected.detection.period.start);
  const periodEnd = toUtcDate(detected.detection.period.end);
  if (periodStart === null || periodEnd === null || periodStart.getTime() > periodEnd.getTime()) {
    return fail("DETECTED_PERIOD_NOT_EXACT");
  }
  const { provenance, profile } = detected;

  // ---- 2. compare-current-state + conditional write, one transaction. ----
  return prisma.$transaction(async (tx): Promise<AcceptDetectedWorksheetPeriodOutcome> => {
    const worksheet = await tx.upload.findFirst({
      where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
      select: { import_batch_id: true, canonical_status: true, period_start: true, period_end: true, period_source: true },
    });
    if (!worksheet) {
      return fail("DETECTION_STALE");
    }
    if (worksheet.import_batch_id !== provenance.importBatchId) {
      return fail("DETECTION_STALE");
    }
    if (worksheet.canonical_status !== "AWAITING_CONFIRMATION") {
      return { ok: false, code: "WORKSHEET_NOT_ELIGIBLE", message: WORKSHEET_NOT_ELIGIBLE_MESSAGE };
    }

    // Every batch field the detected outcome was derived from is re-read
    // and compared by exact equality (status must still be READY).
    const batch = await tx.importBatch.findUnique({
      where: { id_organisation_id: { id: provenance.importBatchId, organisation_id: organisationId } },
      select: {
        status: true,
        content_type: true,
        original_filename: true,
        source_system_id: true,
        sha256: true,
        deleted_at: true,
      },
    });
    if (
      !batch ||
      batch.deleted_at !== null ||
      batch.status !== "READY" ||
      batch.status !== provenance.status ||
      batch.content_type !== provenance.contentType ||
      batch.original_filename !== provenance.originalFilename ||
      batch.source_system_id !== provenance.sourceSystemId ||
      batch.sha256 !== provenance.sha256
    ) {
      return fail("DETECTION_STALE");
    }

    const sourceSystem = await tx.sourceSystem.findUnique({
      where: { id_organisation_id: { id: provenance.sourceSystemId, organisation_id: organisationId } },
      select: { name: true },
    });
    if (!sourceSystem || resolveReportingPeriodDetectorProfile(sourceSystem.name) !== profile) {
      return fail("DETECTION_STALE");
    }

    if (worksheet.period_start !== null || worksheet.period_end !== null) {
      const sameDates =
        worksheet.period_start !== null &&
        worksheet.period_end !== null &&
        worksheet.period_start.getTime() === periodStart.getTime() &&
        worksheet.period_end.getTime() === periodEnd.getTime();
      if (sameDates && worksheet.period_source === "DETECTED") {
        return {
          ok: true,
          worksheetUploadId: worksheetId,
          periodStart: toIsoDateString(periodStart),
          periodEnd: toIsoDateString(periodEnd),
          periodSource: "DETECTED",
          alreadyRecorded: true,
        };
      }
      return fail("PERIOD_ALREADY_RECORDED");
    }

    const claim = await tx.upload.updateMany({
      where: {
        id: worksheetId,
        organisation_id: organisationId,
        lineage_kind: "DATA_HUB",
        canonical_status: "AWAITING_CONFIRMATION",
        import_batch_id: provenance.importBatchId,
        period_start: null,
        period_end: null,
      },
      data: { period_start: periodStart, period_end: periodEnd, period_source: "DETECTED" },
    });

    if (claim.count === 0) {
      // Lost a race between the read above and this write. Re-read once to
      // report WHICH predicate moved; either way nothing was written.
      const current = await tx.upload.findFirst({
        where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
        select: { canonical_status: true },
      });
      if (current && current.canonical_status === "AWAITING_CONFIRMATION") {
        return fail("PERIOD_ALREADY_RECORDED");
      }
      return { ok: false, code: "WORKSHEET_NOT_ELIGIBLE", message: WORKSHEET_NOT_ELIGIBLE_MESSAGE };
    }

    return {
      ok: true,
      worksheetUploadId: worksheetId,
      periodStart: toIsoDateString(periodStart),
      periodEnd: toIsoDateString(periodEnd),
      periodSource: "DETECTED",
      alreadyRecorded: false,
    };
  });
}
