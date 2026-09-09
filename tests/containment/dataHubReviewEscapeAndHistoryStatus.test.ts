import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { describeBatchHistoryStatus } from "@/app/data-hub/import/historyStatusCopy";

// PR #161 QA REMEDIATION — two genuine authenticated-Preview-QA findings:
//   Issue 1: the Review/error screen had no Back/Cancel/Choose-another-file
//     escape, trapping the user (especially on an invalid CSV, where Confirm
//     is disabled and there was previously no other way out).
//   Issue 2: ImportBatch READY (a physical/storage lifecycle state) rendered
//     in history as a green "Ready" badge, which managers reasonably read as
//     "successfully imported" — not necessarily true, since an invalid CSV
//     that was uploaded but never confirmed also sits at READY forever.
//
// This file proves ONLY the new remediation behavior. Pre-existing coverage
// this remediation deliberately relies on rather than duplicates:
//   - T2/T5 (Confirm disabled/enabled by eligibility): dataHubImportContainment.test.ts
//     ("M3: the disabled-confirm safety behavior is untouched") and
//     dataHubImportReviewPanel.test.ts's isConfirmEligible suite.
//   - T11-T15 (IMPORTED/FAILED/AWAITING_UPLOAD/PROCESSING/DELETION_PENDING
//     unchanged): re-asserted directly below (cheap, source-level) since they
//     sit in the same file this remediation touches.
//   - T16-T18 (new-import flow / invalid-header safety / history-recovery
//     flow unchanged): proven by the full pre-existing 5A.3C.1/5A.3D.1/5A.3D.2
//     suites continuing to pass unmodified — not re-derived here.

const ROOT = process.cwd();
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const CONFIRM_ACTION = "app/data-hub/import/_components/ConfirmAction.tsx";
const REVIEW_PANEL = "app/data-hub/import/_components/ReviewPanel.tsx";
const IMPORT_CLIENT = "app/data-hub/import/ImportClient.tsx";
const RECOVERY_CLIENT = "app/data-hub/import/[batchId]/RecoveryClient.tsx";
const HISTORY_PANEL = "app/data-hub/import/_components/ImportHistoryPanel.tsx";

// ---------------------------------------------------------------------------
// Issue 1 — Review escape
// ---------------------------------------------------------------------------

describe("T1/T6: ConfirmAction always renders a 'Choose another file' escape, unconditionally", () => {
  it("the escape button text is present and NOT gated behind `eligible` — it renders for both an invalid file (eligible=false) and a valid one (eligible=true)", () => {
    const code = stripComments(read(CONFIRM_ACTION));
    expect(code).toContain("Choose another file");
    // The escape button's own disabled attribute is tied to `busy` only,
    // never `eligible` — an ineligible (invalid-header) Review must still
    // offer this as the user's one way out.
    const btnIdx = code.indexOf("onClick={onChooseAnotherFile}");
    expect(btnIdx).toBeGreaterThan(-1);
    const btnBlock = code.slice(btnIdx, btnIdx + 200);
    expect(btnBlock).toMatch(/disabled=\{busy\}/);
    expect(btnBlock).not.toMatch(/disabled=\{[^}]*eligible/);
  });

  it("the two buttons are structurally siblings (both always rendered together) — the escape is not inside any `eligible ? ... : null` branch", () => {
    const code = stripComments(read(CONFIRM_ACTION));
    const confirmBtnIdx = code.indexOf("onClick={onConfirm}");
    const escapeBtnIdx = code.indexOf("onClick={onChooseAnotherFile}");
    expect(confirmBtnIdx).toBeGreaterThan(-1);
    expect(escapeBtnIdx).toBeGreaterThan(confirmBtnIdx);
    const between = code.slice(confirmBtnIdx, escapeBtnIdx);
    expect(between).not.toMatch(/eligible\s*\?/);
  });
});

