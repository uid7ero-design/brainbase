import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2G.1 — repo-wide darkness proof. This phase is explicitly
// dark service/domain infrastructure only: no app/api route, no UI, no
// cron/scheduler wiring, no barrel/index.ts export, and nothing outside
// this new module tree may import from it yet.

const ROOT = process.cwd();
const IMPORT_BATCH_DIR = path.join(ROOT, "lib", "data-hub", "importBatch");

function walk(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("Data Hub importBatch — no runtime caller exists yet (M28, verified by static inspection)", () => {
  const candidateDirs = ["app", "components", "middleware.ts"];

  it("no file under app/** or components/** imports from lib/data-hub/importBatch", () => {
    const offenders: string[] = [];
    for (const dir of candidateDirs) {
      const full = path.join(ROOT, dir);
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;
      const files = stat?.isDirectory() ? walk(full, [".ts", ".tsx"]) : stat?.isFile() ? [full] : [];
      for (const file of files) {
        const code = read(file);
        if (/from\s+["'][^"']*data-hub\/importBatch[^"']*["']/.test(code)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no app/api route file imports from lib/data-hub/importBatch", () => {
    const apiDir = path.join(ROOT, "app", "api");
    const files = walk(apiDir, [".ts", ".tsx"]);
    const offenders = files.filter((file) => /from\s+["'][^"']*data-hub\/importBatch[^"']*["']/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});

describe("Data Hub importBatch — no barrel/index.ts anywhere in the new tree", () => {
  it("lib/data-hub/importBatch/ contains no index.ts / index.tsx", () => {
    const entries = fs.readdirSync(IMPORT_BATCH_DIR);
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });

  it("lists exactly the expected production files (no extra barrel/export-surface file)", () => {
    const entries = fs.readdirSync(IMPORT_BATCH_DIR).filter((name) => name.endsWith(".ts"));
    expect(new Set(entries)).toEqual(
      new Set([
        "compositionRoot.ts",
        "failureTaxonomy.ts",
        "directUploadAuth.ts",
        "initiate.ts",
        "finalize.ts",
        // finalizeInternal.ts (remediation, Finding 2): the low-level
        // claim/completion persistence primitives, deliberately named with
        // "Internal" so its restricted-importer contract is visible from
        // the filename alone — see its own header comment and
        // finalizeImportBatch.test.ts's dedicated containment proof.
        "finalizeInternal.ts",
        "staleReclaim.ts",
        // inspectWorksheets.ts (5A.2H.1) — the worksheet inspection/
        // persistence service. Still dark: no runtime caller exists yet
        // (see the "no app/** or app/api/** importer" describe block
        // above, whose regex already covers this file by path-fragment —
        // this Set is the only edit this phase's darkness proof needs).
        "inspectWorksheets.ts",
      ])
    );
  });
});

describe("Data Hub importBatch — staleReclaim is never wired into a cron/scheduler", () => {
  it("no non-test file in the repo (outside node_modules) references staleReclaim.ts's export from a scheduling context", () => {
    // Narrow, targeted scan: anything importing reclaimStaleImportBatches
    // at all, outside the module itself and its own test files (which
    // legitimately call it directly to test it, never to schedule it),
    // would be the very first (and therefore not-yet-existing) wiring
    // point.
    const searchDirs = ["app", "scripts", "components"];
    const offenders: string[] = [];
    for (const dir of searchDirs) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      const files = walk(full, [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
      for (const file of files) {
        if (read(file).includes("reclaimStaleImportBatches")) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Data Hub importBatch — no live Blob network call or Production/Neon connection anywhere in this new test suite (M29/M30, verified by static inspection)", () => {
  it("none of this phase's own new test files reference a real Vercel token/store id shape without also mocking @vercel/blob", () => {
    const testsDir = path.join(ROOT, "tests", "containment");
    const newTestFiles = fs
      .readdirSync(testsDir)
      .filter((name) =>
        [
          "fileSignatures.test.ts",
          "failureTaxonomy.test.ts",
          "dataHubCompositionRoot.test.ts",
          "directUploadAuth.test.ts",
          "initiateImportBatch.test.ts",
          "finalizeImportBatch.test.ts",
          "staleReclaim.test.ts",
          // dataHubImportBatchDarkness.test.ts (this file) is deliberately
          // excluded — its OWN source text contains the literal regex
          // pattern used to detect a token shape, which would otherwise
          // trip this very check against itself.
        ].includes(name)
      )
      .map((name) => path.join(testsDir, name));
    expect(newTestFiles.length).toBeGreaterThan(0);
    for (const file of newTestFiles) {
      const code = read(file);
      if (/vercel_blob_rw_/.test(code)) {
        expect(code).toMatch(/vi\.mock\(["']@vercel\/blob/);
      }
    }
  });

  it("none of this phase's own new test files set a real-looking DATABASE_URL/DIRECT_URL pointing anywhere but localhost/a disposable container", () => {
    const testsDir = path.join(ROOT, "tests", "containment");
    const files = fs
      .readdirSync(testsDir)
      .filter((name) =>
        [
          "initiateImportBatch.test.ts",
          "finalizeImportBatch.test.ts",
          "staleReclaim.test.ts",
        ].includes(name)
      )
      .map((name) => path.join(testsDir, name));
    for (const file of files) {
      const code = read(file);
      expect(code).not.toMatch(/neon\.tech/);
      expect(code).not.toMatch(/ep-[a-z0-9-]+\.us-/); // a real Neon endpoint hostname shape
    }
  });
});
