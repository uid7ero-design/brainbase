import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Data Hub 6.2C3 — Review-side wiring of automatic reporting-period
// detection: typed HTTP client calls, orchestrator/session methods, the
// pure detection view-model, the presentational detection card (rendered
// to static markup — this repo has no jsdom/RTL harness, but a stateless
// component renders fine in the node environment), and static containment
// for PeriodSelector/ReviewPanel wiring.

import { acceptDetectedWorksheetPeriod, getWorksheetPeriodDetection } from "@/lib/data-hub/client/httpClient";
import { createIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import { derivePeriodDetectionPanel, type PeriodDetectionLoadState } from "@/app/data-hub/import/periodDetectionCopy";
import { isConfirmEligible, isPeriodRequirementSatisfied, type ReviewPhase } from "@/app/data-hub/import/confirmEligibility";
import PeriodDetectionPanel from "@/app/data-hub/import/_components/PeriodDetectionPanel";
import type { PeriodDetectionClient } from "@/lib/data-hub/client/types";

const ROOT = process.cwd();
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const FAKE_BATCH = {
  id: "b1",
  status: "READY" as const,
  originalFilename: "City of Onkaparinga-Month-June-2026.xlsx",
  contentType: "xlsx",
  sizeBytes: 10,
  sourceSystemId: "sys-1",
};

const FAKE_WORKSHEET = {
  id: "w1",
  worksheetIndex: 0,
  worksheetName: "Overview",
  worksheetVisibility: "visible" as const,
  worksheetIsEmpty: false,
  canonicalStatus: "AWAITING_CONFIRMATION" as const,
  importBatchId: "b1",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  confirmedBy: null,
  confirmedAt: null,
  lastAttemptAt: null,
  attemptCount: 0,
  lastFailureCode: null,
  lastFailureMessage: null,
  lastFailureRetryable: null,
  importedRowCount: null,
  periodStart: null as string | null,
  periodEnd: null as string | null,
  periodSource: null as string | null,
  reportingPeriodRequired: false,
};

const BATCH_DETAIL = {
  batch: {
    ...FAKE_BATCH,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    sha256: "a".repeat(64),
    uploadedBy: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    deletedAt: null,
  },
};

async function reviewSession(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("period-detection")) return handler(urlStr, init);
    if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
    return jsonResponse(200, BATCH_DETAIL);
  });
  const session = createIllegalDumpingImportSession({ fetchImpl });
  await session.resumeFromBatchId("b1");
  expect(session.getState().phase).toBe("confirmationReady");
  return { session, fetchImpl };
}

const EXACT: PeriodDetectionClient = {
  applicable: true,
  outcome: "EXACT",
  period: { start: "2026-06-01", end: "2026-06-30" },
  suggestedPeriod: null,
  reasonCode: "EXACT_CORROBORATED",
  requiresManualSelection: false,
};
const AMBIGUOUS: PeriodDetectionClient = {
  applicable: true,
  outcome: "AMBIGUOUS",
  period: null,
  suggestedPeriod: { start: "2026-06-01", end: "2026-06-30" },
  reasonCode: "TRUSTED_SIGNALS_CONFLICT",
  requiresManualSelection: true,
};
const ABSENT: PeriodDetectionClient = {
  applicable: true,
  outcome: "ABSENT",
  period: null,
  suggestedPeriod: null,
  reasonCode: "NO_TRUSTED_PERIOD_SIGNAL",
  requiresManualSelection: true,
};

const NO_PERIOD = { periodStart: null, periodEnd: null };
function loaded(detection: PeriodDetectionClient): PeriodDetectionLoadState {
  return { status: "loaded", detection };
}
function renderPanel(load: PeriodDetectionLoadState, opts: { locked?: boolean; worksheet?: { periodStart: string | null; periodEnd: string | null } } = {}) {
  const model = derivePeriodDetectionPanel({ load, locked: opts.locked ?? false, worksheet: opts.worksheet ?? NO_PERIOD });
  return { model, html: renderToStaticMarkup(createElement(PeriodDetectionPanel, { model, accepting: false, acceptError: null, onAccept: () => {} })) };
}

// ─── HTTP client ───────────────────────────────────────────────────────────

