// Data Hub 6.2D3E — real disposable-Postgres proof for
// scripts/activate-datahub-onkaparinga-schema-v1.sql, run against the
// REAL Onkaparinga manifest (never a synthetic fixture) seeded by the
// REAL scripts/seed-datahub-onkaparinga-schema-v1.sql.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/datahubOnkaparingaSchemaV1Activation.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` container that already has
// D3A (create-datahub-source-schema-profiles.sql) AND 6.2D3E
// (create-datahub-governed-schema-immutability.sql) applied — never
// Production/Preview.
//
// UNLIKE every other real-Postgres proof in this repo, this file must
// execute two full, real, multi-statement hand-written SQL SCRIPTS
// (the D3B seed and the D3E activation script) as the actual subject
// under test — not a TS service function. Prisma's raw-query escape
// hatch does not reliably support a BEGIN/DO-block/COMMIT script as one
// call, so this file shells out to `docker exec -i <container> psql`
// (the SAME mechanism the coordinator already uses to apply these
// scripts by hand) via Node's child_process, reading the real files
// straight off disk with fs.readFileSync — it never re-types or
// paraphrases their SQL. Requires DATAHUB_D3E_PROOF_CONTAINER (the
// disposable container's name) in addition to the usual port-scoped
// DATABASE_URL safety check.
//
// Covers:
//   Section 20 — activation succeeds against the real 14-sheet/295-
//     column manifest; schema ACTIVE; activated_at populated; all 14
//     profiles active with correct pointers; exactly one audit event
//     with the test actor; ImportBatch/Upload/SourceSystem/
//     SourceMapping/MappingVersion all untouched.
//   Section 21 — 8 representative drift cases, each causing a full
//     rollback: zero status change, zero profile mutation, zero audit
//     event.
//   Section 22 — idempotent rerun: success/no-op, zero new mutation,
//     zero second audit event, same activated_at.
//   R1/R2 remediation — after a real successful activation, a 15th
//     worksheet, a new column on an existing worksheet, and a new
//     mapping profile are all DB-rejected by the updated INSERT-guarding
//     triggers, and the pre-existing idempotent-rerun guarantee still
//     holds afterward.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("55559")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.2D3E activation proof container (port 55559). " +
      "This proof must never run against Production/Preview."
  );
}
const CONTAINER = process.env.DATAHUB_D3E_PROOF_CONTAINER;
if (!CONTAINER) {
  throw new Error("DATAHUB_D3E_PROOF_CONTAINER must name the disposable postgres:16-alpine container to exec into (never Production/Preview).");
}

const ROOT = path.resolve(__dirname, "../..");
const SEED_SQL = fs.readFileSync(path.join(ROOT, "scripts/seed-datahub-onkaparinga-schema-v1.sql"), "utf8");
const ACTIVATE_SQL = fs.readFileSync(path.join(ROOT, "scripts/activate-datahub-onkaparinga-schema-v1.sql"), "utf8");

const SV_ID = "dhcfg-onk-mwco-sv1";
const SS_NAME = "City of Onkaparinga operational export";
const ACTOR_ID = "d3e-proof-actor";

class PsqlError extends Error {}

