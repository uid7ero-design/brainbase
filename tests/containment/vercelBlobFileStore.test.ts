import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub private Vercel Blob adapter (Phase 5A.2F) — zero real network
// calls. @vercel/blob's put/head/get/del are fully mocked, matching the
// established precedent in tests/containment/eventsArtworkUpload.test.ts.
// All configuration values here are fake and never leave this mocked
// boundary: no real token, no real store id, no env var, no network, no
// Vercel account, no Production dependency.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── Mocks ──────────────────────────────────────────────────────────

class MockBlobError extends Error {}
class MockBlobNotFoundError extends MockBlobError {
  constructor() {
    super("The requested blob does not exist");
  }
}

const putMock = vi.fn();
const headMock = vi.fn();
const getMock = vi.fn();
const delMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  head: (...args: unknown[]) => headMock(...args),
  get: (...args: unknown[]) => getMock(...args),
  del: (...args: unknown[]) => delMock(...args),
  BlobError: MockBlobError,
  BlobNotFoundError: MockBlobNotFoundError,
}));

const { createVercelBlobFileStore, VERCEL_BLOB_PRIVATE_PROVIDER } = await import(
  "@/lib/data-hub/storage/vercelBlobFileStore"
);
const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");

// A structurally-valid-looking (never real) Vercel Blob read-write
// token, shaped `vercel_blob_rw_<storeId>_<secret>` per the verified
// real SDK format (node_modules/@vercel/blob/dist/chunk-QMTUXFZH.cjs,
// function parseStoreIdFromReadWriteToken). FAKE_STORE_ID intentionally
// carries the "store_" prefix convention (the shape Vercel's dashboard/
// env vars such as BLOB_STORE_ID use) to exercise the adapter's
// storeId-normalization when comparing against the token's embedded,
// unprefixed segment — the two must still be recognized as consistent.
const FAKE_DATAHUB_STORE_SEGMENT = "testdatahubstore123";
const FAKE_STORE_ID = `store_${FAKE_DATAHUB_STORE_SEGMENT}`;
const FAKE_TOKEN = `vercel_blob_rw_${FAKE_DATAHUB_STORE_SEGMENT}_fakeSecretNeverReal0000`;

function makeStore() {
  return createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
}

function headResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    size: 4,
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
    pathname: "org_a/importbatch_b",
    contentType: "application/octet-stream",
    contentDisposition: "inline",
    url: "https://example.public.blob.vercel-storage.com/org_a/importbatch_b",
    downloadUrl: "https://example.public.blob.vercel-storage.com/org_a/importbatch_b?download=1",
    cacheControl: "public, max-age=2592000",
    etag: "etag-1",
    ...overrides,
  };
}

// A minimal stand-in for the Web ReadableStream the real SDK returns —
// gives direct, deterministic control over read()/cancel() rather than
// depending on real ReadableStream backpressure semantics.
function makeStream(chunks: Uint8Array[], cancelImpl?: () => Promise<void>) {
  let i = 0;
  const cancel = vi.fn(cancelImpl ?? (async () => undefined));
  const read = vi.fn(async () => {
    if (i < chunks.length) {
      const value = chunks[i];
      i += 1;
      return { done: false, value };
    }
    return { done: true, value: undefined };
  });
  return {
    getReader: () => ({ read, cancel }),
    __read: read,
    __cancel: cancel,
  };
}

function getResult(chunks: Uint8Array[], overrides: Partial<Record<string, unknown>> = {}, cancelImpl?: () => Promise<void>) {
  return {
    statusCode: 200,
    stream: makeStream(chunks, cancelImpl),
    headers: new Headers(),
    blob: {
      url: "https://example.public.blob.vercel-storage.com/org_a/importbatch_b",
      downloadUrl: "https://example.public.blob.vercel-storage.com/org_a/importbatch_b?download=1",
      pathname: "org_a/importbatch_b",
      contentDisposition: "inline",
      cacheControl: "public, max-age=2592000",
      uploadedAt: new Date("2026-01-01T00:00:00Z"),
      etag: "etag-1",
      contentType: "application/octet-stream",
      size: 4,
      ...overrides,
    },
  };
}

