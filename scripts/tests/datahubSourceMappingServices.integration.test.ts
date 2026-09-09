import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Data Hub 5B.2 — real disposable-Postgres integration harness for the
// SourceSystem/SourceMapping/MappingVersion administrative service layer.
// Run ONLY via scripts/tests/verify-datahub-source-mapping-services.sh.
// Same non-Production/non-Preview/localhost-only DATABASE_URL guard as
// every sibling Data Hub integration spec.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "datahubSourceMappingServices.integration.test.ts requires DATABASE_URL to point at a disposable " +
      "Postgres container (see scripts/tests/verify-datahub-source-mapping-services.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run against a DATABASE_URL that looks like a real hosted/Production database. This " +
      "suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error("Refusing to run against a non-localhost DATABASE_URL host.");
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

let createSourceSystem: typeof import("@/lib/data-hub/sourceMapping/sourceSystems").createSourceSystem;
let listSourceSystems: typeof import("@/lib/data-hub/sourceMapping/sourceSystems").listSourceSystems;
let getSourceSystem: typeof import("@/lib/data-hub/sourceMapping/sourceSystems").getSourceSystem;
let updateSourceSystem: typeof import("@/lib/data-hub/sourceMapping/sourceSystems").updateSourceSystem;
let setSourceSystemActive: typeof import("@/lib/data-hub/sourceMapping/sourceSystems").setSourceSystemActive;

let createSourceMapping: typeof import("@/lib/data-hub/sourceMapping/sourceMappings").createSourceMapping;
let listSourceMappings: typeof import("@/lib/data-hub/sourceMapping/sourceMappings").listSourceMappings;
let getSourceMapping: typeof import("@/lib/data-hub/sourceMapping/sourceMappings").getSourceMapping;
let updateSourceMapping: typeof import("@/lib/data-hub/sourceMapping/sourceMappings").updateSourceMapping;
let setSourceMappingActive: typeof import("@/lib/data-hub/sourceMapping/sourceMappings").setSourceMappingActive;

let createMappingVersion: typeof import("@/lib/data-hub/sourceMapping/mappingVersions").createMappingVersion;
let listMappingVersions: typeof import("@/lib/data-hub/sourceMapping/mappingVersions").listMappingVersions;
let getMappingVersion: typeof import("@/lib/data-hub/sourceMapping/mappingVersions").getMappingVersion;
let activateMappingVersion: typeof import("@/lib/data-hub/sourceMapping/mappingVersions").activateMappingVersion;

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const USER_B = "user-b";

const VALID_DOC = { fields: { report_date: "Call time", location: "Site Address", waste_type: "Type" } };

