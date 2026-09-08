"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

// Data Hub 5A.3C.1 — the SUCCESS screen: imported / alreadyImported. Both
// are genuine successes, never styled as errors, with distinct copy —
// alreadyImported never fabricates a row count the phase data doesn't
// provide (only `imported` carries `importedRows`).
//
// QA-POLISH (PR #147 authenticated Preview recheck, issue 1): this screen
// previously wrapped its heading/message in a bordered, padded card (the
// same visual treatment ImportError.tsx legitimately uses for ALERT-style
// content). Every other primary screen in this flow — FileSelector's own
// `<h1>`, ReviewPanel's own `<h2>` — renders its heading/text flush against
// the shared container, with no extra card indentation. Success is this
// flow's own primary terminal content (not a secondary alert layered over
// other content), so it now matches THAT convention instead: a flush
// heading (colored to preserve a success cue) + a flush paragraph, no
// card. This is layout-only — the message text, row count, and
// Start-another-import behavior are unchanged.
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
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#4ADE80", marginBottom: 4 }}>
        {isFresh ? "Import complete" : "Already imported"}
      </h2>
      <p style={{ fontSize: 13, color: "rgba(249,250,251,.72)" }}>
        {isFresh
          ? `${state.importedRows} row(s) were imported.`
          : "This worksheet had already been imported. No new rows were created."}
      </p>

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
