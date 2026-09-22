import { prisma } from "../../prisma";
import { getMessageTemplate, type FailureCode } from "./failureTaxonomy";

// Data Hub 6.2B1 — dedicated worksheet reporting-period selection service.
//
// AUTH BOUNDARY / TRUSTED INPUT / ONE TRANSACTION, NO TOCTOU / FREEZE-ON-
// WRITE / ATOMIC CONDITIONAL WRITE: exactly the same discipline as
// selectWorksheetMapping.ts, mirrored deliberately rather than re-derived.
// This function accepts an already-resolved trusted context
// (organisationId, worksheetUploadId) plus two caller-chosen fields
// (periodStart, periodEnd) as plain parameters. It never resolves its own
// session and never imports lib/org.ts. The HTTP route wrapping this
// service is solely responsible for requireRole("manager") and for
// sourcing organisationId exclusively from that resolved session — never
// from request input. The caller can never choose period_source — the
// server always sets it to the fixed literal "MANUAL".
//
// PERIOD IS NOT GATED ON reporting_period_required HERE: this service
// still resolves the worksheet's authoritative SourceSystem (to keep the
// tenant/lineage trust chain identical to every other worksheet-scoped
// service in this file family), but it does NOT require
// SourceSystem.reporting_period_required to be true before allowing a
// selection — an optional-period source may still record a meaningful
// period if the operator wants to. Only confirmDataHubWorksheet's own
// Confirm gate enforces the requirement, and only when it is actually
// true for the authoritative SourceSystem.
//
// ONE TRANSACTION, ATOMIC CONDITIONAL WRITE, MAY BE RESELECTED: the Upload
// write is a conditional UPDATE whose WHERE clause repeats every
// eligibility predicate (id, organisation_id, lineage_kind,
// canonical_status = AWAITING_CONFIRMATION) — never a separate
// SELECT-then-UPDATE. A worksheet's period may be selected, then
// reselected, any number of times while still AWAITING_CONFIRMATION —
// each call simply re-satisfies the same predicate and overwrites the
// prior selection. Once the worksheet leaves AWAITING_CONFIRMATION (most
// commonly: IMPORTED, by a concurrent or later confirmDataHubWorksheet
// claim), this same WHERE clause affects zero rows and this call fails
// closed with WORKSHEET_NOT_ELIGIBLE — the period is then permanently
// frozen, exactly like mapping_version_id.
export interface SelectWorksheetPeriodTrustedContext {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  worksheetUploadId: string;
  /** Caller's only real choices — plain unknown, validated below. */
  periodStart: unknown;
  periodEnd: unknown;
}

export type SelectWorksheetPeriodOutcome =
  | {
      ok: true;
      worksheetUploadId: string;
      periodStart: string;
      periodEnd: string;
      periodSource: "MANUAL";
    }
  | { ok: false; code: FailureCode; message: string };

function fail(code: FailureCode): SelectWorksheetPeriodOutcome {
  return { ok: false, code, message: getMessageTemplate(code) };
}

// Canonical, locale-independent ISO calendar-date parser — date-only,
// never a timestamp/timezone-bearing value. Deliberately self-contained
// (not imported from illegalDumpingMapper.ts) so this service has no
// dependency on the Illegal-Dumping-specific domain mapper — reporting
// period is a generic Data Hub concept, not an Illegal Dumping one.
// Mirrors illegalDumpingMapper.ts's own ISO_DATE_RE/buildUtcDateIfValid
// discipline exactly: real calendar validation (rejects Feb 30, month 13,
// etc.), never delegates to `new Date(string)`'s own lenient/locale-
// dependent parsing.
const ISO_CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/**
 * Parses a strict "YYYY-MM-DD" calendar date. Returns the UTC-anchored
 * Date (midnight UTC) if valid, or null for anything else — malformed
 * shape, out-of-range month/day, or a non-string input.
 */
function parseIsoCalendarDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = ISO_CALENDAR_DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Selects (or reselects) the reporting-period lineage for one DATA_HUB
 * worksheet.
 *
 * Flow (all inside one transaction): tenant+lineage-scoped worksheet
 * lookup -> AWAITING_CONFIRMATION precondition -> tenant-scoped parent
 * ImportBatch lookup via the worksheet's own persisted import_batch_id
 * (never caller input) -> NULL source_system_id blocks selection
 * entirely (SOURCE_LINEAGE_REQUIRED, mirroring selectWorksheetMapping.ts's
 * own identical rule) -> both dates parsed as strict ISO calendar dates,
 * periodStart <= periodEnd -> an atomic conditional UPDATE persists both
 * dates plus period_source = "MANUAL", gated on the worksheet still being
 * AWAITING_CONFIRMATION at write time.
 */