beforeAll(async () => {
  ({ createSourceSystem, listSourceSystems, getSourceSystem, updateSourceSystem, setSourceSystemActive } = await import(
    "@/lib/data-hub/sourceMapping/sourceSystems"
  ));
  ({ createSourceMapping, listSourceMappings, getSourceMapping, updateSourceMapping, setSourceMappingActive } = await import(
    "@/lib/data-hub/sourceMapping/sourceMappings"
  ));
  ({ createMappingVersion, listMappingVersions, getMappingVersion, activateMappingVersion } = await import(
    "@/lib/data-hub/sourceMapping/mappingVersions"
  ));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'),
      ('${ORG_B}', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('${USER_A}', '${ORG_A}', 'user-a', 'User A'),
      ('${USER_B}', '${ORG_B}', 'user-b', 'User B')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SourceSystem — tenant isolation and lifecycle", () => {
  it("T1/creates and lists within one tenant", async () => {
    const created = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "T1 System" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.sourceSystem.createdBy).toBe(USER_A);

    const listed = await listSourceSystems(ORG_A, {});
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.some((s) => s.id === created.sourceSystem.id)).toBe(true);
  });

  it("T8/duplicate tenant name handled safely (no unhandled Prisma error)", async () => {
    await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Dup System" });
    const dup = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Dup System" });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe("DUPLICATE_NAME");
  });

  it("T9/same name allowed across different tenants", async () => {
    const a = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Shared Name System" });
    const b = await createSourceSystem({ organisationId: ORG_B, userId: USER_B }, { name: "Shared Name System" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("T10/T11 — cross-tenant get and update are both rejected as not-found (no tenant enumeration)", async () => {
    const created = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Cross Tenant Get" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const crossGet = await getSourceSystem(ORG_B, created.sourceSystem.id);
    expect(crossGet.ok).toBe(false);
    if (crossGet.ok) return;
    expect(crossGet.code).toBe("SOURCE_SYSTEM_NOT_FOUND");

    const crossUpdate = await updateSourceSystem(ORG_B, created.sourceSystem.id, { name: "Hijacked" });
    expect(crossUpdate.ok).toBe(false);
    if (crossUpdate.ok) return;
    expect(crossUpdate.code).toBe("SOURCE_SYSTEM_NOT_FOUND");

    // Prove the record was genuinely untouched by the rejected cross-tenant update.
    const stillOriginal = await getSourceSystem(ORG_A, created.sourceSystem.id);
    expect(stillOriginal.ok).toBe(true);
    if (!stillOriginal.ok) return;
    expect(stillOriginal.sourceSystem.name).toBe("Cross Tenant Get");
  });

  it("T12/T13/T14 — metadata update allowlist, deactivate, reactivate", async () => {
    const created = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Lifecycle System" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateSourceSystem(ORG_A, created.sourceSystem.id, { name: "Lifecycle System Renamed", description: "new desc" });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.sourceSystem.name).toBe("Lifecycle System Renamed");
      expect(updated.sourceSystem.description).toBe("new desc");
    }

    const deactivated = await setSourceSystemActive(ORG_A, created.sourceSystem.id, false);
    expect(deactivated.ok).toBe(true);
    if (deactivated.ok) expect(deactivated.sourceSystem.active).toBe(false);

    const reactivated = await setSourceSystemActive(ORG_A, created.sourceSystem.id, true);
    expect(reactivated.ok).toBe(true);
    if (reactivated.ok) expect(reactivated.sourceSystem.active).toBe(true);
  });
});

describe("SourceMapping — parent tenant safety, inactive-parent block, lifecycle", () => {
  it("T21 — source_system_id must be same tenant (cross-tenant parent rejected)", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Parent For Cross" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;

    const crossOrgMapping = await createSourceMapping({ organisationId: ORG_B, userId: USER_B }, { sourceSystemId: sys.sourceSystem.id, name: "Should Fail" });
    expect(crossOrgMapping.ok).toBe(false);
    if (crossOrgMapping.ok) return;
    expect(crossOrgMapping.code).toBe("SOURCE_SYSTEM_NOT_FOUND");
  });

  it("T22 — mapping creation under an inactive SourceSystem is blocked", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Inactive Parent" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    await setSourceSystemActive(ORG_A, sys.sourceSystem.id, false);

    const blocked = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Should Be Blocked" });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("SOURCE_SYSTEM_INACTIVE");
  });

  it("T23/T24 — duplicate name under same source rejected, same name under a different source allowed", async () => {
    const sysOne = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "System One For Names" });
    const sysTwo = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "System Two For Names" });
    expect(sysOne.ok && sysTwo.ok).toBe(true);
    if (!sysOne.ok || !sysTwo.ok) return;

    const first = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sysOne.sourceSystem.id, name: "Shared Mapping Name" });
    expect(first.ok).toBe(true);

    const dupUnderSame = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sysOne.sourceSystem.id, name: "Shared Mapping Name" });
    expect(dupUnderSame.ok).toBe(false);
    if (!dupUnderSame.ok) expect(dupUnderSame.code).toBe("DUPLICATE_NAME");

    const sameNameOtherSystem = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sysTwo.sourceSystem.id, name: "Shared Mapping Name" });
    expect(sameNameOtherSystem.ok).toBe(true);
  });

  it("T25 — cross-tenant get/update impossible", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "System For Cross Mapping" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Cross Mapping Get" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;

    const crossGet = await getSourceMapping(ORG_B, mapping.sourceMapping.id);
    expect(crossGet.ok).toBe(false);
    if (!crossGet.ok) expect(crossGet.code).toBe("SOURCE_MAPPING_NOT_FOUND");

    const crossUpdate = await updateSourceMapping(ORG_B, mapping.sourceMapping.id, { name: "Hijacked" });
    expect(crossUpdate.ok).toBe(false);
    if (!crossUpdate.ok) expect(crossUpdate.code).toBe("SOURCE_MAPPING_NOT_FOUND");
  });

  it("T27/T28 — deactivate/reactivate preserve the active-version pointer and history", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "System For Deactivate Pointer" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Mapping For Deactivate Pointer" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const version = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mapping.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(version.ok).toBe(true);
    if (!version.ok) return;
    const activated = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);

    const deactivated = await setSourceMappingActive(ORG_A, mapping.sourceMapping.id, false);
    expect(deactivated.ok).toBe(true);
    if (deactivated.ok) expect(deactivated.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);

    const reactivated = await setSourceMappingActive(ORG_A, mapping.sourceMapping.id, true);
    expect(reactivated.ok).toBe(true);
    if (reactivated.ok) expect(reactivated.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);

    // History remains fully readable throughout.
    const stillGettable = await getMappingVersion(ORG_A, version.mappingVersion.id);
    expect(stillGettable.ok).toBe(true);
  });

  it("T29 — list source_system filter is tenant-safe (foreign sourceSystemId yields zero rows, not an error)", async () => {
    const sysA = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Filter Owner A" });
    expect(sysA.ok).toBe(true);
    if (!sysA.ok) return;

    const crossFilterList = await listSourceMappings(ORG_B, { sourceSystemId: sysA.sourceSystem.id });
    expect(crossFilterList.ok).toBe(true);
    if (crossFilterList.ok) expect(crossFilterList.items.length).toBe(0);
  });

  it("M24 — an unfiltered list for one tenant never returns another tenant's rows (general tenant-scope leak proof)", async () => {
    const sysA = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Leak Proof Owner A" });
    expect(sysA.ok).toBe(true);
    if (!sysA.ok) return;
    const mappingA = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sysA.sourceSystem.id, name: "Leak Proof Mapping A" });
    expect(mappingA.ok).toBe(true);
    if (!mappingA.ok) return;

    // A completely unfiltered list call for ORG_B (no sourceSystemId
    // filter at all, unlike the coincidentally-safe test above) must
    // never surface ORG_A's mapping, even though ORG_A definitely has at
    // least one real row at this point.
    const orgBList = await listSourceMappings(ORG_B, {});
    expect(orgBList.ok).toBe(true);
    if (orgBList.ok) {
      expect(orgBList.items.some((m) => m.id === mappingA.sourceMapping.id)).toBe(false);
    }
  });
});

