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
// anywhere in its input. Actions: leaving (onRestart) and, 6.2D2, an
// explicit per-row Preview (onPreview) shown only for a visible, non-empty,
// AWAITING_CONFIRMATION worksheet — never auto-invoked, even for a
// single-sheet workbook. The orchestrator re-validates the id. 6.2D3C: an
// explicit, read-only "Compare to governed schema" (onCompareSchema) —
// never auto-invoked; it shows a structural difference report only.
export default function WorksheetInventoryPanel({
  state,
  onPreview,
  onCompareSchema,
  onRestart,
}: {
  state: Extract<DataHubImportState, { phase: "worksheetInventoryReady" }>;
  onPreview: (worksheetId: string) => void;
  onCompareSchema: () => void;
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
              {["#", "Worksheet", "Visibility", "Contents", "Status", "Action"].map((h) => (
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
                <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                  {w.worksheetVisibility === "visible" && !w.worksheetIsEmpty && w.canonicalStatus === "AWAITING_CONFIRMATION" ? (
                    <button type="button" onClick={() => onPreview(w.id)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}>
                      Preview
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button
        type="button"
        onClick={onCompareSchema}
        style={{
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
        Compare to governed schema
      </button>
      <button
        type="button"
        onClick={onRestart}
        style={{
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
    </div>
  );
}