beforeEach(() => {
  putMock.mockReset();
  headMock.mockReset();
  getMock.mockReset();
  delMock.mockReset();
});

// ─── PUT (1-12) ─────────────────────────────────────────────────────

describe("vercelBlobFileStore — put", () => {
  it("1. success returns provider/key/size/contentType/etag", async () => {
    putMock.mockResolvedValue({
      url: "https://x",
      downloadUrl: "https://x?download=1",
      pathname: "org_a/importbatch_b",
      contentType: "application/octet-stream",
      contentDisposition: "inline",
      etag: "etag-1",
    });
    const store = makeStore();
    const body = new Uint8Array([1, 2, 3, 4]);
    const result = await store.put("org_a/importbatch_b", body, { contentType: "application/octet-stream" });
    expect(result).toEqual({
      provider: "vercel-blob-private",
      key: "org_a/importbatch_b",
      size: 4,
      contentType: "application/octet-stream",
      etag: "etag-1",
    });
  });

  it("2. provider identifier is exactly vercel-blob-private", () => {
    const store = makeStore();
    expect(store.provider).toBe("vercel-blob-private");
    expect(VERCEL_BLOB_PRIVATE_PROVIDER).toBe("vercel-blob-private");
  });

  it("3. canonical key is preserved exactly as the put() pathname argument", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]));
    expect(putMock.mock.calls[0][0]).toBe("org_a/importbatch_b");
  });

  it("4. access:'private' is passed explicitly", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]));
    expect(putMock.mock.calls[0][2]).toMatchObject({ access: "private" });
  });

  it("5. configured Data Hub storeId is passed", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]));
    expect(putMock.mock.calls[0][2]).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
  });

  it("6. allowOverwrite:false is passed", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]));
    expect(putMock.mock.calls[0][2]).toMatchObject({ allowOverwrite: false });
  });

  it("7. addRandomSuffix:false is passed", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]));
    expect(putMock.mock.calls[0][2]).toMatchObject({ addRandomSuffix: false });
  });

  it("8. contentType is mapped through when supplied", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "text/csv", etag: "e" });
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1]), { contentType: "text/csv" });
    expect(putMock.mock.calls[0][2]).toMatchObject({ contentType: "text/csv" });
  });

  it("9. size comes from body.byteLength, never a provider-returned size", async () => {
    // PutBlobResult never includes a size field in the installed SDK.
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    const body = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const result = await store.put("org_a/importbatch_b", body);
    expect(result.size).toBe(7);
  });

  it("10. provider pathname mismatch -> PROVIDER_FAILURE", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/DIFFERENT", contentType: "x", etag: "e" });
    const store = makeStore();
    await expect(store.put("org_a/importbatch_b", new Uint8Array([1]))).rejects.toMatchObject({
      code: "PROVIDER_FAILURE",
    });
  });

  it("11. conflict -> ALREADY_EXISTS", async () => {
    putMock.mockRejectedValue(new MockBlobError("This blob already exists, use allowOverwrite: true"));
    const store = makeStore();
    await expect(store.put("org_a/importbatch_b", new Uint8Array([1]))).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
    });
  });

  it("12. generic provider failure -> PROVIDER_FAILURE", async () => {
    putMock.mockRejectedValue(new Error("network reset"));
    const store = makeStore();
    await expect(store.put("org_a/importbatch_b", new Uint8Array([1]))).rejects.toMatchObject({
      code: "PROVIDER_FAILURE",
    });
  });
});

// ─── HEAD (13-20) ───────────────────────────────────────────────────

