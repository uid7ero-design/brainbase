// Data Hub 6.2D3C — pure copy for the read-only governed schema difference
// report. Wording is deliberately structural: an exact match says the
// STRUCTURE matches the governed (draft) schema version — never that the
// workbook is accepted, approved, activated or ready to import.
import type { SchemaDifferenceClient, SchemaMatchReportClient } from "@/lib/data-hub/client/types";

export const SCHEMA_MATCH_NOTICE =
  "Structural comparison only. Nothing has been accepted, activated, mapped or imported, and Excel import remains disabled.";

function schemaLabel(report: SchemaMatchReportClient): string {
  const status = report.sourceSchemaStatus === "DRAFT" ? " draft" : "";
  return `governed schema v${report.sourceSchemaVersionNumber}${status}`;
}

export function deriveSchemaMatchHeadline(report: SchemaMatchReportClient): string {
  switch (report.result) {
    case "EXACT_MATCH":
      return `Structure matches the ${schemaLabel(report)}.`;
    case "MATCH_WITH_NON_BLOCKING_DRIFT":
      return `Structure differs from the ${schemaLabel(report)} (warnings only).`;
    case "BLOCKING_DRIFT":
      return `Structure differs from the ${schemaLabel(report)} (blocking differences).`;
    case "UNMATCHABLE":
      return `This workbook could not be matched to the ${schemaLabel(report)}.`;
    default:
      return "The schema comparison result is not recognized.";
  }
}

function quoted(value: string | null): string {
  return value === null ? "(blank or non-text)" : `"${value}"`;
}

function column(ordinal: number | null): string {
  return ordinal === null ? "?" : String(ordinal + 1);
}

export function describeSchemaDifference(d: SchemaDifferenceClient): string {
  switch (d.code) {
    case "MISSING_REQUIRED_WORKSHEET":
      return "Required worksheet is missing.";
    case "MISSING_OPTIONAL_WORKSHEET":
      return "Optional worksheet is not present.";
    case "UNEXPECTED_WORKSHEET":
      return "Worksheet is not part of the governed schema.";
    case "WORKSHEET_NAME_MISMATCH":
      return "Worksheet name differs from the governed name.";
    case "MISSING_REQUIRED_COLUMN":
      return `Required column ${column(d.governedColumnOrdinal)} ${quoted(d.governedHeader)} is missing.`;
    case "MISSING_OPTIONAL_COLUMN":
      return `Column ${column(d.governedColumnOrdinal)} ${quoted(d.governedHeader)} is missing.`;
    case "UNEXPECTED_COLUMN":
      return `Unexpected column ${column(d.observedColumnOrdinal)} ${quoted(d.observedHeader)}.`;
    case "COLUMN_HEADER_CHANGED":
      return `Column ${column(d.governedColumnOrdinal)} header is ${quoted(d.observedHeader)}; governed header is ${quoted(d.governedHeader)}.`;
    case "COLUMN_POSITION_CHANGED":
      return `Column ${quoted(d.governedHeader)} moved from position ${column(d.governedColumnOrdinal)} to ${column(d.observedColumnOrdinal)}.`;
    case "DUPLICATE_HEADER_SHAPE_CHANGED":
      return `Repeated header ${quoted(d.governedHeader)} appears a different number of times or at different positions.`;
    case "HEADER_ROW_UNRESOLVED":
      return "The governed header row could not be found in this worksheet.";
    case "SHEET_UNMATCHABLE":
      return "Worksheet is present but cannot be compared (hidden, empty, or its name is repeated).";
    case "STRUCTURAL_LIMIT_EXCEEDED":
      return "Worksheet is too wide to compare within the structural limits.";
    case "MATCHER_INTERNAL_ERROR":
      return "The comparison could not be completed for this item.";
    default:
      return "Unrecognized structural difference.";
  }
}

export function deriveDifferenceWorksheetLabel(d: SchemaDifferenceClient): string {
  return d.governedWorksheetName ?? d.observedWorksheetName ?? "Workbook";
}
