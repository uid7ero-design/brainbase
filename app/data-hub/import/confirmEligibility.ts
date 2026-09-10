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
 *  - previewReady AND requiredHeadersPresent === true AND (this worksheet
 *    is unmapped OR its mapped Preview reports structurally valid) — the
 *    server is KNOWN to accept this; a successful preview reporting either
 *    missing required headers OR a structural mapping failure must disable
 *    confirm outright, since the server confirm path is known to reject
 *    both (Data Hub 5B.5B, Section 20 — reflects previewWorksheet.ts's own
 *    `mapping.structurallyValid`, never a re-derived business rule), OR
 *  - previewFailed AND the explicit, not-pre-checked acknowledgement is
 *    true (the UI does not know header/mapping status here at all — see
 *    screenGroup's previewFailed copy).
 * previewing itself is NEVER eligible (still loading).
 */
export function isConfirmEligible(state: ReviewPhase, previewFailedAcknowledged: boolean): boolean {
  if (state.phase === "confirmationReady") return true;
  if (state.phase === "previewReady") return !hasMissingRequiredHeaders(state) && !hasStructuralMappingFailure(state);
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
 * Data Hub 5B.5B (Section 20) — the single source of truth for "did a
 * SUCCESSFUL mapped preview report a structural mapping failure" — mirrors
 * hasMissingRequiredHeaders' own shape exactly, for the same reason: ONE
 * testable predicate, reused by both isConfirmEligible and ReviewPanel's
 * own rendering, never two independently-drifting checks.
 *
 * A legacy (unmapped) worksheet's `preview.mapping` is null — this always
 * returns false for it, matching Section 20's "do NOT require a mapping
 * for all worksheets" requirement. Deliberately reads ONLY
 * `structurallyValid` (previewWorksheet.ts's own server-computed boolean)
 * — never re-derives whether headers/targets are satisfied from
 * `mappingErrors` itself, which would risk drifting from the server's own
 * verdict.
 */
export function hasStructuralMappingFailure(state: ReviewPhase): boolean {
  return state.phase === "previewReady" && state.preview.mapping !== null && state.preview.mapping.structurallyValid === false;
}

/**
 * Data Hub 5B.5B (Section 27) — the REAL gate for whether the mapping
 * selection control is interactive: the worksheet's own authoritative
 * canonicalStatus, never merely "which ReviewPhase is currently rendered"
 * (confirmationReady is, today, structurally reachable with a
 * non-AWAITING_CONFIRMATION worksheet on the fresh-obtain path — see
 * orchestrator.ts's runObtainWorksheet, which does not itself branch on
 * canonicalStatus the way the resume path's runResumeReadyWorksheetRecovery
 * does). IMPORTED/INELIGIBLE/SKIPPED (or any future status) all lock.
 */
export function isMappingSelectorLocked(canonicalStatus: string): boolean {
  return canonicalStatus !== "AWAITING_CONFIRMATION";
}

/**
 * Data Hub 5B.5B (Section 14) — THE single most important truthfulness
 * function in this whole slice, and the UI-equivalent of 5B.4D's own
 * merge-critical M1 race proof. Kept pure and separate from MappingSelector
 * (ReviewPanel.tsx) for exactly the same reason every other predicate in
 * this file is: independently, behaviorally testable without any DOM.
 *
 * `frozen` MUST come from previewReady.preview.mapping (or "unknown"/null
 * for every other case) — see ReviewPanel.tsx's own `frozenMapping`
 * derivation, which is the ONLY call site. This function's signature
 * deliberately accepts NOTHING ELSE version-shaped — there is no second
 * "currently active version" parameter for a caller to (even accidentally)
 * wire in. If SourceMapping's globally active version changes from v3 to
 * v4 WITHOUT an explicit reselection, `frozen` here is untouched (it was
 * never re-derived from anything but the last successful Preview/selection
 * response), so this function keeps reporting v3 — exactly Section 14's
 * requirement.
 */
export function deriveFrozenMappingLabel(
  frozen: { versionNumber: number } | null | "unknown",
  resolvedName: string | null
): string {
  if (frozen === "unknown") return "Checking current mapping status…";
  if (frozen === null) return "No mapping selected yet.";
  return resolvedName ? `Mapping: ${resolvedName} v${frozen.versionNumber}` : `Mapping v${frozen.versionNumber}`;
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
