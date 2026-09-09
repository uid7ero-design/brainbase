// Data Hub 5A.3D.2 — pure batch-status -> history-row presentation mapping.
// Kept separate (no React) so it is independently testable, and so the
// "which statuses are clickable" decision lives in exactly one place rather
// than an inline JSX condition. READY/FAILED are the only statuses this
// module marks actionable — matching the shipped 5A.3D.1 recovery semantics
// (AWAITING_UPLOAD/PROCESSING/DELETION_PENDING are non-actionable there too;
// opening one would only ever show the identical honest, non-resumable
// message that hydration already produces, so this list decides it once,
// without any per-row worksheet/detail fetch).
import type { ImportBatchStatus } from "@/lib/data-hub/client/types";

export interface HistoryStatusPresentation {
  label: string;
  /** true: the row links to /data-hub/import/[batchId]. false: status-only,
   * no navigation offered. */
  actionable: boolean;
  /** Optional short clarifying caption, shown alongside the date whenever
   * present (not only for non-actionable rows). */
  caption: string | null;
}

export function describeBatchHistoryStatus(status: ImportBatchStatus): HistoryStatusPresentation {
  switch (status) {
    case "READY":
      // PR #161 QA REMEDIATION (issue 2): ImportBatch READY is a
      // physical/storage lifecycle state — it says nothing about whether
      // the worksheet inside it was ever reviewed/confirmed as a valid
      // domain import. Authenticated Preview QA found managers reading the
      // old "Ready" label (rendered in success-green) as "successfully
      // imported," which is not necessarily true — an invalid CSV that was
      // uploaded but never confirmed also sits at READY forever. "Review
      // pending" plus this caption is truthful without an N+1 worksheet
      // fetch: the row remains actionable/clickable, and opening it always
      // shows the real, fresh, worksheet-level truth (imported / needs
      // review / ineligible / skipped) via the unmodified 5A.3D.1 recovery
      // matrix — this label never claims more than the batch level knows.
      return { label: "Review pending", actionable: true, caption: "Uploaded — not yet imported" };
    case "FAILED":
      return { label: "Failed", actionable: true, caption: null };
    case "AWAITING_UPLOAD":
      return {
        label: "Never completed",
        actionable: false,
        caption: "This import was never completed. Start a new import to continue.",
      };
    case "PROCESSING":
      return { label: "Processing", actionable: false, caption: "Still processing — check back shortly." };
    case "DELETION_PENDING":
      return { label: "Pending deletion", actionable: false, caption: "This import is pending deletion." };
    default: {
      const _exhaustive: never = status;
      return { label: String(_exhaustive), actionable: false, caption: null };
    }
  }
}