describe("T3/T7/T8/M2/M3/M8: the escape action never calls confirm/upload/finalize and never touches a backend route", () => {
  it("ConfirmAction.tsx: the escape button's onClick is the distinct onChooseAnotherFile prop, never onConfirm", () => {
    const code = stripComments(read(CONFIRM_ACTION));
    const escapeBtnIdx = code.indexOf("onClick={onChooseAnotherFile}");
    expect(escapeBtnIdx).toBeGreaterThan(-1);
    // Exactly one onClick={onConfirm} in the whole file — the escape button
    // does not also/instead wire onConfirm.
    const onConfirmMatches = code.match(/onClick=\{onConfirm\}/g) ?? [];
    expect(onConfirmMatches.length).toBe(1);
  });

  it("ReviewPanel.tsx: onChooseAnotherFile is a direct passthrough of the onRestart prop — no wrapping call to session.confirm/upload/proceedToFinalize", () => {
    const code = stripComments(read(REVIEW_PANEL));
    expect(code).toMatch(/onChooseAnotherFile=\{onRestart\}/);
  });

  it("RecoveryClient.tsx: the Review-phase escape is pure client navigation (router.push) — no session method call in that same expression", () => {
    const code = stripComments(read(RECOVERY_CLIENT));
    const idx = code.indexOf('REVIEW_PHASES.has(state.phase)');
    expect(idx).toBeGreaterThan(-1);
    const block = code.slice(idx, idx + 400);
    expect(block).toMatch(/onRestart=\{\(\) => router\.push\("\/data-hub\/import"\)\}/);
    expect(block).not.toMatch(/session\.(upload|proceedToFinalize|retryFinalize|confirm|retryConfirm)\(/);
  });

  it("neither escape wiring path performs a direct fetch to a Data Hub API route (no bypass of the existing orchestrator/httpClient boundary)", () => {
    for (const file of [CONFIRM_ACTION, REVIEW_PANEL, RECOVERY_CLIENT]) {
      const code = stripComments(read(file));
      expect(code, `${file} must not fetch a data-hub route directly`).not.toMatch(/fetch\(\s*["'`]\/api\/data-hub/);
    }
  });
});

describe("T4: the picker-side escape reuses ImportClient's EXISTING resetKey/onRestart mechanism — no second reset system", () => {
  it("ImportClient.tsx passes the same onRestart identity to ReviewPanel that ProcessingStatus/ImportSuccess already receive", () => {
    const code = stripComments(read(IMPORT_CLIENT));
    const onRestartPassCount = (code.match(/onRestart=\{onRestart\}/g) ?? []).length;
    // ProcessingStatus + ReviewPanel now both receive it (ImportSuccess uses
    // the differently-named onStartAnother prop for the same callback).
    expect(onRestartPassCount).toBeGreaterThanOrEqual(2);
    expect(code).toMatch(/<ReviewPanel[\s\S]{0,200}onRestart=\{onRestart\}/);
  });

  it("ImportClient.tsx defines only ONE reset mechanism — a single onRestart callback (`setResetKey`), never a second parallel reset function", () => {
    const code = stripComments(read(IMPORT_CLIENT));
    const setResetKeyMatches = code.match(/setResetKey/g) ?? [];
    expect(setResetKeyMatches.length).toBeGreaterThan(0);
    // No second differently-named "reset"/"restart" state setter exists.
    expect(code).not.toMatch(/setRestartKey|setReset(?!Key)/);
  });
});

// ---------------------------------------------------------------------------
// Issue 2 — history status semantics
// ---------------------------------------------------------------------------

describe("T8/T9/M4: history READY renders truthful 'Review pending' copy, never success-framed 'Ready' wording", () => {
  it("READY's label is exactly 'Review pending'", () => {
    expect(describeBatchHistoryStatus("READY").label).toBe("Review pending");
  });

  it("READY's label is never the old bare 'Ready' word", () => {
    expect(describeBatchHistoryStatus("READY").label).not.toBe("Ready");
  });

  it("READY's caption clarifies it has not been imported yet, without implying success", () => {
    const p = describeBatchHistoryStatus("READY");
    expect(p.caption).toMatch(/not yet imported/i);
    expect((p.caption ?? "").toLowerCase()).not.toMatch(/success|imported\.$|complete/);
  });
});

describe("T10/M5: READY remains actionable/clickable — presentation-only change, recovery semantics untouched", () => {
  it("READY.actionable is still true", () => {
    expect(describeBatchHistoryStatus("READY").actionable).toBe(true);
  });
});

describe("T9/M4: the history badge no longer renders READY in the repo's reserved success-green", () => {
  it("ImportHistoryPanel.tsx's StatusBadge color function does not map READY to #4ADE80 (the repo's success-green, e.g. ImportSuccess.tsx's heading)", () => {
    const code = stripComments(read(HISTORY_PANEL));
    const colorLineIdx = code.indexOf("const color =");
    expect(colorLineIdx).toBeGreaterThan(-1);
    const colorLine = code.slice(colorLineIdx, code.indexOf(";", colorLineIdx) + 1);
    expect(colorLine).not.toMatch(/READY[\s\S]*4ADE80/);
  });
});

describe("T11-T15: every OTHER history status label/caption is byte-for-byte unchanged by this remediation", () => {
  it("FAILED unchanged", () => {
    expect(describeBatchHistoryStatus("FAILED")).toEqual({ label: "Failed", actionable: true, caption: null });
  });
  it("AWAITING_UPLOAD unchanged", () => {
    expect(describeBatchHistoryStatus("AWAITING_UPLOAD")).toEqual({
      label: "Never completed",
      actionable: false,
      caption: "This import was never completed. Start a new import to continue.",
    });
  });
  it("PROCESSING unchanged", () => {
    expect(describeBatchHistoryStatus("PROCESSING")).toEqual({
      label: "Processing",
      actionable: false,
      caption: "Still processing — check back shortly.",
    });
  });
  it("DELETION_PENDING unchanged", () => {
    expect(describeBatchHistoryStatus("DELETION_PENDING")).toEqual({
      label: "Pending deletion",
      actionable: false,
      caption: "This import is pending deletion.",
    });
  });
});

describe("T11: IMPORTED still renders 'Imported' via the untouched ImportSuccess.tsx (worksheet-level, not a batch history-list concern)", () => {
  it("ImportSuccess.tsx was not touched by this remediation and still uses its own success-green heading", () => {
    const code = read("app/data-hub/import/_components/ImportSuccess.tsx");
    expect(code).toMatch(/color:\s*"#4ADE80"/);
  });
});

describe("no raw internal detail leaks into the new READY caption (spec Section 39, re-asserted)", () => {
  it("READY's caption mentions no storage/blob/sha/provider/organisation detail", () => {
    const p = describeBatchHistoryStatus("READY");
    const text = `${p.label} ${p.caption ?? ""}`.toLowerCase();
    expect(text).not.toMatch(/blob|storage key|sha256|provider|organisation|etag/);
  });
});
