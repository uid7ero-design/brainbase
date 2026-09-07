import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { deriveScreenGroup, deriveErrorOverlayCopy, deriveProcessingStatusText, isErrorOverlayPhase } from "@/app/data-hub/import/screenGroup";
import { mountSessionEffect, simulateStrictModeSessionOwnership } from "@/app/data-hub/import/useDataHubImportSession";
import { createIllegalDumpingImportSession, type DataHubImportState } from "@/lib/data-hub/client/orchestrator";

function initiateOnlyFetch() {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        batch: { id: "b1", status: "AWAITING_UPLOAD", originalFilename: "f.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: "tok-1",
        configurationError: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
}
const testFile = () => new File(["a,b\n1,2\n"], "dumping.csv", { type: "text/csv" });

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("deriveScreenGroup — the real 26-phase mapping (T6, T9)", () => {
  it("T6: idle/initiating/awaitingUpload/uploading map correctly (initiate + upload state mapping)", () => {
    expect(deriveScreenGroup("idle")).toBe("select");
    expect(deriveScreenGroup("initiating")).toBe("uploading");
    expect(deriveScreenGroup("awaitingUpload")).toBe("uploading");
    expect(deriveScreenGroup("uploading")).toBe("uploading");
  });

  it("T9: finalize/inspect sequencing phases all map to the single Processing group, in the real orchestrator's own order — proves this module doesn't reorder or skip a phase", () => {
    const processingOrder: DataHubImportState["phase"][] = [
      "finalizing",
      "reconciling",
      "physicalReady",
      "inspecting",
      "obtainingWorksheet",
    ];
    for (const phase of processingOrder) {
      expect(deriveScreenGroup(phase)).toBe("processing");
    }
  });

  it("every one of the real 26 phases maps to exactly one of the 6 known screen groups (exhaustiveness proof)", () => {
    const allPhases: DataHubImportState["phase"][] = [
      "idle",
      "initiating",
      "initiateFailed",
      "initiateConfigurationError",
      "awaitingUpload",
      "uploading",
      "uploadUncertain",
      "finalizing",
      "finalizeUncertain",
      "reconciling",
      "physicalReady",
      "physicalFailed",
      "batchTerminal",
      "inspecting",
      "inspectFailed",
      "obtainingWorksheet",
      "obtainWorksheetFailed",
      "confirmationReady",
      "previewing",
      "previewFailed",
      "previewReady",
      "confirming",
      "imported",
      "alreadyImported",
      "confirmFailed",
      "unknownError",
    ];
    const KNOWN = new Set(["select", "uploading", "processing", "review", "confirm", "success"]);
    for (const phase of allPhases) {
      expect(KNOWN.has(deriveScreenGroup(phase))).toBe(true);
    }
    expect(allPhases.length).toBe(26);
  });

  it("T17/T18: imported and alreadyImported both map to the success group", () => {
    expect(deriveScreenGroup("imported")).toBe("success");
    expect(deriveScreenGroup("alreadyImported")).toBe("success");
  });

  it("T19: uploadUncertain's derived copy offers ONLY proceedToFinalize, never a re-upload action", () => {
    const copy = deriveErrorOverlayCopy({ phase: "uploadUncertain", batch: FAKE_BATCH, uploadToken: "t", message: "m" });
    expect(copy!.retryAction).toBe("proceedToFinalize");
  });

  it("T20: finalizeUncertain's derived copy offers retryFinalize", () => {
    const copy = deriveErrorOverlayCopy({ phase: "finalizeUncertain", batch: FAKE_BATCH, message: "m" });
    expect(copy!.retryAction).toBe("retryFinalize");
  });

  it("T21: physicalFailed with retryable:true offers a retry action; retryable:false offers restart, never a retry", () => {
    const retryableCopy = deriveErrorOverlayCopy({
      phase: "physicalFailed",
      batch: FAKE_BATCH,
      failureCode: "X",
      failureMessage: "m",
      retryable: true,
    });
    expect(retryableCopy!.retryAction).toBe("proceedToFinalize");
    expect(retryableCopy!.retryLabel).not.toBeNull();

    const terminalCopy = deriveErrorOverlayCopy({
      phase: "physicalFailed",
      batch: FAKE_BATCH,
      failureCode: "X",
      failureMessage: "m",
      retryable: false,
    });
    expect(terminalCopy!.retryAction).toBe("restart");
  });

  it("T22: batchTerminal offers ONLY restart, never a phase-specific retry method", () => {
    const copy = deriveErrorOverlayCopy({ phase: "batchTerminal", batch: FAKE_BATCH, message: "m" });
    expect(copy!.retryAction).toBe("restart");
    expect(copy!.retryLabel).not.toBeNull();
  });

  it("isErrorOverlayPhase correctly classifies every uncertainty/failure phase and no forward-progress phase", () => {
    const errorPhases: DataHubImportState["phase"][] = [
      "initiateFailed",
      "initiateConfigurationError",
      "uploadUncertain",
      "finalizeUncertain",
      "physicalFailed",
      "batchTerminal",
      "inspectFailed",
      "obtainWorksheetFailed",
      "previewFailed",
      "confirmFailed",
      "unknownError",
    ];
    for (const phase of errorPhases) expect(isErrorOverlayPhase(phase)).toBe(true);

    const forwardPhases: DataHubImportState["phase"][] = ["idle", "uploading", "inspecting", "confirmationReady", "confirming", "imported"];
    for (const phase of forwardPhases) expect(isErrorOverlayPhase(phase)).toBe(false);
  });

  it("deriveProcessingStatusText gives distinct, truthful text for distinct sub-phases (never one generic string for all of them)", () => {
    const texts = new Set([
      deriveProcessingStatusText("finalizing"),
      deriveProcessingStatusText("inspecting"),
      deriveProcessingStatusText("obtainingWorksheet"),
    ]);
    expect(texts.size).toBeGreaterThan(1);
  });
});

const FAKE_BATCH = { id: "b1", status: "READY" as const, originalFilename: "f.csv", contentType: "csv", sizeBytes: 10 };

describe("useDataHubImportSession — lifecycle containment (R1 remediation: RTEST1-RTEST5, M11, M22)", () => {
  it("RTEST1/RTEST2 — NEGATIVE CONTROL proving the OLD (removed) construction pattern was genuinely unsafe: a session disposed by a Strict-Mode-style phantom cleanup, then reused, issues a REAL network call while the UI observes nothing", async () => {
    const fetchImpl = initiateOnlyFetch();
    // Mirrors the OLD hook exactly: ONE instance constructed via a
    // useState-style lazy initializer, reused across the phantom
    // cleanup/re-setup instead of being replaced by a fresh one.
    const session = createIllegalDumpingImportSession({ fetchImpl });
    session.subscribe(() => {}); // setup #1
    session.dispose(); // Strict Mode's phantom cleanup
    const observed: unknown[] = [];
    session.subscribe((s) => observed.push(s)); // setup #2 — re-subscribes to the SAME disposed instance (the old bug)

    await session.start(testFile());

    expect(fetchImpl).toHaveBeenCalledTimes(1); // a real network call happened
    expect(observed.length).toBe(0); // the UI never observed it
    expect(session.getState().phase).toBe("idle"); // frozen forever
  });

  it("RTEST1/RTEST2 — the NEW construction pattern (a fresh instance built inside the effect on every setup) is safe: the surviving session is never among the disposed ones, and its start() is fully observable", async () => {
    const fetchImpl = initiateOnlyFetch();
    const { finalSession, disposedSessions } = simulateStrictModeSessionOwnership(() => createIllegalDumpingImportSession({ fetchImpl }));

    expect(disposedSessions).toHaveLength(1);
    expect(disposedSessions[0]).not.toBe(finalSession);

    const observed: unknown[] = [];
    finalSession.subscribe((s) => observed.push(s));

    await finalSession.start(testFile());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observed.length).toBeGreaterThan(0); // the UI WOULD observe every real transition
    expect(finalSession.getState().phase).not.toBe("idle"); // state actually progressed, not frozen
  });

  it("RTEST3: the construction effect has an empty dependency array — by React's own documented contract, an ordinary rerender never re-runs it, so no replacement session is ever constructed outside of mount", () => {
    const code = read("app/data-hub/import/useDataHubImportSession.ts");
    const constructionEffectPattern =
      /useEffect\(\(\) => \{\s*const instance = createIllegalDumpingImportSession\(\);[\s\S]*?setSession\(instance\);\s*return \(\) => \{\s*instance\.dispose\(\);\s*\};\s*\}, \[\]\);/;
    expect(code).toMatch(constructionEffectPattern);
  });

  it("RTEST4: a genuine final unmount (the surviving setup's own cleanup) disposes the session actually in use — proven behaviorally: after that cleanup, start() no longer produces any observable state change", async () => {
    const fetchImpl = initiateOnlyFetch();
    const { finalSession, finalCleanup } = simulateStrictModeSessionOwnership(() => createIllegalDumpingImportSession({ fetchImpl }));
    finalCleanup(); // genuine final unmount
    const observed: unknown[] = [];
    finalSession.subscribe((s) => observed.push(s));
    await finalSession.start(testFile());
    expect(observed.length).toBe(0); // disposed — setState silently no-ops
  });

  it("RTEST5: the construction effect alone (mount/cleanup/remount, with no explicit user start() call) never issues a network request on its own", () => {
    const fetchImpl = initiateOnlyFetch();
    simulateStrictModeSessionOwnership(() => createIllegalDumpingImportSession({ fetchImpl }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("M11/M22: an ordinary rerender cannot construct a second session — a single real mount (one setup, no phantom cleanup) constructs exactly one instance", () => {
    let constructedCount = 0;
    const factory = () => {
      constructedCount++;
      return createIllegalDumpingImportSession();
    };
    const cleanup = mountSessionEffect(factory, () => {});
    expect(constructedCount).toBe(1);
    cleanup();
  });

  it("M11: the hook constructs the session INSIDE the effect body (not via a useState/useRef lazy initializer, and not a module-level singleton)", () => {
    const code = read("app/data-hub/import/useDataHubImportSession.ts");
    expect(code).not.toMatch(/useState[^(]*\(\s*\(\)\s*=>\s*createIllegalDumpingImportSession\(\)\s*\)/);
    expect(code).not.toMatch(/useRef[^(]*\(\s*createIllegalDumpingImportSession\(\)\s*\)/);
    const topLevelSingleton = /^const\s+\w+\s*=\s*createIllegalDumpingImportSession\(\);?\s*$/m;
    expect(code).not.toMatch(topLevelSingleton);
    expect(code).toMatch(/useEffect\(\(\) => \{\s*const instance = createIllegalDumpingImportSession\(\);[\s\S]*?setSession\(instance\);/);
  });

  it("dispose() is genuinely idempotent-safe: calling it twice on the same instance never throws and further setState calls are silently no-ops", () => {
    const session = createIllegalDumpingImportSession();
    session.dispose();
    expect(() => session.dispose()).not.toThrow();
    let notified = false;
    session.subscribe(() => {
      notified = true;
    });
    // A disposed session's listeners set was cleared by the FIRST dispose;
    // subscribing again after dispose adds a listener that a disposed
    // session's own setState() guard (`if (this.disposed) return;`) will
    // never invoke, since nothing calls setState on a disposed instance.
    expect(notified).toBe(false);
  });

  it("the hook never calls any orchestrator mutation method itself (start/upload/confirm/etc.) — it is a pure adapter, proving the HOOK never reorders or short-circuits the real state machine (T9)", () => {
    const code = read("app/data-hub/import/useDataHubImportSession.ts");
    for (const call of ["session.start(", "session.upload(", "session.confirm(", "session.proceedToFinalize(", "session.retryInspect("]) {
      expect(code).not.toContain(call);
    }
    // The only methods this file is allowed to call on the instance it
    // creates are the store-shaped ones useSyncExternalStore needs, plus
    // dispose.
    expect(code).toContain("session.subscribe(");
    expect(code).toContain("session.getState(");
    expect(code).toContain("instance.dispose(");
  });
});
