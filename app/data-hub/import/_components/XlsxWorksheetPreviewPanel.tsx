"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

// Data Hub 6.2D2 — read-only XLSX worksheet preview. Receives state plus
// back/retry/restart callbacks only — never the session — so it cannot
// confirm, select a mapping, or set a reporting period. Cell values are
// rendered as React text (escaped); no HTML, no browser persistence.
type XlsxPreviewState =Extract<DataHubImportState, { phase: "xlsxWorksheetPreviewing" | "xlsxWorksheetPreviewReady" | "xlsxWorksheetPreviewFailed" }>;

export default function XlsxWorksheetPreviewPanel({ state, onBack, onRetry, onRestart }: {
  state: XlsxPreviewState;
  onBack: () => void;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const position = state.worksheets.findIndex((w) => w.id === state.worksheet.id) + 1;
  const preview = state.phase === "xlsxWorksheetPreviewReady" ? state.preview : null;
  const visibleColumnCount = preview ? Math.max(preview.headers.length, ...preview.sampleRows.map((row) => row.length), 0) : 0;
  return <div>
    <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>{state.worksheet.worksheetName}</h2>
    <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>Worksheet {position} of {state.worksheets.length}</p>
    <div role="note" style={{ margin: "14px 0", padding: "10px 14px", border: "1px solid rgba(251,191,36,.3)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }}>
      Preview only — Excel import and confirmation are not enabled.
    </div>
    {state.phase === "xlsxWorksheetPreviewing" && <p aria-live="polite">Loading worksheet preview…</p>}
    {state.phase === "xlsxWorksheetPreviewFailed" && <div role="alert"><p>{state.message}</p><button type="button" onClick={onRetry}>Retry</button></div>}
    {preview && <>
      <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{preview.rowCount} rows · {preview.columnCount} columns</p>
      <div tabIndex={0} style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead><tr>{Array.from({ length: visibleColumnCount }, (_, index) => <th key={index} scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>{preview.headers[index] || `Column ${index + 1}`}</th>)}</tr></thead>
          <tbody>{preview.sampleRows.map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: visibleColumnCount }, (_, columnIndex) => <td key={columnIndex} style={{ padding: 8, borderBottom: "1px solid var(--border-light)" }}>{row[columnIndex] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {preview.truncated && <p style={{ fontSize: 12 }}>Preview is truncated to bounded rows, columns, or cell text.</p>}
    </>}
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button type="button" onClick={onBack}>Back to workbook worksheets</button>
      <button type="button" onClick={onRestart}>Choose another file</button>
    </div>
  </div>;
}
