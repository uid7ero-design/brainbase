import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

const FAKE_ORG = "org_abc123";
const FAKE_BATCH = "batch_xyz789";
const FAKE_STORE_ID = "store_fakedatahub0";
const FAKE_TOKEN = "vercel_blob_rw_fakedatahub0_secretNeverReal";

// ─── Pure option-construction (NO SDK mock needed) ────────────────────

describe("directUploadAuth — buildDirectUploadTokenOptions (pure, no SDK mock)", () => {
  it("uses the real buildImportBatchKey for pathname — never a locally re-templated string", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const { buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.pathname).toBe(buildImportBatchKey(FAKE_ORG, FAKE_BATCH));
  });

  it("always includes an explicit token", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.token).toBe(FAKE_TOKEN);
  });

  it("always includes an explicit validUntil, computed as now + 15 minutes", async () => {
    const { buildDirectUploadTokenOptions, DIRECT_UPLOAD_TOKEN_TTL_MS } = await import(
      "@/lib/data-hub/importBatch/directUploadAuth"
    );
    expect(DIRECT_UPLOAD_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    const now = 1_700_000_000_000;
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
      now,
    });
    expect(options.validUntil).toBe(now + 15 * 60 * 1000);
  });

  it("allowOverwrite is always exactly false", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "xlsx",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.allowOverwrite).toBe(false);
  });

  it("addRandomSuffix is always exactly false", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "xlsx",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.addRandomSuffix).toBe(false);
  });

  it("maximumSizeInBytes is exactly MAX_SOURCE_FILE_BYTES", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "xls",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.maximumSizeInBytes).toBe(MAX_SOURCE_FILE_BYTES);
  });

  it("never sets tokenPayload, clientPayload, onUploadCompleted, or callbackUrl", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    }) as unknown as Record<string, unknown>;
    expect(options).not.toHaveProperty("tokenPayload");
    expect(options).not.toHaveProperty("clientPayload");
    expect(options).not.toHaveProperty("onUploadCompleted");
    expect(options).not.toHaveProperty("callbackUrl");
  });

  it.each([
    ["csv", ["text/csv", "application/csv"]],
    ["xls", ["application/vnd.ms-excel"]],
    ["xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  ] as const)("MIME mapping for %s is exactly %j", async (format, expected) => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format,
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.allowedContentTypes).toEqual(expected);
  });

  it("never includes application/octet-stream in any format's allowlist", async () => {
    const { DIRECT_UPLOAD_ALLOWED_CONTENT_TYPES } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    for (const list of Object.values(DIRECT_UPLOAD_ALLOWED_CONTENT_TYPES)) {
      expect(list).not.toContain("application/octet-stream");
    }
  });

  it("storeId is passed through explicitly", async () => {
    const { buildDirectUploadTokenOptions } = await import("@/lib/data-hub/importBatch/directUploadAuth");
    const options = buildDirectUploadTokenOptions({
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv",
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
    });
    expect(options.storeId).toBe(FAKE_STORE_ID);
  });
});

// ─── mintDirectUploadToken (SDK mocked) ────────────────────────────────

const generateClientTokenMock = vi.fn();

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => generateClientTokenMock(...args),
}));

describe("directUploadAuth — mintDirectUploadToken (SDK mocked)", () => {
  beforeEach(() => {
    generateClientTokenMock.mockReset();
  });

  it("calls generateClientTokenFromReadWriteToken with exactly the built options", async () => {
    generateClientTokenMock.mockResolvedValue("fake-client-token");
    const { mintDirectUploadToken, buildDirectUploadTokenOptions } = await import(
      "@/lib/data-hub/importBatch/directUploadAuth"
    );
    const input = {
      organisationId: FAKE_ORG,
      importBatchId: FAKE_BATCH,
      format: "csv" as const,
      storeId: FAKE_STORE_ID,
      token: FAKE_TOKEN,
      now: 1_700_000_000_000,
    };
    const token = await mintDirectUploadToken(input);
    expect(token).toBe("fake-client-token");
    expect(generateClientTokenMock).toHaveBeenCalledTimes(1);
    expect(generateClientTokenMock.mock.calls[0][0]).toEqual(buildDirectUploadTokenOptions(input));
  });
});

// ─── Import-path verification (static) ─────────────────────────────────

describe("directUploadAuth — import path verification", () => {
  it("imports generateClientTokenFromReadWriteToken from '@vercel/blob/client', not the main entry point", () => {
    const code = read("lib/data-hub/importBatch/directUploadAuth.ts");
    expect(code).toMatch(/from ["']@vercel\/blob\/client["']/);
    expect(code).not.toMatch(/generateClientTokenFromReadWriteToken.*from ["']@vercel\/blob["'](?!\/client)/);
  });

  it("never calls handleUpload or handleUploadPresigned", () => {
    const code = read("lib/data-hub/importBatch/directUploadAuth.ts");
    expect(code).not.toMatch(/handleUpload\(/);
    expect(code).not.toMatch(/handleUploadPresigned\(/);
  });

  it("uses buildImportBatchKey from rawFileStore rather than a locally re-templated string", () => {
    const code = read("lib/data-hub/importBatch/directUploadAuth.ts");
    expect(code).toMatch(/buildImportBatchKey/);
    expect(code).not.toMatch(/org_\$\{|importbatch_\$\{/);
  });
});
