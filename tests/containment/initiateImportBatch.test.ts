import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

const createMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      create: (...args: unknown[]) => createMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const generateClientTokenMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => generateClientTokenMock(...args),
}));

const FAKE_STORE_ID = "store_initiatetest0";
const FAKE_TOKEN = "vercel_blob_rw_initiatetest0_secretNeverReal";

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
  findUniqueMock.mockReset();
  generateClientTokenMock.mockReset();
  return import("@/lib/data-hub/importBatch/initiate");
}

async function withConfiguredEnv<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DATAHUB_BLOB_STORE_ID = FAKE_STORE_ID;
  process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
  try {
    return await fn();
  } finally {
    delete process.env.DATAHUB_BLOB_STORE_ID;
    delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
  }
}

beforeEach(() => {
  delete process.env.DATAHUB_BLOB_STORE_ID;
  delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
});

// ─── Validation ─────────────────────────────────────────────────────

describe("initiateImportBatch — validation", () => {
  it("rejects an unsupported extension with INVALID_REQUEST, no create() call", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "report.pdf", declaredSizeBytes: 100 }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a zero-byte declared size with INVALID_REQUEST", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 0 }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a negative declared size with INVALID_REQUEST", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: -5 }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("rejects a declared size over MAX_SOURCE_FILE_BYTES with SIZE_LIMIT", async () => {
    const { initiateImportBatch } = await freshImport();
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: MAX_SOURCE_FILE_BYTES + 1 }
    );
    expect(result).toMatchObject({ ok: false, code: "SIZE_LIMIT" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("accepts a declared size exactly at MAX_SOURCE_FILE_BYTES (boundary)", async () => {
    const { initiateImportBatch } = await freshImport();
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    createMock.mockResolvedValue(makeRow({ size_bytes: MAX_SOURCE_FILE_BYTES, idempotency_key: null }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: MAX_SOURCE_FILE_BYTES }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed expectedSha256 with INVALID_REQUEST", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, expectedSha256: "not-a-hash" }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("normalizes a valid expectedSha256 (trims + lowercases) before persisting", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ idempotency_key: null }));
    const validHash = "A".repeat(64).toLowerCase().replace(/a/g, "f"); // 64 lowercase hex chars
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, expectedSha256: `  ${validHash.toUpperCase()}  ` }
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expected_sha256: validHash }) })
    );
  });

  it("rejects a whitespace-only idempotency key with INVALID_REQUEST", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "   " }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key over 128 code units with INVALID_REQUEST", async () => {
    const { initiateImportBatch } = await freshImport();
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "x".repeat(129) }
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("accepts an idempotency key at exactly 128 code units (boundary)", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ idempotency_key: "x".repeat(128) }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "x".repeat(128) }
    );
    expect(result.ok).toBe(true);
  });

  it("persists the TRIMMED idempotency key, not the raw input", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ idempotency_key: "abc" }));
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "  abc  " }
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ idempotency_key: "abc" }) })
    );
  });

  it("does not lowercase or normalize the idempotency key beyond trimming", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ idempotency_key: "AbC-123" }));
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100, idempotencyKey: "AbC-123" }
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ idempotency_key: "AbC-123" }) })
    );
  });
});

// ─── size_bytes immutability at initiate (Step 11) ─────────────────

describe("initiateImportBatch — size_bytes", () => {
  it("persists exactly the client-declared size_bytes on create", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ size_bytes: 4242, idempotency_key: null }));
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 4242 }
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ size_bytes: 4242 }) })
    );
  });
});

// ─── Fresh create, no config ────────────────────────────────────────

describe("initiateImportBatch — fresh create without Blob config", () => {
  it("commits the row as AWAITING_UPLOAD, returns configurationError:true, uploadToken:null", async () => {
    const { initiateImportBatch } = await freshImport();
    createMock.mockResolvedValue(makeRow({ idempotency_key: null }));
    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100 }
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, uploadToken: null, configurationError: true });
    expect((result as { batch: { status: string } }).batch.status).toBe("AWAITING_UPLOAD");
  });

  it("uses storage_provider = vercel-blob-private and a storage_key derived from buildImportBatchKey", async () => {
    const { initiateImportBatch } = await freshImport();
    const { buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore");
    createMock.mockResolvedValue(makeRow({ idempotency_key: null }));
    await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      { originalFilename: "data.csv", declaredSizeBytes: 100 }
    );
    const callArg = createMock.mock.calls[0][0] as { data: { id: string; storage_key: string; storage_provider: string } };
    expect(callArg.data.storage_provider).toBe("vercel-blob-private");
    expect(callArg.data.storage_key).toBe(buildImportBatchKey("org-1", callArg.data.id));
  });
});

