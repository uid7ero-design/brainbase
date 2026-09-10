"use client";

import { useEffect, useRef, useState } from "react";
import type { DataHubIllegalDumpingImportSession, ImportBatchHandle } from "@/lib/data-hub/client/orchestrator";
import type { WorksheetPreviewMappingSummaryClient, WorksheetSummaryDTOClient } from "@/lib/data-hub/client/types";
import ImportError from "./ImportError";
import ConfirmAction from "./ConfirmAction";
import {
  createConfirmGuard,
  deriveFrozenMappingLabel,
  hasMissingRequiredHeaders,
  isConfirmEligible,
  isMappingSelectorLocked,
  shouldRenderPreviewTable,
  type ReviewPhase,
} from "../confirmEligibility";
import { useFrozenSourceMappingLabel, useSourceMappings } from "../useSourceMappings";

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
  onRestart,
}: {
  state: ReviewPhase;
  session: DataHubIllegalDumpingImportSession;
  // PR #161 QA REMEDIATION (issue 1): the Review screen previously had no
  // Back/Cancel/Choose-another-file escape, trapping the user on an
  // invalid file with Confirm disabled. `onRestart` is pure navigation/
  // reset — callers pass their own existing "start a new import" mechanism
  // (ImportClient.tsx's resetKey remount; RecoveryClient.tsx's
  // router.push("/data-hub/import")) — ReviewPanel never invents a second
  // reset system and never mutates server state itself.
  onRestart: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // `submitting` is display-only (drives ConfirmAction's busy state) — it
  // is NOT the duplicate-submission guard itself (R2 remediation). A
  // useState-backed boolean was proven, by independent review, insufficient
  // as the actual guard: two genuinely same-tick invocations of the
  // identical onConfirm closure both read the same captured
  // `submitting === false` snapshot before either state update commits.
  const [submitting, setSubmitting] = useState(false);
  // The REAL synchronous guard (T16/M7/R2/RTEST6-RTEST8): a ref-backed lock
  // read/written only inside the onConfirm event handler below, never
  // during render (see confirmEligibility.ts's own header comment for why
  // this differs from the useRef-lazy-initializer pattern this repo's
  // ESLint rule actually forbids). `useRef(createConfirmGuard(...))`
  // constructs a new, cheap, side-effect-free guard object on every render,
  // but React retains only the FIRST one — the same accepted tradeoff this
  // repo already uses elsewhere for non-disposal-bearing resources.
  const confirmGuardRef = useRef(createConfirmGuard(() => session.confirm()));
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // Data Hub 5B.5B — the SINGLE source of truth for "what mapping is
  // currently frozen for this worksheet" is previewReady's own
  // preview.mapping — never re-derived, never held in a second piece of
  // state (Section 12/19/28). "unknown" (not yet resolved) covers every
  // other phase this component renders for (confirmationReady/previewing/
  // previewFailed) — MappingSelector renders a neutral "checking…" label
  // for that case rather than guessing.
  const frozenMapping: WorksheetPreviewMappingSummaryClient | null | "unknown" =
    state.phase === "previewReady" ? state.preview.mapping : "unknown";

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f9fafb", marginBottom: 4 }}>
        {state.worksheet.worksheetName}
      </h2>

      <MappingSelector session={session} batch={state.batch} worksheet={state.worksheet} frozenMapping={frozenMapping} />

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

      {shouldRenderPreviewTable(state) ? <PreviewTable preview={state.preview} /> : null}

      {state.phase !== "previewing" && state.phase !== "confirmationReady" ? (
        <ConfirmAction
          eligible={eligible}
          busy={submitting}
          onConfirm={() => {
            setSubmitting(true);
            confirmGuardRef.current.invoke(() => {
              if (mountedRef.current) setSubmitting(false);
            });
          }}
          onChooseAnotherFile={onRestart}
          rowCount={state.phase === "previewReady" ? state.preview.rowCount : undefined}
          // QA-POLISH (PR #147 authenticated Preview recheck, issue 2): a
          // successful preview reporting missing required headers already
          // shows its own explicit "Missing required column(s)..." error
          // (PreviewTable, above) and already disables Confirm via
          // `eligible` — rendering the normal destructive-confirmation
          // sentence on top of that error is contradictory. Reuses the
          // SAME predicate `isConfirmEligible` is itself built on (never a
          // second, independent "are required headers present" check).
          // previewFailed's own separate acknowledgement semantics are
          // untouched: hasMissingRequiredHeaders is false for that phase,
          // so its existing (unconditional) sentence is unaffected.
          showConfirmationCopy={!hasMissingRequiredHeaders(state)}
        />
      ) : null}
    </div>
  );
}