describe("MappingVersion — immutability, concurrency-safe allocation, inactive-parent block", () => {
  async function makeMappingActive(org: string, user: string, namePrefix: string) {
    const sys = await createSourceSystem({ organisationId: org, userId: user }, { name: `${namePrefix} System` });
    if (!sys.ok) throw new Error("setup failed");
    const mapping = await createSourceMapping({ organisationId: org, userId: user }, { sourceSystemId: sys.sourceSystem.id, name: `${namePrefix} Mapping` });
    if (!mapping.ok) throw new Error("setup failed");
    return { sourceSystemId: sys.sourceSystem.id, sourceMappingId: mapping.sourceMapping.id };
  }

  it("T41/T46/T47/T50 — admin-caller creates versions with server-owned sequential numbers/actor", async () => {
    const { sourceMappingId } = await makeMappingActive(ORG_A, USER_A, "Sequential");

    const v1 = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    const v2 = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;
    expect(v1.mappingVersion.versionNumber).toBe(1);
    expect(v2.mappingVersion.versionNumber).toBe(2);
    expect(v1.mappingVersion.createdBy).toBe(USER_A);
  });

  it("T43 — tenant ownership enforced (cross-tenant sourceMappingId rejected)", async () => {
    const { sourceMappingId } = await makeMappingActive(ORG_A, USER_A, "TenantEnforced");
    const crossOrg = await createMappingVersion({ organisationId: ORG_B, userId: USER_B }, { sourceMappingId, mappingDocument: VALID_DOC });
    expect(crossOrg.ok).toBe(false);
    if (!crossOrg.ok) expect(crossOrg.code).toBe("SOURCE_MAPPING_NOT_FOUND");
  });

  it("T44/T45 — inactive mapping and inactive parent system both block new-version creation", async () => {
    const { sourceSystemId, sourceMappingId } = await makeMappingActive(ORG_A, USER_A, "InactiveBlock1");
    await setSourceMappingActive(ORG_A, sourceMappingId, false);
    const blockedByMapping = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    expect(blockedByMapping.ok).toBe(false);
    if (!blockedByMapping.ok) expect(blockedByMapping.code).toBe("SOURCE_MAPPING_INACTIVE");
    await setSourceMappingActive(ORG_A, sourceMappingId, true);

    await setSourceSystemActive(ORG_A, sourceSystemId, false);
    const blockedBySystem = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    expect(blockedBySystem.ok).toBe(false);
    if (!blockedBySystem.ok) expect(blockedBySystem.code).toBe("SOURCE_SYSTEM_INACTIVE");
  });

  it("T51/T52 — concurrent version creation is safe: N parallel calls produce N distinct sequential numbers, no DB race error surfaces", async () => {
    const { sourceMappingId } = await makeMappingActive(ORG_A, USER_A, "Concurrent");
    const CONCURRENCY = 8;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC })
      )
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = results.map((r) => (r.ok ? r.mappingVersion.versionNumber : -1)).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    // No duplicates — the real (source_mapping_id, version_number) unique
    // constraint would have made a duplicate structurally impossible even
    // if the retry loop had a bug, but this independently confirms it.
    expect(new Set(numbers).size).toBe(CONCURRENCY);
  });

  it("T53/T54 — list is bounded/newest-first, get is tenant-safe", async () => {
    const { sourceMappingId } = await makeMappingActive(ORG_A, USER_A, "ListOrder");
    const v1 = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    const v2 = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId, mappingDocument: VALID_DOC });
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;

    const list = await listMappingVersions(ORG_A, sourceMappingId, {});
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.items[0].versionNumber).toBeGreaterThan(list.items[1].versionNumber);
    }

    const crossGet = await getMappingVersion(ORG_B, v1.mappingVersion.id);
    expect(crossGet.ok).toBe(false);
  });
});