// ─── Fresh create, WITH config -> real token mint ──────────────────

describe("initiateImportBatch — fresh create with Blob config", () => {
  it("mints and returns an upload token", async () => {
    await withConfiguredEnv(async () => {
      const { initiateImportBatch } = await freshImport();
      generateClientTokenMock.mockResolvedValue("minted-token-abc");
      createMock.mockResolvedValue(makeRow({ idempotency_key: null }));
      const result = await initiateImportBatch(
        { organisationId: "org-1", userId: "user-1" },
        { originalFilename: "data.csv", declaredSizeBytes: 100 }
      );
      expect(result).toMatchObject({ ok: true, uploadToken: "minted-token-abc", configurationError: false });
      expect(generateClientTokenMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── P2002 replay resolution ────────────────────────────────────────
//
// Every conflict below is triggered via a REAL Prisma.PrismaClientKnownRequestError
// instance (code: 'P2002') so the production code's own `instanceof` check
// is exercised for real, not stubbed away.

describe("initiateImportBatch — P2002 replay resolution", () => {
  async function triggerConflict(existingRow: Record<string, unknown>, requestOverrides: Partial<{
    organisationId: string;
    userId: string;
    originalFilename: string;
    declaredSizeBytes: number;
    expectedSha256: string;
  }> = {}, afterReset?: (mocks: { generateClientTokenMock: typeof generateClientTokenMock }) => void) {
    const { initiateImportBatch } = await freshImport();
    // freshImport() resets every mock (including generateClientTokenMock) —
    // any mock configuration the caller wants must be applied AFTER this
    // point, via afterReset, not before calling triggerConflict.
    afterReset?.({ generateClientTokenMock });
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    findUniqueMock.mockResolvedValue(existingRow);
    return initiateImportBatch(
      { organisationId: requestOverrides.organisationId ?? "org-1", userId: requestOverrides.userId ?? "user-1" },
      {
        originalFilename: requestOverrides.originalFilename ?? "data.csv",
        declaredSizeBytes: requestOverrides.declaredSizeBytes ?? 100,
        expectedSha256: requestOverrides.expectedSha256,
        idempotencyKey: "shared-key",
      }
    );
  }

  it("same fingerprint, AWAITING_UPLOAD -> mints a fresh token (config present)", async () => {
    await withConfiguredEnv(async () => {
      const result = await triggerConflict(makeRow({ status: "AWAITING_UPLOAD" }), {}, ({ generateClientTokenMock: mock }) =>
        mock.mockResolvedValue("replay-token")
      );
      expect(result).toMatchObject({ ok: true, uploadToken: "replay-token" });
    });
  });

  it("same fingerprint, PROCESSING -> returns as-is, no token minted", async () => {
    const result = await triggerConflict(makeRow({ status: "PROCESSING" }));
    expect(result).toMatchObject({ ok: true, uploadToken: null });
    expect(generateClientTokenMock).not.toHaveBeenCalled();
  });

  it("same fingerprint, READY -> returns as-is, no token minted", async () => {
    const result = await triggerConflict(makeRow({ status: "READY" }));
    expect(result).toMatchObject({ ok: true, uploadToken: null });
  });

  it("same fingerprint, FAILED + STORAGE_NOT_FOUND -> mints a fresh token", async () => {
    await withConfiguredEnv(async () => {
      const result = await triggerConflict(
        makeRow({ status: "FAILED", last_failure_code: "STORAGE_NOT_FOUND", last_failure_retryable: true }),
        {},
        ({ generateClientTokenMock: mock }) => mock.mockResolvedValue("replay-token-2")
      );
      expect(result).toMatchObject({ ok: true, uploadToken: "replay-token-2" });
    });
  });

  it("same fingerprint, FAILED + PROVIDER_FAILURE -> no token minted (config present, so a mint attempt would be observable)", async () => {
    // Deliberately runs WITH Blob config present (withConfiguredEnv) so
    // that "no token minted" is proven by the SDK never being called —
    // not masked by an unrelated config-error short-circuit, which would
    // make this assertion pass even if the eligibility decision were
    // wrong (e.g. decided by last_failure_retryable alone instead of the
    // specific code).
    await withConfiguredEnv(async () => {
      const result = await triggerConflict(
        makeRow({ status: "FAILED", last_failure_code: "PROVIDER_FAILURE", last_failure_retryable: true }),
        {},
        ({ generateClientTokenMock: mock }) => mock.mockResolvedValue("should-never-be-returned")
      );
      expect(result).toMatchObject({ ok: true, uploadToken: null, configurationError: false });
      expect(generateClientTokenMock).not.toHaveBeenCalled();
    });
  });

  it("same fingerprint, FAILED + STALE_RECLAIMED -> no token minted (config present)", async () => {
    await withConfiguredEnv(async () => {
      const result = await triggerConflict(
        makeRow({ status: "FAILED", last_failure_code: "STALE_RECLAIMED", last_failure_retryable: true }),
        {},
        ({ generateClientTokenMock: mock }) => mock.mockResolvedValue("should-never-be-returned")
      );
      expect(result).toMatchObject({ ok: true, uploadToken: null, configurationError: false });
      expect(generateClientTokenMock).not.toHaveBeenCalled();
    });
  });

  it("same fingerprint, FAILED + HASH_MISMATCH (terminal) -> no token minted (config present)", async () => {
    await withConfiguredEnv(async () => {
      const result = await triggerConflict(
        makeRow({ status: "FAILED", last_failure_code: "HASH_MISMATCH", last_failure_retryable: false }),
        {},
        ({ generateClientTokenMock: mock }) => mock.mockResolvedValue("should-never-be-returned")
      );
      expect(result).toMatchObject({ ok: true, uploadToken: null, configurationError: false });
      expect(generateClientTokenMock).not.toHaveBeenCalled();
    });
  });

  it("DELETION_PENDING -> INVALID_STATE, no token minted", async () => {
    const result = await triggerConflict(makeRow({ status: "DELETION_PENDING" }));
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(generateClientTokenMock).not.toHaveBeenCalled();
  });

  it("different original_filename -> IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ original_filename: "different.csv" }));
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("different size_bytes -> IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ size_bytes: 999 }));
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("different content_type -> IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ content_type: "xlsx" }), { originalFilename: "data.csv" });
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("different expected_sha256 -> IDEMPOTENCY_CONFLICT", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const result = await triggerConflict(makeRow({ expected_sha256: hashA }), { expectedSha256: hashB });
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("existing expected_sha256 NULL vs new request supplying one -> IDEMPOTENCY_CONFLICT (absence is a distinct fingerprint value)", async () => {
    const hashA = "a".repeat(64);
    const result = await triggerConflict(makeRow({ expected_sha256: null }), { expectedSha256: hashA });
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("uploaded_by mismatch (existing non-NULL, different user) -> IDEMPOTENCY_CONFLICT", async () => {
    const result = await triggerConflict(makeRow({ uploaded_by: "someone-else" }), { userId: "user-1" });
    expect(result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("uploaded_by NULL on the existing row -> comparison skipped, replay proceeds", async () => {
    const result = await triggerConflict(makeRow({ uploaded_by: null, status: "PROCESSING" }));
    expect(result).toMatchObject({ ok: true });
  });

  it("uploaded_by matches exactly -> replay proceeds", async () => {
    const result = await triggerConflict(makeRow({ uploaded_by: "user-1", status: "PROCESSING" }), {
      userId: "user-1",
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("a P2002 with no idempotency key supplied rethrows rather than silently reinterpreting", async () => {
    const { initiateImportBatch } = await freshImport();
    const { Prisma } = await import("@prisma/client");
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    createMock.mockRejectedValue(conflictError);
    await expect(
      initiateImportBatch(
        { organisationId: "org-1", userId: "user-1" },
        { originalFilename: "data.csv", declaredSizeBytes: 100 }
      )
    ).rejects.toBe(conflictError);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("a non-P2002 database error propagates rather than being swallowed", async () => {
    const { initiateImportBatch } = await freshImport();
    const genericError = new Error("connection reset");
    createMock.mockRejectedValue(genericError);
    await expect(
      initiateImportBatch(
        { organisationId: "org-1", userId: "user-1" },
        { originalFilename: "data.csv", declaredSizeBytes: 100 }
      )
    ).rejects.toBe(genericError);
  });
});
