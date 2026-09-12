// Data Hub 6.1B — real disposable-Postgres proof for per-record
// reconciliation wired into confirmWorksheet.ts's Step 8 transaction.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/confirmWorksheetReconciliation.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` Docker container, never
// Production/Preview. Only the Blob storage composition root is mocked (an
// in-memory byte store keyed by import-batch key), exactly matching
// confirmWorksheetFirstImportGuard.postgres-proof.test.ts's own established
// pattern — reused verbatim here.
//
// Scope: NEW/UNCHANGED/CHANGED end-to-end against real rows; tenant
// isolation via the schema's own composite unique constraint; genuine
// concurrent identity creation (two independent real Prisma connections,
// same organisation+SourceSystem+source_external_id); a real rollback
// proof (a domain-write failure — a CHANGED update targeting a
// deliberately-absent domain row — rolls back its own observation insert
// and the worksheet claim, all in the same transaction); Case C
// (pre-existing identity, zero observations) fails closed with
// RECONCILIATION_HISTORY_INCONSISTENT and rolls back the claim; a lost
// conditional claim (two concurrent confirms of the SAME worksheet)
// commits zero reconciliation state for the loser; the full 12-field
// CHANGED overwrite allowlist, proving every governed field updates and
// every prohibited field (id/organisation_id/upload_id/
// source_record_identity_id/created_at/metadata) does not.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55433")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.1B proof container (port 55433). " +
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
// confirmWorksheetFirstImportGuard.postgres-proof.test.ts — see that
// file's own header comment for the full rationale (a single shared
// PrismaClient serializes concurrent interactive transactions in this
// environment, which would make a same-singleton "concurrency" test pass
// for the wrong reason).
const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) {
          throw new Error("confirmWorksheetReconciliation proof: no active PrismaClient bound for this call");
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

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

const HEADERS = ["report_date", "location", "waste_type", "source_external_id"];

describe("6.1B confirmWorksheet reconciliation — real disposable Postgres proof", () => {
  let organisationId: string;
  let organisationId2: string;
  let sourceSystemId: string;
  let actor1: string;
  let actor2: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "6.1B Proof Org", slug: `proof-org-6-1b-${Date.now()}` },
    });
    organisationId = org.id;

    const org2 = await prisma.organisation.create({
      data: { name: "6.1B Proof Org 2 (tenant isolation)", slug: `proof-org-6-1b-2-${Date.now()}` },
    });
    organisationId2 = org2.id;

    const u1 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor1-${Date.now()}`, name: "Actor One" },
    });
    actor1 = u1.id;
    const u2 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor2-${Date.now()}`, name: "Actor Two" },
    });
    actor2 = u2.id;

    const s1 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "6.1B Reconciliation Proof SourceSystem", active: true },
    });
    sourceSystemId = s1.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh, eligible worksheet+batch for the given organisation.
   * `row` is [report_date, location, waste_type, source_external_id]. */
  async function createWorksheet(orgId: string, sourceSysId: string, label: string, row: string[]) {
    const csv = buildCsv(HEADERS, [row]);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");

    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: orgId,
        source_system_id: sourceSysId,
        original_filename: `${label}.csv`,
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${label}-${Date.now()}-${Math.random()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(orgId, batch.id), body);

    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: orgId,
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

  async function freshConfirm() {
    vi.resetModules();
    return import("../../lib/data-hub/importBatch/confirmWorksheet");
  }

  it("P1. NEW — first-ever worksheet for an identity creates exactly one SourceRecordIdentity, one NEW observation, one linked IllegalDumping row", async () => {
    const { confirmDataHubWorksheet } = await freshConfirm();
    const extId = `P1-${Date.now()}`;
    const { worksheetId } = await createWorksheet(organisationId, sourceSystemId, "p1", ["2024-01-01", "Main St", "tyres", extId]);
    const client = new PrismaClient();
    let result: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      result = await runWithClient(client, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 }));
    } finally {
      await client.$disconnect();
    }
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1, newRows: 1, unchangedRows: 0, changedRows: 0 });

    const identity = await prisma.sourceRecordIdentity.findUniqueOrThrow({
      where: {
        organisation_id_source_system_id_domain_kind_source_external_id: {
          organisation_id: organisationId,
          source_system_id: sourceSystemId,
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: extId,
        },
      },
    });
    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identity.id } });
    expect(observations).toHaveLength(1);
    expect(observations[0].outcome).toBe("NEW");
    const domainRow = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });
    expect(domainRow.upload_id).toBe(worksheetId);
    expect(domainRow.location).toBe("Main St");
  });

  it("P2. UNCHANGED — a second worksheet with identical governed fields creates a new observation but ZERO IllegalDumping mutation", async () => {
    const extId = `P2-${Date.now()}`;
    const row = ["2024-02-01", "Second St", "mattress", extId];

    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p2-first", row);
    const client1 = new PrismaClient();
    let result1: Awaited<ReturnType<typeof confirm1>>;
    try {
      result1 = await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
    } finally {
      await client1.$disconnect();
    }
    expect(result1).toMatchObject({ ok: true, newRows: 1 });

    const identity = await prisma.sourceRecordIdentity.findUniqueOrThrow({
      where: {
        organisation_id_source_system_id_domain_kind_source_external_id: {
          organisation_id: organisationId,
          source_system_id: sourceSystemId,
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: extId,
        },
      },
    });
    const domainBefore = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });

    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    const { worksheetId: ws2 } = await createWorksheet(organisationId, sourceSystemId, "p2-second", row);
    const client2 = new PrismaClient();
    let result2: Awaited<ReturnType<typeof confirm2>>;
    try {
      result2 = await runWithClient(client2, () => confirm2({ organisationId, worksheetUploadId: ws2, confirmedBy: actor2 }));
    } finally {
      await client2.$disconnect();
    }
    expect(result2).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1, newRows: 0, unchangedRows: 1, changedRows: 0 });

    const observations = await prisma.sourceRecordObservation.findMany({
      where: { source_record_identity_id: identity.id },
      orderBy: { observed_at: "asc" },
    });
    expect(observations).toHaveLength(2);
    expect(observations[0].outcome).toBe("NEW");
    expect(observations[1].outcome).toBe("UNCHANGED");
    expect(observations[1].upload_id).toBe(ws2);

    // Zero domain mutation: still exactly one IllegalDumping row, byte-
    // identical to before, still linked to the FIRST worksheet.
    const domainRows = await prisma.illegalDumping.findMany({ where: { source_record_identity_id: identity.id } });
    expect(domainRows).toHaveLength(1);
    expect(domainRows[0]).toEqual(domainBefore);
    expect(domainRows[0].upload_id).toBe(ws1);
  });

  it("P3. CHANGED — a second worksheet with a differing governed field updates the existing IllegalDumping row in place, preserving id/upload_id/created_at", async () => {
    const extId = `P3-${Date.now()}`;
    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p3-first", ["2024-03-01", "Original St", "tyres", extId]);
    const client1 = new PrismaClient();
    try {
      const r = await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
      expect(r).toMatchObject({ ok: true, newRows: 1 });
    } finally {
      await client1.$disconnect();
    }

    const identity = await prisma.sourceRecordIdentity.findUniqueOrThrow({
      where: {
        organisation_id_source_system_id_domain_kind_source_external_id: {
          organisation_id: organisationId,
          source_system_id: sourceSystemId,
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: extId,
        },
      },
    });
    const domainBefore = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });

    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    // Location changed: "Original St" -> "Changed St".
    const { worksheetId: ws2 } = await createWorksheet(organisationId, sourceSystemId, "p3-second", ["2024-03-01", "Changed St", "tyres", extId]);
    const client2 = new PrismaClient();
    try {
      const r = await runWithClient(client2, () => confirm2({ organisationId, worksheetUploadId: ws2, confirmedBy: actor2 }));
      expect(r).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1, newRows: 0, unchangedRows: 0, changedRows: 1 });
    } finally {
      await client2.$disconnect();
    }

    const observations = await prisma.sourceRecordObservation.findMany({
      where: { source_record_identity_id: identity.id },
      orderBy: { observed_at: "asc" },
    });
    expect(observations).toHaveLength(2);
    expect(observations[1].outcome).toBe("CHANGED");

    const domainAfter = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });
    // Exactly one domain row still exists — updated IN PLACE, never a
    // second row.
    const allDomainRows = await prisma.illegalDumping.findMany({ where: { source_record_identity_id: identity.id } });
    expect(allDomainRows).toHaveLength(1);
    expect(domainAfter.id).toBe(domainBefore.id);
    expect(domainAfter.location).toBe("Changed St");
    // upload_id is NEVER overwritten by CHANGED — it stays the FIRST
    // (originating) worksheet's id, never the second worksheet that
    // merely updated it.
    expect(domainAfter.upload_id).toBe(ws1);
    expect(domainAfter.upload_id).not.toBe(ws2);
    expect(domainAfter.created_at).toEqual(domainBefore.created_at);
    expect(domainAfter.organisation_id).toBe(domainBefore.organisation_id);
    expect(domainAfter.source_record_identity_id).toBe(domainBefore.source_record_identity_id);
  });

  it("P4. Full 12-field CHANGED allowlist — every governed field updates; id/organisation_id/upload_id/source_record_identity_id/created_at/metadata never change", async () => {
    const extId = `P4-${Date.now()}`;
    const originalRow = ["2024-04-01", "Loc A", "tyres", extId];
    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p4-first", originalRow);
    const client1 = new PrismaClient();
    try {
      await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
    } finally {
      await client1.$disconnect();
    }

    const identity = await prisma.sourceRecordIdentity.findUniqueOrThrow({
      where: {
        organisation_id_source_system_id_domain_kind_source_external_id: {
          organisation_id: organisationId,
          source_system_id: sourceSystemId,
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: extId,
        },
      },
    });
    const before = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });

    // A mapped worksheet configuring ALL optional business fields so every
    // one of the 12 governed fields genuinely differs from `before`.
    const mappingDoc = {
      fields: {
        report_date: "Reported At",
        location: "Site",
        waste_type: "Type",
        source_external_id: "Ext Ref",
        suburb: "Suburb",
        zone: "Zone",
        volume_estimate: "Volume",
        severity: "Severity",
        status: "Status",
        crew_assigned: "Crew",
        resolution_date: "Resolved At",
        cost_estimate: "Cost",
        notes: "Notes",
      },
    };
    const mapping = await prisma.sourceMapping.create({
      data: { organisation_id: organisationId, source_system_id: sourceSystemId, name: `p4-mapping-${Date.now()}` },
    });
    const version = await prisma.mappingVersion.create({
      data: { organisation_id: organisationId, source_mapping_id: mapping.id, version_number: 1, mapping_document: mappingDoc },
    });

    const mappedHeaders = [
      "Reported At",
      "Site",
      "Type",
      "Ext Ref",
      "Suburb",
      "Zone",
      "Volume",
      "Severity",
      "Status",
      "Crew",
      "Resolved At",
      "Cost",
      "Notes",
    ];
    const mappedRow = [
      "2024-04-15",
      "Loc B (changed)",
      "mattress",
      extId,
      "Riverside",
      "North",
      "large",
      "high",
      "resolved",
      "Team Alpha",
      "2024-04-20",
      "250.50",
      "Follow-up required",
    ];
    const csv = buildCsv(mappedHeaders, [mappedRow]);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const batch2 = await prisma.importBatch.create({
      data: {
        organisation_id: organisationId,
        source_system_id: sourceSystemId,
        original_filename: "p4-second.csv",
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-p4-second-${Date.now()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(organisationId, batch2.id), body);
    const ws2 = await prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: "p4-second.csv",
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch2.id,
        worksheet_index: 0,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: version.id,
      },
    });

    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    const client2 = new PrismaClient();
    try {
      const r = await runWithClient(client2, () => confirm2({ organisationId, worksheetUploadId: ws2.id, confirmedBy: actor2 }));
      expect(r).toMatchObject({ ok: true, changedRows: 1 });
    } finally {
      await client2.$disconnect();
    }

    const after = await prisma.illegalDumping.findUniqueOrThrow({ where: { source_record_identity_id: identity.id } });

    // Every one of the 12 governed fields changed to the new value.
    expect(after.report_date.toISOString().slice(0, 10)).toBe("2024-04-15");
    expect(after.location).toBe("Loc B (changed)");
    expect(after.suburb).toBe("Riverside");
    expect(after.zone).toBe("North");
    expect(after.waste_type).toBe("mattress");
    expect(after.volume_estimate).toBe("large");
    expect(after.severity).toBe("HIGH");
    expect(after.status).toBe("RESOLVED");
    expect(after.crew_assigned).toBe("Team Alpha");
    expect(after.resolution_date?.toISOString().slice(0, 10)).toBe("2024-04-20");
    expect(after.cost_estimate).toBe(250.5);
    expect(after.notes).toBe("Follow-up required");

    // Prohibited fields: never overwritten.
    expect(after.id).toBe(before.id);
    expect(after.organisation_id).toBe(before.organisation_id);
    expect(after.upload_id).toBe(before.upload_id);
    expect(after.upload_id).not.toBe(ws2.id);
    expect(after.source_record_identity_id).toBe(before.source_record_identity_id);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.metadata).toEqual(before.metadata);
  });

  it("P5. Tenant isolation — two organisations with the SAME SourceSystem-id-string and SAME source_external_id resolve to two INDEPENDENT identities", async () => {
    // A second SourceSystem, owned by organisationId2, created so its own
    // real id is guaranteed distinct (Postgres ids are never literally
    // reused across rows) — the composite uniqueness under real proof here
    // is organisation_id itself as the leading tuple element, which is
    // what actually matters: identical (source_system_id, domain_kind,
    // source_external_id) tuples under DIFFERENT organisation_id values
    // must never collide.
    const s2 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId2, name: "6.1B Proof SourceSystem (org 2)", active: true },
    });
    const extId = `P5-shared-${Date.now()}`;

    const { confirmDataHubWorksheet: confirmOrg1 } = await freshConfirm();
    const { worksheetId: wsOrg1 } = await createWorksheet(organisationId, sourceSystemId, "p5-org1", ["2024-05-01", "Org1 Site", "tyres", extId]);
    const clientOrg1 = new PrismaClient();
    try {
      const r = await runWithClient(clientOrg1, () => confirmOrg1({ organisationId, worksheetUploadId: wsOrg1, confirmedBy: actor1 }));
      expect(r).toMatchObject({ ok: true, newRows: 1 });
    } finally {
      await clientOrg1.$disconnect();
    }

    const { confirmDataHubWorksheet: confirmOrg2 } = await freshConfirm();
    const u3 = await prisma.user.create({ data: { organisation_id: organisationId2, username: `actor3-${Date.now()}`, name: "Actor Three" } });
    const { worksheetId: wsOrg2 } = await createWorksheet(organisationId2, s2.id, "p5-org2", ["2024-05-01", "Org2 Site", "mattress", extId]);
    const clientOrg2 = new PrismaClient();
    try {
      const r = await runWithClient(clientOrg2, () => confirmOrg2({ organisationId: organisationId2, worksheetUploadId: wsOrg2, confirmedBy: u3.id }));
      // A genuinely NEW identity for org2 -- zero cross-tenant resolution,
      // never UNCHANGED/CHANGED against org1's own identity/hash.
      expect(r).toMatchObject({ ok: true, newRows: 1, unchangedRows: 0, changedRows: 0 });
    } finally {
      await clientOrg2.$disconnect();
    }

    const identities = await prisma.sourceRecordIdentity.findMany({ where: { source_external_id: extId } });
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map((i) => i.organisation_id))).toEqual(new Set([organisationId, organisationId2]));
    expect(identities[0].id).not.toBe(identities[1].id);
  });

  it("P6. Concurrent first sighting — two independent real Prisma connections racing to create the identity for the SAME organisation+SourceSystem+source_external_id -> exactly ONE identity, exactly one NEW, exactly one UNCHANGED/CHANGED (never two NEW, never a crash)", async () => {
    const extId = `P6-${Date.now()}`;
    const { worksheetId: wsA } = await createWorksheet(organisationId, sourceSystemId, "p6-a", ["2024-06-01", "Race Site A", "tyres", extId]);
    const { worksheetId: wsB } = await createWorksheet(organisationId, sourceSystemId, "p6-b", ["2024-06-01", "Race Site A", "tyres", extId]);

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    let resultA: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    let resultB: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      [resultA, resultB] = await Promise.all([
        runWithClient(clientA, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: wsA, confirmedBy: actor1 })),
        runWithClient(clientB, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: wsB, confirmedBy: actor2 })),
      ]);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }

    // Both worksheets are for a DIFFERENT SourceSystem than any other
    // test's own SourceSystem, but the SAME SourceSystem as each other —
    // the existing SourceSystem `FOR UPDATE` lock (still the sole
    // serialization point per the 6.1B header comment) means these two
    // transactions cannot interleave their own identity-resolution steps;
    // one fully commits before the other's lock request is granted.
    for (const r of [resultA, resultB]) {
      expect(r).toMatchObject({ ok: true, alreadyImported: false });
    }
    const outcomes = [resultA, resultB].map((r) => (r.ok && !r.alreadyImported ? r.newRows : -1));
    // Exactly one of the two attempts observes NEW (0 or 1 newRows each,
    // summing to exactly 1 across both — the other must be UNCHANGED,
    // since both rows are byte-identical).
    expect(outcomes.reduce((a, b) => a + b, 0)).toBe(1);

    const identities = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: extId },
    });
    // EXACTLY one identity — never two, regardless of which transaction
    // won the SourceSystem lock first.
    expect(identities).toHaveLength(1);

    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identities[0].id } });
    expect(observations).toHaveLength(2);
    const observationOutcomes = observations.map((o) => o.outcome).sort();
    expect(observationOutcomes).toEqual(["NEW", "UNCHANGED"]);

    const domainRows = await prisma.illegalDumping.findMany({ where: { source_record_identity_id: identities[0].id } });
    expect(domainRows).toHaveLength(1);
  });

  it("P7. Lost conditional claim commits ZERO reconciliation state — two concurrent confirmations of the SAME worksheet: the loser creates no identity/observation", async () => {
    const extId = `P7-${Date.now()}`;
    const { worksheetId } = await createWorksheet(organisationId, sourceSystemId, "p7", ["2024-07-01", "Site", "tyres", extId]);

    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("../../lib/data-hub/importBatch/confirmWorksheet");

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    let resultA: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    let resultB: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      [resultA, resultB] = await Promise.all([
        runWithClient(clientA, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 })),
        runWithClient(clientB, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor2 })),
      ]);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }

    const results = [resultA, resultB];
    // Exactly one genuine success (claimed:false path returns
    // alreadyImported:true for the loser — the SAME worksheet, so the
    // loser's own claim.count===0 branch resolves to the idempotent
    // "someone else already imported it" outcome, never WORKSHEET_NOT_ELIGIBLE,
    // since the winner's claim genuinely lands IMPORTED before the loser's
    // re-read).
    const freshImports = results.filter((r) => r.ok === true && !r.alreadyImported);
    const alreadyImported = results.filter((r) => r.ok === true && r.alreadyImported);
    expect(freshImports).toHaveLength(1);
    expect(alreadyImported).toHaveLength(1);

    // EXACTLY one identity, one observation, one domain row — the loser's
    // attempt (which lost the claim, per the 6.1B ordering: claim runs
    // BEFORE any reconciliation mutation) never reached the reconciliation
    // loop at all.
    const identities = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: extId },
    });
    expect(identities).toHaveLength(1);
    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identities[0].id } });
    expect(observations).toHaveLength(1);
    const domainRows = await prisma.illegalDumping.findMany({ where: { source_record_identity_id: identities[0].id } });
    expect(domainRows).toHaveLength(1);
  });

  it("P8. Case C — a pre-existing identity with ZERO prior observations fails closed with RECONCILIATION_HISTORY_INCONSISTENT and rolls back the claim (worksheet remains retryable)", async () => {
    const extId = `P8-${Date.now()}`;
    // Manufacture the anomalous state directly (test setup only, bypassing
    // the normal code path entirely): an identity exists, but genuinely
    // zero SourceRecordObservation rows reference it.
    const identity = await prisma.sourceRecordIdentity.create({
      data: { organisation_id: organisationId, source_system_id: sourceSystemId, domain_kind: "ILLEGAL_DUMPING", source_external_id: extId },
    });

    const { worksheetId, batchId } = await createWorksheet(organisationId, sourceSystemId, "p8", ["2024-08-01", "Site", "tyres", extId]);
    const client = new PrismaClient();
    const { confirmDataHubWorksheet } = await freshConfirm();
    let result: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      result = await runWithClient(client, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 }));
    } finally {
      await client.$disconnect();
    }

    expect(result).toMatchObject({ ok: false, code: "RECONCILIATION_HISTORY_INCONSISTENT" });

    // Zero new observations were created (the pre-existing identity still
    // has none).
    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identity.id } });
    expect(observations).toHaveLength(0);
    // Zero IllegalDumping mutation.
    const domainRows = await prisma.illegalDumping.findMany({ where: { source_record_identity_id: identity.id } });
    expect(domainRows).toHaveLength(0);
    // The claim itself was rolled back — the worksheet remains
    // AWAITING_CONFIRMATION, retryable, never IMPORTED.
    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(worksheetAfter.confirmed_by).toBeNull();
    expect(worksheetAfter.confirmed_at).toBeNull();
    // The batch itself is untouched.
    const batchAfter = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batchAfter.status).toBe("READY");
  });

  it("P9. A failed domain write (CHANGED targeting a since-deleted domain row) rolls back its own observation insert AND the claim — no partial commit", async () => {
    const extId = `P9-${Date.now()}`;
    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p9-first", ["2024-09-01", "Site", "tyres", extId]);
    const client1 = new PrismaClient();
    try {
      const r = await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
      expect(r).toMatchObject({ ok: true, newRows: 1 });
    } finally {
      await client1.$disconnect();
    }

    const identity = await prisma.sourceRecordIdentity.findUniqueOrThrow({
      where: {
        organisation_id_source_system_id_domain_kind_source_external_id: {
          organisation_id: organisationId,
          source_system_id: sourceSystemId,
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: extId,
        },
      },
    });
    // Delete the domain row directly (test setup only) so the eventual
    // CHANGED classification's own `illegalDumping.update({ where:
    // { source_record_identity_id } })` targets a row that no longer
    // exists — Prisma throws P2025 "record not found", a genuine domain-
    // write failure inside the SAME transaction as the new observation
    // insert and the claim.
    await prisma.illegalDumping.delete({ where: { source_record_identity_id: identity.id } });

    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    // Different location -> CHANGED (hash differs from the prior
    // observation), triggering the update attempt that will now fail.
    const { worksheetId: ws2 } = await createWorksheet(organisationId, sourceSystemId, "p9-second", ["2024-09-01", "Different Site", "tyres", extId]);
    const client2 = new PrismaClient();
    await expect(
      runWithClient(client2, () =>
        confirm2({ organisationId, worksheetUploadId: ws2, confirmedBy: actor2 })
      )
    ).rejects.toThrow();
    await client2.$disconnect();

    // The whole transaction rolled back: still exactly ONE observation
    // (the original NEW from worksheet 1) — the CHANGED observation this
    // attempt tried to insert never persisted.
    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identity.id } });
    expect(observations).toHaveLength(1);
    expect(observations[0].outcome).toBe("NEW");
    // The second worksheet's claim was rolled back too — never IMPORTED.
    const ws2After = await prisma.upload.findUniqueOrThrow({ where: { id: ws2 } });
    expect(ws2After.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(ws2After.confirmed_by).toBeNull();
  });
});
