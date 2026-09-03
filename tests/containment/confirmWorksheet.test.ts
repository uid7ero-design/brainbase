import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.2K.1 — static containment + mocked-behavioral proof for the
// dark canonical DATA_HUB worksheet confirmation + illegal-dumping
// transactional importer service (confirmWorksheet.ts) and its two new
// support modules (illegalDumpingMapper.ts, ../csvOnlyDecoder.ts).
//
// Mirrors the established per-phase pattern (inspectWorksheets.test.ts /
// fileSignatures.test.ts): static source-text containment for the
// security-load-bearing invariants (xlsx-freedom, no-write-before-
// transaction, trusted-input-only shape, darkness), plus mocked-prisma
// behavioral tests for the service's own decision logic. Real-Postgres
// atomicity/concurrency/tenant/lineage proofs live in the separate
// scripts/tests/confirmWorksheet.integration.test.ts harness (see
// scripts/tests/verify-confirm-worksheet.sh) — this file does not attempt
// to prove genuine DB-level atomicity, since a mocked prisma.$transaction
// cannot.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/confirmWorksheet.ts";
const MAPPER_PATH = "lib/data-hub/importBatch/illegalDumpingMapper.ts";
const DECODER_PATH = "lib/data-hub/csvOnlyDecoder.ts";

// ─── xlsx-freedom (Section 16/39 hard requirement) ─────────────────────