describe("vercelBlobFileStore — head", () => {
  it("13. success maps provider/size/contentType/etag", async () => {
    headMock.mockResolvedValue(headResult({ size: 42, contentType: "text/csv", etag: "etag-x" }));
    const store = makeStore();
    const result = await store.head("org_a/importbatch_b");
    expect(result).toEqual({ provider: "vercel-blob-private", size: 42, contentType: "text/csv", etag: "etag-x" });
  });

  it("14. configured storeId is passed", async () => {
    headMock.mockResolvedValue(headResult());
    const store = makeStore();
    await store.head("org_a/importbatch_b");
    expect(headMock.mock.calls[0][1]).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
  });

  it("15. no access option is passed to head() (the installed SDK's head() does not accept one)", async () => {
    headMock.mockResolvedValue(headResult());
    const store = makeStore();
    await store.head("org_a/importbatch_b");
    expect(headMock.mock.calls[0][1]).not.toHaveProperty("access");
  });

  it("16. missing object -> null", async () => {
    headMock.mockRejectedValue(new MockBlobNotFoundError());
    const store = makeStore();
    await expect(store.head("org_a/importbatch_b")).resolves.toBeNull();
  });

  it("17. provider failure -> PROVIDER_FAILURE", async () => {
    headMock.mockRejectedValue(new Error("service unavailable"));
    const store = makeStore();
    await expect(store.head("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("18. invalid size metadata -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: -1 }));
    const store = makeStore();
    await expect(store.head("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("19. etag is preserved when supplied", async () => {
    headMock.mockResolvedValue(headResult({ etag: "abc123" }));
    const store = makeStore();
    const result = await store.head("org_a/importbatch_b");
    expect(result?.etag).toBe("abc123");
  });

  it("20. etag remains undefined when absent (empty string from provider)", async () => {
    headMock.mockResolvedValue(headResult({ etag: "" }));
    const store = makeStore();
    const result = await store.head("org_a/importbatch_b");
    expect(result?.etag).toBeUndefined();
  });
});

// ─── GET (21-37) ────────────────────────────────────────────────────

describe("vercelBlobFileStore — get", () => {
  it("21. success returns metadata and body", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    const result = await store.get("org_a/importbatch_b");
    expect(result.metadata).toEqual({ provider: "vercel-blob-private", size: 4, contentType: "application/octet-stream", etag: "etag-1" });
    expect(Array.from(result.body)).toEqual([1, 2, 3, 4]);
  });

  it("22. configured storeId is passed to both head and get", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    await store.get("org_a/importbatch_b");
    expect(headMock.mock.calls[0][1]).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
    expect(getMock.mock.calls[0][1]).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
  });

  it("23. access:'private' is passed to get()", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    await store.get("org_a/importbatch_b");
    expect(getMock.mock.calls[0][1]).toMatchObject({ access: "private" });
  });

  it("24. missing HEAD -> NOT_FOUND, get() never called", async () => {
    headMock.mockRejectedValue(new MockBlobNotFoundError());
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("25. maxBytes exact boundary (declared size === maxBytes) succeeds", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).resolves.toBeDefined();
  });

  it("26. HEAD size above maxBytes -> SIZE_LIMIT", async () => {
    headMock.mockResolvedValue(headResult({ size: 5 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
  });

  it("27. get() is NOT called when HEAD already exceeds maxBytes", async () => {
    headMock.mockResolvedValue(headResult({ size: 5 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).rejects.toBeDefined();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("28. streamed body exceeding maxBytes -> SIZE_LIMIT even though HEAD declared an allowed size", async () => {
    // Provider inconsistency: HEAD declares 4 bytes (<= maxBytes), but the
    // actual stream delivers more — the running ceiling must catch this
    // independently of the HEAD precheck.
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4, 5, 6])], { size: 4 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
  });

  it("29. reader cancellation is attempted when the streaming ceiling is violated", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    const gr = getResult([new Uint8Array([1, 2, 3, 4, 5, 6])], { size: 4 });
    getMock.mockResolvedValue(gr);
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
    expect((gr.stream as unknown as { __cancel: ReturnType<typeof vi.fn> }).__cancel).toHaveBeenCalledTimes(1);
  });

  it("30. a cancellation failure does not mask the SIZE_LIMIT error", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    const gr = getResult([new Uint8Array([1, 2, 3, 4, 5, 6])], { size: 4 }, async () => {
      throw new Error("cancel failed");
    });
    getMock.mockResolvedValue(gr);
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 4 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
  });

  it("31. truncated body vs HEAD size -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 10 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3])], { size: 10 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("32. larger body than HEAD declared (but within/without maxBytes) -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 2 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3])], { size: 2 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("33. provider GET failure -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockRejectedValue(new Error("service unavailable"));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("34. stream read failure -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    const stream = {
      getReader: () => ({
        read: vi.fn().mockRejectedValue(new Error("read failed")),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    };
    getMock.mockResolvedValue({ statusCode: 200, stream, blob: { etag: "etag-1", contentType: "application/octet-stream", size: 4 } });
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("35. a generic provider error is NOT misclassified as NOT_FOUND", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockRejectedValue(new Error("some unrelated failure"));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("36. body is returned as a Uint8Array", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    const result = await store.get("org_a/importbatch_b");
    expect(result.body).toBeInstanceOf(Uint8Array);
  });

  it("37. metadata.size === body.byteLength on success", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    const store = makeStore();
    const result = await store.get("org_a/importbatch_b");
    expect(result.metadata.size).toBe(result.body.byteLength);
  });

  it("extra. GET reporting the object missing after a successful HEAD is NOT_FOUND, not PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(null);
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("extra. an etag mismatch between HEAD and GET metadata -> PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 4, etag: "etag-head" }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])], { etag: "etag-get-different" }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });
});

// ─── DELETE (38-42) ─────────────────────────────────────────────────

describe("vercelBlobFileStore — delete", () => {
  it("38. success", async () => {
    delMock.mockResolvedValue(undefined);
    const store = makeStore();
    await expect(store.delete("org_a/importbatch_b")).resolves.toBeUndefined();
  });

  it("39. configured storeId is passed", async () => {
    delMock.mockResolvedValue(undefined);
    const store = makeStore();
    await store.delete("org_a/importbatch_b");
    expect(delMock.mock.calls[0][1]).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
  });

  it("40. the exact canonical key is used, no transformation", async () => {
    delMock.mockResolvedValue(undefined);
    const store = makeStore();
    await store.delete("org_a/importbatch_b");
    expect(delMock.mock.calls[0][0]).toBe("org_a/importbatch_b");
  });

  it("41. missing object is idempotent success", async () => {
    delMock.mockRejectedValue(new MockBlobNotFoundError());
    const store = makeStore();
    await expect(store.delete("org_a/importbatch_b")).resolves.toBeUndefined();
  });

  it("42. provider failure -> PROVIDER_FAILURE", async () => {
    delMock.mockRejectedValue(new Error("service unavailable"));
    const store = makeStore();
    await expect(store.delete("org_a/importbatch_b")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });
});

// ─── VALIDATION (43-47) ─────────────────────────────────────────────

describe("vercelBlobFileStore — validation runs before any provider call", () => {
  it("43. invalid PUT key -> provider never called", async () => {
    const store = makeStore();
    await expect(store.put("../escape", new Uint8Array([1]))).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("44. invalid HEAD key -> provider never called", async () => {
    const store = makeStore();
    await expect(store.head("")).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(headMock).not.toHaveBeenCalled();
  });

  it("45. invalid GET key -> provider never called", async () => {
    const store = makeStore();
    await expect(store.get("bad/../key")).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(headMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("46. invalid DELETE key -> provider never called", async () => {
    const store = makeStore();
    await expect(store.delete("has a space")).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(delMock).not.toHaveBeenCalled();
  });

  it("47. invalid maxBytes -> provider never called", async () => {
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: -1 })).rejects.toBeInstanceOf(TypeError);
    expect(headMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });
});

// ─── CROSS-STORE SAFETY (48-50) ─────────────────────────────────────

describe("vercelBlobFileStore — cross-store safety", () => {
  it("48. no operation reads process.env or the Events store's default env vars", () => {
    const code = stripComments(read("lib/data-hub/storage/vercelBlobFileStore.ts"));
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/BLOB_STORE_ID/);
    expect(code).not.toMatch(/BLOB_READ_WRITE_TOKEN/);
  });

  it("49. the configured Data Hub storeId/token is explicit on every put/head/get/delete call", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    headMock.mockResolvedValue(headResult({ size: 4 }));
    getMock.mockResolvedValue(getResult([new Uint8Array([1, 2, 3, 4])]));
    delMock.mockResolvedValue(undefined);
    const store = makeStore();
    await store.put("org_a/importbatch_b", new Uint8Array([1, 2, 3, 4]));
    await store.head("org_a/importbatch_b");
    await store.get("org_a/importbatch_b");
    await store.delete("org_a/importbatch_b");
    for (const mockFn of [putMock, headMock, getMock, delMock]) {
      const optsArg = mockFn.mock.calls[0][mockFn === putMock ? 2 : 1];
      expect(optsArg).toMatchObject({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
    }
  });

  it("50. no Events storage helper is imported or reused; no reference to the Events store name", () => {
    const code = stripComments(read("lib/data-hub/storage/vercelBlobFileStore.ts"));
    expect(code).not.toMatch(/from\s+["']@?\.?\.?\/?lib\/events/);
    expect(code).not.toMatch(/blobStorage/);
    expect(code).not.toMatch(/brainbase-blob/);
    expect(code).not.toMatch(/uploadEventArtwork|deleteEventArtworkIfManaged/);
  });
});

// ─── CONSTRUCTION SAFETY ────────────────────────────────────────────

describe("vercelBlobFileStore — construction fails closed on missing configuration", () => {
  it("throws when storeId is missing", () => {
    expect(() => createVercelBlobFileStore({ storeId: "", token: FAKE_TOKEN })).toThrow();
  });

  it("throws when token is missing", () => {
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: "" })).toThrow();
  });

  it("never falls back to a default store when construction is attempted with undefined config fields", () => {
    // @ts-expect-error deliberately omitting required fields
    expect(() => createVercelBlobFileStore({})).toThrow();
  });
});

// ─── TOKEN / STOREID SELF-CONSISTENCY (5A.2F-R1 remediation) ─────────
//
// The installed @vercel/blob 2.8.0 SDK derives the actual target store
// from the `token` string itself whenever a token is supplied, and
// never consults `options.storeId` on that path (verified from
// node_modules/@vercel/blob/dist/chunk-QMTUXFZH.cjs — see the module
// comment in vercelBlobFileStore.ts). These tests exercise the real
// verifyTokenStoreIdConsistency() logic (not mocked away) to prove a
// mismatched or malformed { storeId, token } pair is rejected at
// construction time, before any provider call is possible.

describe("vercelBlobFileStore — token/storeId self-consistency", () => {
  it("A. a consistent storeId/token pair succeeds", () => {
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN })).not.toThrow();
  });

  it("B. a token encoding a different store id than the supplied storeId throws at construction", () => {
    const mismatchedToken = "vercel_blob_rw_someTOTALLYdifferentStore999_fakeSecretNeverReal0000";
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: mismatchedToken })).toThrow();
  });

  it("C. a malformed token (no extractable store id segment) throws at construction", () => {
    const malformedToken = "totallymalformedtokenwithnounderscores";
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: malformedToken })).toThrow();
  });

  it("D. empty token is still rejected (regression)", () => {
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: "" })).toThrow();
  });

  it("E. empty storeId is still rejected (regression)", () => {
    expect(() => createVercelBlobFileStore({ storeId: "", token: FAKE_TOKEN })).toThrow();
  });

  it("F. the mismatch error message does not contain the fake token string used", () => {
    const mismatchedToken = "vercel_blob_rw_someTOTALLYdifferentStore999_superSecretPortionNeverLogged";
    let thrown: unknown;
    try {
      createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: mismatchedToken });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain(mismatchedToken);
    expect(message).not.toContain("superSecretPortionNeverLogged");
  });

  it("G. construction failure (mismatch or malformed) never results in any provider call", () => {
    const mismatchedToken = "vercel_blob_rw_someTOTALLYdifferentStore999_fakeSecretNeverReal0000";
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: mismatchedToken })).toThrow();

    const malformedToken = "totallymalformedtokenwithnounderscores";
    expect(() => createVercelBlobFileStore({ storeId: FAKE_STORE_ID, token: malformedToken })).toThrow();

    expect(putMock).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });
});

