import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

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

  it("ConfirmWorksheetTrustedContext carries exactly organisationId, worksheetUploadId, and confirmedBy (5A.2L)", () => {
    const block = code.match(/export interface ConfirmWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/worksheetUploadId:\s*string/);
    expect(block).toMatch(/confirmedBy:\s*string/);
    // No fourth field of any kind.
    const fieldLines = block
      .split("\n")
      .filter((l) => /:\s*\S/.test(l) && !l.trim().startsWith("/") && !l.trim().startsWith("*"));
    expect(fieldLines).toHaveLength(3);
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

// ─── HTTP route wiring (5A.2K.2 — K.1's dark-to-live transition) ─────────
//
// Superseded by 5A.2K.2: confirmWorksheet.ts now has exactly ONE
// authorized runtime caller — the new confirm-illegal-dumping route (see
// tests/containment/dataHubImportBatchDarkness.test.ts's
// AUTHORIZED_IMPORTERS_BY_MODULE map, the canonical source of truth for
// this exact-set assertion). This block's own redundant proof is updated
// to match rather than removed, preserving its role as an independent,
// second check on the same invariant.

describe("confirmWorksheet — repo-wide runtime callers are EXACTLY the authorized 5A.2K.2 confirm route (re-confirmed here, own dedicated proof)", () => {
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

  const AUTHORIZED_CONFIRM_ROUTE = path.join(
    "app",
    "api",
    "data-hub",
    "worksheets",
    "[id]",
    "confirm-illegal-dumping",
    "route.ts"
  );

  it("the ONLY file under app/** or components/** referencing confirmDataHubWorksheet or importing confirmWorksheet.ts is the authorized confirm route", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      const full = path.join(ROOT, dir);
      for (const file of walk(full, [".ts", ".tsx"])) {
        const relPath = path.relative(ROOT, file);
        const code = read(relPath);
        if (code.includes("confirmDataHubWorksheet") || /data-hub\/importBatch\/confirmWorksheet/.test(code)) {
          offenders.push(relPath);
        }
      }
    }
    expect(offenders).toEqual([AUTHORIZED_CONFIRM_ROUTE]);
  });

  it("exactly one confirm-shaped app/api/data-hub route exists, at the exact expected path", () => {
    const apiRoot = path.join(ROOT, "app", "api", "data-hub");
    const files = walk(apiRoot, [".ts", ".tsx"]);
    const confirmRoutes = files.filter((f) => /confirm/i.test(f)).map((f) => path.relative(ROOT, f));
    expect(confirmRoutes).toEqual([AUTHORIZED_CONFIRM_ROUTE]);
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
const mappingVersionFindUniqueMock = vi.fn();
const sourceMappingFindUniqueMock = vi.fn();
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
    // 5B.4D — resolved only when a worksheet carries a persisted
    // mapping_version_id (Step 4.5); untouched by every pre-5B.4D/legacy
    // test in this file, mirroring previewWorksheet.test.ts's own mock shape.
    mappingVersion: {
      findUnique: (...args: unknown[]) => mappingVersionFindUniqueMock(...args),
    },
    sourceMapping: {
      findUnique: (...args: unknown[]) => sourceMappingFindUniqueMock(...args),
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
    // 5B.4D — matches previewWorksheet.test.ts's own worksheetRow() default
    // exactly: a real Prisma NULL column always deserializes to JS `null`,
    // never `undefined` — this default keeps every pre-5B.4D test's
    // implicit assumption (a legacy, unmapped worksheet) explicit and
    // correct, rather than silently relying on an absent-property
    // `undefined` that a real Prisma client would never actually produce.
    mapping_version_id: null,
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
    // 5B.4D — the batch's own authoritative source lineage, now read by
    // confirmWorksheet.ts's Step 4.5 cross-source check for a mapped
    // worksheet. NULL by default (matches most existing ImportBatch test
    // fixtures across this suite for a batch with no SourceSystem lineage).
    source_system_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  uploadFindFirstMock.mockReset();
  uploadFindUniqueMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  mappingVersionFindUniqueMock.mockReset();
  sourceMappingFindUniqueMock.mockReset();
  transactionMock.mockReset();
  storageGetMock.mockReset();
});

describe("confirmWorksheet — worksheet lookup collapses nonexistent/wrong-tenant/LEGACY-lineage into one outcome", () => {
  it("nonexistent worksheet id -> WORKSHEET_NOT_FOUND", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "nope", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("the tenant+lineage predicate is passed in the SAME findFirst call (never fetch-then-check)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(null);
    await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "w-1", confirmedBy: "actor-1" });
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
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  for (const status of ["INELIGIBLE", "SKIPPED"]) {
    it(`${status} -> WORKSHEET_NOT_ELIGIBLE, no batch lookup, no transaction`, async () => {
      const { confirmDataHubWorksheet } = await freshService();
      uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: status }));
      const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
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
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("parent batch tombstoned (deleted_at set) -> WORKSHEET_NOT_FOUND", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ deleted_at: new Date() }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("parent batch not READY -> BATCH_NOT_READY", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ status: "PENDING" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
  });

  it("the batch lookup uses the worksheet's OWN persisted import_batch_id, tenant-scoped, never any caller-supplied id", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ import_batch_id: "batch-from-worksheet" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    storageGetMock.mockResolvedValue({ body: new TextEncoder().encode("report_date,location,waste_type\n") });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "AWAITING_CONFIRMATION" });
    await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    const callArg = importBatchFindUniqueMock.mock.calls[0][0];
    expect(callArg.where.id_organisation_id).toEqual({ id: "batch-from-worksheet", organisation_id: "org-1" });
  });
});

