"use client";

import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";
import {
  SCHEMA_MATCH_NOTICE,
  canSelectGovernedSchema,
  deriveDifferenceWorksheetLabel,
  deriveSchemaMatchHeadline,
  deriveSchemaSelectionNotice,
  describeSchemaDifference,
} from "../schemaMatchCopy";

// Data Hub 6.2D3C/6.2D3D — read-only governed schema difference report,
// plus (6.2D3D) the durable "Use governed schema" lineage-pin action, shown
// ONLY for ACTIVE + EXACT_MATCH. Receives state plus
// back/retry/selectSchema/restart callbacks only — never the session — so
// it can never confirm, select a mapping, set a period, or import; the only
// mutation this panel can ever trigger is the one explicit lineage pin.
// Renders structural fields only (worksheet names, column positions,
// header text); the report never contains sample rows or cell values. All
// text is rendered as escaped React text.
type SchemaMatchState = Extract<
  DataHubImportState,
  { phase: "schemaMatchLoading" | "schemaMatchReady" | "schemaMatchFailed" | "schemaSelectionSaving" | "schemaSelected" | "schemaSelectionFailed" }
>;

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKING: "#f87171",
  WARNING: "#fbbf24",
  INFO: "rgba(249,250,251,.7)",
};

export default function SchemaMatchReportPanel({ state, onBack, onRetry, onSelectSchema, onRestart }: {
  state: SchemaMatchState;
  onBack: () => void;
  onRetry: () => void;
  onSelectSchema: () => void;
  onRestart: () => void;
}) {
  const report = "report" in state ? state.report : null;
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
      {/* Data Hub 6.2D3D — governed schema lineage-pin action. Visible ONLY
          for ACTIVE + EXACT_MATCH (canSelectGovernedSchema derives this
          from the SAME report the headline above uses — one source of
          truth). No override/warning-acknowledgement control exists here. */}
      {state.phase === "schemaMatchReady" && canSelectGovernedSchema(report) && (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={onSelectSchema}>Use governed schema</button>
        </div>
      )}
      {state.phase === "schemaMatchReady" && !canSelectGovernedSchema(report) && deriveSchemaSelectionNotice(report) && (
        <p role="note" style={{ fontSize: 12, color: "rgba(249,250,251,.7)", marginTop: 16 }}>{deriveSchemaSelectionNotice(report)}</p>
      )}
      {state.phase === "schemaSelectionSaving" && <p aria-live="polite" style={{ marginTop: 16 }}>Selecting governed schema…</p>}
      {state.phase === "schemaSelected" && (
        <div role="status" style={{ marginTop: 16, padding: "10px 14px", border: "1px solid rgba(74,222,128,.3)", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}>
          {state.alreadySelected
            ? "This import batch is already bound to this governed dataset and schema version."
            : `This import batch is now bound to governed schema v${state.sourceSchemaVersionNumber}.`}
        </div>
      )}
      {state.phase === "schemaSelectionFailed" && (
        <div role="alert" style={{ marginTop: 16 }}>
          <p>{state.message}</p>
          <button type="button" onClick={onSelectSchema}>Retry</button>
        </div>
      )}
    </>}
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button type="button" onClick={onBack}>Back to workbook worksheets</button>
      <button type="button" onClick={onRestart}>Choose another file</button>
    </div>
  </div>;
}
