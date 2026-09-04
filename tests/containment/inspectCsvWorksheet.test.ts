import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2K.2 — static containment proof for the new xlsx-free,
// CSV-only worksheet inspection service (inspectCsvWorksheet.ts).
// Mirrors the established per-phase pattern (confirmWorksheet.test.ts /
// inspectWorksheets.test.ts): static source-text containment for the
// security-load-bearing invariants (xlsx-freedom, trusted-input-only
// shape, format-gate-before-storage-access ordering). Real-Postgres
// existing-set/idempotency/conflict proofs live in the separate
// scripts/tests/inspectCsvWorksheet.integration.test.ts harness.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/inspectCsvWorksheet.ts";

// ─── xlsx-freedom (hard requirement — see this module's own header comment) ───

describe("inspectCsvWorksheet — zero xlsx/workbookParser/inspectWorksheets dependency, direct or transitive", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never imports xlsx", () => {
    expect(code).not.toMatch(/from\s+["']xlsx["']/);
    expect(code).not.toMatch(/require\(["']xlsx["']\)/);
  });

  it("never imports workbookParser.ts (which itself imports xlsx)", () => {
    expect(code).not.toMatch(/workbookParser/);
  });

  it("never imports inspectWorksheets.ts (which itself imports workbookParser.ts)", () => {
    expect(code).not.toMatch(/from\s+["'][^"']*importBatch\/inspectWorksheets["']/);
    expect(code).not.toMatch(/\binspectWorksheets\(/);
  });

  it("never references inspectWorkbook or decodeWorksheet (workbookParser.ts's own xlsx-reachable exports)", () => {
    expect(code).not.toMatch(/\binspectWorkbook\b/);
    expect(code).not.toMatch(/\bdecodeWorksheet\(/);
  });

  it("imports decodeCsvOnly from the existing, already-xlsx-free csvOnlyDecoder.ts rather than duplicating a CSV parser call", () => {
    expect(code).toMatch(/from\s+["']\.\.\/csvOnlyDecoder["']/);
    expect(code).toMatch(/decodeCsvOnly/);
  });

  it("every import in the file resolves to a known xlsx-free module (allowlist)", () => {
    const imports = code.match(/^import\s.+$/gm) ?? [];
    const allowedPatterns = [
      /node:crypto/,
      /@prisma\/client/,
      /\.\.\/\.\.\/prisma["']/,
      /\.\.\/storage\/rawFileStore["']/,
      /\.\/compositionRoot["']/,
      /\.\.\/limits["']/,
      /\.\.\/csvOnlyDecoder["']/,
      /\.\/failureTaxonomy["']/,
    ];
    for (const imp of imports) {
      expect(allowedPatterns.some((p) => p.test(imp))).toBe(true);
    }
  });
});

// ─── Trusted-input-only shape ───────────────────────────────────────────

describe("inspectCsvWorksheet — trusted-context-only input shape", () => {
  const code = read(SERVICE_PATH);

  it("InspectCsvWorksheetTrustedContext carries exactly organisationId and importBatchId", () => {
    const block = code.match(/export interface InspectCsvWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/importBatchId:\s*string/);
    const fieldLines = block
      .split("\n")
      .filter((l) => /:\s*\S/.test(l) && !l.trim().startsWith("/") && !l.trim().startsWith("*"));
    expect(fieldLines).toHaveLength(2);
  });

  it("never imports lib/org.ts or resolves its own session/auth", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(stripped).not.toMatch(/next\/server/);
    expect(stripped).not.toMatch(/org_override/);
  });

  it("never accepts a caller-suppliable storage locator, format, or worksheet identity as a parameter", () => {
    const stripped = stripComments(code);
    const paramLists = stripped.match(/\(\s*context:\s*InspectCsvWorksheetTrustedContext\s*\)/g) ?? [];
    expect(paramLists.length).toBeGreaterThan(0);
    // The exported function's ONLY parameter is the trusted context —
    // no second parameter of any kind exists anywhere in the file.
    const exportedFnMatch = stripped.match(/export async function inspectCsvWorksheet\(([^)]*)\)/);
    expect(exportedFnMatch).not.toBeNull();
    expect(exportedFnMatch![1].split(",").length).toBe(1);
  });
});

// ─── Format-gate-before-storage-access ordering (Section 12/13 hard requirement) ───

describe("inspectCsvWorksheet — CSV format gate occurs before any storage access", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("the UNSUPPORTED_FORMAT check appears before the first storage.get() call in source order", () => {
    const formatGateIdx = code.indexOf('fail("UNSUPPORTED_FORMAT")');
    const storageGetIdx = code.indexOf("storage.get(");
    expect(formatGateIdx).toBeGreaterThan(-1);
    expect(storageGetIdx).toBeGreaterThan(-1);
    expect(formatGateIdx).toBeLessThan(storageGetIdx);
  });

  it("the format check reads only the persisted batch.content_type, never a caller-supplied field", () => {
    expect(code).toMatch(/batch\.content_type\s*!==\s*["']csv["']/);
  });
});

// ─── Storage authority + SHA verification ordering ──────────────────────

describe("inspectCsvWorksheet — storage authority and integrity ordering", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("derives the storage key exclusively via buildImportBatchKey(organisationId, importBatchId) — never a caller-provided path", () => {
    expect(code).toMatch(/buildImportBatchKey\(\s*organisationId,\s*importBatchId\s*\)/);
  });

  it("recomputes SHA-256 and compares against the batch's own persisted sha256 (never expected_sha256, never trusting an earlier inspection)", () => {
    expect(code).toMatch(/createHash\(["']sha256["']\)/);
    expect(code).toMatch(/computedSha256\s*!==\s*batch\.sha256/);
  });

  it("SHA verification occurs before CSV decode in source order", () => {
    const shaIdx = code.indexOf("STORAGE_INTEGRITY_MISMATCH");
    const decodeIdx = code.indexOf("decodeCsvOnly(");
    expect(shaIdx).toBeGreaterThan(-1);
    expect(decodeIdx).toBeGreaterThan(-1);
    expect(shaIdx).toBeLessThan(decodeIdx);
  });
});

// ─── Existing-set persistence policy (Case A-E) ─────────────────────────

describe("inspectCsvWorksheet — existing-set Case A-E idempotency/conflict policy present", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("compares existing.length against expected.length as the first conflict check", () => {
    expect(code).toMatch(/existing\.length\s*!==\s*expected\.length/);
  });

  it("never overwrites/tops-up an existing DATA_HUB row — every non-MATCH branch returns PERSISTENCE_CONFLICT, never a Prisma update/upsert", () => {
    expect(code).not.toMatch(/prisma\.upload\.update\(/);
    expect(code).not.toMatch(/prisma\.upload\.upsert\(/);
    expect(code).not.toMatch(/prisma\.upload\.updateMany\(/);
  });

  it("first-time persistence uses a single atomic createMany, without skipDuplicates (so a genuine race throws rather than being silently absorbed)", () => {
    expect(code).toMatch(/prisma\.upload\.createMany\(\{\s*data\s*\}\)/);
    expect(code).not.toMatch(/skipDuplicates/);
  });

  // MANDATORY LOAD-BEARING: closes a genuine coverage gap found during
  // this phase's own falsification pass (mutation M15). Structurally, a
  // CSV batch can only ever have zero or exactly one existing DATA_HUB
  // row (worksheet_index is always 0), so the real Postgres unique index
  // on (import_batch_id, worksheet_index) already defends against an
  // actual duplicate ROW even if this app-level gate were entirely
  // removed (persistFirstTime's own P2002 recovery re-classifies
  // correctly) — but nothing else proves the gate exists at all, and a
  // future change to the recovery path could silently remove that
  // safety net too. This is the source-level tripwire for that specific
  // condition, independent of the real-Postgres defense-in-depth.
  it("the call to persistFirstTime (Case A) is gated by existing.length === 0 — the invocation exists ONLY inside that specific conditional, never unconditionally", () => {
    const callIdx = code.indexOf("return persistFirstTime(");
    expect(callIdx).toBeGreaterThan(-1);
    const preceding = code.slice(Math.max(0, callIdx - 200), callIdx);
    const guardIdx = preceding.lastIndexOf("if (");
    expect(guardIdx).toBeGreaterThan(-1);
    const guardCondition = preceding.slice(guardIdx, preceding.length);
    expect(guardCondition).toMatch(/existing\.length\s*===\s*0/);
    // Also assert the call is NOT reachable from an always-true condition
    // by construction — the guard text itself must not contain a bare
    // `true` literal in place of the real comparison.
    expect(guardCondition).not.toMatch(/if\s*\(\s*true\s*\)/);
  });
});

// ─── No write transaction wraps storage/parse I/O ───────────────────────

describe("inspectCsvWorksheet — no storage/parse I/O inside a database write transaction", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never calls prisma.$transaction (persistence is a single createMany, or a plain read — never a multi-statement transaction)", () => {
    expect(code).not.toMatch(/\$transaction/);
  });
});

// ─── No durable failure/processing state, no ImportBatch write ─────────

describe("inspectCsvWorksheet — never writes to ImportBatch's own columns", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never calls prisma.importBatch.update/upsert (read-only against ImportBatch)", () => {
    expect(code).not.toMatch(/prisma\.importBatch\.(update|upsert|updateMany)\(/);
  });
});
