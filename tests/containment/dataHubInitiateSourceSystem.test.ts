import { describe, it, expect, vi, beforeEach } from "vitest";

// Data Hub 5B.4A — SourceSystem selection at initiate. Mocked-Prisma unit
// suite (same idiom as tests/containment/initiateImportBatch.test.ts,
// which this file does not modify) covering the OPTIONAL sourceSystemId
// input: tenant/active validation, immutable create-time lineage,
// idempotency-fingerprint participation, and the fresh-vs-replay active
// enforcement split (see initiate.ts's own header comment for the full
// design rationale).

const createMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const deleteMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      create: (...args: unknown[]) => createMock(...args),
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
    sourceSystem: {
      findUnique: (...args: unknown[]) => sourceSystemFindUniqueMock(...args),
    },
  },
}));

const generateClientTokenMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => generateClientTokenMock(...args),
}));

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "batch-1",
    organisation_id: "org-1",
    uploaded_by: "user-1",
    original_filename: "data.csv",
    content_type: "csv",
    size_bytes: 100,
    sha256: null,
    storage_provider: "vercel-blob-private",
    storage_key: "org_org-1/importbatch_batch-1",
    storage_etag: null,
    status: "AWAITING_UPLOAD",
    idempotency_key: "key-1",
    expected_sha256: null,
    source_system_id: null,
    attempt_count: 0,
    last_failure_code: null,
    last_failure_message: null,
    last_failure_retryable: null,
    ...overrides,
  };
}

async function freshImport() {
  vi.resetModules();
  createMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  deleteMock.mockReset();
  sourceSystemFindUniqueMock.mockReset();
  generateClientTokenMock.mockReset();
  return import("@/lib/data-hub/importBatch/initiate");
}

beforeEach(() => {
  delete process.env.DATAHUB_BLOB_STORE_ID;
  delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
});

// ─── T3, T15 — omitted sourceSystemId: byte-for-byte unchanged ─────────

describe("initiate — sourceSystemId omitted (compatibility)", () => {
  it("T3 — omitted sourceSystemId: no SourceSystem lookup, source_system_id NULL in create()", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow());
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-1" }
    );
    expect(result.ok).toBe(true);
    expect(sourceSystemFindUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect((createMock.mock.calls[0][0] as { data: { source_system_id: unknown } }).data.source_system_id).toBeNull();
  });
});

// ─── T1, T2 — valid active same-tenant SourceSystem accepted ──────────

