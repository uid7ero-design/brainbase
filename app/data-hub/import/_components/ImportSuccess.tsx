"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

// Data Hub 5A.3C.1 — the SUCCESS screen: imported / alreadyImported. Both
// are genuine successes, never styled as errors, with distinct copy —
// alreadyImported never fabricates a row count the phase data doesn't
// provide (only `imported` carries `importedRows`).
export default function ImportSuccess({
  state,
  onStartAnother,
}: {
  state: Extract<DataHubImportState, { phase: "imported" | "alreadyImported" }>;
  onStartAnother: () => void;
}) {
  const isFresh = state.phase === "imported";

  return (
    <div role="status" aria-live="polite">
      <div
        style={{
          border: "1px solid rgba(34,197,94,.25)",
          background: "rgba(34,197,94,.06)",
          borderRadius: 10,
          padding: "18px 20px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: "#f9fafb", marginBottom: 6 }}>
          {isFresh ? "Import complete" : "Already imported"}
        </div>
        <div style={{ fontSize: 13, color: "rgba(249,250,251,.72)" }}>
          {isFresh
            ? `${state.importedRows} row(s) were imported.`
            : "This worksheet had already been imported. No new rows were created."}
        </div>
      </div>

      <button
        type="button"
        onClick={onStartAnother}
        style={{
          marginTop: 18,
          fontSize: 13,
          fontWeight: 600,
          padding: "9px 18px",
          borderRadius: 8,
          border: "none",
          background: "linear-gradient(135deg, #6D28D9, #A78BFA)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Start another import
      </button>
    </div>
  );
}
