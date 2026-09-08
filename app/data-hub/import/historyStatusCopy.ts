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
  /** Shown only when NOT actionable — the honest, non-actionable reason. */
  caption: string | null;
}

export function describeBatchHistoryStatus(status: ImportBatchStatus): HistoryStatusPresentation {
  switch (status) {
    case "READY":
      return { label: "Ready", actionable: true, caption: null };
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