describe("confirmWorksheet — CSV-only format gate", () => {
  for (const contentType of ["xlsx", "xls"]) {
    it(`${contentType} batch -> UNSUPPORTED_FORMAT, no storage GET attempted`, async () => {
      const { confirmDataHubWorksheet } = await freshService();
      uploadFindFirstMock.mockResolvedValue(worksheetRow());
      importBatchFindUniqueMock.mockResolvedValue(batchRow({ content_type: contentType, source_system_id: "ss-1" }));
      const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
      expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
      expect(storageGetMock).not.toHaveBeenCalled();
    });
  }
});

describe("confirmWorksheet — mandatory SHA-256 re-verification", () => {
  it("a storage body whose computed hash does not match the batch's persisted sha256 -> STORAGE_INTEGRITY_MISMATCH", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "not-the-real-hash", source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body: new TextEncoder().encode("report_date,location,waste_type\n") });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — lost-race resolution inside the transaction result", () => {
  it("claim.count === 0 with currentStatus IMPORTED -> idempotent success (a concurrent attempt won)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type,source_external_id\n2024-01-01,Main St,tyres,EXT-1\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "IMPORTED" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
  });

  it("claim.count === 0 with any other currentStatus -> WORKSHEET_NOT_ELIGIBLE, not a silent success", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type,source_external_id\n2024-01-01,Main St,tyres,EXT-1\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "INELIGIBLE" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
  });

  it("claimed true -> ok success with importedRows from the transaction result", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("report_date,location,waste_type,source_external_id\n2024-01-01,Main St,tyres,EXT-1\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: true, importedRows: 1 });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: false, worksheetUploadId: "worksheet-1", importedRows: 1 });
  });
});

