// Data Hub 6.2B1 — real disposable-Postgres proof for the reporting-period
// foundation: scripts/create-datahub-reporting-period.sql's own additive
// schema (Upload.period_start/period_end/period_source,
// SourceSystem.reporting_period_required), selectWorksheetPeriod.ts, and
// confirmWorksheet.ts's new Step 3.6 gate.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/selectWorksheetPeriod.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` Docker container, never
// Production/Preview. Only the Blob storage composition root is mocked (an
// in-memory byte store keyed by import-batch key), exactly matching
// confirmWorksheetReconciliation.postgres-proof.test.ts's own established
// pattern.
//
// SCHEMA SETUP (see the runbook in the final implementation report): the
// target disposable database must already have the FULL Data Hub schema
// applied — every prior hand-written migration script in dependency order,
// PLUS scripts/create-datahub-reporting-period.sql itself — before this
// file is invoked. This proof never runs `prisma db push`; it exercises
// the real, hand-written migration's own constraints (the CHECK constraint
// in particular, which `db push` alone would not create from
// prisma/schema.prisma, since Prisma cannot express a cross-column CHECK).
//
// Scope — the 9 scenarios (P1-P9):
//   P1. additive schema allows historical NULL (a worksheet created with
//       no period, read back faithfully as null, never an error)
//   P2. the pair/range CHECK constraint rejects one-sided pairs and
//       start>end, and accepts a valid pair, at the raw DB level
//   P3. a manual selection persists DATE values with zero timezone drift
//       (the exact calendar date written is the exact calendar date read
//       back, regardless of server timezone)
//   P4. the period is frozen (immutable) once confirmDataHubWorksheet's
//       own claim succeeds — a post-confirmation reselection attempt fails
//       closed and mutates nothing
//   P5. a SourceSystem with reporting_period_required=true blocks
//       confirmation of a worksheet with an unresolved (NULL) period
//   P6. a SourceSystem with reporting_period_required=false (the default)
//       preserves pre-6.2B1 confirmation behavior for a NULL period
//   P7. a deterministic selection-vs-confirm write-boundary proof: once a
//       worksheet's canonical_status transitions to IMPORTED, a
//       still-in-flight selection attempt against it always loses its own
//       atomic claim (WORKSHEET_NOT_ELIGIBLE) — never a mixed/partial
//       state, mirrors confirmWorksheet.test.ts's own "DETERMINISTIC
//       selection-vs-confirm write-boundary race proof" naming convention
//       for the identical underlying safety property, proven here against
//       a REAL Postgres atomic UPDATE ... WHERE rather than a mock
//   P8. two independent worksheets (different batches) may share an
//       identical (period_start, period_end) pair — proves no premature
//       uniqueness constraint exists
//   P9. a confirmation failure that never reaches (or never commits) its
//       own transaction leaves an already-selected period completely
//       untouched — no partial mutation of any kind

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55434")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.2B1 proof container (port 55434). " +
      "This proof must never run against Production/Preview."
  );
}

const inMemoryBlobs = new Map<string, Buffer>();

vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "in-memory-proof-store",
    put: vi.fn(),
    head: vi.fn(),
    get: async (key: string) => {
      const body = inMemoryBlobs.get(key);
      if (!body) throw new Error(`proof store: no blob for key ${key}`);
      return { body };
    },
    delete: vi.fn(),
  }),
}));

// Same AsyncLocalStorage-routed prisma singleton mock as
// confirmWorksheetReconciliation.postgres-proof.test.ts — see that file's
// own header comment for the full rationale.
const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) {
          throw new Error("selectWorksheetPeriod proof: no active PrismaClient bound for this call");
        }
        return Reflect.get(client, prop, client);
      },
    }
  ),
}));

function runWithClient<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return activeClientStorage.run(client, fn);
}

// Fixture setup/assertions use their own separate, ordinary PrismaClient.
const prisma = new PrismaClient();

const HEADERS = ["report_date", "location", "waste_type", "source_external_id"];

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

