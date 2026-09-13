import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";

// Data Hub 6.1C2 — real disposable-Postgres proof for
// scripts/create-illegal-dumping-abandoned-status.sql. Starts a disposable
// postgres:16-alpine container with the pre-existing (pre-6.1C2)
// IncidentStatus enum + illegal_dumping table, applies the new migration,
// and proves: ABANDONED is added; the 4 pre-existing labels are
// unaffected; the migration is idempotent on rerun; a row can actually
// persist with status = ABANDONED; and no schema object outside the
// intended enum change is touched. Mirrors the established
// dataHubReconciliationSchemaFoundation.test.ts (6.1A) disposable-Postgres
// idiom exactly — never against Production/Preview, torn down after use.

const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.resolve(REPO_ROOT, "scripts/create-illegal-dumping-abandoned-status.sql");

function dockerAvailable(): boolean {
  try {
    execSync("docker version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerAvailable();
const CONTAINER = `datahub-61c2-abandoned-status-vitest-${process.pid}`;

function psqlExec(sql: string): { ok: boolean; output: string } {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-t", "-U", "postgres", "-d", "testdb", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf-8" }
  );
  return { ok: result.status === 0, output: (result.stdout || "") + (result.stderr || "") };
}

function applyFile(filePath: string): { ok: boolean; output: string } {
  const sql = fs.readFileSync(filePath, "utf-8");
  return psqlExec(sql);
}

function enumLabels(): string[] {
  const r = psqlExec(
    `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'IncidentStatus';`
  );
  expect(r.ok, r.output).toBe(true);
  // psql -t (tuples only) strips headers/footers, leaving just the value.
  const line = r.output.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return (line ?? "").split(",").filter(Boolean);
}

describe.runIf(HAS_DOCKER)("real disposable-Postgres proof — ABANDONED status migration (6.1C2)", () => {
  beforeAll(async () => {
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine`,
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

    // Bootstrap ONLY the pre-existing (pre-6.1C2) shape this migration
    // depends on — the real IncidentStatus enum and illegal_dumping table,
    // exactly as they exist on current origin/main before this migration.
    const bootstrap = `
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TABLE illegal_dumping (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, upload_id TEXT, report_date TIMESTAMP NOT NULL, location TEXT NOT NULL, suburb TEXT, zone TEXT, waste_type TEXT NOT NULL, volume_estimate TEXT, severity "Severity" NOT NULL DEFAULT 'MEDIUM', status "IncidentStatus" NOT NULL DEFAULT 'OPEN', crew_assigned TEXT, resolution_date TIMESTAMP, cost_estimate DOUBLE PRECISION, notes TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a');
`;
    const b = psqlExec(bootstrap);
    if (!b.ok) throw new Error("bootstrap failed: " + b.output);
  }, 120_000);

  afterAll(() => {
    spawnSync("docker", ["rm", "-f", CONTAINER]);
  });

  it("P1. before migration: IncidentStatus has exactly the 4 pre-existing labels, ABANDONED absent", () => {
    expect(enumLabels()).toEqual(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
  });

  it("P2. migration applies cleanly on top of the real pre-existing schema", () => {
    const r = applyFile(MIGRATION_PATH);
    expect(r.ok, r.output).toBe(true);
  });

  it("P3. after migration: ABANDONED is present and all 4 pre-existing labels are unchanged (order-independent)", () => {
    const labels = enumLabels();
    expect(labels).toHaveLength(5);
    expect(new Set(labels)).toEqual(new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "ABANDONED"]));
  });

  it("P4. second migration application succeeds (idempotent) and does not duplicate or alter any label", () => {
    const r = applyFile(MIGRATION_PATH);
    expect(r.ok, r.output).toBe(true);
    const labels = enumLabels();
    expect(labels).toHaveLength(5);
    expect(new Set(labels)).toEqual(new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "ABANDONED"]));
  });

  it("P5. a real illegal_dumping row can persist with status = ABANDONED", () => {
    const r = psqlExec(
      `INSERT INTO illegal_dumping (id, organisation_id, report_date, location, waste_type, status, resolution_date) VALUES ('id-abandoned-1','org-a', now(), '1 Example St', 'Green Waste', 'ABANDONED', now());`
    );
    expect(r.ok, r.output).toBe(true);
    const check = psqlExec(`SELECT status FROM illegal_dumping WHERE id = 'id-abandoned-1';`);
    expect(check.ok, check.output).toBe(true);
    expect(check.output).toContain("ABANDONED");
  });

  it("P6. a pre-existing status value (RESOLVED) still inserts and persists unaffected", () => {
    const r = psqlExec(
      `INSERT INTO illegal_dumping (id, organisation_id, report_date, location, waste_type, status) VALUES ('id-resolved-1','org-a', now(), '2 Example St', 'Furniture', 'RESOLVED');`
    );
    expect(r.ok, r.output).toBe(true);
  });

  it("P7. no schema object outside the IncidentStatus enum is touched — illegal_dumping's own column list is byte-identical before and after the migration", () => {
    const cols = psqlExec(
      `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'illegal_dumping';`
    );
    expect(cols.ok, cols.output).toBe(true);
    const expectedCols =
      "id,organisation_id,upload_id,report_date,location,suburb,zone,waste_type,volume_estimate,severity,status,crew_assigned,resolution_date,cost_estimate,notes,metadata,created_at,updated_at";
    expect(cols.output).toContain(expectedCols);
  });

  it("P8. no other enum type in the database gained or lost any label (only IncidentStatus changed)", () => {
    const severity = psqlExec(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'Severity';`
    );
    expect(severity.ok, severity.output).toBe(true);
    expect(severity.output).toContain("CRITICAL,HIGH,MEDIUM,LOW");
  });
});
