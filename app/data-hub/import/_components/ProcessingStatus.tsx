"use client";

import type { DataHubIllegalDumpingImportSession, DataHubImportState } from "@/lib/data-hub/client/orchestrator";
import ImportError from "./ImportError";
import { deriveErrorOverlayCopy, deriveProcessingStatusText, isErrorOverlayPhase, isUnrecoverableStorageFailure } from "../screenGroup";

// Data Hub 5A.3C.1 — the one continuous PROCESSING screen: finalizing,
// finalizeUncertain, reconciling, physicalReady, physicalFailed,
// batchTerminal, inspecting, inspectFailed, obtainingWorksheet,
// obtainWorksheetFailed, unknownError. Each sub-phase gets truthful,
// operation-specific status text (screenGroup.ts's deriveProcessingStatusText)
// rather than one generic spinner.
export default function ProcessingStatus({
  state,
  session,
  onRestart,
}: {
  state: Extract<
    DataHubImportState,
    {
      phase:
        | "finalizing"
        | "finalizeUncertain"
        | "reconciling"
        | "physicalReady"
        | "physicalFailed"
        | "batchTerminal"
        | "inspecting"
        | "inspectFailed"
        | "obtainingWorksheet"
        | "obtainWorksheetFailed"
        | "unknownError";
    }
  >;
  session: DataHubIllegalDumpingImportSession;
  onRestart: () => void;
}) {
  if (!isErrorOverlayPhase(state.phase)) {
    return (
      <div aria-live="polite" aria-busy="true" style={{ fontSize: 13, color: "rgba(249,250,251,.7)" }}>
        {deriveProcessingStatusText(state.phase)}
      </div>
    );
  }

  const copy = deriveErrorOverlayCopy(state)!;
  const code = state.phase === "physicalFailed" ? String(state.failureCode) : undefined;
  const unrecoverableStorage = isUnrecoverableStorageFailure(code);

  const onRetry = (() => {
    switch (copy.retryAction) {
      case "proceedToFinalize":
        return () => void session.proceedToFinalize();
      case "retryFinalize":
        return () => void session.retryFinalize();
      case "retryObtainWorksheet":
        return () => void session.retryObtainWorksheet();
      case "retryInspect":
        return () => void session.retryInspect();
      case "restart":
        return onRestart;
      default:
        return null;
    }
  })();

  return (
    <ImportError
      title={unrecoverableStorage ? "Something went wrong reading your file" : copy.title}
      message={unrecoverableStorage ? "Please contact support if this keeps happening." : copy.message}
      retryLabel={unrecoverableStorage ? null : copy.retryLabel}
      onRetry={unrecoverableStorage ? null : onRetry}
      code={code}
    />
  );
}