async function freshSelectPeriod() {
  vi.resetModules();
  return import("../../lib/data-hub/importBatch/selectWorksheetPeriod");
}
async function freshConfirm() {
  vi.resetModules();
  return import("../../lib/data-hub/importBatch/confirmWorksheet");
}

describe("6.2B1 reporting-period foundation — real disposable Postgres proof", () => {
  let organisationId: string;
  let sourceSystemRequired: string;
  let sourceSystemNotRequired: string;
  let actor: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "6.2B1 Proof Org", slug: `proof-org-6-2b1-${Date.now()}` },
    });
    organisationId = org.id;

    const u = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor-${Date.now()}`, name: "Proof Actor" },
    });
    actor = u.id;

    // Every existing row (including this one, created via ordinary
    // Prisma create with no explicit value) defaults reporting_period_required
    // to false — P6 relies on this default, never an explicit override.
    const sNotRequired = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "6.2B1 Proof SourceSystem (not required)", active: true },
    });
    sourceSystemNotRequired = sNotRequired.id;

    const sRequired = await prisma.sourceSystem.create({
      data: {
        organisation_id: organisationId,
        name: "6.2B1 Proof SourceSystem (required)",
        active: true,
        reporting_period_required: true,
      },
    });
    sourceSystemRequired = sRequired.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh, eligible worksheet+batch for the given SourceSystem. */
  async function createWorksheet(sourceSystemId: string, label: string, extId: string) {
    const csv = buildCsv(HEADERS, [["2026-01-01", "Main St", "tyres", extId]]);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");

    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        source_system_id: sourceSystemId,
        original_filename: `${label}.csv`,
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${label}-${Date.now()}-${Math.random()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(organisationId, batch.id), body);

    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: `${label}.csv`,
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch.id,
        worksheet_index: 0,
        // read.ts's own toWorksheetDTO invariant requires every DATA_HUB-lineage
        // row to carry these three structural columns non-null (P1 below reads
        // this worksheet back through getWorksheet, unlike this fixture's own
        // sibling in confirmWorksheetReconciliation.postgres-proof.test.ts,
        // which never does).
        worksheet_name: `${label}.csv`,
        worksheet_visibility: "visible",
        worksheet_is_empty: false,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: null,
      },
    });
    return { batchId: batch.id, worksheetId: worksheet.id, sha256, body };
  }

  it("P1. additive schema allows historical NULL — a worksheet created with no period reads back periodStart/periodEnd/periodSource as null, never an error", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p1", `P1-${Date.now()}`);
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.period_start).toBeNull();
    expect(row.period_end).toBeNull();
    expect(row.period_source).toBeNull();

    // Also proves the read.ts DTO path faithfully preserves this NULL.
    // read.ts is routed through the SAME AsyncLocalStorage-scoped `@/lib/prisma`
    // mock as selectWorksheetPeriod.ts/confirmWorksheet.ts (see this file's own
    // header) — its calls must run inside runWithClient, exactly like every
    // other cross-module call in this proof file.
    const client = new PrismaClient();
    try {
      vi.resetModules();
      const { getWorksheet } = await import("../../lib/data-hub/importBatch/read");
      const result = await runWithClient(client, () => getWorksheet({ organisationId, worksheetId }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.worksheet.periodStart).toBeNull();
      expect(result.worksheet.periodEnd).toBeNull();
    } finally {
      await client.$disconnect();
    }
  });

  it("P2. the pair/range CHECK constraint rejects a one-sided pair and start>end, and accepts a valid pair", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p2", `P2-${Date.now()}`);

    await expect(
      prisma.$executeRaw`UPDATE uploads SET period_start = '2026-01-01' WHERE id = ${worksheetId}`
    ).rejects.toThrow();

    await expect(
      prisma.$executeRaw`UPDATE uploads SET period_start = '2026-02-01', period_end = '2026-01-01' WHERE id = ${worksheetId}`
    ).rejects.toThrow();

    await prisma.$executeRaw`UPDATE uploads SET period_start = '2026-01-01', period_end = '2026-01-31' WHERE id = ${worksheetId}`;
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.period_start?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(row.period_end?.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("P3. a manual selection persists DATE values with zero timezone drift", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p3", `P3-${Date.now()}`);
    const client = new PrismaClient();
    let result: Awaited<ReturnType<(typeof import("../../lib/data-hub/importBatch/selectWorksheetPeriod"))["selectWorksheetPeriod"]>>;
    try {
      const { selectWorksheetPeriod } = await freshSelectPeriod();
      result = await runWithClient(client, () =>
        selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-06-15", periodEnd: "2026-06-20" })
      );
    } finally {
      await client.$disconnect();
    }
    expect(result).toEqual({ ok: true, worksheetUploadId: worksheetId, periodStart: "2026-06-15", periodEnd: "2026-06-20", periodSource: "MANUAL" });

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.period_start?.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(row.period_end?.toISOString().slice(0, 10)).toBe("2026-06-20");
    expect(row.period_source).toBe("MANUAL");
  });

  it("P4. the period is frozen once confirmation succeeds — a post-confirmation reselection fails closed and mutates nothing", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p4", `P4-${Date.now()}`);

    const selectClient = new PrismaClient();
    try {
      const { selectWorksheetPeriod } = await freshSelectPeriod();
      const selected = await runWithClient(selectClient, () =>
        selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-03-01", periodEnd: "2026-03-31" })
      );
      expect(selected).toMatchObject({ ok: true });
    } finally {
      await selectClient.$disconnect();
    }

    const confirmClient = new PrismaClient();
    try {
      const { confirmDataHubWorksheet } = await freshConfirm();
      const confirmed = await runWithClient(confirmClient, () =>
        confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor })
      );
      expect(confirmed).toMatchObject({ ok: true, alreadyImported: false });
    } finally {
      await confirmClient.$disconnect();
    }

    const frozen = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(frozen.canonical_status).toBe("IMPORTED");
    expect(frozen.period_start?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(frozen.period_end?.toISOString().slice(0, 10)).toBe("2026-03-31");

    const reselectClient = new PrismaClient();
    try {
      const { selectWorksheetPeriod } = await freshSelectPeriod();
      const reselected = await runWithClient(reselectClient, () =>
        selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-04-01", periodEnd: "2026-04-30" })
      );
      expect(reselected).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    } finally {
      await reselectClient.$disconnect();
    }

    const stillFrozen = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(stillFrozen.period_start?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(stillFrozen.period_end?.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("P5. a required SourceSystem blocks confirmation of a worksheet with an unresolved (NULL) period", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemRequired, "p5", `P5-${Date.now()}`);
    const client = new PrismaClient();
    let result: Awaited<ReturnType<(typeof import("../../lib/data-hub/importBatch/confirmWorksheet"))["confirmDataHubWorksheet"]>>;
    try {
      const { confirmDataHubWorksheet } = await freshConfirm();
      result = await runWithClient(client, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor }));
    } finally {
      await client.$disconnect();
    }
    expect(result).toMatchObject({ ok: false, code: "REPORTING_PERIOD_REQUIRED" });

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.canonical_status).toBe("AWAITING_CONFIRMATION");
  });

  it("P6. a non-required SourceSystem (the default) preserves pre-6.2B1 confirmation behavior for a NULL period", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p6", `P6-${Date.now()}`);
    const client = new PrismaClient();
    let result: Awaited<ReturnType<(typeof import("../../lib/data-hub/importBatch/confirmWorksheet"))["confirmDataHubWorksheet"]>>;
    try {
      const { confirmDataHubWorksheet } = await freshConfirm();
      result = await runWithClient(client, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor }));
    } finally {
      await client.$disconnect();
    }
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.canonical_status).toBe("IMPORTED");
    expect(row.period_start).toBeNull();
    expect(row.period_end).toBeNull();
  });

  it("P7. DETERMINISTIC selection-vs-confirm write-boundary proof — once IMPORTED, a still-in-flight selection always loses its own atomic claim (real Postgres UPDATE...WHERE, never a mixed state)", async () => {
    const { worksheetId } = await createWorksheet(sourceSystemNotRequired, "p7", `P7-${Date.now()}`);

    // Confirm wins first (deterministic ordering — proves the SAME
    // atomic-conditional-write safety property a genuine concurrent race
    // would, without depending on real scheduler timing, mirroring
    // confirmWorksheet.test.ts's own "DETERMINISTIC...race proof" framing).
    const confirmClient = new PrismaClient();
    try {
      const { confirmDataHubWorksheet } = await freshConfirm();
      const confirmed = await runWithClient(confirmClient, () =>
        confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor })
      );
      expect(confirmed).toMatchObject({ ok: true });
    } finally {
      await confirmClient.$disconnect();
    }

    // The "loser" — a selection attempt racing against (here, arriving
    // just after) the winning confirm claim — must fail closed via the
    // SAME conditional WHERE clause (canonical_status = AWAITING_CONFIRMATION),
    // never silently succeed and never partially mutate the row.
    const selectClient = new PrismaClient();
    try {
      const { selectWorksheetPeriod } = await freshSelectPeriod();
      const selected = await runWithClient(selectClient, () =>
        selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-05-01", periodEnd: "2026-05-31" })
      );
      expect(selected).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    } finally {
      await selectClient.$disconnect();
    }

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.canonical_status).toBe("IMPORTED");
    expect(row.period_start).toBeNull();
    expect(row.period_end).toBeNull();
  });

  it("P8. two independent worksheets (different batches) may share an identical period pair — no premature uniqueness constraint", async () => {
    const { worksheetId: ws1 } = await createWorksheet(sourceSystemNotRequired, "p8-a", `P8A-${Date.now()}`);
    const { worksheetId: ws2 } = await createWorksheet(sourceSystemNotRequired, "p8-b", `P8B-${Date.now()}`);

    for (const worksheetId of [ws1, ws2]) {
      const client = new PrismaClient();
      try {
        const { selectWorksheetPeriod } = await freshSelectPeriod();
        const result = await runWithClient(client, () =>
          selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-07-01", periodEnd: "2026-07-31" })
        );
        expect(result).toMatchObject({ ok: true, periodStart: "2026-07-01", periodEnd: "2026-07-31" });
      } finally {
        await client.$disconnect();
      }
    }

    const rows = await prisma.upload.findMany({ where: { id: { in: [ws1, ws2] } } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.period_start?.toISOString().slice(0, 10)).toBe("2026-07-01");
      expect(row.period_end?.toISOString().slice(0, 10)).toBe("2026-07-31");
    }
  });

  it("P9. a confirmation failure that never opens its own transaction leaves an already-selected period completely untouched", async () => {
    const { worksheetId, batchId } = await createWorksheet(sourceSystemNotRequired, "p9", `P9-${Date.now()}`);

    const selectClient = new PrismaClient();
    try {
      const { selectWorksheetPeriod } = await freshSelectPeriod();
      const selected = await runWithClient(selectClient, () =>
        selectWorksheetPeriod({ organisationId, worksheetUploadId: worksheetId, periodStart: "2026-08-01", periodEnd: "2026-08-31" })
      );
      expect(selected).toMatchObject({ ok: true });
    } finally {
      await selectClient.$disconnect();
    }

    // Corrupt the batch's own persisted sha256 so confirmDataHubWorksheet's
    // mandatory re-verification fails BEFORE its own $transaction ever
    // opens (mirrors confirmWorksheet.test.ts's own "mandatory SHA-256
    // re-verification" test) — a clean, real-Postgres-provable failure
    // point that cannot itself touch period_start/period_end.
    await prisma.importBatch.update({ where: { id: batchId }, data: { sha256: "0".repeat(64) } });

    const confirmClient = new PrismaClient();
    try {
      const { confirmDataHubWorksheet } = await freshConfirm();
      const result = await runWithClient(confirmClient, () =>
        confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor })
      );
      expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    } finally {
      await confirmClient.$disconnect();
    }

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(row.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(row.period_start?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(row.period_end?.toISOString().slice(0, 10)).toBe("2026-08-31");
  });
});
