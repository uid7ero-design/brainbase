import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

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

  it("T16/M7: a local submitting flag is set synchronously on click and gates a second confirm() call before it is ever issued", () => {
    const onConfirmIdx = code.indexOf("onConfirm={() => {");
    expect(onConfirmIdx).toBeGreaterThan(-1);
    const onConfirmBlock = code.slice(onConfirmIdx, onConfirmIdx + 250);
    expect(onConfirmBlock).toMatch(/if\s*\(\s*submitting\s*\)\s*return;/);
    expect(onConfirmBlock).toContain("setSubmitting(true)");
    expect(onConfirmBlock).toContain("session.confirm()");
  });

  it("the busy prop passed to ConfirmAction is the real submitting state, never hardcoded false", () => {
    expect(code).toMatch(/busy=\{submitting\}/);
    expect(code).not.toMatch(/busy=\{false\}/);
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
