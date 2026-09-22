// Data Hub 6.2C3 — pure view-model for the automatic reporting-period
// detection card shown inside PeriodSelector. Kept framework-free (like
// confirmEligibility.ts / historyStatusCopy.ts) so every rendering rule is
// directly unit-testable without a DOM harness.
//
// RULES:
//   - Every user-facing string here is controlled copy keyed by the
//     server's enum reasonCode — nothing from the workbook itself (the wire
//     shape carries no cell text to begin with).
//   - Only an EXACT result can ever offer "Use detected period", and only
//     while the worksheet is unlocked and has no period recorded yet.
//   - AMBIGUOUS copy never uses the words "detected" or "confirmed" — a
//     possible period is shown for reference only.
//   - A load failure is a non-blocking warning; it never gates manual
//     selection or Confirm.
//   - A detection result is never a recorded period. Confirm eligibility
//     keeps reading only the worksheet's persisted periodStart/periodEnd.

import type {
  PeriodBoundsClient,
  PeriodDetectionClient,
  PeriodDetectionReasonCodeClient,
} from "@/lib/data-hub/client/types";

export type PeriodDetectionLoadState =
  | { status: "notRequested" }
  | { status: "loading" }
  | { status: "loaded"; detection: PeriodDetectionClient }
  | { status: "failed" };

export type PeriodDetectionPanelModel =
  | { kind: "hidden" }
  | { kind: "loading"; headline: string }
  | { kind: "warning"; headline: string }
  | {
      kind: "exact" | "ambiguous" | "absent";
      headline: string;
      detail: string;
      range: PeriodBoundsClient | null;
      rangeLabel: string | null;
      offerAccept: boolean;
      note: string | null;
    };

const REASON_COPY: Record<PeriodDetectionReasonCodeClient, string> = {
  EXACT_CORROBORATED: "The file name and the report headings inside the file agree on the month.",
  EXACT_EXPLICIT_METADATA: "The file states its reporting period.",
  TRUSTED_SIGNALS_CONFLICT: "The file name and the report headings inside the file point to different months.",
  MONTH_WITHOUT_YEAR: "The report headings name a month but not a year.",
  FILENAME_ONLY_UNCORROBORATED: "Only the file name indicates a month; the report headings inside the file do not back it up.",
  MULTIPLE_FILENAME_CANDIDATES: "The file name contains more than one possible month.",
  EXPECTED_CONTENT_SIGNAL_MISSING: "The file does not contain the expected report headings.",
  INVALID_FILENAME_PERIOD: "The month or year in the file name could not be read.",
  INVALID_PERIOD_RANGE: "The period found in the file is not a valid date range.",
  MULTIPERIOD_TREND_ONLY: "The file only shows a multi-month trend, not a single reporting month.",
  NO_TRUSTED_PERIOD_SIGNAL:
    "This file does not state a reporting period. Dates on individual records are never used to work one out.",
  UNRECOGNISED_SOURCE_SCHEMA: "This file is not in the recognised monthly report layout.",
};

const GENERIC_REASON = "The file's reporting period could not be established automatically.";

function reasonCopy(code: string): string {
  return (REASON_COPY as Record<string, string | undefined>)[code] ?? GENERIC_REASON;
}

function sameBounds(a: PeriodBoundsClient, start: string | null, end: string | null): boolean {
  return start !== null && end !== null && a.start === start && a.end === end;
}

export function derivePeriodDetectionPanel(input: {
  load: PeriodDetectionLoadState;
  locked: boolean;
  worksheet: { periodStart: string | null; periodEnd: string | null };
}): PeriodDetectionPanelModel {
  const { load, locked, worksheet } = input;
  if (locked) return { kind: "hidden" };

  switch (load.status) {
    case "notRequested":
      return { kind: "hidden" };
    case "loading":
      return { kind: "loading", headline: "Checking this file for a reporting period…" };
    case "failed":
      return {
        kind: "warning",
        headline: "Automatic reporting-period detection is unavailable right now. You can still set a period manually.",
      };
    case "loaded":
      break;
  }

  const detection = load.detection;
  if (!detection.applicable) return { kind: "hidden" };

  const recorded = worksheet.periodStart !== null && worksheet.periodEnd !== null;

  if (detection.outcome === "EXACT" && detection.period !== null) {
    const matchesRecorded = sameBounds(detection.period, worksheet.periodStart, worksheet.periodEnd);
    return {
      kind: "exact",
      headline: "Reporting period detected from this file",
      detail: reasonCopy(detection.reasonCode),
      range: detection.period,
      rangeLabel: "Detected period",
      offerAccept: !recorded,
      note: matchesRecorded
        ? "This period is the one recorded for this worksheet."
        : recorded
          ? "A different reporting period is already recorded. Use the manual period control to change it if needed."
          : "Nothing is recorded until you choose to use it.",
    };
  }

  if (detection.outcome === "AMBIGUOUS") {
    return {
      kind: "ambiguous",
      headline: "This file's reporting period is unclear",
      detail: reasonCopy(detection.reasonCode),
      range: detection.suggestedPeriod,
      rangeLabel: detection.suggestedPeriod !== null ? "Possible period — check before using it" : null,
      offerAccept: false,
      note: "Set the period manually below if one is needed.",
    };
  }

  return {
    kind: "absent",
    headline: "No reporting period found in this file",
    detail: reasonCopy(detection.reasonCode),
    range: null,
    rangeLabel: null,
    offerAccept: false,
    note: "You can set a period manually below if one is needed.",
  };
}
