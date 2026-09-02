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

// 5A.2H.3 — the dark-to-live transition. H.2's own read services
// (lib/data-hub/importBatch/read.ts) now have exactly four authorized
// runtime importers: the four H.3 GET route files. Every OTHER file
// under app/**/components/**, and every OTHER module under
// lib/data-hub/importBatch/ (finalize.ts, initiate.ts, staleReclaim.ts,
// inspectWorksheets.ts, etc. — none of which are read-only or safe to
// expose), must remain completely unimported by any runtime caller. This
// is intentionally an EXACT-SET assertion, not "some imports are now
// allowed" — a new, unauthorized importer must fail this test just as
// loudly as it would have before H.3 existed.
const AUTHORIZED_H3_ROUTE_IMPORTERS = new Set([
  path.join("app", "api", "data-hub", "import-batches", "route.ts"),
  path.join("app", "api", "data-hub", "import-batches", "[id]", "route.ts"),
  path.join("app", "api", "data-hub", "import-batches", "[id]", "worksheets", "route.ts"),
  path.join("app", "api", "data-hub", "worksheets", "[id]", "route.ts"),
]);

describe("Data Hub importBatch — exactly the four authorized H.3 routes import read.ts; nothing else imports any file in this tree (verified by static inspection)", () => {
  const candidateDirs = ["app", "components", "middleware.ts"];

  it("every app/**/components/** importer of lib/data-hub/importBatch/read is exactly the authorized H.3 route set", () => {
    const readImporters: string[] = [];
    for (const dir of candidateDirs) {
      const full = path.join(ROOT, dir);
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;
      const files = stat?.isDirectory() ? walk(full, [".ts", ".tsx"]) : stat?.isFile() ? [full] : [];
      for (const file of files) {
        const code = read(file);
        if (/from\s+["'][^"']*data-hub\/importBatch\/read["']/.test(code)) {
          readImporters.push(path.relative(ROOT, file));
        }
      }
    }
    expect(new Set(readImporters)).toEqual(AUTHORIZED_H3_ROUTE_IMPORTERS);
  });

  it("no app/**/components/** file imports any OTHER lib/data-hub/importBatch module (only read.ts may ever be imported, and only by the authorized route set above)", () => {
    const offenders: string[] = [];
    for (const dir of candidateDirs) {
      const full = path.join(ROOT, dir);
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;
      const files = stat?.isDirectory() ? walk(full, [".ts", ".tsx"]) : stat?.isFile() ? [full] : [];
      for (const file of files) {
        const code = read(file);
        if (
          /from\s+["'][^"']*data-hub\/importBatch[^"']*["']/.test(code) &&
          !/from\s+["'][^"']*data-hub\/importBatch\/read["']/.test(code)
        ) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
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
        // read.ts (5A.2H.2) — the dark tenant-safe worksheet/ImportBatch
        // read services (getImportBatch/listImportBatches/getWorksheet/
        // listWorksheetsForBatch). Still dark: no runtime caller exists
        // yet — same regex coverage above, this Set is again the only
        // edit this phase's darkness proof needs.
        "read.ts",
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
