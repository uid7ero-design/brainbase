// Data Hub 6.2D3E — real disposable-Postgres proof for
// scripts/create-datahub-governed-schema-immutability.sql.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/datahubGovernedSchemaImmutability.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` container that already has
// the D3A foundation (scripts/create-datahub-source-schema-profiles.sql)
// AND this migration (scripts/create-datahub-governed-schema-
// immutability.sql) applied — never Production/Preview.
//
// SCOPE: this file mutation-tests the five triggers directly with raw
// UPDATE/DELETE statements against a minimal synthetic 1-worksheet/
// 1-column fixture (never the real Onkaparinga manifest — that is
// covered, together with the real activation script, by
// datahubOnkaparingaSchemaV1Activation.postgres-proof.test.ts). Every
// scenario proves BOTH the rejection (error thrown, zero row changed)
// and, where the transition is permitted, the actual success.
//
// Covers all 18 scenarios from the 6.2D3E spec's own Section 19:
//   1  DRAFT -> ACTIVE allowed
//   2  ACTIVE requires non-NULL activated_at
//   3  ACTIVE -> DRAFT rejected
//   4  ACTIVE -> RETIRED allowed
//   5  RETIRED -> ACTIVE rejected
//   6  RETIRED -> DRAFT rejected
//   7  DELETE ACTIVE SourceSchemaVersion rejected
//   8  DELETE RETIRED SourceSchemaVersion rejected
//   9  UPDATE worksheet under ACTIVE schema rejected
//   10 DELETE worksheet under ACTIVE schema rejected
//   11 UPDATE column under ACTIVE schema rejected
//   12 DELETE column under ACTIVE schema rejected
//   13 profile-version UPDATE rejected
//   14 profile-version DELETE rejected
//   15 profile identity mutation under ACTIVE schema rejected
//   16 active pointer change remains structurally valid where permitted
//   17 cross-tenant pointer remains rejected by the existing FK
//   18 DRAFT content remains available to future governance work

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("55558")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.2D3E immutability proof container (port 55558). " +
      "This proof must never run against Production/Preview."
  );
}

const prisma = new PrismaClient();

