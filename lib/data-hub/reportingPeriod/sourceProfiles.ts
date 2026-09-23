import "server-only";

// Data Hub 6.2C3 — reporting-period detector SOURCE PROFILE registry.
//
// INTERIM, FAIL-CLOSED APPLICATION PROFILE — NOT A UNIVERSAL MECHANISM.
// SourceSystem has no machine-readable detector key today (verified against
// prisma/schema.prisma at 6.2C3: id/organisation_id/name/description/active/
// reporting_period_required only), and this phase adds no schema field. The
// ONLY key available is the tenant-configured SourceSystem.name, so this
// registry maps an EXACT name (case-sensitive, never trimmed, never
// normalised, never substring/fuzzy-matched) to a detector profile. Any
// other name -> null -> automatic detection is NOT APPLICABLE; no other
// detector is ever tried and nothing is guessed.
//
// Callers must only ever pass a name read from the SourceSystem row that
// the worksheet's own parent ImportBatch.source_system_id resolves to,
// tenant-scoped — never a caller-supplied value. No database id is ever
// hard-coded here.
//
// Known limitation (accepted for this interim profile): SourceSystem.name is
// unique only per organisation, so any organisation that configures a source
// with exactly this name gets the same content-based detector. That is
// safe-by-construction here because detection is read-only and a detected
// period is never persisted without an explicit operator acceptance that
// the server re-verifies. A durable replacement (a dedicated, admin-governed
// detector key on SourceSystem) needs its own migration phase.

export type ReportingPeriodDetectorProfile = "ONKAPARINGA_MONTHLY_WORKBOOK";

export const ONKAPARINGA_OPERATIONAL_EXPORT_SOURCE_NAME = "City of Onkaparinga operational export";

const PROFILE_BY_EXACT_SOURCE_NAME: ReadonlyMap<string, ReportingPeriodDetectorProfile> = new Map([
  [ONKAPARINGA_OPERATIONAL_EXPORT_SOURCE_NAME, "ONKAPARINGA_MONTHLY_WORKBOOK"],
]);

export function resolveReportingPeriodDetectorProfile(sourceSystemName: string): ReportingPeriodDetectorProfile | null {
  return PROFILE_BY_EXACT_SOURCE_NAME.get(sourceSystemName) ?? null;
}

// The Onkaparinga monthly workbook's structural signals: each heading lives
// in cell A2 of its own sheet. All three sheets must be present (exactly
// once each) for the workbook to count as schema-matched.
export const ONKAPARINGA_WORKBOOK_SHEETS = {
  overview: "Overview",
  serviceExceptionTotals: "Service Exception Totals",
  trends: "Trends",
} as const;

export const ONKAPARINGA_HEADING_ADDRESS = "A2";
