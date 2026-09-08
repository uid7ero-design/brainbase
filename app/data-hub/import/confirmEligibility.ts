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
  if (state.phase === "previewReady") return !hasMissingRequiredHeaders(state);
  if (state.phase === "previewFailed") return previewFailedAcknowledged;
  return false;
}

/**
 * QA-POLISH (PR #147 authenticated Preview recheck, issue 2): the single
 * source of truth for "did a SUCCESSFUL preview report missing required
 * headers" — extracted out of `isConfirmEligible`'s own previewReady branch
 * (a pure negation of this) so ReviewPanel can also use it to suppress the
 * "Importing this file will create..." confirmation sentence for exactly
 * this case, without defining a second, independently-drifting check.
 * Deliberately scoped to previewReady only — previewFailed's own, separate
 * acknowledgement-required semantics (where header status is unknown, not
 * "known absent") are untouched by this predicate and must stay that way.
 */
export function hasMissingRequiredHeaders(state: ReviewPhase): boolean {
  return state.phase === "previewReady" && state.preview.requiredHeadersPresent === false;
}

/**
 * R3 remediation (spec Section 12/RTEST9/RTEST10): the single source of
 * truth for "should the bounded preview table render for this phase" — a
 * TypeScript type predicate, so callers keep full narrowing (`state.preview`
 * is safely accessible inside the `true` branch) while the actual decision
 * lives in ONE testable function rather than an inline JSX condition.
 *
 * This replaces an earlier inline `state.phase === "previewReady"` ternary
 * in ReviewPanel.tsx. Independent review found that inline form's own
 * discrimination TEST (block-slicing the source text between the
 * "previewFailed" and "previewReady" string literals) had a blind spot: a
 * mutation that WIDENS this exact condition to
 * `state.phase === "previewReady" || state.phase === "previewFailed"`
 * doesn't add a second `<PreviewTable` call site and doesn't move any text
 * into the slicer's previewFailed block, so it silently escaped that test.
 * Routing the decision through this named function lets the test call it
 * DIRECTLY with a `previewFailed`-phase fixture and assert `false` —
 * semantically, not positionally — so no future syntactic rewrite of the
 * call site can evade it.
 */
export function shouldRenderPreviewTable(state: ReviewPhase): state is Extract<ReviewPhase, { phase: "previewReady" }> {
  return state.phase === "previewReady";
}

/**
 * R2 remediation (spec Section 9-11/RTEST6-RTEST8): a synchronous,
 * React-free duplicate-submission guard around an async confirm call.
 *
 * ROOT CAUSE this replaces: the prior guard was a `useState`-backed
 * `submitting` boolean. Two genuinely SAME-TICK invocations of the
 * identical `onConfirm` closure both read the same captured
 * `submitting === false` snapshot before either state update could commit
 * — independent review proved this empirically. The shipped orchestrator's
 * own `confirm()` phase guard (synchronously transitions to "confirming"
 * before its first `await`) already prevents the actual harmful outcome (a
 * duplicate real import), but the second call's rejected promise was
 * unhandled.
 *
 * This guard's `locked` flag is a plain closure variable — read/written
 * synchronously, with no React re-render in between two same-tick calls —
 * so it is not vulnerable to the same closure-snapshot problem. In
 * ReviewPanel it is held in a `useRef` (read/written only inside the
 * `onConfirm` event handler, never during render, so this repo's
 * react-hooks/refs rule — which flags a `ref.current` read DURING RENDER —
 * does not apply). `confirmFn`'s rejection is always consumed here, so no
 * unhandled promise rejection can ever reach the browser console from this
 * call path (R2-F). The lock always releases once the call settles
 * (success OR failure), so a legitimate later retry remains fully
 * functional (R2-C/R2-D) — this guard only protects the ORIGINAL confirm
 * click; `retryConfirm()` (wired directly in ImportClient.tsx after a
 * confirmFailed transition) is an intentionally separate, ungated call,
 * since it already re-enters confirm()'s own phase guard.
 */
export function createConfirmGuard(confirmFn: () => Promise<void>): {
  isLocked: () => boolean;
  invoke: (onSettled?: () => void) => void;
} {
  let locked = false;
  return {
    isLocked: () => locked,
    invoke: (onSettled) => {
      if (locked) return;
      locked = true;
      confirmFn()
        .catch(() => {
          // The orchestrator's own confirm() already reports failure via
          // its own confirmFailed phase (observed through
          // useSyncExternalStore) — this catch exists ONLY to consume the
          // rejection so it never surfaces as an unhandled promise
          // rejection. Never derives a separate error UI from it.
        })
        .finally(() => {
          locked = false;
          onSettled?.();
        });
    },
  };
}
