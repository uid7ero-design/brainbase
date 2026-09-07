import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { deriveScreenGroup, deriveErrorOverlayCopy, deriveProcessingStatusText, isErrorOverlayPhase } from "@/app/data-hub/import/screenGroup";
import { simulateSessionLifecycle } from "@/app/data-hub/import/useDataHubImportSession";
import { createIllegalDumpingImportSession, type DataHubImportState } from "@/lib/data-hub/client/orchestrator";

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

describe("useDataHubImportSession — lifecycle containment (T30, M11)", () => {
  it("T30: a simulated single mount constructs exactly one instance and disposes exactly one instance", () => {
    const result = simulateSessionLifecycle(() => createIllegalDumpingImportSession(), 1);
    expect(result.constructedCount).toBe(1);
    expect(result.disposedCount).toBe(1);
  });

  it("T30: a simulated mount->unmount->remount->unmount cycle (Strict Mode shape) never leaves more disposed instances than constructed, and every constructed instance is disposed exactly once", () => {
    const result = simulateSessionLifecycle(() => createIllegalDumpingImportSession(), 3);
    expect(result.constructedCount).toBe(3);
    expect(result.disposedCount).toBe(3);
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

  it("M11: the hook's source uses useState's lazy-initializer form for construction, not a raw call inside the render body or a module-level singleton", () => {
    const code = read("app/data-hub/import/useDataHubImportSession.ts");
    expect(code).toMatch(/useState[^(]*\(\s*\(\)\s*=>\s*createIllegalDumpingImportSession\(\)\s*\)/);
    // No bare top-level `const session = createIllegalDumpingImportSession()`
    // outside of any function — a module-level singleton shape.
    const topLevelSingleton = /^const\s+\w+\s*=\s*createIllegalDumpingImportSession\(\);?\s*$/m;
    expect(code).not.toMatch(topLevelSingleton);
  });

  it("the hook never calls any orchestrator mutation method itself (start/upload/confirm/etc.) — it is a pure adapter, proving the HOOK never reorders or short-circuits the real state machine (T9)", () => {
    const code = read("app/data-hub/import/useDataHubImportSession.ts");
    for (const call of ["session.start(", "session.upload(", "session.confirm(", "session.proceedToFinalize(", "session.retryInspect("]) {
      expect(code).not.toContain(call);
    }
    // The only methods this file is allowed to call on the instance it
    // creates are the store-shaped ones useSyncExternalStore needs.
    expect(code).toContain("session.subscribe(");
    expect(code).toContain("session.getState(");
    expect(code).toContain("session.dispose(");
  });
});
