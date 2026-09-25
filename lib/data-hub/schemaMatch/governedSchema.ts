import { prisma } from "../../prisma";
import { MAX_HEADER_ROW_ONE_BASED } from "../workbookParser";
import type { GovernedPresence, GovernedSchemaInput, GovernedWorksheetInput } from "./schemaMatcher";

// Data Hub 6.2D3C — READ-ONLY, tenant-safe loader for the governed
// Onkaparinga "Monthly waste and collection operations" June-v1 source
// schema (6.2D3A tables, 6.2D3B definitions).
//
// Resolution is by the batch's OWN persisted source_system_id + the exact
// DatasetType name + version_number 1, then pinned to the deterministic
// D3B ids — never by any caller-supplied schema/org id. Every query carries
// organisation_id = the trusted session tenant, and every returned row's
// organisation_id is re-checked, so a cross-tenant row can never be used.
//
// The only profile data read is each worksheet's profile_document
// headerRowOneBased (the structural header position D3B recorded there),
// strictly validated. Profile active/active_profile_version_id,
// disposition, and schema activation are never read as authority and
// never written. A DRAFT schema stays DRAFT: this module performs zero
// Prisma writes (findFirst/findMany only) and never opens a transaction.

export const GOVERNED_DATASET_TYPE_NAME = "Monthly waste and collection operations";
export const GOVERNED_DATASET_TYPE_ID = "dhcfg-onk-mwco-dt";
export const GOVERNED_SOURCE_SCHEMA_VERSION_ID = "dhcfg-onk-mwco-sv1";
export const GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER = 1;
// The D3B profile version that recorded headerRowOneBased; a later profile
// version never silently changes where this schema's header row is read.
const GOVERNED_PROFILE_VERSION_NUMBER = 1;
const READABLE_SCHEMA_STATUSES = new Set(["DRAFT", "ACTIVE"]);

export type LoadGovernedSchemaResult = { ok: true; schema: GovernedSchemaInput } | { ok: false };

const UNAVAILABLE: LoadGovernedSchemaResult = { ok: false };

function isPresence(value: string): value is GovernedPresence {
  return value === "REQUIRED" || value === "OPTIONAL";
}

/** undefined = invalid document; null = governed "no tabular header". */
function headerRowFromProfileDocument(doc: unknown): number | null | undefined {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const keys = Object.keys(doc).sort();
  if (keys.join(",") !== "documentVersion,headerRowOneBased,schemaStatus") return undefined;
  const d = doc as { documentVersion: unknown; headerRowOneBased: unknown; schemaStatus: unknown };
  if (d.documentVersion !== 1 || typeof d.schemaStatus !== "string") return undefined;
  if (d.headerRowOneBased === null) return null;
  if (
    typeof d.headerRowOneBased !== "number" ||
    !Number.isSafeInteger(d.headerRowOneBased) ||
    d.headerRowOneBased < 1 ||
    d.headerRowOneBased > MAX_HEADER_ROW_ONE_BASED
  ) {
    return undefined;
  }
  return d.headerRowOneBased;
}

