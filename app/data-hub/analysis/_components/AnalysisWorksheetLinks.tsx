"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { listWorksheetsForBatch } from "@/lib/data-hub/client/httpClient";

type Worksheet = { id: string; worksheetName: string; worksheetIndex: number };

// Explicit, bounded read of persisted worksheet metadata. Opening analysis
// never re-inspects the uploaded file and does not imply profile readiness.
export default function AnalysisWorksheetLinks({ batchId, filename }: { batchId: string; filename: string }) {
  const [worksheets, setWorksheets] = useState<Worksheet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setWorksheets(null);
    try {
      const response = await listWorksheetsForBatch(batchId);
      if (response.kind !== "response" || response.httpStatus !== 200) throw new Error("Unavailable");
      const body: unknown = response.body;
      const rows = (body as { worksheets?: unknown } | null)?.worksheets;
      if (!Array.isArray(rows) || rows.length > 50 || rows.some(row =>
        typeof row?.id !== "string" || !row.id.trim() || typeof row.worksheetName !== "string" ||
        !Number.isSafeInteger(row.worksheetIndex) || row.worksheetIndex < 0) ||
        new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Invalid response");
      setWorksheets(rows.map(row => ({ id: row.id, worksheetName: row.worksheetName, worksheetIndex: row.worksheetIndex })));
    } catch { setError("Couldn't load worksheets. Try again; no review has been changed."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <div style={{ padding: "8px 12px" }} aria-label={`Analysis worksheets for ${filename}`}>
    <button disabled={busy} onClick={() => void load()} aria-label={`Review worksheets in ${filename}`}>
      {busy ? "Loading worksheets…" : worksheets ? "Refresh analysis worksheets" : "Review worksheets"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {worksheets ? <>
      {worksheets.length === 0 ? <p>No persisted worksheets are available for analysis yet.</p> : <>
        <p>Open a worksheet to check its current profile and saved review.</p>
        <ul>{worksheets.map(worksheet => <li key={worksheet.id}>
          <Link href={`/data-hub/analysis/${encodeURIComponent(worksheet.id)}`}>
            {worksheet.worksheetName || "Worksheet"} (worksheet {worksheet.worksheetIndex + 1}) — review and count
          </Link>
        </li>)}</ul>
      </>}
    </> : null}
  </div>;
}
