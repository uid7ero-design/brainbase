"use client";

import { useRef, useState } from "react";
import type { DataHubIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import { FILE_INPUT_ACCEPT, validateSelectedFile } from "../fileValidation";

// Data Hub 5A.3C.1 — the SELECT screen. Single file, CSV only, advisory-only
// browser checks (server remains authoritative — see fileValidation.ts).
// Never parses CSV content, never imports @vercel/blob/client, never
// imports xlsx/SheetJS/workbookParser.
export default function FileSelector({ session }: { session: DataHubIllegalDumpingImportSession }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

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
    void session.start(pendingFile);
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#f9fafb", marginBottom: 6 }}>Import Illegal Dumping data</h1>
      <p style={{ fontSize: 13, color: "rgba(249,250,251,.55)", marginBottom: 20 }}>
        Select a CSV file to review and import.
      </p>

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