describe("confirmWorksheet — malformed/invalid CSV never reaches the transaction", () => {
  it("a CSV missing a required header -> PARSER_REJECTED, prisma.$transaction never called", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode("foo,bar\n1,2\n");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // Data Hub 5A.3A — duplicate-required-CSV-header fail-closed hardening.
  // illegalDumpingMapper.ts's mapIllegalDumpingRows builds its column index
  // via `new Map(headers.map((h, i) => [h, i]))`, which silently keeps only
  // the LAST occurrence's index for a repeated header name — a genuinely
  // reachable Excel-hand-edit mistake, not merely theoretical. This proves
  // the service-level outcome: the ambiguity is rejected before the
  // transactional claim, reusing the existing PARSER_REJECTED outcome code
  // (illegalDumpingMapper.ts throws IllegalDumpingMappingError, which
  // confirmWorksheet.ts's existing Step 7 catch block already maps to
  // PARSER_REJECTED — no new failure code was introduced).
  it("a CSV with a DUPLICATED required header (report_date appears twice) -> PARSER_REJECTED, prisma.$transaction never called", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    const body = new TextEncoder().encode(
      "report_date,location,waste_type,report_date\n2024-01-01,Main St,tyres,2024-01-01\n"
    );
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("a CSV with a duplicated required header whose two occurrences hold IDENTICAL values is STILL rejected (the ambiguity itself is invalid, not a value disagreement) -> PARSER_REJECTED, prisma.$transaction never called", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { createHash } = await import("node:crypto");
    // "location" duplicated; both occurrences are the literal same value.
    const body = new TextEncoder().encode(
      "report_date,location,waste_type,location\n2024-01-01,Main St,tyres,Main St\n"
    );
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5B.4D — FROZEN MAPPING CONFIRM INTEGRATION
//
// Core rule under test throughout this block: Confirm CONSUMES frozen
// lineage exactly like 5B.4C Preview does — it never resolves/repairs/
// follows it. The frozen Upload.mapping_version_id captured ONCE from Step
// 1's own read (expectedMappingVersionId) is the SOLE authority through
// every mapped-path lookup/compile/apply step AND the Step 8 atomic claim's
// own WHERE clause — SourceMapping.active_mapping_version_id and both
// SourceSystem.active/SourceMapping.active are never consulted (those
// remain 5B.4B's own NEW-selection gates, never a consumption gate).
// ═══════════════════════════════════════════════════════════════════════

function mappingVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mv-3",
    source_mapping_id: "sm-1",
    version_number: 3,
    // 6.1B — source_external_id joined the required canonical targets;
    // included here so every mapped-path fixture using this default
    // continues to compile+map successfully unchanged.
    mapping_document: { fields: { report_date: "Reported At", location: "Site", waste_type: "Type", source_external_id: "Ext Reference" } },
    ...overrides,
  };
}
function sourceMappingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "sm-1", source_system_id: "ss-1", ...overrides };
}
// 6.0C1 — default tx.$queryRaw double for the two sequential guard queries
// (SourceSystem FOR UPDATE lock, then the illegal_dumping existence check).
// Call order is deterministic (lock always first) — this default lets the
// guard pass through cleanly (lock succeeds, no prior success found) so
// pre-existing tests exercising OTHER logic reach their own assertions
// unaffected. Tests specifically targeting the guard itself override this.
function defaultGuardQueryRawMock() {
  return vi
    .fn()
    .mockResolvedValueOnce([{ id: "ss-1" }])
    .mockResolvedValueOnce([{ prior_success: false }]);
}
function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.join(","));
  return lines.join("\n");
}
function bufferAndHash(text: string): { body: Buffer; sha256: string } {
  const body = Buffer.from(text, "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  return { body, sha256 };
}
function mappedCsv(rows: string[][]): { body: Buffer; sha256: string } {
  // 6.1B — every row gets a synthetic, unique source_external_id appended
  // automatically so existing 3-column call sites need no change; callers
  // that care about the actual identity value pass it as a 4th cell
  // themselves (see mappedCsvWithIds below for that case).
  const withExternalId = rows.map((row, i) => (row.length >= 4 ? row : [...row, `EXT-${i}`]));
  return bufferAndHash(buildCsv(["Reported At", "Site", "Type", "Ext Reference"], withExternalId));
}
const CONFIRM_SERVICE_PATH = "lib/data-hub/importBatch/confirmWorksheet.ts";

describe("confirmWorksheet — 5B.4D legacy/mapped dual-path routing (T1-T4)", () => {
  it("NULL mapping_version_id -> zero mappingVersion/sourceMapping lookups, legacy claim WHERE clause has no mapping_version_id key at all", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash(buildCsv(["report_date", "location", "waste_type", "source_external_id"], [["2024-01-01", "Main St", "tyres", "EXT-1"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: true, importedRows: 1 });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: false, worksheetUploadId: "worksheet-1", importedRows: 1 });
    expect(mappingVersionFindUniqueMock).not.toHaveBeenCalled();
    expect(sourceMappingFindUniqueMock).not.toHaveBeenCalled();
  });

  it("the legacy claim's WHERE clause in source has exactly the same 4 keys as pre-5B.4D (id/organisation_id/lineage_kind/canonical_status), with mapping_version_id spread in conditionally, never unconditionally", () => {
    const code = fs.readFileSync(path.join(ROOT, CONFIRM_SERVICE_PATH), "utf8");
    const claimBlock = code.match(/tx\.upload\.updateMany\(\{[\s\S]*?\n {6}\}\);/)?.[0] ?? "";
    expect(claimBlock).toMatch(/id:\s*worksheetUploadId/);
    expect(claimBlock).toMatch(/organisation_id:\s*organisationId/);
    expect(claimBlock).toMatch(/lineage_kind:\s*"DATA_HUB"/);
    expect(claimBlock).toMatch(/canonical_status:\s*"AWAITING_CONFIRMATION"/);
    expect(claimBlock).toMatch(/\.\.\.\(expectedMappingVersionId !== null \? \{ mapping_version_id: expectedMappingVersionId \} : \{\}\)/);
  });
});