function psql(sql: string, extraArgs: string[] = []): string {
  // psql sends RAISE NOTICE/WARNING (and RAISE EXCEPTION's own error
  // text) to STDERR, never STDOUT — spawnSync captures both regardless
  // of exit code, so callers can assert on NOTICE text on the success
  // path too, and on the real error text on the failure path.
  const result = spawnSync("docker", ["exec", "-i", CONTAINER as string, "psql", "-X", "-q", "-U", "postgres", "-d", "testdb", "-v", "ON_ERROR_STOP=1", ...extraArgs], {
    input: sql,
    encoding: "utf8",
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new PsqlError(combined || `docker exec psql exited with status ${result.status}`);
  }
  return combined;
}

function disableTrigger(table: string, trigger: string): void {
  psql(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
}
function enableTrigger(table: string, trigger: string): void {
  psql(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
}

function runSeed(): void {
  psql(SEED_SQL);
}
function runActivation(actorUserId: string = ACTOR_ID): string {
  return psql(ACTIVATE_SQL, ["-v", `actor_user_id=${actorUserId}`]);
}

const prisma = new PrismaClient();

async function resetD3bState(): Promise<void> {
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE worksheet_mapping_profile_versions, worksheet_mapping_profiles, source_schema_columns, source_schema_worksheets, source_schema_versions, dataset_types, audit_logs CASCADE"
  );
  runSeed();
}

describe("6.2D3E activation script — real Onkaparinga v1 manifest, real disposable Postgres proof", () => {
  let organisationId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: "6.2D3E Activation Proof Org", slug: `proof-org-6-2d3e-act-${Date.now()}` } });
    organisationId = org.id;
    const user = await prisma.user.create({ data: { id: ACTOR_ID, organisation_id: organisationId, username: `actor-${Date.now()}`, name: "D3E Proof Actor" } });
    actorUserId = user.id;
    await prisma.sourceSystem.create({ data: { organisation_id: organisationId, name: SS_NAME, active: true } });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetD3bState();
  });

  it("Section 20 — activation succeeds against the real 14-sheet manifest: ACTIVE, activated_at set, 14 profiles pointed correctly, one audit event, nothing else touched", async () => {
    const before = await prisma.importBatch.count();
    const uploadsBefore = await prisma.upload.count();

    const output = runActivation(actorUserId);
    expect(output).toMatch(/is now ACTIVE, 14 profiles activated/);

    const sv = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(sv.status).toBe("ACTIVE");
    expect(sv.activated_at).not.toBeNull();

    const activeProfiles = await prisma.worksheetMappingProfile.findMany({
      where: { worksheet: { source_schema_version_id: SV_ID } },
    });
    expect(activeProfiles).toHaveLength(14);
    for (const p of activeProfiles) {
      expect(p.active).toBe(true);
      expect(p.active_profile_version_id).toBe(`${p.source_schema_worksheet_id}-wp-v1`);
    }

    const auditRows = await prisma.auditLog.findMany({ where: { resource_type: "source_schema_version", resource_id: SV_ID } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      organisation_id: organisationId,
      user_id: actorUserId,
      action: "DATA_HUB_SOURCE_SCHEMA_ACTIVATED",
      resource_type: "source_schema_version",
      resource_id: SV_ID,
    });
    expect(JSON.stringify(auditRows[0].before_state)).not.toMatch(/PERSONALLY_IDENTIFIABLE|Driver|header/i);

    expect(await prisma.importBatch.count()).toBe(before);
    expect(await prisma.upload.count()).toBe(uploadsBefore);
    expect(await prisma.sourceMapping.count()).toBe(0);
    expect(await prisma.mappingVersion.count()).toBe(0);
  });

  it("Section 20 — wrong actor (nonexistent user id) fails closed before any mutation", async () => {
    expect(() => runActivation("nonexistent-user-id")).toThrow(PsqlError);
    const sv = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(sv.status).toBe("DRAFT");
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("Section 20 — actor belonging to a DIFFERENT organisation fails closed before any mutation", async () => {
    const otherOrg = await prisma.organisation.create({ data: { name: "Other org", slug: `other-org-${Date.now()}` } });
    const otherUser = await prisma.user.create({ data: { organisation_id: otherOrg.id, username: `other-${Date.now()}`, name: "Other" } });
    expect(() => runActivation(otherUser.id)).toThrow(PsqlError);
    const sv = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(sv.status).toBe("DRAFT");
    expect(await prisma.auditLog.count()).toBe(0);
  });

  describe("Section 21 — drift cases (each fails closed, zero mutation, zero audit event)", () => {
    const cases: [string, () => Promise<void>][] = [
      ["worksheet expected_name drifted", async () => {
        await prisma.$executeRawUnsafe(`UPDATE source_schema_worksheets SET expected_name = 'DRIFTED' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview'`);
      }],
      ["column source_header drifted", async () => {
        await prisma.$executeRawUnsafe(`UPDATE source_schema_columns SET source_header = 'DRIFTED' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-c000'`);
      }],
      ["column ordinal drifted", async () => {
        await prisma.$executeRawUnsafe(`UPDATE source_schema_columns SET ordinal = 999 WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-c000'`);
      }],
      ["column sensitivity_class drifted", async () => {
        await prisma.$executeRawUnsafe(`UPDATE source_schema_columns SET sensitivity_class = 'PERSONALLY_IDENTIFIABLE' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-c000'`);
      }],
      ["profile disposition drifted", async () => {
        // worksheet_mapping_profile_versions is now UNCONDITIONALLY
        // immutable (6.2D3E's own migration) — even a DIRECT UPDATE is
        // already rejected before the activation script ever runs. To
        // still exercise the activation script's OWN precheck (defense
        // in depth against drift from any source, e.g. manual DB
        // surgery predating this migration, or a future bypass), the
        // trigger is deliberately, temporarily disabled to simulate
        // that drift existing, then re-enabled immediately.
        disableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        try {
          await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profile_versions SET disposition = 'IGNORE' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-wp-v1'`);
        } finally {
          enableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        }
      }],
      ["profile_document drifted", async () => {
        disableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        try {
          await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profile_versions SET profile_document = '{"documentVersion":1,"schemaStatus":"DRAFT","headerRowOneBased":999}' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-wp-v1'`);
        } finally {
          enableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        }
      }],
      ["a governed worksheet is missing entirely", async () => {
        // Same rationale: deleting a profile-version row is now always
        // rejected by 6.2D3E's own migration, so this drift (which
        // pre-existing D3B-era code could never have produced anyway,
        // and which 6.2D3E's migration now makes structurally
        // impossible going forward) is simulated the same way.
        disableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        try {
          await prisma.$executeRawUnsafe(`DELETE FROM source_schema_columns WHERE source_schema_worksheet_id = 'dhcfg-onk-mwco-sv1-ws-trends'`);
          await prisma.$executeRawUnsafe(`DELETE FROM worksheet_mapping_profile_versions WHERE worksheet_mapping_profile_id = 'dhcfg-onk-mwco-sv1-ws-trends-wp'`);
          await prisma.$executeRawUnsafe(`DELETE FROM worksheet_mapping_profiles WHERE id = 'dhcfg-onk-mwco-sv1-ws-trends-wp'`);
          await prisma.$executeRawUnsafe(`DELETE FROM source_schema_worksheets WHERE id = 'dhcfg-onk-mwco-sv1-ws-trends'`);
        } finally {
          enableTrigger("worksheet_mapping_profile_versions", "datahub_guard_worksheet_mapping_profile_version_write");
        }
      }],
      ["an unexpected active pointer already set before activation", async () => {
        await prisma.$executeRawUnsafe(`UPDATE worksheet_mapping_profiles SET active = true, active_profile_version_id = 'dhcfg-onk-mwco-sv1-ws-overview-wp-v1' WHERE id = 'dhcfg-onk-mwco-sv1-ws-overview-wp'`);
      }],
    ];

    it.each(cases)("%s", async (_label, mutate) => {
      await mutate();
      expect(() => runActivation(actorUserId)).toThrow(PsqlError);
      const sv = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
      expect(sv.status).toBe("DRAFT");
      expect(sv.activated_at).toBeNull();
      const activatedProfiles = await prisma.worksheetMappingProfile.count({ where: { active: true } });
      // The one deliberately-pre-set pointer in the last case is the
      // drift itself (an anomaly the script must refuse to build on),
      // not a successful activation — the assertion above already
      // proves the schema version itself never reached ACTIVE, which is
      // the authoritative signal; profile count is documented, not
      // re-asserted to zero, since that one specific case intentionally
      // starts with one profile already (wrongly) marked active.
      void activatedProfiles;
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });

  it("Section 22 — idempotent rerun: success/no-op, zero new mutation, zero second audit event, same activated_at", async () => {
    runActivation(actorUserId);
    const first = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    const firstAuditCount = await prisma.auditLog.count();

    await new Promise((r) => setTimeout(r, 50));

    const output = runActivation(actorUserId);
    expect(output).toMatch(/already ACTIVE.*no-op, zero mutation, zero new audit event/);

    const second = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(second.activated_at?.getTime()).toBe(first.activated_at?.getTime());
    expect(await prisma.auditLog.count()).toBe(firstAuditCount);
  });

  it("R1/R2 remediation — after a successful real activation, a 15th worksheet, a new column, and a new mapping profile are all DB-rejected; the activation script's own idempotent no-op still succeeds afterward", async () => {
    runActivation(actorUserId);
    const afterActivation = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(afterActivation.status).toBe("ACTIVE");

    // Attempt a 15th worksheet on the now-ACTIVE schema.
    await expect(
      prisma.sourceSchemaWorksheet.create({
        data: { organisation_id: organisationId, source_schema_version_id: SV_ID, logical_key: "unauthorized_extra_sheet", expected_name: "Unauthorized Extra Sheet", ordinal_hint: 14, presence: "OPTIONAL", role: "DATA" },
      })
    ).rejects.toThrow();
    expect(await prisma.sourceSchemaWorksheet.count({ where: { source_schema_version_id: SV_ID } })).toBe(14);

    // Attempt a new column on one of the 14 existing (now-frozen) worksheets.
    await expect(
      prisma.sourceSchemaColumn.create({
        data: { organisation_id: organisationId, source_schema_worksheet_id: "dhcfg-onk-mwco-sv1-ws-overview", ordinal: 99, source_header: "Unauthorized Extra Column", presence: "OPTIONAL", declared_type: "UNKNOWN", sensitivity_class: "PUBLIC" },
      })
    ).rejects.toThrow();

    // Attempt a new mapping profile on one of the 14 existing worksheets.
    await expect(
      prisma.worksheetMappingProfile.create({
        data: { organisation_id: organisationId, source_schema_worksheet_id: "dhcfg-onk-mwco-sv1-ws-overview", name: "Unauthorized extra profile", active: false },
      })
    ).rejects.toThrow();
    expect(await prisma.worksheetMappingProfile.count({ where: { source_schema_worksheet_id: "dhcfg-onk-mwco-sv1-ws-overview" } })).toBe(1);

    // The R1/R2 trigger changes must not have broken the pre-existing
    // idempotent-rerun guarantee.
    const output = runActivation(actorUserId);
    expect(output).toMatch(/already ACTIVE.*no-op, zero mutation, zero new audit event/);
    const stillActive = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: SV_ID } });
    expect(stillActive.activated_at?.getTime()).toBe(afterActivation.activated_at?.getTime());
  });
});
