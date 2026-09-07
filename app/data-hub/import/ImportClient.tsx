"use client";

import { useEffect, useRef, useState } from "react";
import { useDataHubImportSession } from "./useDataHubImportSession";
import { deriveScreenGroup, deriveErrorOverlayCopy, isErrorOverlayPhase } from "./screenGroup";
import FileSelector from "./_components/FileSelector";
import UploadProgress from "./_components/UploadProgress";
import ProcessingStatus from "./_components/ProcessingStatus";
import ReviewPanel from "./_components/ReviewPanel";
import ImportSuccess from "./_components/ImportSuccess";
import ImportError from "./_components/ImportError";

// Data Hub 5A.3C.1 — client shell. Owns the hook, switches between the 6
// rendered screen groups (Select / Uploading / Processing / Review /
// Confirm / Success) based on the shipped orchestrator's real phase. A
// `resetKey` remount is the ONLY "start a new import" mechanism — the
// shipped client has no reset()/restart() method, and creating a fresh
// session via a full remount (dispose old, construct new) is the correct,
// contract-respecting way to start over.
export default function ImportClient() {
  const [resetKey, setResetKey] = useState(0);
  return <ImportFlow key={resetKey} onRestart={() => setResetKey((k) => k + 1)} />;
}

const IN_FLIGHT_NAV_GUARD_PHASES = new Set(["uploading", "finalizing", "confirming"]);

function ImportFlow({ onRestart }: { onRestart: () => void }) {
  const { state, session } = useDataHubImportSession();
  const screenGroup = deriveScreenGroup(state.phase);
  const headingRef = useRef<HTMLDivElement>(null);

  // In-flight navigation guard (spec Section 23 / discovery Section U) —
  // narrow, phase-scoped, attached/detached via this effect only, never a
  // global always-on handler.
  useEffect(() => {
    if (!IN_FLIGHT_NAV_GUARD_PHASES.has(state.phase)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.phase]);

  // Focus management: move focus to this screen's heading on every
  // screen-group transition, so screen-reader users get an announcement.
  useEffect(() => {
    headingRef.current?.focus();
  }, [screenGroup]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <div ref={headingRef} tabIndex={-1} style={{ outline: "none" }} aria-live="polite">
        {screenGroup === "select" && <FileSelector session={session} />}

        {screenGroup === "uploading" && (
          <UploadProgress
            state={
              state as Extract<
                typeof state,
                { phase: "initiating" | "initiateFailed" | "initiateConfigurationError" | "awaitingUpload" | "uploading" | "uploadUncertain" }
              >
            }
            session={session}
          />
        )}

        {screenGroup === "processing" && (
          <ProcessingStatus
            state={
              state as Extract<
                typeof state,
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
              >
            }
            session={session}
            onRestart={onRestart}
          />
        )}

        {screenGroup === "review" && (
          <ReviewPanel
            state={state as Extract<typeof state, { phase: "confirmationReady" | "previewing" | "previewFailed" | "previewReady" }>}
            session={session}
          />
        )}

        {screenGroup === "confirm" &&
          (state.phase === "confirming" ? (
            <div aria-live="polite" aria-busy="true" style={{ fontSize: 13, color: "rgba(249,250,251,.7)" }}>
              Confirming import…
            </div>
          ) : isErrorOverlayPhase(state.phase) ? (
            (() => {
              const copy = deriveErrorOverlayCopy(state)!;
              return (
                <ImportError
                  title={copy.title}
                  message={copy.message}
                  retryLabel={copy.retryLabel}
                  onRetry={copy.retryAction === "retryConfirm" ? () => void session.retryConfirm() : null}
                />
              );
            })()
          ) : null)}

        {screenGroup === "success" && (
          <ImportSuccess
            state={state as Extract<typeof state, { phase: "imported" | "alreadyImported" }>}
            onStartAnother={onRestart}
          />
        )}
      </div>
    </div>
  );
}