export async function loadGovernedSchemaForSourceSystem(context: {
  organisationId: string;
  sourceSystemId: string;
}): Promise<LoadGovernedSchemaResult> {
  const { organisationId, sourceSystemId } = context;

  const sourceSystem = await prisma.sourceSystem.findFirst({
    where: { id: sourceSystemId, organisation_id: organisationId },
    select: { id: true, organisation_id: true },
  });
  if (!sourceSystem || sourceSystem.organisation_id !== organisationId) return UNAVAILABLE;

  const datasetType = await prisma.datasetType.findFirst({
    where: { organisation_id: organisationId, source_system_id: sourceSystemId, name: GOVERNED_DATASET_TYPE_NAME },
    select: { id: true, organisation_id: true, source_system_id: true, active: true },
  });
  if (
    !datasetType ||
    datasetType.organisation_id !== organisationId ||
    datasetType.source_system_id !== sourceSystemId ||
    datasetType.id !== GOVERNED_DATASET_TYPE_ID ||
    datasetType.active !== true
  ) {
    return UNAVAILABLE;
  }

  const version = await prisma.sourceSchemaVersion.findFirst({
    where: { organisation_id: organisationId, dataset_type_id: datasetType.id, version_number: GOVERNED_SOURCE_SCHEMA_VERSION_NUMBER },
    select: { id: true, organisation_id: true, dataset_type_id: true, version_number: true, status: true },
  });
  if (
    !version ||
    version.organisation_id !== organisationId ||
    version.dataset_type_id !== datasetType.id ||
    version.id !== GOVERNED_SOURCE_SCHEMA_VERSION_ID ||
    !READABLE_SCHEMA_STATUSES.has(version.status)
  ) {
    return UNAVAILABLE;
  }

  const worksheets = await prisma.sourceSchemaWorksheet.findMany({
    where: { organisation_id: organisationId, source_schema_version_id: version.id },
    orderBy: [{ ordinal_hint: "asc" }, { expected_name: "asc" }],
    select: {
      id: true,
      organisation_id: true,
      source_schema_version_id: true,
      logical_key: true,
      expected_name: true,
      ordinal_hint: true,
      presence: true,
    },
  });
  if (worksheets.length === 0) return UNAVAILABLE;
  const worksheetIds = worksheets.map((w) => w.id);

  const columns = await prisma.sourceSchemaColumn.findMany({
    where: { organisation_id: organisationId, source_schema_worksheet_id: { in: worksheetIds } },
    orderBy: [{ source_schema_worksheet_id: "asc" }, { ordinal: "asc" }],
    select: { organisation_id: true, source_schema_worksheet_id: true, ordinal: true, source_header: true, presence: true },
  });

  const profileVersions = await prisma.worksheetMappingProfileVersion.findMany({
    where: {
      organisation_id: organisationId,
      version_number: GOVERNED_PROFILE_VERSION_NUMBER,
      profile: { organisation_id: organisationId, source_schema_worksheet_id: { in: worksheetIds } },
    },
    select: {
      organisation_id: true,
      profile_document: true,
      profile: { select: { organisation_id: true, source_schema_worksheet_id: true } },
    },
  });

  const rowsAreTenantScoped =
    worksheets.every((w) => w.organisation_id === organisationId && w.source_schema_version_id === version.id) &&
    columns.every((c) => c.organisation_id === organisationId && worksheetIds.includes(c.source_schema_worksheet_id)) &&
    profileVersions.every((v) => v.organisation_id === organisationId && v.profile.organisation_id === organisationId);
  if (!rowsAreTenantScoped) return UNAVAILABLE;
  if (!worksheets.every((w) => isPresence(w.presence)) || !columns.every((c) => isPresence(c.presence))) return UNAVAILABLE;

  const governed: GovernedWorksheetInput[] = worksheets.map((w) => {
    const docs = profileVersions
      .filter((v) => v.profile.source_schema_worksheet_id === w.id)
      .map((v) => headerRowFromProfileDocument(v.profile_document));
    const distinct = new Set(docs);
    // Exactly one consistent, valid governed header row; anything else is
    // unresolved (null), which the matcher reports as HEADER_ROW_UNRESOLVED
    // for a worksheet that defines columns.
    const headerRowOneBased = docs.length > 0 && distinct.size === 1 && !distinct.has(undefined) ? (docs[0] as number | null) : null;
    return {
      logicalKey: w.logical_key,
      expectedName: w.expected_name,
      ordinalHint: w.ordinal_hint,
      presence: w.presence as GovernedPresence,
      headerRowOneBased,
      columns: columns
        .filter((c) => c.source_schema_worksheet_id === w.id)
        .map((c) => ({ ordinal: c.ordinal, sourceHeader: c.source_header, presence: c.presence as GovernedPresence })),
    };
  });

  return {
    ok: true,
    schema: {
      sourceSchemaVersionId: version.id,
      versionNumber: version.version_number,
      status: version.status,
      worksheets: governed,
    },
  };
}