export async function selectWorksheetPeriod(
  context: SelectWorksheetPeriodTrustedContext
): Promise<SelectWorksheetPeriodOutcome> {
  const { organisationId, worksheetUploadId } = context;

  // ---- Validate both boundaries BEFORE opening any transaction — a
  // malformed request should never even attempt a DB round trip. Both
  // must be present together (INVALID_REPORTING_PERIOD covers "only one
  // boundary supplied" as well as "malformed"/"not a real calendar date"
  // — deliberately one generic code, mirroring this file family's own
  // established non-distinguishing discipline for validation failures). ----
  const periodStart = parseIsoCalendarDate(context.periodStart);
  const periodEnd = parseIsoCalendarDate(context.periodEnd);
  if (periodStart === null || periodEnd === null) {
    return fail("INVALID_REPORTING_PERIOD");
  }
  if (periodStart.getTime() > periodEnd.getTime()) {
    return fail("INVALID_REPORTING_PERIOD");
  }

  return prisma.$transaction(async (tx) => {
    // ---- Step 1 — tenant + DATA_HUB lineage-scoped worksheet lookup, the
    // SAME predicate as confirmWorksheet.ts's and
    // selectWorksheetMapping.ts's own Step 1. ----
    const worksheet = await tx.upload.findFirst({
      where: { id: worksheetUploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
      select: { id: true, import_batch_id: true, canonical_status: true },
    });
    if (!worksheet || worksheet.import_batch_id === null) {
      return fail("WORKSHEET_NOT_FOUND");
    }

    // ---- Step 2 — state precondition. Selection/reselection is allowed
    // ONLY while AWAITING_CONFIRMATION — no "unlock" path back to
    // selectability from IMPORTED/SKIPPED/INELIGIBLE/any other value. ----
    if (worksheet.canonical_status !== "AWAITING_CONFIRMATION") {
      return fail("WORKSHEET_NOT_ELIGIBLE");
    }

    // ---- Step 3 — parent ImportBatch lookup via the worksheet's OWN
    // persisted import_batch_id (never caller input), tenant-scoped. ----
    const batch = await tx.importBatch.findUnique({
      where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
      select: { source_system_id: true },
    });
    if (!batch) {
      return fail("WORKSHEET_NOT_FOUND");
    }

    // ---- Step 4 — NULL-source policy, identical rule to
    // selectWorksheetMapping.ts's own Step 4: a batch with no SourceSystem
    // lineage cannot enter ANY worksheet-scoped selection pipeline. No
    // inference, no backfill, no silent permission. Reporting period is a
    // property of a governed source's own worksheet lineage — it cannot
    // be authoritative without that lineage existing at all. ----
    if (batch.source_system_id === null) {
      return fail("SOURCE_LINEAGE_REQUIRED");
    }

    // ---- Step 5 — the atomic conditional write. Deliberately does NOT
    // check SourceSystem.reporting_period_required here — see this file's
    // own header comment: selection is always permitted for any
    // lineage-complete worksheet, regardless of whether the parent
    // SourceSystem requires a period at Confirm time. The WHERE clause
    // repeats every eligibility predicate so a concurrent state
    // transition (a confirmDataHubWorksheet claim, or another selection
    // call) can never be silently overwritten. ----
    const claim = await tx.upload.updateMany({
      where: {
        id: worksheetUploadId,
        organisation_id: organisationId,
        lineage_kind: "DATA_HUB",
        canonical_status: "AWAITING_CONFIRMATION",
      },
      data: { period_start: periodStart, period_end: periodEnd, period_source: "MANUAL" },
    });

    if (claim.count === 0) {
      // Lost a race against a concurrent state transition between Step
      // 1's read and this write — mirrors selectWorksheetMapping.ts's own
      // identical "lost the claim" handling shape.
      return fail("WORKSHEET_NOT_ELIGIBLE");
    }

    return {
      ok: true,
      worksheetUploadId,
      periodStart: toIsoDateString(periodStart),
      periodEnd: toIsoDateString(periodEnd),
      periodSource: "MANUAL" as const,
    };
  });
}
