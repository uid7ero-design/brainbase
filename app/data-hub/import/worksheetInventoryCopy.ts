// Data Hub 6.2D1 — pure display copy for the XLSX structural worksheet
// inventory (WorksheetInventoryPanel.tsx). Structural fields only: every
// label here is derived from persisted worksheet metadata (index, name,
// visibility, emptiness, canonical status) — never from cell content.
import type { WorksheetCanonicalStatusClient, WorksheetVisibilityClient } from "@/lib/data-hub/client/types";

export const INVENTORY_NOT_ENABLED_NOTICE =
  "Excel workbook import is not enabled yet. This is a structural check of the workbook's worksheets only — no data has been imported.";

export function deriveVisibilityLabel(visibility: WorksheetVisibilityClient): string {
  switch (visibility) {
    case "visible":
      return "Visible";
    case "hidden":
      return "Hidden";
    case "veryHidden":
      return "Very hidden";
  }
}

export function deriveContentsLabel(isEmpty: boolean): string {
  return isEmpty ? "Empty" : "Has content";
}

export function deriveInventoryStatusLabel(status: WorksheetCanonicalStatusClient): string {
  switch (status) {
    case "AWAITING_CONFIRMATION":
      return "Awaiting confirmation (import not enabled)";
    case "INELIGIBLE":
      return "Not importable";
    case "SKIPPED":
      return "Skipped";
    case "IMPORTED":
      return "Imported";
  }
}