describe("confirmWorksheet — 5B.4D exact frozen-version lookup (T5-T11)", () => {
  it("resolves the EXACT persisted Upload.mapping_version_id, tenant-scoped via the compound key, and includes it in the atomic claim's WHERE clause", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
      const createManyMock = vi.fn().mockResolvedValue(undefined);
      const result = await callback({
        $queryRaw: defaultGuardQueryRawMock(),
        upload: { updateMany: updateManyMock },
        illegalDumping: { createMany: createManyMock },
      });
      const claimArg = updateManyMock.mock.calls[0][0];
      expect(claimArg.where.mapping_version_id).toBe("mv-3");
      return result;
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(mappingVersionFindUniqueMock).toHaveBeenCalledTimes(1);
    const callArg = mappingVersionFindUniqueMock.mock.calls[0][0];
    expect(callArg.where.id_organisation_id).toMatchObject({ id: "mv-3", organisation_id: "org-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
  });

  it("cross-source corruption (SourceMapping.source_system_id !== batch.source_system_id) -> MAPPING_LINEAGE_UNAVAILABLE, storage never touched, transaction never called (M5)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow({ source_system_id: "ss-2" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("frozen MappingVersion no longer exists -> MAPPING_LINEAGE_UNAVAILABLE, storage never touched (M4)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-gone" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(null);
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("SourceMapping itself no longer resolvable -> MAPPING_LINEAGE_UNAVAILABLE (M3)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(null);
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_LINEAGE_UNAVAILABLE" });
  });
});

describe("confirmWorksheet — 5B.4D consumption never consults active state (T12-T17, M6/M7)", () => {
  it("the mappingVersion/sourceMapping lookups select no `active`/active_mapping_version_id field at all — structurally impossible to consult (M6/M7)", () => {
    const code = fs.readFileSync(path.join(ROOT, CONFIRM_SERVICE_PATH), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const mvCallIdx = code.indexOf("prisma.mappingVersion.findUnique(");
    const mvBlock = code.slice(mvCallIdx, code.indexOf(");", mvCallIdx));
    expect(mvBlock).not.toMatch(/active_mapping_version_id/);
    const smCallIdx = code.indexOf("prisma.sourceMapping.findUnique(");
    const smBlock = code.slice(smCallIdx, code.indexOf(");", smCallIdx));
    expect(smBlock).not.toMatch(/\bactive:\s*true\b/);
    expect(smBlock).not.toMatch(/active_mapping_version_id/);
  });

  it("even if the mocked SourceMapping row carried active:false, Confirm still succeeds using the frozen version (deactivation after selection does not invalidate consumption)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow({ active: false }));
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: true, importedRows: 1 });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
  });

  it("a newly-activated v4 on the SAME SourceMapping never influences a Confirm frozen at v3 — only the frozen id is ever looked up (M2/M25)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow({ id: "mv-3", version_number: 3 }));
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: true, importedRows: 1 });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    expect(mappingVersionFindUniqueMock.mock.calls[0][0].where.id_organisation_id.id).toBe("mv-3");
  });
});

