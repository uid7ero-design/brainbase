// 6.0C1 — narrow, disposable, real-Postgres concurrency proof (T13).
//
// NOT part of the default vitest containment suite (tests/containment/**) —
// invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/confirmWorksheetFirstImportGuard.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` Docker container, never
// Production/Preview. Only the Blob storage composition root is mocked (an
// in-memory byte store keyed by import-batch key), exactly matching
// confirmWorksheet.postgres-proof.test.ts's own established pattern.
//
// Scope: proves the 6.0C1 first-import/repeat-import guard's own race
// safety — two independent, eligible worksheets for the SAME
// organisation+SourceSystem, confirmed CONCURRENTLY, must yield EXACTLY ONE
// successful domain import and EXACTLY ONE SOURCE_ALREADY_IMPORTED failure.
//
// WHY TWO PRISMACLIENT INSTANCES, NOT ONE: empirically verified (via an
// isolated node -e repro, both against this same disposable container)
// that a SINGLE shared PrismaClient's query engine in this environment
// serializes interactive ($transaction) calls to strictly one-at-a-time —
// a second concurrent $transaction call only ENTERS its callback after the
// first one fully commits, even with connection_limit raised. That
// artifact would make a same-singleton "concurrency" test pass for the
// wrong reason (accidental engine-level queueing, not the SourceSystem
// `FOR UPDATE` lock actually being exercised) — indistinguishable from a
// broken guard. Two independent PrismaClient instances (confirmed via the
// same repro to run genuinely concurrently — both entering their
// transaction callback within ~3ms of each other) give real, guaranteed
// concurrent database connections, exactly matching two independent
// production server processes/requests each holding their own connection.
// `@/lib/prisma`'s singleton is mocked to route to whichever of the two
// real clients is active for the current async call context (via
// AsyncLocalStorage), so the REAL, unmodified confirmWorksheet.ts is
// exercised unchanged — only which physical connection it borrows differs
// per concurrent call, never its own logic.
//
// DATABASE_URL/DIRECT_URL must already point at the disposable container
// when this file is invoked (see the final report's runbook).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55432")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable proof container (port 55432). " +
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

// Routes the production `@/lib/prisma` singleton import (as consumed by
// confirmWorksheet.ts's own `../../prisma` relative import — the same
// resolved module) to whichever real PrismaClient is bound for the current
// async call — see the file header comment for why this exists. Every
// property access (model delegates, $transaction, $queryRaw, etc.) is
// forwarded untouched to the real, active client; confirmWorksheet.ts's
// own code is never modified or aware of this indirection.
const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) {
          throw new Error("confirmWorksheetFirstImportGuard proof: no active PrismaClient bound for this call");
        }
        return Reflect.get(client, prop, client);
      },
    }
  ),
}));

function runWithClient<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return activeClientStorage.run(client, fn);
}

// Fixture setup/assertions use their own separate, ordinary PrismaClient —
// never routed through the mock above (which exists only to intercept the
// SERVICE's own internal singleton).
const prisma = new PrismaClient();

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// Legacy (NULL mapping_version_id) headers/shape, matching
// illegalDumpingMapper.ts's own directly-recognized column names — avoids
// any dependency on the 5B.4D mapped-path machinery, which is irrelevant to
// this proof.
const LEGACY_HEADERS = ["report_date", "location", "waste_type"];

describe("6.0C1 confirmWorksheetFirstImportGuard — real disposable Postgres concurrency proof", () => {
  let organisationId: string;
  let sourceSystemId: string;
  let actor1: string;
  let actor2: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "6.0C1 Proof Org", slug: `proof-org-6-0c1-${Date.now()}` },
    });
    organisationId = org.id;

    const u1 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor1-${Date.now()}`, name: "Actor One" },
    });
    actor1 = u1.id;
    const u2 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor2-${Date.now()}`, name: "Actor Two" },
    });
    actor2 = u2.id;

    const s1 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "Concurrency Proof SourceSystem", active: true },
    });
    sourceSystemId = s1.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh, independent, eligible worksheet+batch — a distinct
   * physical file (distinct sha256/content), the same organisation+
   * SourceSystem. Deliberately NOT the same worksheet/batch (this proof is
   * about two DIFFERENT worksheets racing for the same organisation+
   * SourceSystem allowance, never same-worksheet replay). */
  async function createEligibleWorksheet(label: string, row: string[]) {
    const csv = buildCsv(LEGACY_HEADERS, [row]);
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
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: null,
      },
    });
    return { batchId: batch.id, worksheetId: worksheet.id };
  }

  it("T13. two independent worksheets, same organisation+SourceSystem, confirmed CONCURRENTLY (via two independent real Prisma connections) -> exactly one success, exactly one SOURCE_ALREADY_IMPORTED, no duplicate domain dataset", async () => {
    const a = await createEligibleWorksheet("concurrent-a", ["2024-09-01", "Race Site A", "Mattress"]);
    const b = await createEligibleWorksheet("concurrent-b", ["2024-09-02", "Race Site B", "Tyres"]);

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    let resultA: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    let resultB: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      [resultA, resultB] = await Promise.all([
        runWithClient(clientA, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: a.worksheetId, confirmedBy: actor1 })),
        runWithClient(clientB, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: b.worksheetId, confirmedBy: actor2 })),
      ]);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }

    const results = [resultA, resultB];
    const successes = results.filter((r) => r.ok === true);
    const blocked = results.filter((r) => r.ok === false);

    // EXACTLY one success, exactly one SOURCE_ALREADY_IMPORTED — never
    // zero, never two, regardless of which of the two calls happened to
    // win the real Postgres row lock first.
    expect(successes).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ ok: false, code: "SOURCE_ALREADY_IMPORTED" });
    expect(successes[0]).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });

    // No duplicate domain dataset: exactly one IllegalDumping row exists
    // for this organisation+SourceSystem in total, attached to whichever
    // worksheet actually won.
    const rows = await prisma.illegalDumping.findMany({ where: { organisation_id: organisationId } });
    expect(rows).toHaveLength(1);

    const winningWorksheetId = successes[0].ok === true ? successes[0].worksheetUploadId : null;
    expect(rows[0].upload_id).toBe(winningWorksheetId);

    // The losing worksheet was never claimed — it remains eligible
    // (AWAITING_CONFIRMATION), never left in a partial/ambiguous state.
    const losingWorksheetId = a.worksheetId === winningWorksheetId ? b.worksheetId : a.worksheetId;
    const losingWorksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: losingWorksheetId } });
    expect(losingWorksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(losingWorksheetAfter.confirmed_by).toBeNull();
  });
});