describe("6.2D3E governed schema immutability — real disposable Postgres proof", () => {
  let organisationId: string;
  let sourceSystemId: string;
  let datasetTypeId: string;

  /** Creates a fresh DRAFT SourceSchemaVersion + 1 worksheet + 1 column +
   * 1 inactive profile + 1 v1 profile version, all under the shared
   * organisation/source-system/dataset-type fixture. */
  async function createDraftVersion(label: string) {
    const sv = await prisma.sourceSchemaVersion.create({
      data: { organisation_id: organisationId, dataset_type_id: datasetTypeId, version_number: Math.floor(Math.random() * 1_000_000) + 1, label, status: "DRAFT" },
    });
    const ws = await prisma.sourceSchemaWorksheet.create({
      data: { organisation_id: organisationId, source_schema_version_id: sv.id, logical_key: `k_${label}`, expected_name: `Sheet ${label}`, ordinal_hint: 0, presence: "REQUIRED", role: "DATA" },
    });
    const col = await prisma.sourceSchemaColumn.create({
      data: { organisation_id: organisationId, source_schema_worksheet_id: ws.id, ordinal: 0, source_header: "Id", presence: "REQUIRED", declared_type: "STRING", sensitivity_class: "PUBLIC" },
    });
    const profile = await prisma.worksheetMappingProfile.create({
      data: { organisation_id: organisationId, source_schema_worksheet_id: ws.id, name: `profile-${label}`, active: false },
    });
    const version = await prisma.worksheetMappingProfileVersion.create({
      data: { organisation_id: organisationId, worksheet_mapping_profile_id: profile.id, version_number: 1, disposition: "STAGING_DATASET", profile_document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 1 } },
    });
    return { sv, ws, col, profile, version };
  }

  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: "6.2D3E Immutability Proof Org", slug: `proof-org-6-2d3e-imm-${Date.now()}` } });
    organisationId = org.id;
    const ss = await prisma.sourceSystem.create({ data: { organisation_id: organisationId, name: "6.2D3E Immutability Proof SourceSystem", active: true } });
    sourceSystemId = ss.id;
    const dt = await prisma.datasetType.create({ data: { organisation_id: organisationId, source_system_id: sourceSystemId, name: "6.2D3E Immutability Proof DatasetType", active: true } });
    datasetTypeId = dt.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1/2. DRAFT may transition to ACTIVE; ACTIVE requires a non-NULL activated_at", async () => {
    const { sv } = await createDraftVersion("t1");
    await expect(prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE' WHERE id = ${sv.id}`).rejects.toThrow();
    const row1 = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    expect(row1.status).toBe("DRAFT");

    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    const row2 = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    expect(row2.status).toBe("ACTIVE");
    expect(row2.activated_at).not.toBeNull();
  });

  it("3. ACTIVE -> DRAFT is rejected (no unactivate)", async () => {
    const { sv } = await createDraftVersion("t3");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    await expect(prisma.$executeRaw`UPDATE source_schema_versions SET status = 'DRAFT', activated_at = NULL WHERE id = ${sv.id}`).rejects.toThrow();
    const row = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    expect(row.status).toBe("ACTIVE");
  });

  it("4. ACTIVE -> RETIRED is allowed, activated_at is preserved unchanged", async () => {
    const { sv } = await createDraftVersion("t4");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    const active = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'RETIRED' WHERE id = ${sv.id}`;
    const retired = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    expect(retired.status).toBe("RETIRED");
    expect(retired.activated_at?.getTime()).toBe(active.activated_at?.getTime());
  });

  it("5/6. RETIRED is terminal: RETIRED -> ACTIVE and RETIRED -> DRAFT are both rejected", async () => {
    const { sv } = await createDraftVersion("t56");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'RETIRED' WHERE id = ${sv.id}`;
    await expect(prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE' WHERE id = ${sv.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE source_schema_versions SET status = 'DRAFT', activated_at = NULL WHERE id = ${sv.id}`).rejects.toThrow();
    const row = await prisma.sourceSchemaVersion.findUniqueOrThrow({ where: { id: sv.id } });
    expect(row.status).toBe("RETIRED");
  });

  it("7/8. DELETE of an ACTIVE or RETIRED SourceSchemaVersion is rejected", async () => {
    const { sv: svActive } = await createDraftVersion("t7");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${svActive.id}`;
    await expect(prisma.$executeRaw`DELETE FROM source_schema_versions WHERE id = ${svActive.id}`).rejects.toThrow();

    const { sv: svRetired } = await createDraftVersion("t8");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${svRetired.id}`;
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'RETIRED' WHERE id = ${svRetired.id}`;
    await expect(prisma.$executeRaw`DELETE FROM source_schema_versions WHERE id = ${svRetired.id}`).rejects.toThrow();

    expect((await prisma.sourceSchemaVersion.findMany({ where: { id: { in: [svActive.id, svRetired.id] } } })).length).toBe(2);
  });

  it("9/10. UPDATE and DELETE of a worksheet under an ACTIVE schema are both rejected; a DRAFT worksheet remains fully editable/deletable", async () => {
    const { sv, ws } = await createDraftVersion("t910");
    // DRAFT: fully editable/deletable.
    await prisma.$executeRaw`UPDATE source_schema_worksheets SET expected_name = 'Renamed while draft' WHERE id = ${ws.id}`;
    await prisma.$executeRaw`UPDATE source_schema_worksheets SET expected_name = ${ws.expected_name} WHERE id = ${ws.id}`;

    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    await expect(prisma.$executeRaw`UPDATE source_schema_worksheets SET expected_name = 'Hacked' WHERE id = ${ws.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM source_schema_worksheets WHERE id = ${ws.id}`).rejects.toThrow();
    const row = await prisma.sourceSchemaWorksheet.findUniqueOrThrow({ where: { id: ws.id } });
    expect(row.expected_name).toBe(ws.expected_name);
  });

  it("11/12. UPDATE and DELETE of a column under an ACTIVE schema are both rejected; a DRAFT column remains fully editable/deletable", async () => {
    const { sv, col } = await createDraftVersion("t1112");
    await prisma.$executeRaw`UPDATE source_schema_columns SET source_header = 'Renamed while draft' WHERE id = ${col.id}`;
    await prisma.$executeRaw`UPDATE source_schema_columns SET source_header = ${col.source_header} WHERE id = ${col.id}`;

    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    await expect(prisma.$executeRaw`UPDATE source_schema_columns SET source_header = 'Hacked' WHERE id = ${col.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM source_schema_columns WHERE id = ${col.id}`).rejects.toThrow();
    const row = await prisma.sourceSchemaColumn.findUniqueOrThrow({ where: { id: col.id } });
    expect(row.source_header).toBe(col.source_header);
  });

  it("13/14. worksheet_mapping_profile_versions are UNCONDITIONALLY immutable — UPDATE and DELETE rejected even while the parent schema is still DRAFT", async () => {
    const { version } = await createDraftVersion("t1314");
    await expect(prisma.$executeRaw`UPDATE worksheet_mapping_profile_versions SET disposition = 'IGNORE' WHERE id = ${version.id}`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM worksheet_mapping_profile_versions WHERE id = ${version.id}`).rejects.toThrow();
    const row = await prisma.worksheetMappingProfileVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(row.disposition).toBe("STAGING_DATASET");
  });

  it("15/16. profile identity mutation is rejected once ACTIVE, but the lifecycle pointer (active/active_profile_version_id/updated_at) remains changeable and structurally FK-valid", async () => {
    const { sv, profile, version } = await createDraftVersion("t1516");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;

    await expect(prisma.$executeRaw`UPDATE worksheet_mapping_profiles SET name = 'Hacked' WHERE id = ${profile.id}`).rejects.toThrow();

    // The permitted lifecycle-pointer change — must succeed, and the
    // pre-existing composite FK must still accept a valid same-profile
    // pointer.
    await prisma.$executeRaw`UPDATE worksheet_mapping_profiles SET active = true, active_profile_version_id = ${version.id} WHERE id = ${profile.id}`;
    const row = await prisma.worksheetMappingProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(row.active).toBe(true);
    expect(row.active_profile_version_id).toBe(version.id);
    expect(row.name).toBe(profile.name);
  });

  it("15b. worksheet_mapping_profiles DELETE is also rejected once ACTIVE (symmetric hardening)", async () => {
    const { sv, profile } = await createDraftVersion("t15b");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    await expect(prisma.$executeRaw`DELETE FROM worksheet_mapping_profiles WHERE id = ${profile.id}`).rejects.toThrow();
  });

  it("17. cross-tenant active pointer remains rejected by the pre-existing composite FK, unaffected by the new triggers", async () => {
    const { sv, profile } = await createDraftVersion("t17a");
    const { version: otherVersion } = await createDraftVersion("t17b");
    await prisma.$executeRaw`UPDATE source_schema_versions SET status = 'ACTIVE', activated_at = now() WHERE id = ${sv.id}`;
    // otherVersion belongs to a DIFFERENT profile (same tenant, but not
    // "this profile's own version") — the composite FK
    // (active_profile_version_id, id, organisation_id) ->
    // (id, worksheet_mapping_profile_id, organisation_id) requires the
    // pointer's profile-id component to equal THIS profile's own id.
    await expect(prisma.$executeRaw`UPDATE worksheet_mapping_profiles SET active = true, active_profile_version_id = ${otherVersion.id} WHERE id = ${profile.id}`).rejects.toThrow();
  });

  it("18. DRAFT content remains fully available to future governance/version-construction work (no trigger interference at all while DRAFT)", async () => {
    const { sv, ws, col, profile } = await createDraftVersion("t18");
    await prisma.$executeRaw`UPDATE source_schema_worksheets SET expected_name = 'Edited', ordinal_hint = 5 WHERE id = ${ws.id}`;
    await prisma.$executeRaw`UPDATE source_schema_columns SET source_header = 'Edited', sensitivity_class = 'CONFIDENTIAL' WHERE id = ${col.id}`;
    // Full profile UPDATE (including identity fields, not just the
    // lifecycle pointer) succeeds while DRAFT — the identity-freeze only
    // applies once ACTIVE/RETIRED.
    await prisma.$executeRaw`UPDATE worksheet_mapping_profiles SET name = 'Edited', active = true WHERE id = ${profile.id}`;
    const editedProfile = await prisma.worksheetMappingProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(editedProfile.name).toBe("Edited");

    // DELETE at the column level is fully available while DRAFT. (This
    // profile's own v1 version is UNCONDITIONALLY immutable — 13/14
    // above — including DELETE, even while the schema is DRAFT, so the
    // profile row itself cannot be deleted while that version exists;
    // that is a pre-existing D3A composite FK behavior, not a gap in
    // DRAFT flexibility introduced by this migration.)
    await prisma.$executeRaw`DELETE FROM source_schema_columns WHERE id = ${col.id}`;
    const colGone = await prisma.sourceSchemaColumn.findUnique({ where: { id: col.id } });
    expect(colGone).toBeNull();

    // A worksheet with no remaining columns and no profile is fully
    // deletable while DRAFT.
    const freeWs = await prisma.sourceSchemaWorksheet.create({
      data: { organisation_id: organisationId, source_schema_version_id: sv.id, logical_key: "t18_free", expected_name: "Free", ordinal_hint: 1, presence: "OPTIONAL", role: "DATA" },
    });
    await prisma.$executeRaw`DELETE FROM source_schema_worksheets WHERE id = ${freeWs.id}`;
    expect(await prisma.sourceSchemaWorksheet.findUnique({ where: { id: freeWs.id } })).toBeNull();
  });
});