describe("Active-version activation — atomicity, cross-mapping/cross-tenant rejection, idempotency", () => {
  it("T55/T61/T64 — admin+ activates own mapping's version atomically; DB pointer remains valid", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Activation System" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Activation Mapping" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const version = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mapping.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const activated = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(activated.ok).toBe(true);
    if (activated.ok) expect(activated.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);

    // T64 — the DB FK itself must accept this state (it would have thrown
    // at the write above if not); reconfirm via a fresh read.
    const reGet = await getSourceMapping(ORG_A, mapping.sourceMapping.id);
    expect(reGet.ok).toBe(true);
    if (reGet.ok) expect(reGet.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);
  });

  it("T58 — another mapping's version is rejected (VERSION_MISMATCH), even same tenant", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Mismatch System" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mappingOne = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Mismatch Mapping One" });
    const mappingTwo = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Mismatch Mapping Two" });
    expect(mappingOne.ok && mappingTwo.ok).toBe(true);
    if (!mappingOne.ok || !mappingTwo.ok) return;
    const versionOfTwo = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mappingTwo.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(versionOfTwo.ok).toBe(true);
    if (!versionOfTwo.ok) return;

    const crossMapping = await activateMappingVersion(ORG_A, mappingOne.sourceMapping.id, versionOfTwo.mappingVersion.id);
    expect(crossMapping.ok).toBe(false);
    if (!crossMapping.ok) expect(crossMapping.code).toBe("VERSION_MISMATCH");
  });

  it("T57 — cross-tenant activation impossible", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Cross Tenant Activate System" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Cross Tenant Activate Mapping" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const version = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mapping.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const crossTenant = await activateMappingVersion(ORG_B, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.code).toBe("SOURCE_MAPPING_NOT_FOUND");

    // Also prove a same-tenant mapping cannot activate an org-B version id
    // even if it somehow guessed a real id from another tenant.
    const orgBSys = await createSourceSystem({ organisationId: ORG_B, userId: USER_B }, { name: "Org B Own System" });
    const orgBMapping = orgBSys.ok
      ? await createSourceMapping({ organisationId: ORG_B, userId: USER_B }, { sourceSystemId: orgBSys.sourceSystem.id, name: "Org B Own Mapping" })
      : null;
    const orgBVersion =
      orgBMapping && orgBMapping.ok
        ? await createMappingVersion({ organisationId: ORG_B, userId: USER_B }, { sourceMappingId: orgBMapping.sourceMapping.id, mappingDocument: VALID_DOC })
        : null;
    expect(orgBVersion && orgBVersion.ok).toBe(true);
    if (!orgBVersion || !orgBVersion.ok) return;
    const stealAttempt = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, orgBVersion.mappingVersion.id);
    expect(stealAttempt.ok).toBe(false);
    if (!stealAttempt.ok) expect(stealAttempt.code).toBe("MAPPING_VERSION_NOT_FOUND");
  });

  it("T59/T60 — inactive mapping and inactive parent system both block activation", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Activation Inactive System" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Activation Inactive Mapping" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const version = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mapping.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    await setSourceMappingActive(ORG_A, mapping.sourceMapping.id, false);
    const blockedByMapping = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(blockedByMapping.ok).toBe(false);
    if (!blockedByMapping.ok) expect(blockedByMapping.code).toBe("SOURCE_MAPPING_INACTIVE");
    await setSourceMappingActive(ORG_A, mapping.sourceMapping.id, true);

    await setSourceSystemActive(ORG_A, sys.sourceSystem.id, false);
    const blockedBySystem = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(blockedBySystem.ok).toBe(false);
    if (!blockedBySystem.ok) expect(blockedBySystem.code).toBe("SOURCE_SYSTEM_INACTIVE");
  });

  it("T62/T63 — activating the already-active version is idempotent and never mutates the MappingVersion row", async () => {
    const sys = await createSourceSystem({ organisationId: ORG_A, userId: USER_A }, { name: "Idempotent System" });
    expect(sys.ok).toBe(true);
    if (!sys.ok) return;
    const mapping = await createSourceMapping({ organisationId: ORG_A, userId: USER_A }, { sourceSystemId: sys.sourceSystem.id, name: "Idempotent Mapping" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const version = await createMappingVersion({ organisationId: ORG_A, userId: USER_A }, { sourceMappingId: mapping.sourceMapping.id, mappingDocument: VALID_DOC });
    expect(version.ok).toBe(true);
    if (!version.ok) return;

    const first = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    const second = await activateMappingVersion(ORG_A, mapping.sourceMapping.id, version.mappingVersion.id);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.sourceMapping.activeMappingVersionId).toBe(version.mappingVersion.id);
    }

    const versionAfter = await getMappingVersion(ORG_A, version.mappingVersion.id);
    expect(versionAfter.ok).toBe(true);
    if (versionAfter.ok) {
      expect(versionAfter.mappingVersion.versionNumber).toBe(version.mappingVersion.versionNumber);
      expect(versionAfter.mappingVersion.mappingDocument).toEqual(version.mappingVersion.mappingDocument);
    }
  });
});
