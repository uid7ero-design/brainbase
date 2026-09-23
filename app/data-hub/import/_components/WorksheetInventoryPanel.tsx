"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";
import {
  INVENTORY_NOT_ENABLED_NOTICE,
  deriveContentsLabel,
  deriveInventoryStatusLabel,
  deriveVisibilityLabel,
} from "../worksheetInventoryCopy";

// Data Hub 6.2D1 — the XLSX structural worksheet inventory screen
// (worksheetInventoryReady). Read-only by construction: this component is
// never handed the import session, so it has no way to call confirm(),
// loadPreview(), or any mapping/period method. It renders persisted
// structural metadata only — no headers, sample rows, or cell values exist
// anywhere in its input. The only action is leaving (onRestart).
export default function WorksheetInventoryPanel({
  state,
  onRestart,
}: {
  state: Extract<DataHubImportState, { phase: "worksheetInventoryReady" }>;
  onRestart: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f9fafb", marginBottom: 4 }}>Workbook worksheets</h2>
      <p style={{ fontSize: 13, color: "rgba(249,250,251,.55)", marginBottom: 14 }}>
        {state.worksheets.length} worksheet(s) found in {state.batch.originalFilename ?? "this workbook"}.
      </p>

      <div
        role="note"
        style={{
          border: "1px solid rgba(251,191,36,.3)",
          background: "rgba(251,191,36,.06)",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 12,
          color: "#f9fafb",
          marginBottom: 14,
        }}
      >
        {INVENTORY_NOT_ENABLED_NOTICE}
      </div>

      <div
        tabIndex={0}
        aria-label={`Worksheet inventory, ${state.worksheets.length} worksheets`}
        style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8 }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              {["#", "Worksheet", "Visibility", "Contents", "Status"].map((h) => (
                <th
                  key={h}
                  scope="col"
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
            {state.worksheets.map((w) => (
              <tr key={w.id} data-worksheet-index={w.worksheetIndex} data-canonical-status={w.canonicalStatus}>
                {[
                  String(w.worksheetIndex),
                  w.worksheetName,
                  deriveVisibilityLabel(w.worksheetVisibility),
                  deriveContentsLabel(w.worksheetIsEmpty),
                  deriveInventoryStatusLabel(w.canonicalStatus),
                ].map((cell, c) => (
                  <td
                    key={c}
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

      <button
        type="button"
        onClick={onRestart}
        style={{
          marginTop: 20,
          fontSize: 13,
          fontWeight: 600,
          padding: "9px 18px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,.18)",
          background: "transparent",
          color: "rgba(249,250,251,.85)",
          cursor: "pointer",
        }}
      >
        Choose another file
      </button>
    </div>
  );
}