// ─── PUT byte-conversion fidelity for offset/sliced views ────────────

describe("vercelBlobFileStore — put byte-conversion fidelity", () => {
  it("put() sends exactly the offset view's bytes, never the whole backing ArrayBuffer", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();

    // One larger backing ArrayBuffer with distinct, recognizable
    // prefix/payload/suffix byte regions.
    const prefix = [0xaa, 0xaa, 0xaa, 0xaa];
    const payload = [0x01, 0x02, 0x03, 0x04, 0x05];
    const suffix = [0xbb, 0xbb, 0xbb, 0xbb];
    const backing = new Uint8Array([...prefix, ...payload, ...suffix]).buffer;

    // A VIEW into just the payload region: non-zero byteOffset, and a
    // byteLength smaller than the full backing buffer — an actual
    // "slice" view, not the whole buffer.
    const view = new Uint8Array(backing, prefix.length, payload.length);

    await store.put("org_a/importbatch_b", view);

    const sentBody = putMock.mock.calls[0][1] as Buffer;
    // This assertion is what would FAIL if the implementation
    // regressed to something like Buffer.from(body.buffer) (whole
    // backing-buffer conversion, ignoring byteOffset/byteLength).
    expect(Buffer.isBuffer(sentBody)).toBe(true);
    expect(sentBody.byteLength).toBe(payload.length);
    expect(Array.from(sentBody)).toEqual(payload);
    expect(sentBody.includes(0xaa)).toBe(false);
    expect(sentBody.includes(0xbb)).toBe(false);
  });
});