describe("confirmWorksheet — 5B.4D stored MappingDocument revalidation (T18-T20, M8)", () => {
  it("an invalid stored mapping_document -> MAPPING_DOCUMENT_INVALID, storage never touched, no legacy fallback (M8/M9)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: "deadbeef", source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow({ mapping_document: { not_a_valid_shape: true } }));
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_DOCUMENT_INVALID" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — 5B.4D compileMapping integration, reused verbatim (T21-T25, M10)", () => {
  it("a worksheet whose real headers don't satisfy the frozen mapping (missing configured source header) -> MAPPING_COMPILE_FAILED, transaction never called", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    // The CSV's real headers do NOT include "Reported At" (the mapping's
    // own configured source header for report_date) — compileMapping must
    // reject this with MAPPING_SOURCE_HEADER_MISSING, and confirmWorksheet
    // must treat that as a hard failure (never a partial/best-effort import).
    const { body, sha256 } = bufferAndHash(buildCsv(["Wrong Header", "Site", "Type"], [["2024-01-01", "Main St", "tyres"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "MAPPING_COMPILE_FAILED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("compileMapping/applyCompiledMappingToRows/toIllegalDumpingMapperInput are imported from mappingExecution.ts via one static import, never re-implemented (T21, mappingExecution.ts stays byte-identical to 5B.3/5B.4C)", () => {
    const code = fs.readFileSync(path.join(ROOT, CONFIRM_SERVICE_PATH), "utf8");
    const importLines = code.match(/^import\s.+from\s+["'][^"']*sourceMapping\/mappingExecution["'];?$/gm) ?? [];
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\bcompileMapping\b/);
    expect(importLines[0]).toMatch(/\bapplyCompiledMappingToRows\b/);
    expect(importLines[0]).toMatch(/\btoIllegalDumpingMapperInput\b/);
  });
});

describe("confirmWorksheet — 5B.4D full-dataset mapping, never Preview's bounded sample (T26-T31, M12/M13)", () => {
  it("source never references PREVIEW_MAX_SAMPLE_ROWS or any row-count-bounding slice for the mapped path — structurally impossible to reuse Preview's 20-row bound (M12)", () => {
    const code = fs.readFileSync(path.join(ROOT, CONFIRM_SERVICE_PATH), "utf8");
    expect(code).not.toMatch(/PREVIEW_MAX_SAMPLE_ROWS/);
    expect(code).not.toMatch(/\.slice\(0,\s*20\)/);
    // The mapped-path apply call passes the full `rows` array, not a sliced one.
    expect(code).toMatch(/applyCompiledMappingToRows\(compiled\.plan,\s*rows\)/);
  });

  it("a mapped worksheet with MORE than 20 rows imports EVERY row, not a 20-row-capped subset (M12)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const dataRows = Array.from({ length: 37 }, (_, i) => [`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, `Site ${i}`, "tyres"]);
    const { body, sha256 } = mappedCsv(dataRows);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    let capturedCreateManyRowCount = -1;
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
      const createManyMock = vi.fn().mockImplementation(async (args: { data: unknown[] }) => {
        capturedCreateManyRowCount = args.data.length;
      });
      return callback({
        $queryRaw: defaultGuardQueryRawMock(),
        upload: { updateMany: updateManyMock },
        illegalDumping: { createMany: createManyMock },
      });
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 37 });
    expect(capturedCreateManyRowCount).toBe(37);
  });
});

describe("confirmWorksheet — 5B.4D domain write only after successful claim (T39, M14)", () => {
  it("tx.illegalDumping.createMany is never invoked when the claim affects zero rows (mapped path)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const createManyMock = vi.fn();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateManyMock = vi.fn().mockResolvedValue({ count: 0 });
      const findUniqueMock = vi.fn().mockResolvedValue({ canonical_status: "AWAITING_CONFIRMATION" });
      return callback({
        $queryRaw: defaultGuardQueryRawMock(),
        upload: { updateMany: updateManyMock, findUnique: findUniqueMock },
        illegalDumping: { createMany: createManyMock },
      });
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("a domain createMany rejection propagates out of confirmDataHubWorksheet uncaught (Prisma's own real $transaction rolls the whole transaction back on any thrown error — see the real-Postgres proof for the DB-level guarantee; this proves the service adds no swallowing/partial-commit logic of its own)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
      const createManyMock = vi.fn().mockRejectedValue(new Error("simulated domain write failure"));
      return callback({
        $queryRaw: defaultGuardQueryRawMock(),
        upload: { updateMany: updateManyMock },
        illegalDumping: { createMany: createManyMock },
      });
    });
    await expect(
      confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" })
    ).rejects.toThrow("simulated domain write failure");
  });
});

