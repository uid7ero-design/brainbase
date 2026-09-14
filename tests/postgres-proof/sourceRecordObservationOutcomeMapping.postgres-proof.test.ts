// Data Hub 6.1D1 — real disposable-Postgres proof that a REAL generated
// Prisma Client (not raw psql, not a mocked client) can successfully
// read/write SourceRecordObservation.outcome against the ACTUAL Postgres
// enum name the hand-written 6.1A migration script creates in Production
// (public.source_record_observation_outcome, lowercase) rather than
// Prisma's own default PascalCase name for the enum
// (SourceRecordObservationOutcome).
//
// WHY THIS TEST EXISTS — the exact coverage gap that let this bug reach
// Production (Onkaparinga's first real governed Confirm attempt,
// worksheet cmu17oxyx0002w3d629y32rjt, Postgres 42704 "type
// \"public.SourceRecordObservationOutcome\" does not exist"):
//   - tests/containment/dataHubReconciliationSchemaFoundation.test.ts (6.1A)
//     DOES apply the real scripts/create-datahub-reconciliation.sql
//     migration against a real disposable Postgres container, but every
//     assertion in that file issues raw SQL via `docker exec ... psql` —
//     it never invokes a real generated Prisma Client's own
//     `.create()`/query-generation logic at all, so it could never
//     surface a Prisma-schema-to-Postgres-object naming mismatch.
//   - tests/postgres-proof/confirmWorksheetReconciliation.postgres-proof.test.ts
//     (6.1B) DOES use a real `new PrismaClient()` against a disposable
//     container, but that container's schema was never provisioned by
//     this repo's own hand-written migration script in this test file
//     (no setup script exists anywhere in this repo for its expected
//     port-55433 container) — the only realistic way that container's
//     schema was ever created is `prisma db push`, which derives Postgres
//     object names FROM the Prisma schema itself and is therefore always
//     self-consistent with whatever Prisma expects, by construction, GIVEN
//     an accurate mapping — regardless of whether the schema's own @@map
//     annotations (or lack thereof) actually match what the REAL,
//     hand-written Production migration created.
//
// This test closes that exact gap: the container's schema is built EXACTLY
// the way Production's real database was built (the real, unmodified
// scripts/create-import-batches.sql, scripts/create-datahub-source-mappings.sql,
// and scripts/create-datahub-reconciliation.sql migration files, applied via
// raw SQL — never `prisma db push`, never `prisma migrate`), and then
// exercised through a real generated `@prisma/client` instance, exactly
// mirroring what confirmWorksheet.ts's own `tx.sourceRecordObservation.create()`
// call does in Production.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly against a disposable, self-managed `postgres:16-alpine`
// Docker container that this file starts and tears down itself (mirroring
// dataHubReconciliationSchemaFoundation.test.ts's own self-contained
// container-lifecycle pattern, since no external provisioning script exists
// for this proof to depend on). Never Production/Preview.
//
// Run: npx vitest run --config tests/postgres-proof/vitest.proof.config.ts \
//   tests/postgres-proof/sourceRecordObservationOutcomeMapping.postgres-proof.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const REPO_ROOT = path.resolve(__dirname, "../..");