// ─── ZERO-BYTE COVERAGE ───────────────────────────────────────────────

describe("vercelBlobFileStore — zero-byte objects", () => {
  it("put() accepts a zero-byte body; provider receives a zero-length body; result.size === 0", async () => {
    putMock.mockResolvedValue({ pathname: "org_a/importbatch_b", contentType: "x", etag: "e" });
    const store = makeStore();
    const result = await store.put("org_a/importbatch_b", new Uint8Array(0));
    const sentBody = putMock.mock.calls[0][1] as Buffer;
    expect(sentBody.byteLength).toBe(0);
    expect(result.size).toBe(0);
  });

  it("head() accepts provider metadata reporting size:0 as valid, not PROVIDER_FAILURE", async () => {
    headMock.mockResolvedValue(headResult({ size: 0 }));
    const store = makeStore();
    const result = await store.head("org_a/importbatch_b");
    expect(result).toEqual({
      provider: "vercel-blob-private",
      size: 0,
      contentType: "application/octet-stream",
      etag: "etag-1",
    });
  });

  it("get() succeeds for a zero-byte object: HEAD size:0, stream yields zero bytes, maxBytes:0", async () => {
    headMock.mockResolvedValue(headResult({ size: 0 }));
    getMock.mockResolvedValue(getResult([], { size: 0 }));
    const store = makeStore();
    const result = await store.get("org_a/importbatch_b", { maxBytes: 0 });
    expect(result.metadata.size).toBe(0);
    expect(result.body.byteLength).toBe(0);
  });

  it("get() with maxBytes:0 against a non-empty HEAD-declared object rejects with SIZE_LIMIT before ever calling GET", async () => {
    headMock.mockResolvedValue(headResult({ size: 1 }));
    const store = makeStore();
    await expect(store.get("org_a/importbatch_b", { maxBytes: 0 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
    expect(getMock).not.toHaveBeenCalled();
  });
});
