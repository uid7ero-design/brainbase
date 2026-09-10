"use client";

import { useRef, useState } from "react";
import type { DataHubIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import { FILE_INPUT_ACCEPT, validateSelectedFile } from "../fileValidation";
import { useSourceSystems } from "../useSourceSystems";

// Data Hub 5A.3C.1 — the SELECT screen. Single file, CSV only, advisory-only
// browser checks (server remains authoritative — see fileValidation.ts).
// Never parses CSV content, never imports @vercel/blob/client, never
// imports xlsx/SheetJS/workbookParser.
//
// Data Hub 5B.5A — gained an OPTIONAL SourceSystem selection control. The
// value chosen here (or "" for none) is threaded into session.start() as
// StartImportOptions.sourceSystemId and becomes immutable the instant
// start() fires — see orchestrator.ts's own comment on
// StartImportOptions.sourceSystemId. This control is deliberately a plain
// local useState, exactly like pendingFile/warnings above: ImportClient.tsx's
// existing resetKey remount already clears it on "Start another" with zero
// extra code, and it is never persisted to localStorage/sessionStorage or
// any global store — the server-persisted ImportBatch.source_system_id is
// the only authoritative record once a batch exists.
const NO_SOURCE_SYSTEM_VALUE = "";

export default function FileSelector({ session }: { session: DataHubIllegalDumpingImportSession }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedSourceSystemId, setSelectedSourceSystemId] = useState<string>(NO_SOURCE_SYSTEM_VALUE);
  // Guards the one-source auto-pre-select (Section 9) so it only ever
  // applies the FIRST time the list resolves to exactly one system — a
  // manager who then explicitly clears it back to "No source system" is
  // never overridden again (this becomes true exactly once and never reverts).
  // Plain state, not a ref: this repo's ESLint config forbids reading a
  // ref's `.current` during render (react-hooks/refs) — the render-time
  // state-adjustment pattern below reads/writes real state instead, exactly
  // like ReviewPanel.tsx's own established prevPhase idiom.
  const [hasAppliedSingleSourceDefault, setHasAppliedSingleSourceDefault] = useState(false);

  const sourceSystemsState = useSourceSystems();
  // React's own "adjusting state during render" pattern (not an effect —
  // this repo's ESLint config flags synchronous setState-in-effect calls):
  // https://react.dev/learn/you-might-not-need-an-effect
  if (
    !hasAppliedSingleSourceDefault &&
    sourceSystemsState.status === "success" &&
    sourceSystemsState.sourceSystems.length === 1
  ) {
    setHasAppliedSingleSourceDefault(true);
    // Pre-selected for convenience ONLY — the control stays visible and
    // the "No source system" option remains selectable (Section 9). Not a
    // hidden default: the select element itself visibly shows this
    // system's name once this render applies it.
    setSelectedSourceSystemId(sourceSystemsState.sourceSystems[0].id);
  }

  function handleFile(file: File) {
    const advisory = validateSelectedFile(file);
    setWarnings(advisory.warnings);
    setPendingFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function start() {
    if (!pendingFile) return;
    // Section 8/11 — omission semantics: when no SourceSystem is chosen,
    // sourceSystemId is left out of the options object entirely (never
    // passed as ""), so orchestrator.ts's own `undefined` default carries
    // through to a JSON.stringify that drops the field completely.
    void session.start(
      pendingFile,
      selectedSourceSystemId === NO_SOURCE_SYSTEM_VALUE ? {} : { sourceSystemId: selectedSourceSystemId }
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#f9fafb", marginBottom: 6 }}>Import Illegal Dumping data</h1>
      <p style={{ fontSize: 13, color: "rgba(249,250,251,.55)", marginBottom: 20 }}>
        Select a CSV file to review and import.
      </p>

      <div style={{ marginBottom: 20 }}>
        <label
          htmlFor="data-hub-source-system-select"
          style={{ display: "block", fontSize: 13, fontWeight: 500, color: "rgba(249,250,251,.85)", marginBottom: 6 }}
        >
          Source System <span style={{ fontWeight: 400, color: "rgba(249,250,251,.45)" }}>(optional)</span>
        </label>
        <select
          id="data-hub-source-system-select"
          value={selectedSourceSystemId}
          disabled={sourceSystemsState.status === "loading"}
          onChange={(e) => setSelectedSourceSystemId(e.target.value)}
          aria-describedby={sourceSystemsState.status === "error" ? "data-hub-source-system-error" : undefined}
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
          {sourceSystemsState.status === "loading" ? (
            <option value={NO_SOURCE_SYSTEM_VALUE}>Loading source systems…</option>
          ) : (
            <>
              <option value={NO_SOURCE_SYSTEM_VALUE}>No source system (legacy import)</option>
              {sourceSystemsState.status === "success"
                ? sourceSystemsState.sourceSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                : null}
            </>
          )}
        </select>

        {sourceSystemsState.status === "error" ? (
          <div id="data-hub-source-system-error" role="alert" style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
            {sourceSystemsState.message} You can still continue without selecting one.
          </div>
        ) : null}

        {sourceSystemsState.status === "success" && sourceSystemsState.sourceSystems.length === 0 ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "rgba(249,250,251,.45)" }}>
            No source systems are configured yet. You can still continue without selecting one.
          </div>
        ) : null}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: "1px dashed rgba(255,255,255,.18)",
          borderRadius: 10,
          padding: 28,
          textAlign: "center",
        }}
      >
        <label
          htmlFor="data-hub-import-file-input"
          style={{ fontSize: 13, fontWeight: 500, color: "rgba(249,250,251,.85)", cursor: "pointer" }}
        >
          Choose a CSV file
        </label>
        <input
          id="data-hub-import-file-input"
          ref={inputRef}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          onChange={handleChange}
          style={{ display: "block", margin: "12px auto 0" }}
        />
        <div style={{ fontSize: 12, color: "rgba(249,250,251,.35)", marginTop: 8 }}>or drag and drop a file here</div>
      </div>

      {pendingFile ? (
        <div style={{ marginTop: 16, fontSize: 13, color: "rgba(249,250,251,.8)" }}>
          Selected: <strong>{pendingFile.name}</strong> ({(pendingFile.size / 1024).toFixed(1)} KB)
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "#fbbf24" }}>
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={start}
        disabled={!pendingFile}
        style={{
          marginTop: 20,
          fontSize: 13,
          fontWeight: 600,
          padding: "9px 18px",
          borderRadius: 8,
          border: "none",
          background: pendingFile ? "linear-gradient(135deg, #6D28D9, #A78BFA)" : "rgba(255,255,255,.06)",
          color: pendingFile ? "#fff" : "rgba(255,255,255,.3)",
          cursor: pendingFile ? "pointer" : "default",
        }}
      >
        Start import
      </button>
    </div>
  );
}
