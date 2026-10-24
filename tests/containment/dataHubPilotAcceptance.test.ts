import { afterEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";
import manifest from "@/config/data-hub/onkaparinga-monthly-operations-v1.json";
import { createPilotWorkbook } from "../../scripts/tests/helpers/dataHubPilotWorkbook.mjs";
import blob from "../../scripts/tests/helpers/localDataHubBlobFixture.cjs";

const root = path.resolve("test-results/runs-pilot-acceptance");
const owned: string[] = [];
afterEach(() => { for (const folder of owned.splice(0)) {
  if (!folder.startsWith(root + path.sep + "unit-")) throw new Error("CLEANUP_SCOPE_INVALID");
  rmSync(folder, { recursive: true, force: true });
} });
function setup() {
  mkdirSync(root, { recursive: true }); const folder = mkdtempSync(path.join(root, "unit-")); owned.push(folder);
  const bytes = Buffer.from("synthetic bytes only"), sha = createHash("sha256").update(bytes).digest("hex");
  const provider = blob.createProvider(folder, sha);
  const key = "org_mapping-proof-org/importbatch_opaque-id", url = `${blob.API}/api/blob/?${new URLSearchParams({ pathname: key })}`;
  function token(patch = {}) {
    const payload = Buffer.from(JSON.stringify({ pathname: key, allowOverwrite: false, addRandomSuffix: false,
      storeId: blob.STORE, allowedContentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      maximumSizeInBytes: 100000, validUntil: Date.now() + 60000, ...patch })).toString("base64");
    const signature = createHmac("sha256", blob.TOKEN).update(payload).digest("hex");
    return `Bearer vercel_blob_client_${blob.STORE}_${Buffer.from(signature + "." + payload).toString("base64")}`;
  }
  return { folder, bytes, sha, provider, key, url, token };
}
describe("complete pilot acceptance fixture boundaries", () => {
  it("constructs all exact headers and synthetic typed zero/null/day/rate/identifier values", () => {
    const workbook = XLSX.read(createPilotWorkbook(), { type: "buffer", cellDates: true });
    expect(workbook.SheetNames).toEqual(manifest.worksheets.map(w => w.name));
    expect(manifest.worksheets.reduce((sum, w) => sum + w.columns.length, 0)).toBe(295);
    for (const spec of manifest.worksheets) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[spec.name], { header: 1, defval: null });
      expect(rows[0][0]).toContain("SYNTHETIC"); expect(rows[2] ?? []).toEqual(spec.columns.map(c => c.header));
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Runs, { header: 1, defval: null });
    expect(rows[3][0]).toBe("0001"); expect(rows[3][6]).toBe(0); expect(rows[3][8]).toBeNull();
    expect(rows[4][8]).toBe(0); expect(rows[3][14]).toBe(0.5); expect(rows[3][17]).toBe(0.5);
  });
  it("accepts exact signed uploads once and preserves their bytes and metadata", () => {
    const f = setup(); expect(f.provider.metadata(f.key)).toBeNull();
    expect(f.provider.accept(f.url, f.token(), f.bytes)).toMatchObject({ pathname: f.key, size: f.bytes.length, etag: f.sha });
    expect(f.provider.metadata(f.key)).toMatchObject({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(() => f.provider.accept(f.url, f.token(), f.bytes)).toThrow("FIXTURE_UPLOAD_REJECTED");
  });
  it.each([{ pathname: "foreign" }, { storeId: "foreign" }, { allowedContentTypes: ['*/*'] }, { allowOverwrite: true }, { addRandomSuffix: true }, { maximumSizeInBytes: 1 }, { maximumSizeInBytes: null }, { validUntil: 0 }])("rejects unsafe or mismatched token scope %j", patch => {
    const f = setup(); expect(() => f.provider.accept(f.url, f.token(patch), f.bytes)).toThrow("FIXTURE_UPLOAD_REJECTED");
    expect(f.provider.metadata(f.key)).toBeNull();
  });
  it("rejects wrong content, forged authentication and foreign keys before writing", () => {
    const f = setup(); expect(() => f.provider.accept(f.url, f.token(), Buffer.from("different"))).toThrow("FIXTURE_UPLOAD_REJECTED");
    expect(() => f.provider.accept(f.url, "Bearer forged", f.bytes)).toThrow("FIXTURE_CLIENT_TOKEN_INVALID");
    expect(() => f.provider.accept(`${blob.API}/api/blob/?pathname=org_foreign/importbatch_x`, f.token(), f.bytes)).toThrow("FIXTURE_UPLOAD_SCOPE_INVALID");
    expect(() => f.provider.accept("https://foreign.invalid/", f.token(), f.bytes)).toThrow("FIXTURE_UPLOAD_SCOPE_INVALID");
  });
  it("cannot use a filesystem target outside its owned evidence directory", () => {
    expect(() => blob.createProvider(path.resolve("scripts"), "a".repeat(64))).toThrow("OWNED_BLOB_DIRECTORY_REQUIRED");
  });
  it("refuses a nonlocal database before installing any provider transport", () => {
    const child = spawnSync(process.execPath, ["-e", "require('./scripts/tests/helpers/localDataHubBlobFixture.cjs')"], {
      windowsHide: true, encoding: "utf8", env: { ...process.env, DATAHUB_PILOT_UPLOAD_PROOF: "1", DATAHUB_BROWSER_PROOF: "1", DATABASE_URL: "postgresql://production.invalid/neondb" },
    });
    expect(child.status).not.toBe(0); expect(child.stderr).toContain("OWNED_LOCAL_BLOB_HARNESS_REQUIRED");
  });
});
