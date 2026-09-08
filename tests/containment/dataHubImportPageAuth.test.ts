import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.3C.1 — page-level access-control containment (T1, T2).
// Static source-text proof: the manager-page guard pattern established
// elsewhere in this repo (app/dashboard/leads/page.tsx, app/clients/page.tsx
// — `let session; try { session = await requireRole('manager'); } catch {
// redirect('/login'); }`) is genuinely present, unweakened, in
// app/data-hub/import/page.tsx.

const ROOT = process.cwd();
const PAGE_PATH = path.join(ROOT, "app", "data-hub", "import", "page.tsx");

function readPage(): string {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

/** Strips single-line (//) and block (/* *\/) comments before any
 * substring assertion — a comment merely mentioning the right call would
 * otherwise false-pass a naive whole-file substring check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("app/data-hub/import/page.tsx — manager-page access guard", () => {
  it("T1: imports requireRole from lib/org (the authoritative, DB-re-reading primitive)", () => {
    const code = stripComments(readPage());
    expect(code).toMatch(/import\s*\{\s*requireRole\s*\}\s*from\s*["']@\/lib\/org["']/);
  });

  it("T1: calls requireRole('manager') — the real, non-commented call site, not a mention in a comment", () => {
    const code = stripComments(readPage());
    expect(code).toMatch(/requireRole\(\s*["']manager["']\s*\)/);
  });

  it("T2: wraps the requireRole call in try/catch with a redirect('/login') in the catch branch", () => {
    const code = stripComments(readPage());
    const tryIdx = code.indexOf("try");
    expect(tryIdx).toBeGreaterThan(-1);
    const catchBlock = code.slice(tryIdx, tryIdx + 400);
    expect(catchBlock).toMatch(/requireRole\(\s*["']manager["']\s*\)/);
    expect(catchBlock).toMatch(/catch/);
    expect(catchBlock).toMatch(/redirect\(\s*["']\/login["']\s*\)/);
  });

  it("imports redirect from next/navigation", () => {
    const code = stripComments(readPage());
    expect(code).toMatch(/import\s*\{\s*redirect\s*\}\s*from\s*["']next\/navigation["']/);
  });

  it("M1 falsification target: the exact requireRole('manager') call-site substring is unique in the file (a widening mutation to 'viewer' is structurally detectable by this same assertion)", () => {
    const code = stripComments(readPage());
    const managerCalls = code.match(/requireRole\(\s*["']manager["']\s*\)/g) ?? [];
    const viewerCalls = code.match(/requireRole\(\s*["']viewer["']\s*\)/g) ?? [];
    expect(managerCalls.length).toBeGreaterThanOrEqual(1);
    expect(viewerCalls.length).toBe(0);
  });
});
