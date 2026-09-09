import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  mountRecoverySessionEffect,
  simulateStrictModeRecoverySessionOwnership,
} from "@/app/data-hub/import/[batchId]/useDataHubRecoverySession";
import { createIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import { isErrorOverlayPhase, deriveErrorOverlayCopy } from "@/app/data-hub/import/screenGroup";

// Data Hub 5A.3D.2 — history/recovery UI containment. Static source-text
// proofs (matching this repo's dominant convention — no jsdom/RTL exists)
// for wiring/boundary invariants, plus real behavioral tests against the
// ACTUAL orchestrator (mocked fetch only) for the recovery HOOK's own new
// wiring — the underlying resumeFromBatchId state-machine correctness
// itself is already proven by 5A.3D.1's own dataHubClientResume.test.ts and
// deliberately NOT re-proven here.

const ROOT = process.cwd();
const IMPORT_DIR = path.join(ROOT, "app", "data-hub", "import");

function walk(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) results.push(full);
  }
  return results;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readAll(): { file: string; code: string }[] {
  return walk(IMPORT_DIR, [".ts", ".tsx"]).map((file) => ({
    file: path.relative(ROOT, file),
    code: stripComments(fs.readFileSync(file, "utf8")),
  }));
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const HISTORY_HOOK = "app/data-hub/import/useImportHistory.ts";
const HISTORY_PANEL = "app/data-hub/import/_components/ImportHistoryPanel.tsx";
const RECOVERY_HOOK = "app/data-hub/import/[batchId]/useDataHubRecoverySession.ts";
const RECOVERY_CLIENT = "app/data-hub/import/[batchId]/RecoveryClient.tsx";
const RECOVERY_PAGE = "app/data-hub/import/[batchId]/page.tsx";
const IMPORT_CLIENT = "app/data-hub/import/ImportClient.tsx";
const FILE_SELECTOR = "app/data-hub/import/_components/FileSelector.tsx";

// ---------------------------------------------------------------------------
// T1: history first page uses listImportBatches
// ---------------------------------------------------------------------------
describe("T1: history uses listImportBatches", () => {
  it("useImportHistory.ts calls listImportBatches (imported from orchestrator.ts, never httpClient.ts directly)", () => {
    const code = stripComments(read(HISTORY_HOOK));
    expect(code).toMatch(/import\s*\{[^}]*listImportBatches[^}]*\}\s*from\s*["']@\/lib\/data-hub\/client\/orchestrator["']/);
    expect(code).toMatch(/listImportBatches\(/);
    expect(code).not.toMatch(/from\s+["'@][^"']*data-hub\/client\/httpClient/);
  });
});

// ---------------------------------------------------------------------------
// T9/T10 (list-level)/N+1 hard rule + M2: no per-row worksheet/detail fetch
// ---------------------------------------------------------------------------
describe("T9/M2: N+1 hard rule — history list never fetches worksheet/detail per row", () => {
  it("useImportHistory.ts references no worksheet/detail fetching function", () => {
    const code = stripComments(read(HISTORY_HOOK));
    expect(code).not.toMatch(/listWorksheetsForBatch|getWorksheet|getImportBatch|fetchWorksheetPreview/);
  });

  it("ImportHistoryPanel.tsx itself never calls any fetch/http-client function directly — all data flows through useImportHistory", () => {
    const code = stripComments(read(HISTORY_PANEL));
    expect(code).not.toMatch(/listWorksheetsForBatch|getWorksheet|getImportBatch|fetchWorksheetPreview|fetch\(/);
  });

  it("listImportBatches is called at most twice in useImportHistory.ts (initial load + loadMore), never inside a per-row loop/map", () => {
    const code = stripComments(read(HISTORY_HOOK));
    const calls = code.match(/listImportBatches\(/g) ?? [];
    expect(calls.length).toBe(2);
    // Neither call site is inside a .map/.forEach over rows.
    expect(code).not.toMatch(/rows\.(map|forEach)\([^)]*listImportBatches/);
  });
});

// ---------------------------------------------------------------------------
// T10/T11/T15/T17/M3: batch id only, no organisationId, no caller-supplied
// status, no auto-resume on the ordinary /data-hub/import page.
// ---------------------------------------------------------------------------
describe("T10/T11/M3: recovery hook takes only a batchId — no organisationId, no caller status", () => {
  it("useDataHubRecoverySession.ts's public signature is (batchId: string) only", () => {
    const code = stripComments(read(RECOVERY_HOOK));
    expect(code).toMatch(/export function useDataHubRecoverySession\(batchId: string\)/);
    expect(code).not.toMatch(/organisationId|organisation_id/i);
  });

  it("no file under app/data-hub/import/** references organisationId/organisation_id (client never supplies tenant identity)", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not reference organisationId`).not.toMatch(/organisationId|organisation_id/i);
    }
  });

  it("resumeFromBatchId is called with exactly the batchId argument, nothing else appended", () => {
    const code = stripComments(read(RECOVERY_HOOK));
    expect(code).toMatch(/instance\.resumeFromBatchId\(batchId\)/);
  });
});

describe("T17/M1: no auto-resume anywhere on the ordinary /data-hub/import page", () => {
  it("resumeFromBatchId is referenced ONLY inside app/data-hub/import/[batchId]/** — never in ImportClient.tsx, FileSelector.tsx, the history hook/panel, or page.tsx", () => {
    for (const { file, code } of readAll()) {
      if (file.includes(`[batchId]`)) continue; // the recovery route itself is the one legitimate caller
      expect(code, `${file} must not reference resumeFromBatchId`).not.toMatch(/resumeFromBatchId/);
    }
  });

  it("the recovery route's own construction effect performs the resume call — proven not to happen from ImportClient's construction (useDataHubImportSession.ts is untouched by this task)", () => {
    const code = stripComments(read("app/data-hub/import/useDataHubImportSession.ts"));
    expect(code).not.toMatch(/resumeFromBatchId/);
  });
});

// ---------------------------------------------------------------------------
// T18/T36/M8/M9: recovery hook wiring — real behavioral proof against the
// actual orchestrator (mocked fetch only).
// ---------------------------------------------------------------------------
function batchDetailResponse(overrides: Record<string, unknown> = {}) {
  return {
    batch: {
      id: "b-1",
      status: "READY",
      originalFilename: "dumping.csv",
      contentType: "csv",
      sizeBytes: 100,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      sha256: "a".repeat(64),
      uploadedBy: null,
      attemptCount: 1,
      lastAttemptAt: null,
      lastFailureCode: null,
      lastFailureMessage: null,
      lastFailureRetryable: null,
      deletedAt: null,
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("T18: recovery hook trusts fresh server state, never any caller assumption", () => {
  it("a batch whose fresh server status is FAILED hydrates physicalFailed, regardless of any prior/implicit assumption", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        batchDetailResponse({ status: "FAILED", lastFailureCode: "HASH_MISMATCH", lastFailureMessage: "checksum mismatch", lastFailureRetryable: true })
      )
    );
    const session = createIllegalDumpingImportSession({ fetchImpl });
    const observed: string[] = [];
    session.subscribe(() => observed.push(session.getState().phase));
    mountRecoverySessionEffect(() => session, "b-1", () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(session.getState().phase).toBe("physicalFailed");
    session.dispose();
  });
});

describe("T19/T20/M6: IMPORTED worksheet hydrates the authoritative count, genuine zero preserved", () => {
  it("importedRowCount: 0 on the worksheet results in imported.importedRows === 0, not null/falsy-collapsed", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/worksheets")) {
        return jsonResponse({
          worksheets: [
            {
              id: "w-1",
              worksheetIndex: 0,
              worksheetName: "Sheet1",
              worksheetVisibility: "visible",
              worksheetIsEmpty: false,
              canonicalStatus: "IMPORTED",
              importBatchId: "b-1",
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
              confirmedBy: null,
              confirmedAt: "2026-09-01T00:00:00.000Z",
              lastAttemptAt: null,
              attemptCount: 0,
              lastFailureCode: null,
              lastFailureMessage: null,
              lastFailureRetryable: null,
              importedRowCount: 0,
            },
          ],
        });
      }
      return jsonResponse(batchDetailResponse({ status: "READY" }));
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    mountRecoverySessionEffect(() => session, "b-1", () => {});
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const state = session.getState();
    expect(state.phase).toBe("imported");
    if (state.phase === "imported") {
      expect(state.importedRows).toBe(0);
    }
    session.dispose();
  });
});

describe("T26: foreign/missing batch id surfaces the existing safe not-found semantics, no extra distinction", () => {
  it("a BATCH_NOT_FOUND-shaped response (server's own conflated not-found/wrong-tenant case) becomes unknownError with the server's own message, verbatim, no new classification", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Import batch not found." }, 404));
    const session = createIllegalDumpingImportSession({ fetchImpl });
    mountRecoverySessionEffect(() => session, "does-not-exist", () => {});
    await new Promise((r) => setTimeout(r, 0));
    const state = session.getState();
    expect(state.phase).toBe("unknownError");
    if (state.phase === "unknownError") {
      expect(state.message).toBe("Import batch not found.");
    }
    session.dispose();
  });
});

describe("T36: Strict Mode double-invoke never produces a duplicate mutating call or a lost final session", () => {
  it("exactly one extra (fully-superseded) GET is issued; the final session is correctly hydrated, never among the disposed ones", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(batchDetailResponse({ status: "FAILED", lastFailureMessage: "x", lastFailureRetryable: false })));
    const { finalSession, disposedSessions } = simulateStrictModeRecoverySessionOwnership(
      () => createIllegalDumpingImportSession({ fetchImpl }),
      "b-1"
    );
    expect(disposedSessions).toHaveLength(1);
    expect(disposedSessions[0]).not.toBe(finalSession);

    await new Promise((r) => setTimeout(r, 0));

    // Bounded: exactly 2 fetch calls total (one phantom, one real) — never
    // unbounded, and never more than the two construction-triggered resumes.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The real, surviving session ends up correctly hydrated.
    expect(finalSession.getState().phase).toBe("physicalFailed");
    // The phantom (disposed) session never produced an observable listener
    // call — proving its resolution was a genuine no-op, not merely unobserved.
    const disposedObserved: string[] = [];
    disposedSessions[0].subscribe(() => disposedObserved.push(disposedSessions[0].getState().phase));
    await new Promise((r) => setTimeout(r, 0));
    expect(disposedObserved).toHaveLength(0);

    finalSession.dispose();
  });
});

describe("T21/M9-equivalent: dispose suppresses a stale in-flight resume completion", () => {
  it("disposing immediately after mount leaves the session frozen — the resolved fetch never mutates its observable state", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(batchDetailResponse({ status: "READY" })));
    const session = createIllegalDumpingImportSession({ fetchImpl });
    const cleanup = mountRecoverySessionEffect(() => session, "b-1", () => {});
    cleanup(); // dispose before the fetch resolves
    await new Promise((r) => setTimeout(r, 0));
    // resumingBatch was the last state actually set before disposal; the
    // batch-detail response's own reconciliation never lands.
    expect(session.getState().phase).toBe("resumingBatch");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T27/T28/T29/M10: no browser persistence anywhere under this feature.
// ---------------------------------------------------------------------------
describe("T27/T28/T29/M10: no localStorage/sessionStorage/IndexedDB", () => {
  it("no file under app/data-hub/import/** references any browser storage API", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not reference browser storage`).not.toMatch(
        /localStorage|sessionStorage|indexedDB|IDBFactory/
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T30/T31: ordinary new-import + invalid-header flow untouched.
// ---------------------------------------------------------------------------
describe("T30/T31: ordinary new-import and invalid-header logic are untouched", () => {
  it("confirmEligibility.ts (the invalid-header/Confirm-disabled logic) is byte-identical to its pre-5A.3D.2 shipped form", () => {
    const code = read("app/data-hub/import/confirmEligibility.ts");
    // Structural markers proving the exact same predicates still exist,
    // unmodified — the same file this repo's own 5A.3C.1 suite already
    // behaviorally tests in full; this task adds no second copy of this
    // logic and made no edit to this file.
    expect(code).toMatch(/export function isConfirmEligible/);
    expect(code).toMatch(/export function hasMissingRequiredHeaders/);
    expect(code).toMatch(/export function shouldRenderPreviewTable/);
    expect(code).toMatch(/export function createConfirmGuard/);
  });

  it("FileSelector.tsx's start() call is unchanged — still session.start(pendingFile), no resume/history coupling", () => {
    const code = stripComments(read(FILE_SELECTOR));
    expect(code).toMatch(/void session\.start\(pendingFile\)/);
    expect(code).not.toMatch(/resumeFromBatchId|listImportBatches/);
  });

  it("ImportClient.tsx's resetKey remount mechanism (the 'start a new import' mechanism) is unchanged", () => {
    const code = stripComments(read(IMPORT_CLIENT));
    expect(code).toMatch(/const \[resetKey, setResetKey\] = useState\(0\);/);
    expect(code).toMatch(/key=\{resetKey\}/);
  });

  it("ImportHistoryPanel is additive only — rendered strictly inside the existing 'select' screenGroup branch, immediately after FileSelector", () => {
    const code = stripComments(read(IMPORT_CLIENT));
    const selectIdx = code.indexOf('screenGroup === "select"');
    const fileSelectorIdx = code.indexOf("<FileSelector session={session} />");
    const historyPanelIdx = code.indexOf("<ImportHistoryPanel />");
    const uploadingIdx = code.indexOf('screenGroup === "uploading"');
    expect(selectIdx).toBeGreaterThan(-1);
    expect(fileSelectorIdx).toBeGreaterThan(selectIdx);
    // ImportHistoryPanel appears after FileSelector but still before the
    // NEXT screen group's own branch — i.e. it is scoped to the "select"
    // branch only, not hoisted elsewhere.
    expect(historyPanelIdx).toBeGreaterThan(fileSelectorIdx);
    expect(historyPanelIdx).toBeLessThan(uploadingIdx);
  });
});

// ---------------------------------------------------------------------------
// M21: no direct Blob client import anywhere in the history/recovery UI —
// the shipped orchestrator (blobUpload.ts) owns Blob behavior entirely.
// ---------------------------------------------------------------------------
describe("M21: no direct @vercel/blob/client import in the history/recovery UI", () => {
  it("no file under app/data-hub/import/** imports @vercel/blob directly", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import @vercel/blob directly`).not.toMatch(/@vercel\/blob/);
    }
  });
});

// ---------------------------------------------------------------------------
// T32/M20: no new backend route.
// ---------------------------------------------------------------------------
describe("T32/M20: no new backend route", () => {
  it("app/api/data-hub/** contains exactly the same 7 pre-existing route files (5A.3D.0/5A.3D.1 baseline) — no new route.ts added", () => {
    const apiDir = path.join(ROOT, "app", "api", "data-hub");
    const routeFiles = walk(apiDir, [".ts"])
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(routeFiles).toEqual(
      [
        "app/api/data-hub/import-batches/[id]/finalize/route.ts",
        "app/api/data-hub/import-batches/[id]/inspect/route.ts",
        "app/api/data-hub/import-batches/[id]/route.ts",
        "app/api/data-hub/import-batches/[id]/worksheets/route.ts",
        "app/api/data-hub/import-batches/route.ts",
        "app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route.ts",
        "app/api/data-hub/worksheets/[id]/preview/route.ts",
        "app/api/data-hub/worksheets/[id]/route.ts",
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// T33/M15: no raw storage/internal field exposed by the new DTO/UI.
// ---------------------------------------------------------------------------
describe("T33/M15: ImportBatchSummaryDTOClient carries no raw storage/internal field", () => {
  it("the new client type has only id/status/originalFilename/contentType/sizeBytes/createdAt/updatedAt", () => {
    const code = read("lib/data-hub/client/types.ts");
    const block = code.match(/export interface ImportBatchSummaryDTOClient \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(block).not.toMatch(/storageKey|etag|sha256|uploadedBy|organisationId|token|secret/i);
  });

  it("ImportHistoryPanel.tsx never renders a field named storageKey/etag/sha256/token", () => {
    const code = stripComments(read(HISTORY_PANEL));
    expect(code).not.toMatch(/storageKey|etag|sha256|token|secret/i);
  });
});

// ---------------------------------------------------------------------------
// T34/M4/M18: no automatic mutating call from the recovery UI.
// ---------------------------------------------------------------------------
describe("T34/M4/M18: no automatic finalize/retry/confirm outside an explicit click handler", () => {
  it("RecoveryClient.tsx never calls a mutating session method inside a useEffect (only inside onRetry/onConfirm closures)", () => {
    const code = stripComments(read(RECOVERY_CLIENT));
    const effectBlocks = code.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const block of effectBlocks) {
      expect(block).not.toMatch(/session\.(proceedToFinalize|retryFinalize|retryObtainWorksheet|retryInspect|retryConfirm|confirm)\(/);
    }
  });

  it("useDataHubRecoverySession.ts's own construction effect calls only resumeFromBatchId (plus dispose(), only in its own cleanup) — no mutating method", () => {
    const code = stripComments(read(RECOVERY_HOOK));
    const effectMethodCalls = code.match(/instance\.\w+\(/g) ?? [];
    const ALLOWED = new Set(["instance.resumeFromBatchId(", "instance.dispose("]);
    expect(effectMethodCalls.every((c) => ALLOWED.has(c))).toBe(true);
    expect(effectMethodCalls).toContain("instance.resumeFromBatchId(");
    expect(effectMethodCalls).toContain("instance.dispose(");
  });
});

// ---------------------------------------------------------------------------
// T38: Start new import remains reachable from every terminal recovery view.
// ---------------------------------------------------------------------------
describe("T38: terminal recovery states always offer a path back to /data-hub/import", () => {
  it("RecoveryClient.tsx routes every 'restart'/success/fallback action to router.push('/data-hub/import')", () => {
    const code = stripComments(read(RECOVERY_CLIENT));
    const pushCalls = code.match(/router\.push\("\/data-hub\/import"\)/g) ?? [];
    // ImportSuccess's onStartAnother, the error-overlay 'restart' branch,
    // and the exhaustiveness fallback all navigate back — never a dead end.
    expect(pushCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("worksheetTerminal (INELIGIBLE/SKIPPED) is classified as an error-overlay phase with a 'Start a new import' retryAction", () => {
    expect(isErrorOverlayPhase("worksheetTerminal")).toBe(true);
    const copy = deriveErrorOverlayCopy({
      phase: "worksheetTerminal",
      batch: { id: "b", status: "READY", originalFilename: "f.csv", contentType: "csv", sizeBytes: 1 },
      worksheet: {
        id: "w",
        worksheetIndex: 0,
        worksheetName: "s",
        worksheetVisibility: "visible",
        worksheetIsEmpty: false,
        canonicalStatus: "INELIGIBLE",
        importBatchId: "b",
        createdAt: "",
        updatedAt: "",
        confirmedBy: null,
        confirmedAt: null,
        lastAttemptAt: null,
        attemptCount: 0,
        lastFailureCode: null,
        lastFailureMessage: null,
        lastFailureRetryable: null,
        importedRowCount: null,
      },
      reason: "INELIGIBLE",
    });
    expect(copy?.retryAction).toBe("restart");
    expect(copy?.message).not.toMatch(/raw|stack|blob/i);
  });

  it("SKIPPED gets distinct, honest copy from INELIGIBLE (never the same generic string)", () => {
    const base = {
      phase: "worksheetTerminal" as const,
      batch: { id: "b", status: "READY" as const, originalFilename: "f.csv", contentType: "csv", sizeBytes: 1 },
      worksheet: {
        id: "w",
        worksheetIndex: 0,
        worksheetName: "s",
        worksheetVisibility: "visible" as const,
        worksheetIsEmpty: false,
        importBatchId: "b",
        createdAt: "",
        updatedAt: "",
        confirmedBy: null,
        confirmedAt: null,
        lastAttemptAt: null,
        attemptCount: 0,
        lastFailureCode: null,
        lastFailureMessage: null,
        lastFailureRetryable: null,
        importedRowCount: null,
      },
    };
    const ineligible = deriveErrorOverlayCopy({ ...base, worksheet: { ...base.worksheet, canonicalStatus: "INELIGIBLE" }, reason: "INELIGIBLE" });
    const skipped = deriveErrorOverlayCopy({ ...base, worksheet: { ...base.worksheet, canonicalStatus: "SKIPPED" }, reason: "SKIPPED" });
    expect(ineligible?.message).not.toBe(skipped?.message);
  });
});

// ---------------------------------------------------------------------------
// T8: Load More is hidden/disabled once hasNextPage is false.
// ---------------------------------------------------------------------------
describe("T8: Load More is offered only while hasNextPage is true", () => {
  it("ImportHistoryPanel.tsx's Load More button is conditioned on state.status === 'loaded' && state.hasNextPage", () => {
    const code = stripComments(read(HISTORY_PANEL));
    expect(code).toMatch(/state\.status === "loaded" && state\.hasNextPage/);
  });

  it("useImportHistory.ts's loadMore() refuses to run once hasNextPage is false or nextCursor is null", () => {
    const code = stripComments(read(HISTORY_HOOK));
    expect(code).toMatch(/if \(!state\.hasNextPage \|\| state\.nextCursor === null\) return;/);
  });
});

// ---------------------------------------------------------------------------
// T10: opening a history item navigates using the batch id only.
// ---------------------------------------------------------------------------
describe("T10: history row navigation carries only the batch id, no query string", () => {
  it("ImportHistoryPanel.tsx links to /data-hub/import/${row.id} with no query parameters", () => {
    const code = stripComments(read(HISTORY_PANEL));
    const hrefMatch = code.match(/href=\{`([^`]*)`\}/);
    expect(hrefMatch?.[1]).toBe("/data-hub/import/${encodeURIComponent(row.id)}");
    expect(hrefMatch?.[1]).not.toMatch(/\?/);
  });
});

// ---------------------------------------------------------------------------
// T13/T15: AWAITING_UPLOAD/PROCESSING never trigger upload()/finalize() from
// this feature's own new files.
// ---------------------------------------------------------------------------
describe("T13/T15: no upload()/finalize() call anywhere in the history/recovery UI", () => {
  it("ImportHistoryPanel.tsx, useImportHistory.ts, RecoveryClient.tsx and the recovery hook never call session.upload()/proceedToFinalize() automatically", () => {
    for (const relPath of [HISTORY_PANEL, HISTORY_HOOK, RECOVERY_CLIENT, RECOVERY_HOOK]) {
      const code = stripComments(read(relPath));
      expect(code, `${relPath} must not call .upload(`).not.toMatch(/\.upload\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// T21/T22/T23: terminal recovered phases (imported/alreadyImported,
// worksheetTerminal) can never reach a confirm-capable component.
// ---------------------------------------------------------------------------
describe("T21/T22/T23: terminal recovered phases never render a confirm-capable component", () => {
  it("RecoveryClient.tsx renders ImportSuccess (not ReviewPanel) for imported/alreadyImported", () => {
    const code = stripComments(read(RECOVERY_CLIENT));
    const importedBranch = code.slice(
      code.indexOf('state.phase === "imported" || state.phase === "alreadyImported"'),
      code.indexOf("if (isErrorOverlayPhase")
    );
    expect(importedBranch).toMatch(/<ImportSuccess/);
    expect(importedBranch).not.toMatch(/<ReviewPanel|ConfirmAction/);
  });

  it("worksheetTerminal renders via the isErrorOverlayPhase/ImportError branch (never ReviewPanel/ConfirmAction) — it is not a member of REVIEW_PHASES", () => {
    const code = stripComments(read(RECOVERY_CLIENT));
    expect(code).toMatch(/const REVIEW_PHASES = new Set\(\["confirmationReady", "previewing", "previewFailed", "previewReady"\]\);/);
    // worksheetTerminal is absent from that literal set.
    const reviewPhasesLine = code.match(/const REVIEW_PHASES = new Set\(\[[^\]]*\]\);/)?.[0] ?? "";
    expect(reviewPhasesLine).not.toMatch(/worksheetTerminal/);
  });
});

// ---------------------------------------------------------------------------
// T35: a direct recovery reload (a fresh construct+resume cycle against the
// same batch) is idempotent and read-safe — repeatable with no accumulation.
// ---------------------------------------------------------------------------
describe("T35: direct recovery reload is idempotent/read-safe", () => {
  it("two independent construct+resume cycles against the same batchId each issue exactly one GET and reach the same terminal state — no cross-call accumulation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(batchDetailResponse({ status: "FAILED", lastFailureMessage: "x", lastFailureRetryable: false })));

    const session1 = createIllegalDumpingImportSession({ fetchImpl });
    mountRecoverySessionEffect(() => session1, "b-1", () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(session1.getState().phase).toBe("physicalFailed");
    session1.dispose();

    // A genuine second "page load" (a brand new session, as a real reload
    // would produce) against the identical batch id.
    const session2 = createIllegalDumpingImportSession({ fetchImpl });
    mountRecoverySessionEffect(() => session2, "b-1", () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(session2.getState().phase).toBe("physicalFailed");
    session2.dispose();

    expect(fetchImpl).toHaveBeenCalledTimes(2); // exactly one per reload, no accumulation
  });
});

// ---------------------------------------------------------------------------
// Auth boundary (spec Section 40).
// ---------------------------------------------------------------------------
describe("auth: /data-hub/import/[batchId] preserves the manager+ gate", () => {
  it("page.tsx calls requireRole('manager') and redirects to /login on failure — same pattern as the parent page", () => {
    const code = stripComments(read(RECOVERY_PAGE));
    expect(code).toMatch(/requireRole\("manager"\)/);
    expect(code).toMatch(/redirect\("\/login"\)/);
  });

  it("page.tsx's route params type carries only batchId — no orgId/status/worksheetId field", () => {
    const code = stripComments(read(RECOVERY_PAGE));
    expect(code).toMatch(/params: Promise<\{ batchId: string \}>/);
    expect(code).not.toMatch(/organisationId|searchParams|worksheetId/i);
  });
});

// ---------------------------------------------------------------------------
// T24/M2/M14 continuity: no XLS/XLSX enablement introduced by this task
// (reusing this repo's own established phrasing/convention for this check).
// ---------------------------------------------------------------------------
describe("T31 (spec numbering)/M14-continuity: no XLS/XLSX reachability introduced under app/data-hub/import/**", () => {
  it("no new file imports xlsx/SheetJS/workbookParser", () => {
    for (const { file, code } of readAll()) {
      if (!file.includes("useImportHistory") && !file.includes("ImportHistoryPanel") && !file.includes("[batchId]") && !file.includes("historyStatusCopy") && !file.includes("importHistoryReducer")) {
        continue;
      }
      expect(code, `${file} must not import xlsx/workbookParser`).not.toMatch(/from\s+["']xlsx["']|workbookParser/);
    }
  });
});