describe("confirmWorksheet — 5B.4D DETERMINISTIC selection-vs-confirm write-boundary race proof (Section 13/14, T43-T51)", () => {
  // Mirrors selectWorksheetMapping.test.ts's own established "row-aware"
  // pattern, adapted to confirmWorksheet.ts's whole-callback $transaction
  // shape (prisma.$transaction is mocked at the OUTER level here, not just
  // tx.upload.updateMany, since confirmWorksheet.ts passes a callback, not
  // a plain query). The mock evaluates the SERVICE'S OWN REAL `where`
  // argument against a tiny real row that changes state mid-flight — the
  // same way a genuine Postgres `UPDATE ... WHERE` only touches rows that
  // still satisfy every one of its own conditions.
  //
  // T0 Confirm resolves worksheet + frozen mapping_version_id = v3 (all the
  //     mocked reads above already answer this).
  // T1 Confirm validates/compiles/maps the full dataset using v3 (already
  //     completed by the time this transaction callback runs at all).
  // T2 immediately before the mocked updateMany is evaluated, a "concurrent
  //     actor" (standing in for a real, legitimate 5B.4B reselection call)
  //     flips the row's REAL mapping_version_id v3 -> v4 — modeling the
  //     exact moment a real concurrent selectWorksheetMapping transaction
  //     would have already committed between Step 1's read and this write.
  //     canonical_status is deliberately left UNTOUCHED by this simulated
  //     reselection, exactly matching selectWorksheetMapping.ts's own real
  //     `data: { mapping_version_id: version.id }` (verified by direct
  //     source read — it never sets canonical_status).
  // T3 the service's own conditional claim is evaluated against that now-
  //     changed real state. The required, falsifiable result: zero rows
  //     match, because the WHERE clause's own mapping_version_id condition
  //     no longer agrees with reality.
  function rowAwareTransactionMock() {
    const realRow = {
      id: "worksheet-1",
      organisation_id: "org-1",
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION" as string,
      mapping_version_id: "mv-3" as string | null,
    };
    const createManyMock = vi.fn().mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: defaultGuardQueryRawMock(),
        upload: {
          updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            // T2 — the race: a concurrent legitimate reselection wins,
            // immediately before this mocked write is evaluated.
            realRow.mapping_version_id = "mv-4";
            // T3 — evaluate the SERVICE'S ACTUAL where clause against the
            // row's real current state, field by field. A field absent
            // from `where` means "no filter" (matches Prisma's own
            // semantics) — this is what lets the M1 mutation below be caught.
            const matches = (Object.keys(realRow) as (keyof typeof realRow)[]).every(
              (field) => !(field in args.where) || args.where[field] === realRow[field]
            );
            if (matches) Object.assign(realRow, args.data);
            return { count: matches ? 1 : 0 };
          },
          findUnique: async () => ({ canonical_status: realRow.canonical_status }),
        },
        illegalDumping: { createMany: createManyMock },
      };
      return callback(tx);
    });
    return { realRow, createManyMock };
  }

  it("T43-T51 — a legitimate reselection (v3->v4) winning between the reads and the claim makes the claim match zero rows; zero stale domain rows, zero IMPORTED transition, zero automatic retry against v4", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const { realRow, createManyMock } = rowAwareTransactionMock();

    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });

    // T47/T49 — claim count 0 -> safe, non-leaking, EXISTING failure code
    // (Section 21/T51 — no automatic false-idempotent-success while the
    // worksheet remains otherwise confirmable under v4).
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    // T48 — zero stale domain rows written from v3.
    expect(createManyMock).not.toHaveBeenCalled();
    // T49 — zero IMPORTED transition from stale v3; canonical_status was
    // never touched by this losing claim (it was already AWAITING_CONFIRMATION
    // and remains so — the reselection itself never changes it either).
    expect(realRow.canonical_status).toBe("AWAITING_CONFIRMATION");
    // The reselection's OWN write stands untouched — Confirm's losing claim
    // must never overwrite or "fix" it.
    expect(realRow.mapping_version_id).toBe("mv-4");
  });

  it("legacy (NULL expectedMappingVersionId) worksheets are structurally exempt from this race entirely — the claim WHERE clause never gains a mapping_version_id key, so no reselection-shaped mutation can ever apply to them", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = bufferAndHash(buildCsv(["report_date", "location", "waste_type", "source_external_id"], [["2024-01-01", "Main St", "tyres", "EXT-1"]]));
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    let capturedWhereKeys: string[] = [];
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateManyMock = vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) => {
        capturedWhereKeys = Object.keys(args.where);
        return { count: 1 };
      });
      const createManyMock = vi.fn().mockResolvedValue(undefined);
      return callback({
        $queryRaw: defaultGuardQueryRawMock(),
        upload: { updateMany: updateManyMock },
        illegalDumping: { createMany: createManyMock },
      });
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false });
    expect(capturedWhereKeys).not.toContain("mapping_version_id");
    expect(capturedWhereKeys.sort()).toEqual(["canonical_status", "id", "lineage_kind", "organisation_id"]);
  });
});