describe("httpClient — 6.2C3 period-detection calls", () => {
  it("GET detection hits the exact route with GET and no body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, applicable: false }));
    const r = await getWorksheetPeriodDetection("w/1", { fetchImpl });
    expect(r).toMatchObject({ kind: "response", body: { ok: true, applicable: false } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/data-hub/worksheets/w%2F1/period-detection");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("accept POSTs to the exact route with NO body — the client can never send dates", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, worksheetUploadId: "w1", periodStart: "2026-06-01", periodEnd: "2026-06-30", periodSource: "DETECTED" })
    );
    await acceptDetectedWorksheetPeriod("w1", { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/data-hub/worksheets/w1/period-detection/accept");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("the client wire-type module never imports the server detector types", () => {
    const types = stripComments(read("lib/data-hub/client/types.ts"));
    expect(types).not.toMatch(/reportingPeriod\//);
    expect(stripComments(read("lib/data-hub/client/httpClient.ts"))).not.toMatch(/reportingPeriod\//);
    expect(stripComments(read("lib/data-hub/client/orchestrator.ts"))).not.toMatch(/reportingPeriod\//);
  });
});

// ─── Orchestrator / session ───────────────────────────────────────────────

describe("session.loadPeriodDetection / acceptDetectedPeriod", () => {
  it("loads EXACT detection as advisory data only — session state/worksheet period untouched", async () => {
    const { session } = await reviewSession(() => jsonResponse(200, { ok: true, ...EXACT }));
    const before = JSON.stringify(session.getState());
    const r = await session.loadPeriodDetection();
    expect(r).toEqual({ status: "loaded", detection: EXACT });
    expect(JSON.stringify(session.getState())).toBe(before);
  });

  it("not applicable / server failure / transport uncertainty are three distinct results", async () => {
    let s = await reviewSession(() => jsonResponse(200, { ok: true, applicable: false }));
    expect(await s.session.loadPeriodDetection()).toEqual({ status: "loaded", detection: { applicable: false } });
    s = await reviewSession(() => jsonResponse(502, { ok: false, error: "Storage unavailable." }));
    expect(await s.session.loadPeriodDetection()).toEqual({ status: "failed", error: "Storage unavailable." });
    s = await reviewSession(() => {
      throw new TypeError("offline");
    });
    expect(await s.session.loadPeriodDetection()).toMatchObject({ status: "networkUncertain" });
  });

  it("#19 accept returns the server-persisted DETECTED period; request carries no body", async () => {
    const { session, fetchImpl } = await reviewSession(() =>
      jsonResponse(200, { ok: true, worksheetUploadId: "w1", periodStart: "2026-06-01", periodEnd: "2026-06-30", periodSource: "DETECTED" })
    );
    const r = await session.acceptDetectedPeriod();
    expect(r).toEqual({ outcome: "accepted", periodStart: "2026-06-01", periodEnd: "2026-06-30", periodSource: "DETECTED" });
    const acceptCall = fetchImpl.mock.calls.find(([u]) => String(u).includes("/accept")) as unknown as [string, RequestInit];
    expect(acceptCall[1].method).toBe("POST");
    expect(acceptCall[1].body).toBeUndefined();
  });

  it("accept rejection vs uncertainty are distinct (a lost response may still have persisted)", async () => {
    let s = await reviewSession(() => jsonResponse(409, { ok: false, error: "No exact reporting period was detected." }));
    expect(await s.session.acceptDetectedPeriod()).toEqual({ outcome: "rejected", error: "No exact reporting period was detected." });
    s = await reviewSession(() => {
      throw new TypeError("offline");
    });
    expect(await s.session.acceptDetectedPeriod()).toMatchObject({ outcome: "uncertain" });
  });
});

// ─── View-model + rendered card ────────────────────────────────────────────

describe("detection card — EXACT / AMBIGUOUS / ABSENT / not-applicable / error / locked", () => {
  it("#15 EXACT renders the detected period and an explicit 'Use detected period' button", () => {
    const { model, html } = renderPanel(loaded(EXACT));
    expect(model).toMatchObject({ kind: "exact", offerAccept: true });
    expect(html).toContain("2026-06-01 to 2026-06-30");
    expect(html).toContain("Use detected period");
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toContain("Nothing is recorded until you choose to use it.");
  });

  it("#16 AMBIGUOUS shows the possible range but never offers acceptance and never says detected/confirmed", () => {
    const { model, html } = renderPanel(loaded(AMBIGUOUS));
    expect(model).toMatchObject({ kind: "ambiguous", offerAccept: false });
    expect(html).toContain("2026-06-01 to 2026-06-30");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/detected|confirmed/i);
  });

  it("#16b AMBIGUOUS without a suggestion shows no range", () => {
    const { html } = renderPanel(loaded({ ...AMBIGUOUS, suggestedPeriod: null, reasonCode: "MULTIPLE_FILENAME_CANDIDATES" }));
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(html).not.toContain("<button");
  });

  it("every AMBIGUOUS reason code's copy avoids the words detected/confirmed", () => {
    for (const reasonCode of [
      "TRUSTED_SIGNALS_CONFLICT",
      "MONTH_WITHOUT_YEAR",
      "FILENAME_ONLY_UNCORROBORATED",
      "MULTIPLE_FILENAME_CANDIDATES",
      "EXPECTED_CONTENT_SIGNAL_MISSING",
      "INVALID_FILENAME_PERIOD",
      "INVALID_PERIOD_RANGE",
      "MULTIPERIOD_TREND_ONLY",
    ] as const) {
      const { html } = renderPanel(loaded({ ...AMBIGUOUS, reasonCode }));
      expect(html, reasonCode).not.toMatch(/detected|confirmed/i);
    }
  });

  it("#17 ABSENT keeps the manual fallback message and offers no acceptance", () => {
    const { model, html } = renderPanel(loaded(ABSENT));
    expect(model).toMatchObject({ kind: "absent", offerAccept: false });
    expect(html).toContain("No reporting period found in this file");
    expect(html).toContain("set a period manually");
    expect(html).not.toContain("<button");
  });

  it("not applicable -> no card at all (nothing Onkaparinga-specific is shown)", () => {
    const { model, html } = renderPanel(loaded({ applicable: false }));
    expect(model).toEqual({ kind: "hidden" });
    expect(html).toBe("");
  });

  it("#18 load failure -> a non-blocking warning that points to manual selection", () => {
    const { model, html } = renderPanel({ status: "failed" });
    expect(model.kind).toBe("warning");
    expect(html).toContain("You can still set a period manually");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="alert"');
  });

  it("locked worksheet -> nothing rendered, never an active control, whatever the detection state", () => {
    for (const load of [loaded(EXACT), loaded(AMBIGUOUS), { status: "failed" } as const, { status: "loading" } as const]) {
      const { html } = renderPanel(load, { locked: true });
      expect(html).toBe("");
    }
  });

  it("EXACT with a period already recorded never offers acceptance (matching or different)", () => {
    const same = renderPanel(loaded(EXACT), { worksheet: { periodStart: "2026-06-01", periodEnd: "2026-06-30" } });
    expect(same.model).toMatchObject({ kind: "exact", offerAccept: false });
    expect(same.html).toContain("This period is the one recorded for this worksheet.");
    const different = renderPanel(loaded(EXACT), { worksheet: { periodStart: "2026-05-01", periodEnd: "2026-05-31" } });
    expect(different.model).toMatchObject({ kind: "exact", offerAccept: false });
    expect(different.html).toContain("A different reporting period is already recorded");
    expect(different.html).not.toContain("<button");
  });

  it("an unknown future reason code falls back to generic copy, never echoing the raw code", () => {
    const { html } = renderPanel(loaded({ ...ABSENT, reasonCode: "SOMETHING_NEW" as never }));
    expect(html).not.toContain("SOMETHING_NEW");
  });

  it("the card never renders a raw reasonCode enum value", () => {
    for (const d of [EXACT, AMBIGUOUS, ABSENT]) {
      const { html } = renderPanel(loaded(d));
      expect(html).not.toContain(d.applicable ? d.reasonCode : "__");
    }
  });
});

// ─── Confirm eligibility is unchanged by detection ─────────────────────────

describe("confirm eligibility — detection never satisfies the persisted-period gate", () => {
  const required = { ...FAKE_WORKSHEET, reportingPeriodRequired: true };
  const reviewState = (worksheet: typeof FAKE_WORKSHEET): ReviewPhase =>
    ({ phase: "previewFailed", batch: FAKE_BATCH, worksheet, code: "NETWORK", message: "x" }) as unknown as ReviewPhase;

  it("EXACT detected but not accepted does NOT satisfy reportingPeriodRequired=true", () => {
    // Detection state is not an input to the gate at all — the only inputs
    // are the worksheet's persisted periodStart/periodEnd.
    expect(isPeriodRequirementSatisfied(required)).toBe(false);
    expect(isConfirmEligible(reviewState(required), true)).toBe(false);
  });

  it("#19 once accepted (local override carries the persisted DETECTED period), the existing gate passes without a reload", () => {
    const accepted = { ...required, periodStart: "2026-06-01", periodEnd: "2026-06-30", periodSource: "DETECTED" };
    expect(isPeriodRequirementSatisfied(accepted)).toBe(true);
    expect(isConfirmEligible(reviewState(accepted), true)).toBe(true);
  });

  it("#18 optional period: confirm eligibility is independent of detection load failure", () => {
    expect(isConfirmEligible(reviewState(FAKE_WORKSHEET), true)).toBe(true);
  });

  it("confirmEligibility.ts and ReviewPanel's eligibility never reference detection", () => {
    expect(stripComments(read("app/data-hub/import/confirmEligibility.ts"))).not.toMatch(/detect/i);
    const review = stripComments(read("app/data-hub/import/_components/ReviewPanel.tsx"));
    expect(review).not.toMatch(/Detection|detection/);
    expect(review).toMatch(/const eligible = isConfirmEligible\(\{ \.\.\.state, worksheet: effectiveWorksheet \}, acknowledged\);/);
  });
});

// ─── PeriodSelector / ReviewPanel static wiring ────────────────────────────

describe("PeriodSelector wiring (static)", () => {
  const selector = stripComments(read("app/data-hub/import/_components/PeriodSelector.tsx"));

  it("fetches detection only for an unlocked worksheet whose batch has a governing source", () => {
    expect(selector).toMatch(/usePeriodDetection\(session, worksheet\.id, !locked && sourceSystemId !== null\)/);
  });

  it("#19 a successful acceptance reports through onSelected with the server's DETECTED periodSource", () => {
    expect(selector).toMatch(/session\.acceptDetectedPeriod\(\)/);
    expect(selector).toMatch(/onSelected\(\{ periodStart: result\.periodStart, periodEnd: result\.periodEnd, periodSource: result\.periodSource \}\)/);
    expect(selector).toMatch(/periodSource: "MANUAL" \| "DETECTED"/);
  });

  it("#17/#18 the manual form is gated ONLY on the worksheet lock — never on detection outcome or load state", () => {
    const formIdx = selector.indexOf("<form");
    const gate = selector.slice(selector.lastIndexOf("{", formIdx), formIdx);
    expect(gate).toMatch(/!locked/);
    expect(gate).not.toMatch(/detection/i);
    expect(selector).toMatch(/disabled=\{submitting \|\| !pendingStart \|\| !pendingEnd\}/);
  });

  it("the card is presentational — no network call, no session import", () => {
    const panel = stripComments(read("app/data-hub/import/_components/PeriodDetectionPanel.tsx"));
    expect(panel).not.toMatch(/session|fetch\(|orchestrator|httpClient/);
    expect(panel).toMatch(/model\.offerAccept \?/);
  });

  it("ReviewPanel passes the batch's authoritative sourceSystemId", () => {
    const review = read("app/data-hub/import/_components/ReviewPanel.tsx");
    expect(review).toMatch(/sourceSystemId=\{state\.batch\.sourceSystemId\}/);
  });

  it("a worksheet switch cannot leak accept/submit state or a stale result: PeriodSelector is keyed by worksheet id and drops post-unmount results", () => {
    const review = read("app/data-hub/import/_components/ReviewPanel.tsx");
    expect(review).toMatch(/<PeriodSelector\s+key=\{state\.worksheet\.id\}/);
    const acceptBody = selector.slice(selector.indexOf("async function handleAcceptDetected"), selector.indexOf("const frozen"));
    expect(acceptBody).toMatch(/await session\.acceptDetectedPeriod\(\);\s*if \(!mountedRef\.current\) return;/);
    const submitBody = selector.slice(selector.indexOf("async function handleSubmit"));
    expect(submitBody).toMatch(/await session\.selectPeriod\(pendingStart, pendingEnd\);\s*if \(!mountedRef\.current\) return;/);
  });

  it("the detection hook goes through the session object, never httpClient directly", () => {
    const hook = stripComments(read("app/data-hub/import/usePeriodDetection.ts"));
    expect(hook).toMatch(/session\s*\.loadPeriodDetection\(\)/);
    expect(hook).not.toMatch(/httpClient|fetch\(/);
  });
});
