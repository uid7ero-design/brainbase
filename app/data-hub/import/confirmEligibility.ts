// Data Hub 5A.3C.1 — pure confirm-eligibility derivation (discovery Sections
// N/O/spec Sections 18-20). Kept separate from ReviewPanel/ConfirmAction so
// it is independently, behaviorally testable without any DOM.
import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

export type ReviewPhase = Extract<
  DataHubImportState,
  { phase: "confirmationReady" | "previewing" | "previewFailed" | "previewReady" }
>;

/**
 * Confirm is eligible when:
 *  - confirmationReady (no preview attempted at all — orchestrator's own
 *    shipped, reviewed semantics allow this directly), OR
 *  - previewReady AND requiredHeadersPresent === true (the server is KNOWN
 *    to accept this — a successful preview reporting missing required
 *    headers must disable confirm outright, since the server confirm path
 *    is known to reject it), OR
 *  - previewFailed AND the explicit, not-pre-checked acknowledgement is
 *    true (the UI does not know header status here at all — see
 *    screenGroup's previewFailed copy).
 * previewing itself is NEVER eligible (still loading).
 */
export function isConfirmEligible(state: ReviewPhase, previewFailedAcknowledged: boolean): boolean {
  if (state.phase === "confirmationReady") return true;
  if (state.phase === "previewReady") return state.preview.requiredHeadersPresent === true;
  if (state.phase === "previewFailed") return previewFailedAcknowledged;
  return false;
}