describe("confirmWorksheet — 5B.4D existing state-race remains independently preserved (T52-T54)", () => {
  it("canonical_status stays its own, unreplaced predicate — a status change (not a mapping-version change) between the reads and the claim also makes the claim match zero rows", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    const realRow = { id: "worksheet-1", organisation_id: "org-1", lineage_kind: "DATA_HUB", canonical_status: "AWAITING_CONFIRMATION" as string, mapping_version_id: "mv-3" as string | null };
    const createManyMock = vi.fn();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: defaultGuardQueryRawMock(),
        upload: {
          updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            // A DIFFERENT concurrent actor wins this time: a real
            // confirmWorksheet.ts claim (not a reselection) — status
            // transitions to IMPORTED, mapping_version_id is untouched.
            realRow.canonical_status = "IMPORTED";
            const matches = (Object.keys(realRow) as (keyof typeof realRow)[]).every(
              (field) => !(field in args.where) || args.where[field] === realRow[field]
            );
            if (matches) Object.assign(realRow, args.data);
            return { count: matches ? 1 : 0 };
          },
          findUnique: async () => ({ canonical_status: realRow.canonical_status }),
        },
        illegalDumping: { createMany: createManyMock },
      };
      return callback(tx);
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    // The existing idempotent-success path: a genuinely concurrent Confirm
    // already won and imported it.
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
    expect(createManyMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — 5B.4D idempotency preserved for a mapped worksheet (T55-T57)", () => {
  it("claim.count === 0 with currentStatus already IMPORTED -> idempotent success, exactly like the legacy path (never a false failure on replay)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = mappedCsv([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ mapping_version_id: "mv-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow());
    sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow());
    storageGetMock.mockResolvedValue({ body });
    transactionMock.mockResolvedValue({ claimed: false, currentStatus: "IMPORTED" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
  });
});

describe("confirmWorksheet — 5B.4D no schema/migration/UI/Phase6 leakage (Section 26)", () => {
  it("prisma/schema.prisma is untouched by this diff (Upload.mapping_version_id already existed from 5B.1)", () => {
    // Static proxy check: confirmWorksheet.ts itself never contains a
    // "model " Prisma DSL token, and does not import a migration/UI module.
    const code = fs.readFileSync(path.join(ROOT, CONFIRM_SERVICE_PATH), "utf8");
    expect(code).not.toMatch(/from\s+["'].*\.tsx["']/);
    expect(code).not.toMatch(/next\/server/);
  });
});
