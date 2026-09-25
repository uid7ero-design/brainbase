"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";
import {
  SCHEMA_MATCH_NOTICE,
  deriveDifferenceWorksheetLabel,
  deriveSchemaMatchHeadline,
  describeSchemaDifference,
} from "../schemaMatchCopy";

// Data Hub 6.2D3C — read-only governed schema difference report. Receives
// state plus back/retry/restart callbacks only — never the session — so it
// cannot confirm, select a mapping or schema, set a period, or import.
// Renders structural fields only (worksheet names, column positions,
// header text); the report never contains sample rows or cell values.
// All text is rendered as escaped React text.
type SchemaMatchState = Extract<DataHubImportState, { phase: "schemaMatchLoading" | "schemaMatchReady" | "schemaMatchFailed" }>;

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKING: "#f87171",
  WARNING: "#fbbf24",
  INFO: "rgba(249,250,251,.7)",
};

export default function SchemaMatchReportPanel({ state, onBack, onRetry, onRestart }: {
  state: SchemaMatchState;
  onBack: () => void;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const report = state.phase === "schemaMatchReady" ? state.report : null;
  return <div>
    <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f9fafb" }}>Governed schema comparison</h2>
    <p style={{ fontSize: 12, color: "rgba(249,250,251,.6)" }}>{state.batch.originalFilename ?? "This workbook"}</p>
    <div role="note" style={{ margin: "14px 0", padding: "10px 14px", border: "1px solid rgba(251,191,36,.3)", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}>
      {SCHEMA_MATCH_NOTICE}
    </div>
    {state.phase === "schemaMatchLoading" && <p aria-live="polite">Comparing workbook structure…</p>}
    {state.phase === "schemaMatchFailed" && <div role="alert"><p>{state.message}</p><button type="button" onClick={onRetry}>Retry</button></div>}
    {report && <>
      <p style={{ fontSize: 14, fontWeight: 600, color: "#f9fafb" }}>{deriveSchemaMatchHeadline(report)}</p>
      <p style={{ fontSize: 12, color: "rgba(249,250,251,.7)", fontVariantNumeric: "tabular-nums" }}>
        {report.matchedWorksheetCount} of {report.governedWorksheetCount} governed worksheets matched · {report.observedWorksheetCount} worksheets in file ·{" "}
        {report.missingRequiredWorksheetCount + report.missingOptionalWorksheetCount} missing · {report.unexpectedWorksheetCount} unexpected ·{" "}
        {report.blockingDifferenceCount} blocking · {report.warningDifferenceCount} warnings
      </p>
      {report.differences.length > 0 && (
        <div tabIndex={0} aria-label={`${report.totalDifferenceCount} structural differences`} style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead><tr>{["Severity", "Worksheet", "Difference"].map((h) => <th key={h} scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid rgba(255,255,255,.1)" }}>{h}</th>)}</tr></thead>
            <tbody>{report.differences.map((d, i) => <tr key={`${i}:${d.deterministicKey}`}>
              <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,.05)", color: SEVERITY_COLOR[d.severity] ?? "#f9fafb" }}>{d.severity}</td>
              <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,.05)" }}>{deriveDifferenceWorksheetLabel(d)}</td>
              <td style={{ padding: 8, borderBottom: "1px solid rgba(255,255,255,.05)" }}>{describeSchemaDifference(d)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </>}
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button type="button" onClick={onBack}>Back to workbook worksheets</button>
      <button type="button" onClick={onRestart}>Choose another file</button>
    </div>
  </div>;
}
