import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createConfirmGuard } from "@/app/data-hub/import/confirmEligibility";

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ConfirmAction.tsx — T15/T16/M7", () => {
  const code = read("app/data-hub/import/_components/ConfirmAction.tsx");

  it("T16: the button's disabled attribute considers both eligibility and busy state", () => {
    expect(code).toMatch(/disabled=\{!eligible \|\| busy\}/);
  });

  it("carries aria-busy tied to the real busy prop, not a hardcoded value", () => {
    expect(code).toMatch(/aria-busy=\{busy\}/);
  });

  it("never renders the word 'destructive' in actual code/markup (a comment MAY explain the decision) — uses accurate consequence language instead", () => {
    expect(stripComments(code).toLowerCase()).not.toContain("destructive");
    expect(code).toMatch(/cannot be undone/i);
  });
});

describe("ReviewPanel.tsx — Confirm delegation and double-submit guard (T15/T16/M7)", () => {
  const code = read("app/data-hub/import/_components/ReviewPanel.tsx");

  it("T15: confirm delegates to session.confirm() — the shipped orchestrator's own method — never a direct fetch", () => {
    expect(code).toContain("session.confirm()");
    expect(code).not.toMatch(/fetch\(\s*["'`]\/api\/data-hub/);
  });

  it("T16/M7/R2: onConfirm delegates through the ref-backed confirmGuardRef (the real synchronous guard), sets the busy display state, and never re-introduces the disproven useState-only `if (submitting) return` guard", () => {
    const onConfirmIdx = code.indexOf("onConfirm={() => {");
    expect(onConfirmIdx).toBeGreaterThan(-1);
    const onConfirmBlock = code.slice(onConfirmIdx, onConfirmIdx + 250);
    expect(onConfirmBlock).toContain("setSubmitting(true)");
    expect(onConfirmBlock).toContain("confirmGuardRef.current.invoke(");
    // R2 root cause: a bare `if (submitting) return` is NOT a sufficient
    // guard against same-tick invocation (independent review proved this
    // empirically) — the real guard must live in confirmGuardRef, not here.
    expect(onConfirmBlock).not.toMatch(/if\s*\(\s*submitting\s*\)\s*return;/);
  });

  it("R2: confirmGuardRef is constructed from createConfirmGuard(() => session.confirm()) — the real, tested guard primitive, not an inline reimplementation", () => {
    expect(code).toMatch(/useRef\(createConfirmGuard\(\(\) => session\.confirm\(\)\)\)/);
  });

  it("R2/R2-E: an isMounted-style ref guards the busy-state reset so a confirm() that settles after unmount never updates state on an unmounted component", () => {
    expect(code).toMatch(/mountedRef\.current/);
    const onSettledIdx = code.indexOf("confirmGuardRef.current.invoke(");
    const onSettledBlock = code.slice(onSettledIdx, onSettledIdx + 150);
    expect(onSettledBlock).toMatch(/if\s*\(\s*mountedRef\.current\s*\)\s*setSubmitting\(false\)/);
  });

  it("the busy prop passed to ConfirmAction is the real submitting state, never hardcoded false", () => {
    expect(code).toMatch(/busy=\{submitting\}/);
    expect(code).not.toMatch(/busy=\{false\}/);
  });
});

describe("createConfirmGuard — RTEST6/RTEST7/RTEST8 (R2 same-tick duplicate-confirm remediation, real executed proofs)", () => {
  it("RTEST6: two genuinely SAME-TICK invocations of guard.invoke() (synchronous, back-to-back, before either promise's .finally() can run) result in exactly ONE call into the underlying confirm function", () => {
    const confirmFn = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const guard = createConfirmGuard(confirmFn);

    guard.invoke();
    guard.invoke(); // same-tick, synchronous second call

    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it("RTEST7: a rejected confirm call is fully consumed — no unhandled promise rejection escapes createConfirmGuard", async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const confirmFn = vi.fn(() => Promise.reject(new Error("confirm failed")));
      const guard = createConfirmGuard(confirmFn);
      guard.invoke();
      // Let the rejection's microtask (and any unhandledRejection dispatch,
      // which Node schedules on a later tick) actually run.
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("RTEST8: after a confirm() rejection settles, the lock releases and a legitimate subsequent call (mirroring retry) is NOT permanently poisoned", async () => {
    const confirmFn = vi.fn(() => Promise.reject(new Error("confirm failed")));
    const guard = createConfirmGuard(confirmFn);

    guard.invoke();
    await new Promise((r) => setTimeout(r, 10)); // let .finally() run

    expect(guard.isLocked()).toBe(false);
    guard.invoke(); // a legitimate later call must be allowed through
    expect(confirmFn).toHaveBeenCalledTimes(2);
  });

  it("onSettled is called exactly once per real (non-blocked) invocation, mirroring how ReviewPanel resets its busy display state", async () => {
    const confirmFn = vi.fn(() => Promise.resolve());
    const guard = createConfirmGuard(confirmFn);
    let settledCount = 0;

    guard.invoke(() => settledCount++);
    guard.invoke(() => settledCount++); // same-tick, blocked — must not call onSettled
    await new Promise((r) => setTimeout(r, 0));

    expect(settledCount).toBe(1);
  });
});

describe("uploadUncertain safe recovery — T19/M16", () => {
  it("T19/M16: UploadProgress.tsx never offers a re-upload action from uploadUncertain — only proceedToFinalize()", () => {
    const code = read("app/data-hub/import/_components/UploadProgress.tsx");
    const uncertainSectionIdx = code.indexOf("// uploadUncertain");
    expect(uncertainSectionIdx).toBeGreaterThan(-1);
    const uncertainSection = code.slice(uncertainSectionIdx);
    expect(uncertainSection).toContain("session.proceedToFinalize()");
    expect(uncertainSection).not.toMatch(/session\.upload\(/);
    expect(uncertainSection).not.toMatch(/session\.retryInitiate\(/);
  });
});

describe("finalizeUncertain safe recovery — T20", () => {
  it("T20: screenGroup.ts maps finalizeUncertain to retryFinalize, which ProcessingStatus.tsx wires to session.proceedToFinalize()", async () => {
    const { deriveErrorOverlayCopy } = await import("@/app/data-hub/import/screenGroup");
    const copy = deriveErrorOverlayCopy({
      phase: "finalizeUncertain",
      batch: { id: "b1", status: "READY", originalFilename: "f.csv", contentType: "csv", sizeBytes: 1 },
      message: "m",
    });
    expect(copy!.retryAction).toBe("retryFinalize");
    const code = read("app/data-hub/import/_components/ProcessingStatus.tsx");
    expect(code).toContain('case "retryFinalize"');
    expect(code).toContain("session.retryFinalize()");
  });
});
