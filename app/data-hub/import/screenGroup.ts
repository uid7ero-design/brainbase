// Data Hub 5A.3C.1 — pure phase -> rendered-screen-group derivation.
//
// The shipped 5A.3B/5A.3C.0 orchestrator (lib/data-hub/client/orchestrator.ts)
// is the ONLY state authority — this module never invents new state, it only
// groups the real 26 phases into the 6 rendered screens the discovered
// product flow calls for (Select / Uploading / Processing / Review / Confirm
// / Success), plus derives truthful, phase-specific copy for every
// error/uncertainty overlay. Kept as pure functions (no React, no DOM) so it
// is independently testable under this repo's node-only Vitest environment.
import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

export type ScreenGroup = "select" | "uploading" | "processing" | "review" | "confirm" | "success";

const UPLOADING_PHASES = new Set([
  "initiating",
  "initiateFailed",
  "initiateConfigurationError",
  "awaitingUpload",
  "uploading",
  "uploadUncertain",
]);

const PROCESSING_PHASES = new Set([
  "finalizing",
  "finalizeUncertain",
  "reconciling",
  "physicalReady",
  "physicalFailed",
  "batchTerminal",
  "inspecting",
  "inspectFailed",
  "obtainingWorksheet",
  "obtainWorksheetFailed",
  // unknownError can only be reached via reconcileFromBatchStatus's
  // exhaustiveness guard during finalize-uncertainty reconciliation — the
  // same conceptual screen as every other processing-stage failure.
  "unknownError",
]);

const REVIEW_PHASES = new Set(["confirmationReady", "previewing", "previewFailed", "previewReady"]);

const CONFIRM_PHASES = new Set(["confirming", "confirmFailed"]);

const SUCCESS_PHASES = new Set(["imported", "alreadyImported"]);

export function deriveScreenGroup(phase: DataHubImportState["phase"]): ScreenGroup {
  if (phase === "idle") return "select";
  if (UPLOADING_PHASES.has(phase)) return "uploading";
  if (PROCESSING_PHASES.has(phase)) return "processing";
  if (REVIEW_PHASES.has(phase)) return "review";
  if (CONFIRM_PHASES.has(phase)) return "confirm";
  if (SUCCESS_PHASES.has(phase)) return "success";
  // Exhaustiveness fallback — a phase this module has never seen. Never
  // silently treated as success; falls back to the select screen so the
  // user isn't stuck on a blank/unrecognized view.
  return "select";
}

/** Truthful, operation-specific status text for the one continuous
 * Processing screen — never a single generic "Processing…" (spec Section
 * 14's explicit instruction). */
export function deriveProcessingStatusText(phase: DataHubImportState["phase"]): string {
  switch (phase) {
    case "finalizing":
    case "reconciling":
      return "Verifying upload…";
    case "physicalReady":
      return "Upload verified. Reading your file…";
    case "inspecting":
      return "Reading your file…";
    case "obtainingWorksheet":
      return "Preparing worksheet…";
    default:
      return "Processing…";
  }
}

export type RetryAction =
  | "retryInitiate"
  | "proceedToFinalize"
  | "retryFinalize"
  | "retryInspect"
  | "retryObtainWorksheet"
  | "retryPreview"
  | "retryConfirm"
  | "restart"
  | null;

export interface ErrorOverlayCopy {
  title: string;
  message: string;
  retryLabel: string | null;
  retryAction: RetryAction;
}

/** True for every phase this module treats as an error/uncertainty overlay
 * rather than a forward-progress phase. */
export function isErrorOverlayPhase(phase: DataHubImportState["phase"]): boolean {
  return (
    phase === "initiateFailed" ||
    phase === "initiateConfigurationError" ||
    phase === "uploadUncertain" ||
    phase === "finalizeUncertain" ||
    phase === "physicalFailed" ||
    phase === "batchTerminal" ||
    phase === "inspectFailed" ||
    phase === "obtainWorksheetFailed" ||
    phase === "previewFailed" ||
    phase === "confirmFailed" ||
    phase === "unknownError" ||
    phase === "worksheetTerminal"
  );
}