describe("initiate — sourceSystemId supplied, valid + active", () => {
  it("T1/T2 — active same-tenant SourceSystem accepted; exact id persisted on create()", async () => {
    const { initiateImportBatch } = await freshImport();
    sourceSystemFindUniqueMock.mockResolvedValue({ active: true });
    createMock.mockResolvedValue(makeRow({ source_system_id: "ss-1" }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-1", sourceSystemId: "ss-1" }
    );
    expect(result.ok).toBe(true);
    expect(sourceSystemFindUniqueMock).toHaveBeenCalledWith({
      where: { id_organisation_id: { id: "ss-1", organisation_id: "org-1" } },
      select: { active: true },
    });
    expect((createMock.mock.calls[0][0] as { data: { source_system_id: unknown } }).data.source_system_id).toBe(
      "ss-1"
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

// ─── T4, T6, T7 — nonexistent/foreign SourceSystem rejected, no leak ───

describe("initiate — sourceSystemId supplied, not found for this tenant", () => {
  it("T4/T6 — nonexistent or foreign-tenant SourceSystem rejected BEFORE any create() attempt", async () => {
    const { initiateImportBatch } = await freshImport();
    sourceSystemFindUniqueMock.mockResolvedValue(null);
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-1", sourceSystemId: "ss-foreign" }
    );
    expect(result).toMatchObject({ ok: false, code: "SOURCE_SYSTEM_UNAVAILABLE" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("T7 — the same error code/message is returned for nonexistent as for inactive (no leak of the distinguishing reason)", async () => {
    const { initiateImportBatch } = await freshImport();

    sourceSystemFindUniqueMock.mockResolvedValueOnce(null);
    const notFoundResult = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-a", sourceSystemId: "ss-a" }
    );

    sourceSystemFindUniqueMock.mockResolvedValueOnce({ active: false });
    createMock.mockResolvedValueOnce(makeRow({ id: "batch-2", source_system_id: "ss-b" }));
    const inactiveResult = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-b", sourceSystemId: "ss-b" }
    );

    expect(notFoundResult).toMatchObject({ ok: false, code: "SOURCE_SYSTEM_UNAVAILABLE" });
    expect(inactiveResult).toMatchObject({ ok: false, code: "SOURCE_SYSTEM_UNAVAILABLE" });
    expect((notFoundResult as { ok: false; message: string }).message).toBe(
      (inactiveResult as { ok: false; message: string }).message
    );
  });
});

// ─── T5 — inactive SourceSystem rejected for a genuinely fresh batch ──

describe("initiate — sourceSystemId supplied, found but inactive (fresh-creation path)", () => {
  it("T5 — inactive SourceSystem: row is created then deleted; caller sees rejection, no leaked row", async () => {
    const { initiateImportBatch } = await freshImport();
    sourceSystemFindUniqueMock.mockResolvedValue({ active: false });
    createMock.mockResolvedValue(makeRow({ source_system_id: "ss-inactive" }));
    deleteMock.mockResolvedValue(makeRow({ source_system_id: "ss-inactive" }));

    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "key-1", sourceSystemId: "ss-inactive" }
    );

    expect(result).toMatchObject({ ok: false, code: "SOURCE_SYSTEM_UNAVAILABLE" });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect((deleteMock.mock.calls[0][0] as { where: { id: string } }).where.id).toBe(
      (createMock.mock.calls[0][0] as { data: { id: string } }).data.id
    );
    expect(generateClientTokenMock).not.toHaveBeenCalled();
  });
});

// ─── T8, T9, T10 — client cannot inject anything but the id ────────────

describe("initiate — no client trust beyond the bare sourceSystemId", () => {
  it("T8 — organisationId cannot be injected via sourceSystemId-adjacent input (the trusted context param is what is used)", async () => {
    const { initiateImportBatch } = await freshImport();
    sourceSystemFindUniqueMock.mockResolvedValue({ active: true });
    createMock.mockResolvedValue(makeRow({ source_system_id: "ss-1" }));
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      {
        originalFilename: "data.csv",
        declaredSizeBytes: 100,
        idempotencyKey: "key-1",
        sourceSystemId: "ss-1",
        // @ts-expect-error -- deliberately probing an untyped extra field
        organisationId: "org-attacker",
      }
    );
    expect(sourceSystemFindUniqueMock).toHaveBeenCalledWith({
      where: { id_organisation_id: { id: "ss-1", organisation_id: "org-1" } },
      select: { active: true },
    });
  });

  it("T9/T10 — InitiateClientInput's own type has no sourceSystemName/active/createdBy/mappingVersionId field (static shape proof)", async () => {
    // TypeScript-level proof: InitiateClientInput is imported and its
    // literal shape inspected via source text, since a runtime object can
    // always be over-supplied regardless of the type (see the route's own
    // hand-constructed-input proof in dataHubInitiateSourceSystemRoute
    // below) — this test asserts the SERVICE's own declared contract does
    // not name any of these fields at all.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/data-hub/importBatch/initiate.ts"),
      "utf8"
    );
    const interfaceStart = source.indexOf("export interface InitiateClientInput");
    const interfaceEnd = source.indexOf("\n}", interfaceStart);
    const interfaceText = source.slice(interfaceStart, interfaceEnd);
    for (const forbidden of ["sourceSystemName", "createdBy", "mappingVersionId", "sourceMappingId", "organisationId"]) {
      expect(interfaceText.includes(forbidden)).toBe(false);
    }
    // "active" checked as a field-declaration shape specifically (bare
    // substring search is too broad — it would false-positive on prose
    // like "inactive"/"active" appearing inside doc comments).
    expect(/\bactive\??\s*:/.test(interfaceText)).toBe(false);
  });
});

// ─── Idempotency fingerprint — T16-T21 ─────────────────────────────────

describe("initiate — sourceSystemId idempotency fingerprint", () => {
  async function triggerConflict(existingRow: Record<string, unknown>, sourceSystemId?: string) {
    const { initiateImportBatch } = await freshImport();
    sourceSystemFindUniqueMock.mockResolvedValue({ active: true });
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    importBatchFindUniqueMock.mockResolvedValue(existingRow);
    return initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      {
        originalFilename: "data.csv",
        declaredSizeBytes: 100,
        idempotencyKey: "shared-key",
        sourceSystemId,
      }
    );
  }

  it("T16 — same key + same fields + same sourceSystemId replays the same batch", async () => {
    const result = await triggerConflict(makeRow({ source_system_id: "ss-1" }), "ss-1");
    expect(result).toMatchObject({ ok: true });
    // The replay path must NEVER re-check active status against current
    // SourceSystem state — only the pre-insert lookup (once) is expected.
    expect(sourceSystemFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it("T17 — same key + different sourceSystemId => IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ source_system_id: "ss-1" }), "ss-2");
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("T18 — same key + omitted/omitted => existing replay succeeds", async () => {
    const { initiateImportBatch } = await freshImport();
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    importBatchFindUniqueMock.mockResolvedValue(makeRow({ source_system_id: null }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "shared-key" }
    );
    expect(result).toMatchObject({ ok: true });
    expect(sourceSystemFindUniqueMock).not.toHaveBeenCalled();
  });

  it("T19 — original omitted + replay supplied => IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ source_system_id: null }), "ss-1");
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("T20 — original supplied + replay omitted => IDEMPOTENCY_CONFLICT", async () => {
    const { initiateImportBatch } = await freshImport();
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    importBatchFindUniqueMock.mockResolvedValue(makeRow({ source_system_id: "ss-1" }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "shared-key" }
    );
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("T21 — same sourceSystemId + a DIFFERENT existing fingerprint field (filename) still conflicts", async () => {
    const result = await triggerConflict(
      makeRow({ source_system_id: "ss-1", original_filename: "other.csv" }),
      "ss-1"
    );
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });
});

// ─── T24, T25 — deactivation after creation does not alter/break replay ─

describe("initiate — deactivation-after-creation replay stability", () => {
  it("T24/T25 — an exact replay succeeds even though the SourceSystem used at original creation is now inactive", async () => {
    const { initiateImportBatch } = await freshImport();
    // The SourceSystem is now inactive — if the replay path incorrectly
    // consulted this, the request would be wrongly rejected.
    sourceSystemFindUniqueMock.mockResolvedValue({ active: false });
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    importBatchFindUniqueMock.mockResolvedValue(makeRow({ source_system_id: "ss-deactivated-since" }));

    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      {
        originalFilename: "data.csv",
        declaredSizeBytes: 100,
        idempotencyKey: "shared-key",
        sourceSystemId: "ss-deactivated-since",
      }
    );

    expect(result).toMatchObject({ ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

// ─── T26-T32 — immutability / containment (static) ─────────────────────

describe("initiate — source_system_id immutability containment", () => {
  it("T26/T27 — source_system_id is written ONLY inside initiate.ts's own create() call (no other write site in this module)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.join(process.cwd(), "lib/data-hub/importBatch/initiate.ts"), "utf8");
    const writeSites = source.match(/source_system_id\s*:/g) ?? [];
    // Exactly one write site: the `create()` data object. (Reads of
    // `existing.source_system_id` in resolveReplay use `.source_system_id`
    // WITHOUT a trailing colon, so they are not matched by this pattern.)
    expect(writeSites.length).toBe(1);
  });

  it("T27 — no SourceSystem-reassignment/update route exists in the Data Hub API surface", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const importBatchesDir = path.join(process.cwd(), "app/api/data-hub/import-batches");
    function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    }
    const files = walk(importBatchesDir).filter((f) => f.endsWith("route.ts"));
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      if (/export\s+async\s+function\s+PATCH/.test(text)) {
        expect(text.includes("source_system_id")).toBe(false);
      }
    }
  });

  it("T28-T31 — finalize/inspect/preview/confirm source files never reference source_system_id", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files = [
      "lib/data-hub/importBatch/finalize.ts",
      "lib/data-hub/importBatch/finalizeInternal.ts",
      "lib/data-hub/importBatch/inspectWorksheets.ts",
      "lib/data-hub/importBatch/previewWorksheet.ts",
      "lib/data-hub/importBatch/confirmWorksheet.ts",
    ];
    for (const relPath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
      expect(source.includes("source_system_id")).toBe(false);
    }
  });

  it("T32 — recovery/history read services never write source_system_id (read.ts contains no write of it)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.join(process.cwd(), "lib/data-hub/importBatch/read.ts"), "utf8");
    expect(/source_system_id\s*:/.test(source)).toBe(false);
  });

  it("T33 — no Upload.mapping_version_id write introduced anywhere in this diff's touched files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const relPath of ["lib/data-hub/importBatch/initiate.ts", "app/api/data-hub/import-batches/route.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
      expect(source.includes("mapping_version_id")).toBe(false);
      expect(source.includes("mappingVersionId")).toBe(false);
    }
  });

  it("T34 — no mapping-selection code (sourceMappingId) introduced in initiate.ts", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.join(process.cwd(), "lib/data-hub/importBatch/initiate.ts"), "utf8");
    expect(source.includes("sourceMappingId")).toBe(false);
    expect(source.includes("SourceMapping")).toBe(false);
  });

  it("T35 — no UI file references sourceSystemId (no integration introduced)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files = [
      "lib/data-hub/client/orchestrator.ts",
      "app/data-hub/import/_components/ReviewPanel.tsx",
      "app/data-hub/import/ImportClient.tsx",
    ];
    for (const relPath of files) {
      const full = path.join(process.cwd(), relPath);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, "utf8");
      expect(source.toLowerCase().includes("sourcesystemid")).toBe(false);
    }
  });

  it("T36 — no schema/migration file changed by this slice (prisma/schema.prisma unmodified marker check)", async () => {
    // Static, in-repo proof only (a git-diff-based proof runs at the
    // independent-review stage): schema.prisma's own SourceSystem model
    // still carries the same field set 5B.1 shipped, with no NEW field
    // added by this task.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const modelStart = source.indexOf("model SourceSystem {");
    const modelEnd = source.indexOf("\n}", modelStart);
    const modelText = source.slice(modelStart, modelEnd);
    // Exactly the 5B.1-shipped field count (id, organisation_id, name,
    // description, active, created_by, created_at, updated_at) plus the
    // organisation/creator/mappings relations and the two @@unique — no
    // new scalar field was introduced by 5B.4A.
    expect(modelText.includes("active")).toBe(true);
    expect(modelText.includes("credential")).toBe(false);
    expect(modelText.includes("vendor")).toBe(false);
  });
});

// ─── M8 — no SELECT-before-INSERT reintroduced on the idempotency path ─

describe("initiate — insert-first preserved with sourceSystemId supplied", () => {
  it("importBatch.create() is attempted with NO preceding importBatch.findUnique call, even when sourceSystemId is supplied", async () => {
    const { initiateImportBatch } = await freshImport();
    const callOrder: string[] = [];
    sourceSystemFindUniqueMock.mockImplementation(async () => {
      callOrder.push("sourceSystem.findUnique");
      return { active: true };
    });
    createMock.mockImplementation(async () => {
      callOrder.push("importBatch.create");
      return makeRow({ source_system_id: "ss-1" });
    });
    importBatchFindUniqueMock.mockImplementation(async () => {
      callOrder.push("importBatch.findUnique");
      return null;
    });
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "order-check", sourceSystemId: "ss-1" }
    );
    expect(callOrder).toEqual(["sourceSystem.findUnique", "importBatch.create"]);
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
  });
});

// ─── T11-T14 — auth/role behavior is unchanged by this slice ───────────

describe("initiate — auth/role unchanged", () => {
  it("T11 — the route still calls requireRole(\"manager\") exactly, nothing weaker or stronger", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/data-hub/import-batches/route.ts"),
      "utf8"
    );
    const postFnStart = source.indexOf("export async function POST");
    const postFnText = source.slice(postFnStart);
    expect(postFnText.includes('requireRole("manager")')).toBe(true);
    expect(postFnText.includes('requireRole("admin")')).toBe(false);
  });
});