function dockerAvailable(): boolean {
  try {
    execSync("docker version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerAvailable();
const CONTAINER = `datahub-61d1-outcome-mapping-vitest-${process.pid}`;
const HOST_PORT = 55442; // distinct from the 6.1B proof's own 55433, to allow both to run concurrently without a port clash.

function psqlExec(sql: string): { ok: boolean; output: string } {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-U", "postgres", "-d", "testdb", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf-8" }
  );
  return { ok: result.status === 0, output: (result.stdout || "") + (result.stderr || "") };
}

function applyFile(filePath: string): { ok: boolean; output: string } {
  const sql = fs.readFileSync(filePath, "utf-8");
  return psqlExec(sql);
}

describe.runIf(HAS_DOCKER)("6.1D1 SourceRecordObservationOutcome Prisma-to-Postgres enum mapping — real disposable Postgres proof", () => {
  let PrismaClient: typeof import("@prisma/client").PrismaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeAll(async () => {
    execSync(
      `docker run -d --name ${CONTAINER} -p ${HOST_PORT}:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine`,
      { stdio: "ignore" }
    );
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const r = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"]);
      if (r.status === 0) {
        ready = true;
        break;
      }
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    if (!ready) throw new Error("postgres container did not become ready within 30s");

    // Base schema — the exact bootstrap dataHubReconciliationSchemaFoundation.test.ts
    // itself uses, reused verbatim (organisations/users/uploads/illegal_dumping,
    // the enums those pre-existing tables genuinely need — these predate the
    // Data Hub hand-written-migration convention and were always created by
    // ordinary Prisma tooling with names that already match Prisma exactly,
    // so no @@map is needed or expected for them).
    const bootstrap = `
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TYPE "SchemaType" AS ENUM ('MISSED_COLLECTIONS','ILLEGAL_DUMPING','DEBTORS','SERVICE_REQUESTS','BIN_MAINTENANCE','WASTE_METRICS','FINANCIAL','GENERIC','UNKNOWN');
CREATE TYPE "Module" AS ENUM ('WASTE','DUMPING','FORECASTING','MISSED_COLLECTIONS','DEBTORS','BIN_MAINTENANCE','CONTRACTS','OPERATIONS');
CREATE TYPE "UploadStatus" AS ENUM ('PENDING','DETECTING','VALIDATING','PREVIEW_READY','IMPORTING','COMPLETE','FAILED');
CREATE TABLE uploads (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, original_name TEXT NOT NULL, stored_path TEXT NOT NULL, mimetype TEXT NOT NULL, size_bytes INTEGER NOT NULL, schema_type "SchemaType" NOT NULL DEFAULT 'UNKNOWN', module "Module", status "UploadStatus" NOT NULL DEFAULT 'PENDING', row_count INTEGER, column_count INTEGER, columns_detected JSONB NOT NULL DEFAULT '[]', field_mappings JSONB NOT NULL DEFAULT '{}', validation_errors JSONB NOT NULL DEFAULT '[]', preview_rows JSONB NOT NULL DEFAULT '[]', metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ABANDONED');
CREATE TABLE illegal_dumping (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, upload_id TEXT REFERENCES uploads(id), report_date TIMESTAMP NOT NULL, location TEXT NOT NULL, suburb TEXT, zone TEXT, waste_type TEXT NOT NULL, volume_estimate TEXT, severity "Severity" NOT NULL DEFAULT 'MEDIUM', status "IncidentStatus" NOT NULL DEFAULT 'OPEN', crew_assigned TEXT, resolution_date TIMESTAMP, cost_estimate DOUBLE PRECISION, notes TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
CREATE INDEX ON illegal_dumping (organisation_id);
INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-a','org-a','user-a','User A');
`;
    const b = psqlExec(bootstrap);
    if (!b.ok) throw new Error("bootstrap failed: " + b.output);

    // The REAL, unmodified hand-written migration files — the exact same
    // files Production's own database was built from. Never `prisma db
    // push`, never `prisma migrate` — this is the whole point of the proof.
    for (const f of [
      "scripts/create-import-batches.sql",
      "scripts/create-datahub-source-mappings.sql",
      "scripts/create-datahub-reconciliation.sql",
    ]) {
      const r = applyFile(path.resolve(REPO_ROOT, f));
      if (!r.ok) throw new Error(`real migration ${f} failed: ` + r.output);
    }

    const seed = `
INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-a1','org-a','Org A System 1');
INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key, source_system_id) VALUES ('batch-a1','org-a','user-a','a.csv','csv',100,'vercel-blob','k-a1','ss-a1');
INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status) VALUES ('upload-a1','org-a','user-a','a.csv','k-a1','text/csv',100,'batch-a1',0,'DATA_HUB','AWAITING_CONFIRMATION');
INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-a1','org-a','ss-a1','ILLEGAL_DUMPING','TICKET-6.1D1-1');
`;
    const s = psqlExec(seed);
    if (!s.ok) throw new Error("seed failed: " + s.output);

    // Generate a REAL Prisma Client from the (now-corrected, @@map'd)
    // committed prisma/schema.prisma, pointed at this exact disposable
    // container — never a mock, never raw SQL for the assertions below.
    process.env.DATABASE_URL = `postgresql://postgres:test@localhost:${HOST_PORT}/testdb`;
    execSync("npx prisma generate", { cwd: REPO_ROOT, stdio: "ignore" });
    ({ PrismaClient } = await import("@prisma/client"));
    prisma = new PrismaClient();
  }, 120_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    spawnSync("docker", ["rm", "-f", CONTAINER]);
  });

  function makeObservation(id: string, outcome: "NEW" | "UNCHANGED" | "CHANGED") {
    return prisma.sourceRecordObservation.create({
      data: {
        id,
        organisation_id: "org-a",
        source_record_identity_id: "sri-a1",
        import_batch_id: "batch-a1",
        upload_id: "upload-a1",
        canonical_hash: createHash("sha256").update(id).digest("hex"),
        outcome,
      },
    });
  }

  it("1. NEW insert succeeds via the real generated Prisma Client", async () => {
    const row = await makeObservation("sro-new-1", "NEW");
    expect(row.outcome).toBe("NEW");
  });

  it("2. UNCHANGED insert succeeds via the real generated Prisma Client", async () => {
    const row = await makeObservation("sro-unchanged-1", "UNCHANGED");
    expect(row.outcome).toBe("UNCHANGED");
  });

  it("3. CHANGED insert succeeds via the real generated Prisma Client", async () => {
    const row = await makeObservation("sro-changed-1", "CHANGED");
    expect(row.outcome).toBe("CHANGED");
  });

  it("4. persisted value reads back correctly through a fresh findUnique() call", async () => {
    const read = await prisma.sourceRecordObservation.findUnique({ where: { id: "sro-changed-1" } });
    expect(read?.outcome).toBe("CHANGED");
  });

  it("5. no PascalCase Postgres enum is required — the type does not exist in this database", async () => {
    const rows: { typname: string }[] = await prisma.$queryRawUnsafe(
      `SELECT typname FROM pg_type WHERE typname = 'SourceRecordObservationOutcome'`
    );
    expect(rows).toHaveLength(0);
  });

  it("6. the real Postgres type the migration created — public.source_record_observation_outcome — exists with exactly the 3 expected labels", async () => {
    const rows: { typname: string; labels: string[] }[] = await prisma.$queryRawUnsafe(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'source_record_observation_outcome'
       GROUP BY t.typname`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].labels).toEqual(["NEW", "UNCHANGED", "CHANGED"]);
  });

  it("7. the real Prisma client's own generated SQL references the lowercase type (confirmed via successful inserts above, not just DMMF metadata) — a direct raw-SQL insert using the lowercase type name also succeeds, proving both paths agree on the same real object", async () => {
    const r = psqlExec(
      `INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-raw-1','org-a','sri-a1','batch-a1','upload-a1', repeat('f',64), 'NEW'::public.source_record_observation_outcome);`
    );
    expect(r.ok, r.output).toBe(true);
    const viaClient = await prisma.sourceRecordObservation.findUnique({ where: { id: "sro-raw-1" } });
    expect(viaClient?.outcome).toBe("NEW");
  });
});