/**
 * Maps every error/uncertainty phase to specific, non-leaking copy and the
 * CORRECT phase-specific retry method — never a generic "try again" that
 * would call the wrong orchestrator method (spec Section 22). Never
 * interpolates a raw server `code`/`message` string that could carry
 * internal details; only a small, deliberately-curated set of `message`
 * values (already pre-sanitized server strings, per this repo's own
 * established failureTaxonomy discipline) are passed through as-is.
 */
export function deriveErrorOverlayCopy(state: DataHubImportState): ErrorOverlayCopy | null {
  switch (state.phase) {
    case "initiateFailed":
      return { title: "Couldn't start the import", message: state.message, retryLabel: "Try again", retryAction: "retryInitiate" };
    case "initiateConfigurationError":
      return {
        title: "Temporarily unavailable",
        message: "The import service is temporarily unavailable. Please try again in a moment.",
        retryLabel: "Try again",
        retryAction: "retryInitiate",
      };
    case "uploadUncertain":
      return {
        title: "Checking your upload",
        message: "We couldn't confirm your upload finished. We'll check its status now — this is safe.",
        retryLabel: "Continue",
        retryAction: "proceedToFinalize",
      };
    case "finalizeUncertain":
      return {
        title: "Checking status",
        message: "We're checking the status of your upload.",
        retryLabel: "Check again",
        retryAction: "retryFinalize",
      };
    case "physicalFailed":
      return {
        title: "Upload could not be verified",
        message: state.failureMessage,
        retryLabel: state.retryable ? "Try again" : "Start a new import",
        retryAction: state.retryable ? "proceedToFinalize" : "restart",
      };
    case "batchTerminal":
      return { title: "This import can't proceed", message: state.message, retryLabel: "Start a new import", retryAction: "restart" };
    case "inspectFailed": {
      // A parser/format rejection will fail identically on retry — only a
      // genuine transport-level uncertainty (code "NETWORK") is worth
      // re-attempting the same operation for.
      const isNetworkIssue = state.code === "NETWORK";
      return {
        title: "Couldn't read this file",
        message: state.message,
        retryLabel: isNetworkIssue ? "Try again" : "Choose a different file",
        retryAction: isNetworkIssue ? "retryInspect" : "restart",
      };
    }
    case "obtainWorksheetFailed":
      return { title: "Couldn't prepare this file", message: state.message, retryLabel: "Try again", retryAction: "retryObtainWorksheet" };
    case "previewFailed":
      return { title: "Couldn't load a preview", message: state.message, retryLabel: "Try again", retryAction: "retryPreview" };
    case "confirmFailed":
      return { title: "Couldn't confirm this import", message: state.message, retryLabel: "Try again", retryAction: "retryConfirm" };
    case "unknownError":
      return {
        title: "Something went wrong",
        message: state.message,
        retryLabel: "Start a new import",
        retryAction: "restart",
      };
    case "worksheetTerminal":
      return {
        title: state.reason === "SKIPPED" ? "This sheet was skipped" : "This sheet can't be imported",
        message:
          state.reason === "SKIPPED"
            ? "This worksheet was skipped during import and cannot be confirmed."
            : "This worksheet was found ineligible for import and cannot be confirmed.",
        retryLabel: "Start a new import",
        retryAction: "restart",
      };
    default:
      return null;
  }
}

/** Storage/integrity-shaped failures never leak provider/hash details —
 * this list is the ONE place that decides which physicalFailed/previewFailed
 * codes get the generic "contact support" framing instead of a retry. */
const UNRECOVERABLE_STORAGE_CODES = new Set(["STORAGE_INTEGRITY_MISMATCH", "STORAGE_NOT_FOUND", "PROVIDER_FAILURE"]);

export function isUnrecoverableStorageFailure(code: string | undefined | null): boolean {
  return !!code && UNRECOVERABLE_STORAGE_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Data Hub 5A.3D.2 — additive recovery-phase copy. `worksheetTerminal`
// (5A.3D.1) is the one remaining error/uncertainty-shaped phase this module
// did not yet classify — `batchTerminal`, reused unmodified for every other
// 5A.3D.1 terminal-recovery case, already had a home here. Extending
// isErrorOverlayPhase/deriveErrorOverlayCopy (rather than introducing a
// parallel recovery-only copy module) lets the recovery route reuse the
// exact same ImportError renderer and retry-dispatch convention the
// ordinary flow already uses — no second error-presentation system.
// ---------------------------------------------------------------------------
