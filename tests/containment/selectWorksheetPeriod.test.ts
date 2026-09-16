import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 6.2B1 — static containment + mocked-behavioral proof for the
// dedicated worksheet reporting-period-selection service
// (selectWorksheetPeriod.ts) and its route
// (app/api/data-hub/worksheets/[id]/period-selection/route.ts).
//
// Real-Postgres proofs (P1-P9) live in
// tests/postgres-proof/selectWorksheetPeriod.postgres-proof.test.ts — this
// file does not attempt to prove genuine DB-level atomicity, since a
// mocked prisma.$transaction cannot.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/selectWorksheetPeriod.ts";
const ROUTE_PATH = "app/api/data-hub/worksheets/[id]/period-selection/route.ts";

// ─── K16: no domain-specific / inference vocabulary ────────────────────

describe("selectWorksheetPeriod — K16: no filename detection / inference / row min-max vocabulary", () => {
  const code = stripComments(read(SERVICE_PATH));

  it("never references report_date, resolution_date, filename parsing, or a row min/max derivation", () => {
    expect(code).not.toMatch(/report_date/);
    expect(code).not.toMatch(/resolution_date/);
    expect(code).not.toMatch(/originalFilename|original_filename/);
    expect(code).not.toMatch(/Math\.min|Math\.max/);
  });

  it("never hard-codes an Onkaparinga/tenant/domain-kind identifier", () => {
    expect(code.toLowerCase()).not.toMatch(/onkaparinga/);
    expect(code).not.toMatch(/domain_kind\s*:\s*["']/);
  });

  it("never resolves its own session/auth (dark service discipline, mirrors selectWorksheetMapping.ts)", () => {
    expect(code).not.toMatch(/requireSession|requireRole/);
    expect(code).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(code).not.toMatch(/next\/server/);
  });
});

// ─── Trusted-input-only shape ───────────────────────────────────────────

describe("selectWorksheetPeriod — trusted-context-only input shape", () => {
  const code = read(SERVICE_PATH);

  it("never accepts organisationId, sourceSystemId, or periodSource as a caller choice beyond the trusted context", () => {
    const block = code.match(/export interface SelectWorksheetPeriodTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/worksheetUploadId:\s*string/);
    expect(block).toMatch(/periodStart:\s*unknown/);
    expect(block).toMatch(/periodEnd:\s*unknown/);
    expect(block).not.toMatch(/periodSource/);
    expect(block).not.toMatch(/sourceSystemId/);
  });

  it("K10: period_source is always the fixed literal \"MANUAL\", never derived from any input field", () => {
    expect(code).toMatch(/period_source:\s*["']MANUAL["']/);
    expect(code).not.toMatch(/context\.periodSource/);
  });
});

// ─── One transaction, atomic conditional write ─────────────────────────

describe("selectWorksheetPeriod — one transaction, atomic conditional write", () => {
  const code = read(SERVICE_PATH);

  it("prisma.$transaction is called exactly once", () => {
    const matches = code.match(/prisma\.\$transaction\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("the write is a single conditional updateMany whose where clause repeats id, organisation_id, lineage_kind, and canonical_status = AWAITING_CONFIRMATION", () => {
    const updateCall = code.match(/tx\.upload\.updateMany\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(updateCall).toMatch(/id:\s*worksheetUploadId/);
    expect(updateCall).toMatch(/organisation_id:\s*organisationId/);
    expect(updateCall).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
    expect(updateCall).toMatch(/canonical_status:\s*["']AWAITING_CONFIRMATION["']/);
  });

  it("no plain prisma.upload.update / unconditional updateMany exists anywhere", () => {
    expect(code).not.toMatch(/prisma\.upload\.update\(/);
    const updateManyMatches = code.match(/\.upload\.updateMany\(/g) ?? [];
    expect(updateManyMatches).toHaveLength(1);
  });

  it("does NOT gate on SourceSystem.reporting_period_required — that is exclusively confirmDataHubWorksheet's own job", () => {
    // Documentation-only mention in the header comment is fine (explains
    // why this is deliberately absent) — no EXECUTABLE reference may exist.
    expect(stripComments(code)).not.toMatch(/reporting_period_required/);
  });
});

// ─── Mocked-behavioral tests: selectWorksheetPeriod's own decision logic ──

const findFirstMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const updateManyMock = vi.fn();

function txStub() {
  return {
    upload: { findFirst: (...a: unknown[]) => findFirstMock(...a), updateMany: (...a: unknown[]) => updateManyMock(...a) },
    importBatch: { findUnique: (...a: unknown[]) => importBatchFindUniqueMock(...a) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) => cb(txStub()),
  },
}));

async function freshService() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/selectWorksheetPeriod");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "worksheet-1", import_batch_id: "batch-1", canonical_status: "AWAITING_CONFIRMATION", ...overrides };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { source_system_id: "source-1", ...overrides };
}

function mockHappyPath(overrides: { worksheet?: Partial<Record<string, unknown>>; batch?: Partial<Record<string, unknown>>; claimCount?: number } = {}) {
  findFirstMock.mockResolvedValue(worksheetRow(overrides.worksheet));
  importBatchFindUniqueMock.mockResolvedValue(batchRow(overrides.batch));
  updateManyMock.mockResolvedValue({ count: overrides.claimCount ?? 1 });
}

beforeEach(() => {
  findFirstMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  updateManyMock.mockReset();
});

describe("selectWorksheetPeriod — K1: valid range accepted", () => {
  it("a valid, ordered ISO date pair is accepted and persisted with period_source MANUAL", async () => {
    const { selectWorksheetPeriod } = await freshService();
    mockHappyPath();
    const result = await selectWorksheetPeriod({
      organisationId: "org-1",
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(result).toEqual({
      ok: true,
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      periodSource: "MANUAL",
    });
    const updateArg = updateManyMock.mock.calls[0][0];
    expect(updateArg.data.period_source).toBe("MANUAL");
  });

  it("an equal start/end (a single-day period) is accepted", async () => {
    const { selectWorksheetPeriod } = await freshService();
    mockHappyPath();
    const result = await selectWorksheetPeriod({
      organisationId: "org-1",
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-03-15",
      periodEnd: "2026-03-15",
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("selectWorksheetPeriod — K2: start > end rejected", () => {
  it("periodStart after periodEnd -> INVALID_REPORTING_PERIOD, no DB call at all", async () => {
    const { selectWorksheetPeriod } = await freshService();
    const result = await selectWorksheetPeriod({
      organisationId: "org-1",
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-02-01",
      periodEnd: "2026-01-01",
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_REPORTING_PERIOD" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe("selectWorksheetPeriod — K3: malformed/non-calendar date rejected", () => {
  const badInputs = ["2026-13-01", "2026-02-30", "not-a-date", "2026/01/01", "", 12345, null, undefined];
  for (const bad of badInputs) {
    it(`periodStart=${JSON.stringify(bad)} -> INVALID_REPORTING_PERIOD, no DB call`, async () => {
      const { selectWorksheetPeriod } = await freshService();
      const result = await selectWorksheetPeriod({
        organisationId: "org-1",
        worksheetUploadId: "worksheet-1",
        periodStart: bad,
        periodEnd: "2026-01-31",
      });
      expect(result).toMatchObject({ ok: false, code: "INVALID_REPORTING_PERIOD" });
      expect(findFirstMock).not.toHaveBeenCalled();
    });
  }
});

describe("selectWorksheetPeriod — K4: only one boundary supplied rejected", () => {
  it("periodEnd missing (undefined) -> INVALID_REPORTING_PERIOD", async () => {
    const { selectWorksheetPeriod } = await freshService();
    const result = await selectWorksheetPeriod({
      organisationId: "org-1",
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-01-01",
      periodEnd: undefined,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_REPORTING_PERIOD" });
  });

  it("periodStart missing (undefined) -> INVALID_REPORTING_PERIOD", async () => {
    const { selectWorksheetPeriod } = await freshService();
    const result = await selectWorksheetPeriod({
      organisationId: "org-1",
      worksheetUploadId: "worksheet-1",
      periodStart: undefined,
      periodEnd: "2026-01-31",
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_REPORTING_PERIOD" });
  });
});

describe("selectWorksheetPeriod — K5: selection allowed while AWAITING_CONFIRMATION (incl. reselection)", () => {
  it("a second selection call while still AWAITING_CONFIRMATION succeeds and overwrites the prior one", async () => {
    const { selectWorksheetPeriod } = await freshService();
    mockHappyPath();
    const first = await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    const second = await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-02-01", periodEnd: "2026-02-28" });
    expect(first).toMatchObject({ ok: true, periodStart: "2026-01-01" });
    expect(second).toMatchObject({ ok: true, periodStart: "2026-02-01" });
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });
});

describe("selectWorksheetPeriod — K6: selection/reselection blocked after IMPORTED", () => {
  it("canonical_status IMPORTED -> WORKSHEET_NOT_ELIGIBLE, no write attempted", async () => {
    const { selectWorksheetPeriod } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "IMPORTED" }));
    const result = await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("a lost race (claim.count === 0) also yields WORKSHEET_NOT_ELIGIBLE", async () => {
    const { selectWorksheetPeriod } = await freshService();
    mockHappyPath({ claimCount: 0 });
    const result = await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
  });
});

describe("selectWorksheetPeriod — K7: foreign-tenant worksheet not exposed", () => {
  it("a worksheet not matched by the tenant-scoped findFirst (wrong org/nonexistent/legacy lineage) -> WORKSHEET_NOT_FOUND, indistinguishable", async () => {
    const { selectWorksheetPeriod } = await freshService();
    findFirstMock.mockResolvedValue(null);
    const result = await selectWorksheetPeriod({ organisationId: "org-2", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("the tenant+lineage predicate is passed in the SAME findFirst call (never fetch-then-check)", async () => {
    const { selectWorksheetPeriod } = await freshService();
    findFirstMock.mockResolvedValue(null);
    await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    const callArg = findFirstMock.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ id: "worksheet-1", organisation_id: "org-1", lineage_kind: "DATA_HUB" });
  });
});

describe("selectWorksheetPeriod — SOURCE_LINEAGE_REQUIRED (mirrors selectWorksheetMapping's own rule)", () => {
  it("a NULL batch.source_system_id blocks selection entirely", async () => {
    const { selectWorksheetPeriod } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await selectWorksheetPeriod({ organisationId: "org-1", worksheetUploadId: "worksheet-1", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});

// ─── K8/K9: route-level auth + server-set period_source ────────────────

describe("period-selection route — K8: requires manager+", () => {
  const code = read(ROUTE_PATH);
  it("calls requireRole(\"manager\")", () => {
    expect(code).toMatch(/requireRole\(["']manager["']\)/);
  });
});

describe("period-selection route — K9/K10: request allowlist, server-set period_source", () => {
  const code = read(ROUTE_PATH);
  it("reads exactly periodStart/periodEnd from the body, never organisationId/sourceSystemId/periodSource", () => {
    expect(code).toMatch(/periodStart:\s*body\.periodStart/);
    expect(code).toMatch(/periodEnd:\s*body\.periodEnd/);
    expect(code).not.toMatch(/body\.organisationId/);
    expect(code).not.toMatch(/body\.sourceSystemId/);
    expect(code).not.toMatch(/body\.periodSource/);
  });

  it("organisationId is sourced exclusively from the resolved session, never request input", () => {
    expect(code).toMatch(/organisationId:\s*session\.organisationId/);
  });
});