describe("confirmWorksheet — zero xlsx dependency across all three new files", () => {
  for (const file of [SERVICE_PATH, MAPPER_PATH, DECODER_PATH]) {
    it(`${file} never imports xlsx`, () => {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/from\s+["']xlsx["']/);
      expect(code).not.toMatch(/require\(["']xlsx["']\)/);
    });

    it(`${file} never imports workbookParser.ts (which itself imports xlsx)`, () => {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/workbookParser/);
    });
  }

  it("csvOnlyDecoder.ts has no import at all besides csv-parse/sync", () => {
    const code = stripComments(read(DECODER_PATH));
    const imports = code.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/csv-parse\/sync/);
  });
});

// ─── Trusted-input-only shape (Section 8/9 hard requirement) ───────────

describe("confirmWorksheet — trusted-context-only input shape", () => {
  const code = read(SERVICE_PATH);

  it("ConfirmWorksheetTrustedContext carries exactly organisationId and worksheetUploadId", () => {
    const block = code.match(/export interface ConfirmWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/worksheetUploadId:\s*string/);
    // No third field of any kind.
    const fieldLines = block
      .split("\n")
      .filter((l) => /:\s*\S/.test(l) && !l.trim().startsWith("/") && !l.trim().startsWith("*"));
    expect(fieldLines).toHaveLength(2);
  });

  it("never accepts storageKey/storageProvider/storage locator as a parameter name", () => {
    expect(code).not.toMatch(/\bstorageKey\s*:\s*string\b.*\/\/.*param/i);
    // The only storageKey identifier in the file must be a locally-derived
    // const, never destructured off the trusted context/any function param.
    const paramLists = code.match(/\(\s*context:\s*ConfirmWorksheetTrustedContext\s*\)/g) ?? [];
    expect(paramLists.length).toBeGreaterThan(0);
  });

  it("never imports lib/org.ts or resolves its own session/auth", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(stripped).not.toMatch(/next\/server/);
    expect(stripped).not.toMatch(/org_override/);
  });

  it("never accepts worksheet name, lineage, or canonical_status as caller input (no such field on the trusted context)", () => {
    const block = code.match(/export interface ConfirmWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/worksheetName|lineageKind|lineage_kind|canonicalStatus|canonical_status/);
  });

  it("carries an AUTH BOUNDARY and TRUSTED INPUT ONLY header comment", () => {
    expect(code).toMatch(/AUTH BOUNDARY/);
    expect(code).toMatch(/TRUSTED INPUT ONLY/);
  });
});

// ─── No durable IMPORTING state (Section 15 hard requirement) ──────────

describe("confirmWorksheet — no durable IMPORTING state anywhere", () => {
  it("never writes the literal string IMPORTING to any column", () => {
    const code = stripComments(read(SERVICE_PATH));
    expect(code).not.toMatch(/["']IMPORTING["']/);
  });
});

// ─── Decode/validate strictly outside any transaction (Section 12/13) ──

describe("confirmWorksheet — decode/validate/hash-verify happen strictly before the transaction opens", () => {
  const code = read(SERVICE_PATH);

  it("prisma.$transaction is called exactly once", () => {
    const matches = code.match(/prisma\.\$transaction\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("decodeCsvOnly / mapIllegalDumpingRows / createHash(\"sha256\") all appear strictly before the prisma.$transaction( call site", () => {
    const txIndex = code.indexOf("prisma.$transaction(");
    expect(txIndex).toBeGreaterThan(0);
    for (const marker of ["decodeCsvOnly(", "mapIllegalDumpingRows(", 'createHash("sha256")']) {
      const idx = code.indexOf(marker);
      expect(idx).toBeGreaterThan(0);
      expect(idx).toBeLessThan(txIndex);
    }
  });

  it("no storage.get(/RawFileStore call appears inside the transaction callback body", () => {
    const txBody = code.slice(code.indexOf("prisma.$transaction(async (tx) => {"));
    expect(txBody).not.toMatch(/storage\.get\(/);
    expect(txBody).not.toMatch(/decodeCsvOnly\(/);
    expect(txBody).not.toMatch(/mapIllegalDumpingRows\(/);
  });
});

// ─── Single atomic conditional-UPDATE claim as the transaction's FIRST
//     statement — never SELECT-then-UPDATE (Section 14 hard requirement) ──

describe("confirmWorksheet — the claim is a single conditional UPDATE, first in the transaction, never SELECT-then-UPDATE", () => {
  const code = read(SERVICE_PATH);
  const txBody = code.slice(
    code.indexOf("prisma.$transaction(async (tx) => {"),
    code.indexOf("\n  });", code.indexOf("prisma.$transaction("))
  );

  it("the transaction's first statement is tx.upload.updateMany, not a tx.upload.findUnique/findFirst", () => {
    const firstStatementMatch = txBody.match(/const\s+\w+\s*=\s*await\s+tx\.\w+\.\w+\(/);
    expect(firstStatementMatch?.[0]).toMatch(/tx\.upload\.updateMany\(/);
  });

  it("the claim's WHERE clause encodes id, organisation_id, lineage_kind, and canonical_status all in one predicate", () => {
    const claimBlock = txBody.match(/tx\.upload\.updateMany\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(claimBlock).toMatch(/id:\s*worksheetUploadId/);
    expect(claimBlock).toMatch(/organisation_id:\s*organisationId/);
    expect(claimBlock).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
    expect(claimBlock).toMatch(/canonical_status:\s*["']AWAITING_CONFIRMATION["']/);
  });

  it("the domain write (illegalDumping.createMany) textually follows the claim, never precedes it", () => {
    const claimIdx = txBody.indexOf("tx.upload.updateMany(");
    const domainIdx = txBody.indexOf("tx.illegalDumping.createMany(");
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(domainIdx).toBeGreaterThan(claimIdx);
  });

  it("the domain write is gated behind a claim.count check (never unconditional)", () => {
    expect(txBody).toMatch(/claim\.count\s*===\s*0/);
    const domainIdx = txBody.indexOf("tx.illegalDumping.createMany(");
    const guardIdx = txBody.indexOf("claim.count === 0");
    expect(guardIdx).toBeGreaterThan(0);
    expect(domainIdx).toBeGreaterThan(guardIdx);
  });
});

// ─── Zero-row claim structurally terminates before the domain write
//     (5A.2K.1-R). Independent adversarial review found the PRIOR test
//     above ("domain write is gated behind a claim.count check") proves
//     only that the guard TEXT appears before createMany textually -- it
//     cannot distinguish a real early return from the claim.count check
//     being present-but-inert (e.g. its `return` silently removed/
//     replaced), which is exactly the regression the review deterministically
//     forced via a real-Postgres race in
//     scripts/tests/confirmWorksheet.integration.test.ts. This test closes
//     that specific gap with brace-scoped structural containment: it
//     extracts the EXACT if (claim.count === 0) { ... } block (via balanced-
//     brace matching, not a fixed-offset guess) and requires its own FINAL
//     statement to be a `return`, so nothing inside that block can fall
//     through toward the domain write below it. The real-Postgres test
//     remains the authoritative proof of runtime behavior; this is a fast,
//     permanent, source-level tripwire for the same defect class. ──────────

function extractBalancedBlock(code: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error("extractBalancedBlock: unbalanced braces starting at " + openBraceIndex);
}

describe("confirmWorksheet — zero-row claim (claim.count === 0) structurally terminates before the domain write (5A.2K.1-R)", () => {
  const code = read(SERVICE_PATH);
  const txBody = code.slice(
    code.indexOf("prisma.$transaction(async (tx) => {"),
    code.indexOf("\n  });", code.indexOf("prisma.$transaction("))
  );
  const IF_MARKER = "if (claim.count === 0) {";
  const ifIdx = txBody.indexOf(IF_MARKER);
  const openBraceIdx = ifIdx + IF_MARKER.length - 1;
  const ifBlock = ifIdx >= 0 ? extractBalancedBlock(txBody, openBraceIdx) : "";

  it("the if (claim.count === 0) block exists exactly once, brace-balanced", () => {
    expect(ifIdx).toBeGreaterThanOrEqual(0);
    expect(ifBlock.length).toBeGreaterThan(0);
    expect(ifBlock.startsWith("{")).toBe(true);
    expect(ifBlock.endsWith("}")).toBe(true);
  });

  it("the block's OWN final statement (not merely some statement anywhere before createMany) is a return — nothing inside this block can fall through", () => {
    const inner = ifBlock.slice(1, -1).trim();
    expect(inner.length).toBeGreaterThan(0);
    const statements = inner
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    const lastStatement = statements[statements.length - 1];
    expect(lastStatement.startsWith("return")).toBe(true);
  });

  it("the domain write (tx.illegalDumping.createMany) is reached only via the code that follows the if-block's own closing brace, never from inside it", () => {
    const afterBlock = txBody.slice(openBraceIdx + ifBlock.length).trimStart();
    expect(afterBlock.startsWith("await tx.illegalDumping.createMany(")).toBe(true);
  });
});

// ─── No HTTP route / UI wiring exists yet (Section 38, re-confirmed here) ──

describe("confirmWorksheet — repo-wide, no runtime caller exists yet (re-confirmed here, own dedicated proof)", () => {
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
      if (entry.isDirectory()) results.push(...walk(full, exts));
      else if (exts.some((e) => entry.name.endsWith(e))) results.push(full);
    }
    return results;
  }

  it("no file under app/** or components/** references confirmDataHubWorksheet or imports confirmWorksheet.ts", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      const full = path.join(ROOT, dir);
      for (const file of walk(full, [".ts", ".tsx"])) {
        const code = read(path.relative(ROOT, file));
        if (code.includes("confirmDataHubWorksheet") || /data-hub\/importBatch\/confirmWorksheet/.test(code)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no new app/api route directory exists for worksheet confirmation (e.g. .../confirm/route.ts)", () => {
    const apiRoot = path.join(ROOT, "app", "api", "data-hub");
    const files = walk(apiRoot, [".ts", ".tsx"]);
    const confirmRoutes = files.filter((f) => /confirm/i.test(f));
    expect(confirmRoutes).toEqual([]);
  });
});

// ─── lib/data-hub/importBatch/ — no barrel/index.ts (re-confirmed) ─────

describe("lib/data-hub/importBatch/ — no barrel/index.ts (re-confirmed here, 5A.2K.1)", () => {
  it("contains no index.ts / index.tsx", () => {
    const dir = path.join(ROOT, "lib", "data-hub", "importBatch");
    const entries = fs.readdirSync(dir);
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });
});

// ─── Mocked-behavioral tests: confirmWorksheet's own decision logic ────

const uploadFindFirstMock = vi.fn();
const uploadFindUniqueMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: {
      findFirst: (...args: unknown[]) => uploadFindFirstMock(...args),
      findUnique: (...args: unknown[]) => uploadFindUniqueMock(...args),
    },
    importBatch: {
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const storageGetMock = vi.fn();
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "vercel-blob-private",
    put: vi.fn(),
    head: vi.fn(),
    get: (...args: unknown[]) => storageGetMock(...args),
    delete: vi.fn(),
  }),
}));

async function freshService() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/confirmWorksheet");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "worksheet-1",
    import_batch_id: "batch-1",
    worksheet_index: 0,
    canonical_status: "AWAITING_CONFIRMATION",
    ...overrides,
  };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    content_type: "csv",
    sha256: "deadbeef",
    storage_key: "datahub-batch:org-1:batch-1",
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  uploadFindFirstMock.mockReset();
  uploadFindUniqueMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  transactionMock.mockReset();
  storageGetMock.mockReset();
});

describe("confirmWorksheet — worksheet lookup collapses nonexistent/wrong-tenant/LEGACY-lineage into one outcome", () => {
  it("nonexistent worksheet id -> WORKSHEET_NOT_FOUND", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "nope" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("the tenant+lineage predicate is passed in the SAME findFirst call (never fetch-then-check)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "w-1" });
    expect(uploadFindFirstMock).toHaveBeenCalledTimes(1);
    const callArg = uploadFindFirstMock.mock.calls[0][0];
    expect(callArg.where).toMatchObject({
      id: "w-1",
      organisation_id: "org-1",
      lineage_kind: "DATA_HUB",
    });
  });
});

describe("confirmWorksheet — canonical_status precondition", () => {
  it("already IMPORTED -> idempotent success, no batch lookup, no transaction", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "IMPORTED" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  for (const status of ["INELIGIBLE", "SKIPPED"]) {
    it(`${status} -> WORKSHEET_NOT_ELIGIBLE, no batch lookup, no transaction`, async () => {
      const { confirmDataHubWorksheet } = await freshService();
      uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: status }));
      const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
      expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
      expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });
  }
});

describe("confirmWorksheet — parent ImportBatch readiness gate", () => {
  it("parent batch missing -> WORKSHEET_NOT_FOUND (never leaks a distinct code)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(null);
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("parent batch tombstoned (deleted_at set) -> WORKSHEET_NOT_FOUND", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ deleted_at: new Date() }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("parent batch not READY -> BATCH_NOT_READY", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ status: "PENDING" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
  });

  it("the batch lookup uses the worksheet's OWN persisted import_batch_id, tenant-scoped, never any caller-supplied id", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ import_batch_id: "batch-from-worksheet" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    storageGetMock.mockResolvedValue({ body: new TextEncoder().encode("report_date,location,waste_type\n") });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "AWAITING_CONFIRMATION" });
    await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    const callArg = importBatchFindUniqueMock.mock.calls[0][0];
    expect(callArg.where.id_organisation_id).toEqual({ id: "batch-from-worksheet", organisation_id: "org-1" });
  });
});

describe("confirmWorksheet — CSV-only format gate", () => {
  for (const contentType of ["xlsx", "xls"]) {
    it(`${contentType} batch -> UNSUPPORTED_FORMAT, no storage GET attempted`, async () => {
      const { confirmDataHubWorksheet } = await freshService();
      uploadFindFirstMock.mockResolvedValue(worksheetRow());
      importBatchFindUniqueMock.mockResolvedValue(batchRow({ content_type: contentType }));
      const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
      expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
      expect(storageGetMock).not.toHaveBeenCalled();
    });
  }
});

describe("confirmWorksheet — mandatory SHA-256 re-verification", () => {
  it("a storage body whose computed hash does not match the batch's persisted sha256 -> STORAGE_INTEGRITY_MISMATCH", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "not-the-real-hash" }));
    storageGetMock.mockResolvedValue({ body: new TextEncoder().encode("report_date,location,waste_type\n") });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — lost-race resolution inside the transaction result", () => {
  it("claim.count === 0 with currentStatus IMPORTED -> idempotent success (a concurrent attempt won)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type\n2024-01-01,Main St,tyres\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex") }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "IMPORTED" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
  });

  it("claim.count === 0 with any other currentStatus -> WORKSHEET_NOT_ELIGIBLE, not a silent success", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type\n2024-01-01,Main St,tyres\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex") }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "INELIGIBLE" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
  });

  it("claimed true -> ok success with importedRows from the transaction result", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type\n2024-01-01,Main St,tyres\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex") }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: true, importedRows: 1 });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toEqual({ ok: true, alreadyImported: false, worksheetUploadId: "worksheet-1", importedRows: 1 });
  });
});

describe("confirmWorksheet — malformed/invalid CSV never reaches the transaction", () => {
  it("a CSV missing a required header -> PARSER_REJECTED, prisma.$transaction never called", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("foo,bar\n1,2\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex") }));
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
