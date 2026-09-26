"use client";

import type { PeriodDetectionPanelModel } from "../periodDetectionCopy";

// Data Hub 6.2C3 — presentational automatic reporting-period detection card
// rendered inside PeriodSelector. Holds no state and makes no calls: every
// decision (what to say, whether "Use detected period" is offered) is
// already made by derivePeriodDetectionPanel. The only action it can raise
// is `onAccept`, and only when model.offerAccept is true.
export default function PeriodDetectionPanel({
  model,
  accepting,
  acceptError,
  onAccept,
}: {
  model: PeriodDetectionPanelModel;
  accepting: boolean;
  acceptError: string | null;
  onAccept: () => void;
}) {
  if (model.kind === "hidden") return null;

  if (model.kind === "loading") {
    return (
      <div aria-live="polite" aria-busy="true" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        {model.headline}
      </div>
    );
  }

  if (model.kind === "warning") {
    return (
      <div role="status" data-period-detection="warning" style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>
        {model.headline}
      </div>
    );
  }

  return (
    <div
      data-period-detection={model.kind}
      style={{
        marginBottom: 10,
        padding: "8px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{model.headline}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{model.detail}</div>

      {model.range !== null && model.rangeLabel !== null ? (
        <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6 }}>
          {model.rangeLabel}: {model.range.start} to {model.range.end}
        </div>
      ) : null}

      {model.note !== null ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{model.note}</div>
      ) : null}

      {model.offerAccept ? (
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          aria-busy={accepting}
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-raised)",
            color: "var(--text-primary)",
            cursor: accepting ? "default" : "pointer",
          }}
        >
          {accepting ? "Saving…" : "Use detected period"}
        </button>
      ) : null}

      {acceptError ? (
        <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
          {acceptError}
        </div>
      ) : null}
    </div>
  );
}
