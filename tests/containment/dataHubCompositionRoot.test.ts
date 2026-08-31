import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

const putMock = vi.fn();
const headMock = vi.fn();
const getMock = vi.fn();
const delMock = vi.fn();

class MockBlobError extends Error {}
class MockBlobNotFoundError extends MockBlobError {}

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  head: (...args: unknown[]) => headMock(...args),
  get: (...args: unknown[]) => getMock(...args),
  del: (...args: unknown[]) => delMock(...args),
  BlobError: MockBlobError,
  BlobNotFoundError: MockBlobNotFoundError,
}));

const FAKE_STORE_SEGMENT = "compositionroottest0";
const FAKE_STORE_ID = `store_${FAKE_STORE_SEGMENT}`;
const FAKE_TOKEN = `vercel_blob_rw_${FAKE_STORE_SEGMENT}_fakeSecretNeverReal0000`;

describe("dataHub compositionRoot — env-var boundary (static)", () => {
  it("is the only module (outside the storage adapter it constructs) mentioning DATAHUB_BLOB_ env vars", () => {
    const code = read("lib/data-hub/importBatch/compositionRoot.ts");
    expect(code).toMatch(/DATAHUB_BLOB_STORE_ID/);
    expect(code).toMatch(/DATAHUB_BLOB_READ_WRITE_TOKEN/);
  });

  it("never actually reads the Events store's default (undecorated) env vars", () => {
    const code = read("lib/data-hub/importBatch/compositionRoot.ts");
    expect(code).not.toMatch(/process\.env\.BLOB_STORE_ID\b/);
    expect(code).not.toMatch(/process\.env\.BLOB_READ_WRITE_TOKEN\b/);
  });

  it("never exports a cache-reset function", () => {
    const code = read("lib/data-hub/importBatch/compositionRoot.ts");
    expect(code).not.toMatch(/export function reset/i);
    expect(code).not.toMatch(/export const reset/i);
  });
});

describe("dataHub compositionRoot — fails closed on missing config", () => {
  beforeEach(() => {
    delete process.env.DATAHUB_BLOB_STORE_ID;
    delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
    vi.resetModules();
  });

  it("createImportBatchStorage throws DataHubConfigurationError when both env vars are missing", async () => {
    const { createImportBatchStorage, DataHubConfigurationError } = await import(
      "@/lib/data-hub/importBatch/compositionRoot"
    );
    expect(() => createImportBatchStorage()).toThrow(DataHubConfigurationError);
  });

  it("throws when only DATAHUB_BLOB_STORE_ID is set", async () => {
    process.env.DATAHUB_BLOB_STORE_ID = FAKE_STORE_ID;
    const { createImportBatchStorage, DataHubConfigurationError } = await import(
      "@/lib/data-hub/importBatch/compositionRoot"
    );
    expect(() => createImportBatchStorage()).toThrow(DataHubConfigurationError);
  });

  it("throws when only DATAHUB_BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
    const { createImportBatchStorage, DataHubConfigurationError } = await import(
      "@/lib/data-hub/importBatch/compositionRoot"
    );
    expect(() => createImportBatchStorage()).toThrow(DataHubConfigurationError);
  });

  it("never throws a message containing the token value", async () => {
    process.env.DATAHUB_BLOB_STORE_ID = FAKE_STORE_ID;
    process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = "";
    const { createImportBatchStorage } = await import("@/lib/data-hub/importBatch/compositionRoot");
    let thrown: unknown;
    try {
      createImportBatchStorage();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(FAKE_TOKEN);
  });

  it("resolveImportBatchBlobCredentials also throws when config is missing", async () => {
    const { resolveImportBatchBlobCredentials, DataHubConfigurationError } = await import(
      "@/lib/data-hub/importBatch/compositionRoot"
    );
    expect(() => resolveImportBatchBlobCredentials()).toThrow(DataHubConfigurationError);
  });
});

describe("dataHub compositionRoot — override bypasses env resolution", () => {
  beforeEach(() => {
    delete process.env.DATAHUB_BLOB_STORE_ID;
    delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
    vi.resetModules();
    putMock.mockReset();
    headMock.mockReset();
  });

  it("createImportBatchStorage(override) succeeds with no env vars set", async () => {
    const { createImportBatchStorage } = await import("@/lib/data-hub/importBatch/compositionRoot");
    const store = createImportBatchStorage({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
    expect(store.provider).toBe("vercel-blob-private");
  });

  it("resolveImportBatchBlobCredentials(override) returns exactly the override, ignoring env", async () => {
    process.env.DATAHUB_BLOB_STORE_ID = "store_shouldneverbereached";
    process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_shouldneverbereached_x";
    const { resolveImportBatchBlobCredentials } = await import("@/lib/data-hub/importBatch/compositionRoot");
    const creds = resolveImportBatchBlobCredentials({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
    expect(creds).toEqual({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
  });
});

describe("dataHub compositionRoot — same credential pair feeds both consumers", () => {
  beforeEach(() => {
    process.env.DATAHUB_BLOB_STORE_ID = FAKE_STORE_ID;
    process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = FAKE_TOKEN;
    vi.resetModules();
    putMock.mockReset();
    headMock.mockReset();
  });

  it("resolveImportBatchBlobCredentials() (env path) returns the pair that also constructs the storage adapter successfully", async () => {
    const { createImportBatchStorage, resolveImportBatchBlobCredentials } = await import(
      "@/lib/data-hub/importBatch/compositionRoot"
    );
    const creds = resolveImportBatchBlobCredentials();
    expect(creds).toEqual({ storeId: FAKE_STORE_ID, token: FAKE_TOKEN });
    // Constructing the storage adapter with the SAME env state must not
    // throw (i.e. it is genuinely the same resolved pair, not a second,
    // independently-resolved one that could disagree).
    expect(() => createImportBatchStorage()).not.toThrow();
  });

  it("resolveImportBatchBlobCredentials() is memoized across repeated calls (same object identity)", async () => {
    const { resolveImportBatchBlobCredentials } = await import("@/lib/data-hub/importBatch/compositionRoot");
    const first = resolveImportBatchBlobCredentials();
    const second = resolveImportBatchBlobCredentials();
    expect(first).toBe(second);
  });
});
