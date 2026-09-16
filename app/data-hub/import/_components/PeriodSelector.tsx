"use client";

import { useState } from "react";
import type { DataHubIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import type { WorksheetSummaryDTOClient } from "@/lib/data-hub/client/types";
import { isMappingSelectorLocked } from "../confirmEligibility";

// Data Hub 6.2B1 — the reporting-period selection control, placed alongside
// MappingSelector in ReviewPanel.tsx (Section H). Mirrors MappingSelector's
// own shape/discipline exactly: same lock gate (worksheet.canonicalStatus,
// never merely "which ReviewPhase"), same "reselection allowed while
// AWAITING_CONFIRMATION, frozen after" semantics, same generic server-error
// surfacing (no machine-readable code on this wire shape either).
//
// UNLIKE MappingSelector, there is no server preview-equivalent to re-fetch
// after a successful selection (no mapped-period preview concept exists) —
// a successful selectPeriod() result is reported to the parent via
// `onSelected`, which ReviewPanel uses to freshen its own
// confirm-eligibility check for the remainder of this render session. This
// component never re-derives eligibility itself.
export interface PeriodOverride {
  periodStart: string;
  periodEnd: string;
  periodSource: "MANUAL";
}

export default function PeriodSelector({
  session,
  worksheet,
  onSelected,
}: {
  session: DataHubIllegalDumpingImportSession;
  worksheet: WorksheetSummaryDTOClient;
  onSelected: (override: PeriodOverride) => void;
}) {
  const locked = isMappingSelectorLocked(worksheet.canonicalStatus);

  const [pendingStart, setPendingStart] = useState(worksheet.periodStart ?? "");
  const [pendingEnd, setPendingEnd] = useState(worksheet.periodEnd ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Nothing has ever been selected AND the source doesn't require one —
  // this is a purely optional, ordinary-worksheet case. Still rendered
  // (not hidden outright) so an operator with a genuinely optional-period
  // source can still record one if they choose to (selectWorksheetPeriod.ts
  // itself never gates on reporting_period_required — see its own header
  // comment).
  const frozen = worksheet.periodStart !== null && worksheet.periodEnd !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingStart || !pendingEnd) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await session.selectPeriod(pendingStart, pendingEnd);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    onSelected({ periodStart: result.periodStart, periodEnd: result.periodEnd, periodSource: result.periodSource });
  }

  return (
    <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8 }}>
      <div style={{ fontSize: 13, color: "rgba(249,250,251,.85)", marginBottom: locked ? 0 : 8 }}>
        {frozen
          ? `Reporting period: ${worksheet.periodStart} to ${worksheet.periodEnd}`
          : worksheet.reportingPeriodRequired
            ? "A reporting period is required before this worksheet can be confirmed."
            : "No reporting period recorded."}
      </div>

      {!locked ? (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label
                htmlFor="data-hub-period-start"
                style={{ display: "block", fontSize: 12, fontWeight: 500, color: "rgba(249,250,251,.6)", marginBottom: 4 }}
              >
                Period start
              </label>
              <input
                id="data-hub-period-start"
                type="date"
                value={pendingStart}
                disabled={submitting}
                onChange={(e) => setPendingStart(e.target.value)}
                style={{
                  fontSize: 13,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.18)",
                  background: "rgba(255,255,255,.04)",
                  color: "#f9fafb",
                }}
              />
            </div>
            <div>
              <label
                htmlFor="data-hub-period-end"
                style={{ display: "block", fontSize: 12, fontWeight: 500, color: "rgba(249,250,251,.6)", marginBottom: 4 }}
              >
                Period end
              </label>
              <input
                id="data-hub-period-end"
                type="date"
                value={pendingEnd}
                disabled={submitting}
                onChange={(e) => setPendingEnd(e.target.value)}
                style={{
                  fontSize: 13,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.18)",
                  background: "rgba(255,255,255,.04)",
                  color: "#f9fafb",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !pendingStart || !pendingEnd}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.04)",
                color: "#f9fafb",
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? "Saving…" : frozen ? "Change period" : "Set period"}
            </button>
          </div>

          {submitError ? (
            <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
              {submitError}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