// Data Hub 5B.5B — the SourceMapping selection + frozen-lineage display
// control (spec Sections 5/6/9/14/15/16). Placed at the TOP of ReviewPanel,
// before mapped Preview content, per Section 9's exact placement
// requirement.
function MappingSelector({
  session,
  batch,
  worksheet,
  frozenMapping,
}: {
  session: DataHubIllegalDumpingImportSession;
  batch: ImportBatchHandle;
  worksheet: WorksheetSummaryDTOClient;
  frozenMapping: WorksheetPreviewMappingSummaryClient | null | "unknown";
}) {
  const [pendingSelection, setPendingSelection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Section 27 — the REAL gate is the worksheet's own authoritative status,
  // not merely "which ReviewPhase am I rendered in" (confirmationReady is,
  // today, structurally reachable with a non-AWAITING_CONFIRMATION
  // worksheet on the fresh-obtain path — this reads the one field that is
  // always truthful regardless of that).
  const locked = isMappingSelectorLocked(worksheet.canonicalStatus);

  // Section 7/8 — only ever fetch the active-mapping list for a batch that
  // HAS a source and is still selectable; a locked worksheet needs no new-
  // selection options, and a null-source batch has nothing to filter by.
  const sourceMappingsState = useSourceMappings(batch.sourceSystemId === null || locked ? null : batch.sourceSystemId);

  // Section 16 — resolve a label for the frozen mapping ONLY when one is
  // actually frozen; a deactivated-but-frozen mapping's name is recovered
  // here even though it may be absent from sourceMappingsState above.
  const frozenSourceMappingId = frozenMapping !== "unknown" && frozenMapping !== null ? frozenMapping.sourceMappingId : null;
  const frozenLabelState = useFrozenSourceMappingLabel(frozenSourceMappingId);

  if (batch.sourceSystemId === null) {
    // Section 8/13 — a genuinely legacy (no source) batch. No mapping
    // concept applies to it at all; Confirm proceeds via the unchanged
    // legacy path.
    return (
      <div style={{ marginBottom: 16, fontSize: 12, color: "rgba(249,250,251,.5)" }}>
        Legacy import — no source system was selected for this file.
      </div>
    );
  }

  function frozenLabel(): string {
    // Section 14's own truthfulness invariant, enforced by ROUTING through
    // the dedicated, independently-tested pure function — see
    // confirmEligibility.ts's own deriveFrozenMappingLabel comment. This
    // component never re-implements this derivation inline.
    const name = frozenLabelState.status === "success" ? frozenLabelState.name : null;
    return deriveFrozenMappingLabel(frozenMapping, name);
  }

  async function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setPendingSelection(id);
    if (!id) return; // the placeholder option — never actionable.
    setSubmitting(true);
    setSubmitError(null);
    const result = await session.selectMapping(id);
    setSubmitting(false);
    if (!result.ok) {
      // Section 13/21 — a lost selection-vs-something-else race (or any
      // other server rejection) surfaces the server's own safe message
      // here; never auto-retried. The control resets to its own
      // placeholder — frozenLabel() above remains driven exclusively by
      // authoritative Preview state, which this failed attempt never
      // touched.
      setSubmitError(result.error);
      setPendingSelection("");
      return;
    }
    setPendingSelection("");
  }

  return (
    <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8 }}>
      <div style={{ fontSize: 13, color: "rgba(249,250,251,.85)", marginBottom: locked ? 0 : 8 }}>{frozenLabel()}</div>

      {!locked ? (
        <div>
          <label
            htmlFor="data-hub-mapping-select"
            style={{ display: "block", fontSize: 12, fontWeight: 500, color: "rgba(249,250,251,.6)", marginBottom: 4 }}
          >
            {frozenMapping === null || frozenMapping === "unknown" ? "Select a mapping" : "Change mapping"}{" "}
            <span style={{ fontWeight: 400, color: "rgba(249,250,251,.4)" }}>(optional)</span>
          </label>
          <select
            id="data-hub-mapping-select"
            value={pendingSelection}
            disabled={submitting || sourceMappingsState.status === "loading"}
            onChange={(e) => void handleSelect(e)}
            aria-describedby={submitError ? "data-hub-mapping-error" : undefined}
            style={{
              width: "100%",
              maxWidth: 320,
              fontSize: 13,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(255,255,255,.04)",
              color: "#f9fafb",
            }}
          >
            <option value="">{sourceMappingsState.status === "loading" ? "Loading mappings…" : "Choose a mapping…"}</option>
            {sourceMappingsState.status === "success"
              ? sourceMappingsState.sourceMappings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              : null}
          </select>

          {sourceMappingsState.status === "error" ? (
            <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
              {sourceMappingsState.message}
            </div>
          ) : null}

          {sourceMappingsState.status === "success" && sourceMappingsState.sourceMappings.length === 0 ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "rgba(249,250,251,.45)" }}>
              No mappings configured for this source system yet.
            </div>
          ) : null}

          {submitError ? (
            <div id="data-hub-mapping-error" role="alert" style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
              {submitError}
            </div>
          ) : null}
        </div>
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
    mapping: WorksheetPreviewMappingSummaryClient | null;
  };
}) {
  const columnTruncated = preview.columnCount > preview.headers.length;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "rgba(249,250,251,.55)", marginBottom: 10 }}>
        {preview.rowCount} row(s), {preview.columnCount} column(s)
      </div>

      {preview.mapping !== null ? (
        <div style={{ marginBottom: 12, fontSize: 12 }}>
          {preview.mapping.structurallyValid ? (
            <div style={{ color: preview.mapping.domainRowsValid ? "rgba(52,211,153,.85)" : "#fbbf24" }}>
              Mapping v{preview.mapping.versionNumber} structurally matches this file&apos;s columns.{" "}
              {preview.mapping.domainRowsValid
                ? "The previewed rows also passed value validation."
                : "One or more previewed rows failed value validation — review the sample below before confirming."}
            </div>
          ) : (
            <div role="alert" style={{ color: "#f9fafb" }}>
              This mapping does not structurally match this file&apos;s columns:{" "}
              {preview.mapping.mappingErrors
                .map((e) => (e.code === "MAPPING_REQUIRED_TARGET_MISSING" ? e.canonicalTarget : `${e.canonicalTarget} (${e.sourceHeader})`))
                .join(", ")}
              . Choose a different mapping, or contact an administrator to fix this one.
            </div>
          )}
        </div>
      ) : null}

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
