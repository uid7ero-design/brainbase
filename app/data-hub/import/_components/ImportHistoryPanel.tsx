"use client";

import Link from "next/link";
import { useImportHistory } from "../useImportHistory";
import { describeBatchHistoryStatus } from "../historyStatusCopy";

// Data Hub 5A.3D.2 — "Recent imports" panel embedded below the existing
// FileSelector on the SELECT screen only (spec Section 7: no separate nav
// item, no global redesign). A history-load failure renders its own inline
// error and never disables/replaces FileSelector above it (spec Section 19
// / T4) — this component has no way to affect the new-import workflow even
// by accident, since it is a sibling, not a wrapper.
//
// Every field rendered here comes directly from ImportBatchSummaryDTOClient
// (lib/data-hub/client/types.ts) — id, status, originalFilename, sizeBytes,
// createdAt/updatedAt only. No storage key/etag/sha256/uploadedBy/
// organisationId exists on this DTO to accidentally render (spec Section 9/39).
export default function ImportHistoryPanel() {
  const { state, loadMore } = useImportHistory();

  return (
    <div style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(249,250,251,.85)", marginBottom: 12 }}>Recent imports</h2>

      {state.status === "loading" ? (
        <div aria-live="polite" style={{ fontSize: 12, color: "rgba(249,250,251,.5)" }}>
          Loading recent imports…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" style={{ fontSize: 12, color: "rgba(249,250,251,.5)" }}>
          Couldn&apos;t load recent imports. New imports are unaffected.
        </div>
      ) : null}

      {state.status !== "loading" && state.status !== "error" ? (
        state.rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(249,250,251,.4)" }}>No imports yet.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {state.rows.map((row) => (
              <HistoryRow key={row.id} row={row} />
            ))}
          </ul>
        )
      ) : null}

      {state.status === "loaded" && state.hasNextPage ? (
        <button
          type="button"
          onClick={loadMore}
          style={{
            marginTop: 12,
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 12px",
            borderRadius: 7,
            border: "1px solid rgba(255,255,255,.12)",
            background: "rgba(255,255,255,.04)",
            color: "rgba(249,250,251,.8)",
            cursor: "pointer",
          }}
        >
          Load more
        </button>
      ) : null}

      {state.status === "loadingMore" ? (
        <div aria-live="polite" style={{ marginTop: 12, fontSize: 12, color: "rgba(249,250,251,.5)" }}>
          Loading more…
        </div>
      ) : null}

      {state.status === "loadMoreFailed" ? (
        <div style={{ marginTop: 12 }}>
          <div role="alert" style={{ fontSize: 12, color: "rgba(249,250,251,.5)", marginBottom: 6 }}>
            Couldn&apos;t load more imports.
          </div>
          <button
            type="button"
            onClick={loadMore}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 12px",
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(255,255,255,.04)",
              color: "rgba(249,250,251,.8)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HistoryRow({
  row,
}: {
  row: { id: string; status: string; originalFilename: string; createdAt: string };
}) {
  const presentation = describeBatchHistoryStatus(row.status as Parameters<typeof describeBatchHistoryStatus>[0]);
  const created = formatHistoryDate(row.createdAt);

  const content = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,.08)",
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "rgba(249,250,251,.85)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={row.originalFilename}
        >
          {row.originalFilename}
        </div>
        <div style={{ fontSize: 11, color: "rgba(249,250,251,.45)", marginTop: 2 }}>
          {created}
          {presentation.caption ? ` · ${presentation.caption}` : ""}
        </div>
      </div>
      <StatusBadge label={presentation.label} status={row.status} />
    </div>
  );

  if (!presentation.actionable) {
    return <li>{content}</li>;
  }

  return (
    <li>
      <Link href={`/data-hub/import/${encodeURIComponent(row.id)}`} style={{ display: "block", textDecoration: "none" }}>
        {content}
      </Link>
    </li>
  );
}

function StatusBadge({ label, status }: { label: string; status: string }) {
  // Status is never communicated by color alone (spec Section 32) — the
  // text label above is always present; color is a secondary, non-load-
  // bearing cue only.
  //
  // PR #161 QA REMEDIATION (issue 2): READY intentionally gets the SAME
  // neutral color as every other non-terminal-success status, never the
  // success-green this repo reserves for genuine success (e.g.
  // ImportSuccess.tsx's "#4ADE80" heading) — a READY batch has not
  // necessarily been reviewed or confirmed as a valid import.
  const color = status === "FAILED" ? "#F87171" : "rgba(249,250,251,.55)";
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        color,
        border: "1px solid currentColor",
        borderRadius: 999,
        padding: "2px 8px",
        opacity: 0.85,
      }}
    >
      {label}
    </span>
  );
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
