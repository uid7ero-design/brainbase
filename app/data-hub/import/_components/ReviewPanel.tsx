"use client";

import { useEffect, useState } from "react";
import type { DataHubIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import ImportError from "./ImportError";
import ConfirmAction from "./ConfirmAction";
import { isConfirmEligible, type ReviewPhase } from "../confirmEligibility";

// Data Hub 5A.3C.1 — the REVIEW screen: confirmationReady, previewing,
// previewFailed, previewReady. Owns the bounded preview table, the
// missing-required-header validation summary, and the previewFailed
// acknowledgement checkbox.
//
// CRITICAL (discovery Section P / spec Section 19): previewFailed and
// previewReady are genuinely, structurally distinct render branches below —
// previewFailed NEVER calls the same table-rendering logic previewReady
// uses. previewFailed is never visually represented as if review succeeded.
export default function ReviewPanel({
  state,
  session,
}: {
  state: ReviewPhase;
  session: DataHubIllegalDumpingImportSession;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // Local, synchronous double-submit guard (T16/M7): set the instant
  // Confirm is clicked, BEFORE the orchestrator's own async confirm() call
  // resolves or its phase transition propagates back through
  // useSyncExternalStore. The orchestrator's own confirm() phase guard
  // would also throw on a genuine re-entrant call, but this flag prevents
  // the click from ever reaching a second confirm() call at all.
  const [submitting, setSubmitting] = useState(false);

  // Reset the acknowledgement whenever the preview state itself changes
  // (e.g. a retry lands on a fresh previewFailed, or a retry succeeds into
  // previewReady) — a stale acknowledgement must never silently carry over.
  // React's own "adjusting state during render" pattern (not an effect —
  // this repo's ESLint config flags synchronous setState-in-effect calls):
  // https://react.dev/learn/you-might-not-need-an-effect
  const [prevPhase, setPrevPhase] = useState(state.phase);
  if (state.phase !== prevPhase) {
    setPrevPhase(state.phase);
    setAcknowledged(false);
  }

  useEffect(() => {
    if (state.phase === "confirmationReady") {
      // Auto-offer preview — the manager can always choose not to wait; this
      // just starts the (optional, non-blocking) preview load immediately
      // rather than requiring an extra click most managers will make anyway.
      void session.loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase === "confirmationReady"]);

  const eligible = isConfirmEligible(state, acknowledged);

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f9fafb", marginBottom: 4 }}>
        {state.worksheet.worksheetName}
      </h2>

      {state.phase === "confirmationReady" || state.phase === "previewing" ? (
        <div aria-live="polite" aria-busy="true" style={{ fontSize: 13, color: "rgba(249,250,251,.6)", marginTop: 10 }}>
          Preparing preview…
        </div>
      ) : null}

      {state.phase === "previewFailed" ? (
        <div style={{ marginTop: 10 }}>
          <ImportError
            title="Couldn't load a preview"
            message="A preview of this file's contents could not be loaded. You have NOT reviewed a sample of the data."
            retryLabel="Try loading preview again"
            onRetry={() => void session.retryPreview()}
          />
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, fontSize: 13, color: "rgba(249,250,251,.75)" }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I understand a preview of this file&apos;s contents could not be loaded, and I want to confirm without
              reviewing it.
            </span>
          </label>
        </div>
      ) : null}

      {state.phase === "previewReady" ? <PreviewTable preview={state.preview} /> : null}

      {state.phase !== "previewing" && state.phase !== "confirmationReady" ? (
        <ConfirmAction
          eligible={eligible}
          busy={submitting}
          onConfirm={() => {
            if (submitting) return;
            setSubmitting(true);
            void session.confirm();
          }}
          rowCount={state.phase === "previewReady" ? state.preview.rowCount : undefined}
        />
      ) : null}
    </div>
  );
}

function PreviewTable({
  preview,
}: {
  preview: {
    rowCount: number;
    columnCount: number;
    headers: string[];
    sampleRows: string[][];
    sampleRowCount: number;
    truncated: boolean;
    requiredHeadersPresent: boolean;
    missingRequiredHeaders: string[];
  };
}) {
  const columnTruncated = preview.columnCount > preview.headers.length;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "rgba(249,250,251,.55)", marginBottom: 10 }}>
        {preview.rowCount} row(s), {preview.columnCount} column(s)
      </div>

      {!preview.requiredHeadersPresent ? (
        <div
          role="alert"
          style={{
            border: "1px solid rgba(239,68,68,.25)",
            background: "rgba(239,68,68,.06)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "#f9fafb",
            marginBottom: 12,
          }}
        >
          Missing required column(s): {preview.missingRequiredHeaders.join(", ")}. This file cannot be imported until
          they are present.
        </div>
      ) : null}

      <div
        tabIndex={0}
        aria-label={`Scrollable preview of ${preview.headers.length} columns`}
        style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8 }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              {preview.headers.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  title={h}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid rgba(255,255,255,.1)",
                    color: "rgba(249,250,251,.75)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sampleRows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    title={cell}
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid rgba(255,255,255,.05)",
                      color: "rgba(249,250,251,.6)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview.truncated ? (
        <div style={{ fontSize: 11, color: "rgba(249,250,251,.4)", marginTop: 8 }}>
          Showing first {preview.sampleRowCount} of {preview.rowCount} rows
          {columnTruncated ? `, first ${preview.headers.length} of ${preview.columnCount} columns` : ""}.
        </div>
      ) : columnTruncated ? (
        <div style={{ fontSize: 11, color: "rgba(249,250,251,.4)", marginTop: 8 }}>
          Showing first {preview.headers.length} of {preview.columnCount} columns.
        </div>
      ) : null}
    </div>
  );
}
