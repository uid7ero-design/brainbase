"use client";

import { useEffect, useState } from "react";
import type { DataHubIllegalDumpingImportSession, DataHubImportState } from "@/lib/data-hub/client/orchestrator";
import ImportError from "./ImportError";
import { deriveErrorOverlayCopy } from "../screenGroup";

// Data Hub 5A.3C.1 — the UPLOADING screen: initiating / initiateFailed /
// initiateConfigurationError / awaitingUpload / uploading / uploadUncertain.
//
// Progress is REAL, sourced only from the orchestrator's own upload()
// onProgress callback — no fake/timer-driven percentage anywhere in this
// file. uploadUncertain's only offered recovery is proceedToFinalize() —
// this component NEVER renders a "retry upload" affordance for that phase
// (the orchestrator's own class comment forbids a direct re-upload here due
// to allowOverwrite:false).
export default function UploadProgress({
  state,
  session,
}: {
  state: Extract<
    DataHubImportState,
    { phase: "initiating" | "initiateFailed" | "initiateConfigurationError" | "awaitingUpload" | "uploading" | "uploadUncertain" }
  >;
  session: DataHubIllegalDumpingImportSession;
}) {
  const [progressPct, setProgressPct] = useState<number | null>(null);

  // awaitingUpload auto-triggers the real upload() call — this is the ONLY
  // place upload() is ever invoked; no other component calls it.
  useEffect(() => {
    if (state.phase === "awaitingUpload") {
      void session.upload((p) => {
        // p is the REAL DataHubUploadProgress shape from the shipped SDK
        // callback — no synthetic percentage is ever computed here.
        if (typeof p.percentage === "number") setProgressPct(p.percentage);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase === "awaitingUpload"]);

  if (state.phase === "initiating") {
    return <StatusLine text="Preparing your upload…" busy />;
  }

  if (state.phase === "initiateFailed" || state.phase === "initiateConfigurationError") {
    const copy = deriveErrorOverlayCopy(state)!;
    return (
      <ImportError
        title={copy.title}
        message={copy.message}
        retryLabel={copy.retryLabel}
        onRetry={copy.retryAction === "retryInitiate" ? () => void session.retryInitiate() : null}
      />
    );
  }

  if (state.phase === "awaitingUpload") {
    return <StatusLine text="Starting upload…" busy />;
  }

  if (state.phase === "uploading") {
    const pct = state.progress?.percentage ?? progressPct;
    return (
      <div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 8 }}>Uploading…</div>
        <div
          role="progressbar"
          aria-valuenow={pct ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct ?? 0}%`,
              background: "var(--purple-600)",
              transition: "width .2s",
            }}
          />
        </div>
        {typeof pct === "number" ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{Math.round(pct)}%</div>
        ) : null}
        <button
          type="button"
          onClick={() => session.abort()}
          style={{
            marginTop: 14,
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 12px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // uploadUncertain
  const copy = deriveErrorOverlayCopy(state)!;
  return (
    <ImportError
      title={copy.title}
      message={copy.message}
      retryLabel={copy.retryLabel}
      onRetry={() => void session.proceedToFinalize()}
    />
  );
}

function StatusLine({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div aria-live="polite" aria-busy={!!busy} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
      {text}
    </div>
  );
}
