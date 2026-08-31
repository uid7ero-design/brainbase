import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("staleReclaim — static containment", () => {
  it("STALE_RECLAIM_THRESHOLD_MS is a named exported constant, not a literal baked into the SQL string", () => {
    const code = read("lib/data-hub/importBatch/staleReclaim.ts");
    expect(code).toMatch(/export const STALE_RECLAIM_THRESHOLD_MS/);
    // The raw SQL template must reference a parameter/variable, never a
    // literal number of minutes/seconds hardcoded directly in the string.
    const sqlBlock = code.match(/UPDATE import_batches[\s\S]*?RETURNING id/)?.[0] ?? "";
    expect(sqlBlock).not.toMatch(/interval\s+'\d+\s+(minute|second)/i);
  });

  it("uses last_attempt_at, not updated_at, as the staleness signal", () => {
    const code = stripComments(read("lib/data-hub/importBatch/staleReclaim.ts"));
    const sqlBlock = code.match(/UPDATE import_batches[\s\S]*?RETURNING id/)?.[0] ?? "";
    expect(sqlBlock).toMatch(/last_attempt_at/);
    expect(sqlBlock).not.toMatch(/updated_at/);
  });

  it("never increments attempt_count", () => {
    const code = read("lib/data-hub/importBatch/staleReclaim.ts");
    const sqlBlock = code.match(/UPDATE import_batches[\s\S]*?RETURNING id/)?.[0] ?? "";
    expect(sqlBlock).not.toMatch(/attempt_count/);
  });

  it("computes the cutoff server-side (now()), never an app-computed timestamp value", () => {
    const code = read("lib/data-hub/importBatch/staleReclaim.ts");
    const sqlBlock = code.match(/UPDATE import_batches[\s\S]*?RETURNING id/)?.[0] ?? "";
    expect(sqlBlock).toMatch(/now\(\)/);
  });

  it("is not wired into any cron/scheduler (no scheduling API is called or imported)", () => {
    const code = stripComments(read("lib/data-hub/importBatch/staleReclaim.ts"));
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|cron\.schedule\(|node-cron|from ["']node-cron["']/);
  });
});

// ─── Mocked behavioral tests ────────────────────────────────────────

const sqlMock = vi.fn();
vi.mock("@/lib/db", () => ({
  default: (...args: unknown[]) => sqlMock(...(args as [TemplateStringsArray, ...unknown[]])),
}));

async function freshStaleReclaim() {
  vi.resetModules();
  sqlMock.mockReset();
  return import("@/lib/data-hub/importBatch/staleReclaim");
}

beforeEach(() => {
  sqlMock.mockReset();
});

describe("reclaimStaleImportBatches — behavior", () => {
  it("returns the reclaimed ids from RETURNING id", async () => {
    const { reclaimStaleImportBatches } = await freshStaleReclaim();
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }, { id: "batch-2" }]);
    const result = await reclaimStaleImportBatches();
    expect(result.reclaimedIds).toEqual(["batch-1", "batch-2"]);
  });

  it("uses the fixed, sanitized STALE_RECLAIMED message template — never a raw error string", async () => {
    const { reclaimStaleImportBatches } = await freshStaleReclaim();
    const { getMessageTemplate } = await import("@/lib/data-hub/importBatch/failureTaxonomy");
    sqlMock.mockResolvedValueOnce([]);
    await reclaimStaleImportBatches();
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(getMessageTemplate("STALE_RECLAIMED"));
  });

  it("sets last_failure_retryable = true", () => {
    const code = stripComments(read("lib/data-hub/importBatch/staleReclaim.ts"));
    const sqlBlock = code.match(/UPDATE import_batches[\s\S]*?RETURNING id/)?.[0] ?? "";
    expect(sqlBlock).toMatch(/last_failure_retryable\s*=\s*true/);
  });

  it("accepts an injected threshold override for tests (converted to seconds)", async () => {
    const { reclaimStaleImportBatches } = await freshStaleReclaim();
    sqlMock.mockResolvedValueOnce([]);
    await reclaimStaleImportBatches(5000); // 5 seconds
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(5);
  });

  it("default threshold is exactly 30 minutes in seconds (1800)", async () => {
    const { reclaimStaleImportBatches, STALE_RECLAIM_THRESHOLD_MS } = await freshStaleReclaim();
    expect(STALE_RECLAIM_THRESHOLD_MS).toBe(30 * 60 * 1000);
    sqlMock.mockResolvedValueOnce([]);
    await reclaimStaleImportBatches();
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(1800);
  });

  it("empty reclaim result returns an empty array, not null/undefined", async () => {
    const { reclaimStaleImportBatches } = await freshStaleReclaim();
    sqlMock.mockResolvedValueOnce([]);
    const result = await reclaimStaleImportBatches();
    expect(result.reclaimedIds).toEqual([]);
  });
});
