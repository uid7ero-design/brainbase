import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { GOVERNED_SOURCE_SCHEMA_VERSION_ID, GOVERNED_DATASET_TYPE_ID } from "../schemaMatch/governedSchema";
import { buildRunsProfile, createRunsPilotReview, RUNS_REVIEW_FIELDS, type RunsPilotReview, type RunsGovernedColumn } from "./runsPilotReview";
import { parseProfileDocument } from "./profileDocument";

type Tx = Prisma.TransactionClient;
type Scope = { organisationId: string; userId: string; uploadId: string };
export class MappingSetupError extends Error {
  constructor(readonly code: "UPLOAD_NOT_FOUND" | "FORBIDDEN" | "MAPPING_NOT_READY" | "MAPPING_STALE" | "MAPPING_REVIEW_INVALID" | "MAPPING_ALREADY_STARTED") { super(code); }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function context(tx: Tx, scope: Scope, lock: boolean) {
  const { organisationId, userId, uploadId } = scope;
  const actors = await tx.$queryRaw<{ role: string }[]>`SELECT role::text AS role FROM users
    WHERE id=${userId} AND organisation_id=${organisationId} AND status::text='ACTIVE' FOR SHARE`;
  const role = actors[0]?.role;
  if (!["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role)) throw new MappingSetupError("FORBIDDEN");
  const upload = await tx.upload.findFirst({ where: { id: uploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { import_batch_id: true, worksheet_name: true, worksheet_index: true, raw_staged_at: true,
      import_batch: { select: { status: true, deleted_at: true, sha256: true, source_schema_version_id: true, source_system_id: true } } } });
  if (!upload) throw new MappingSetupError("UPLOAD_NOT_FOUND");
  const batch = upload.import_batch;
  if (!batch || batch.status !== "READY" || batch.deleted_at || !batch.sha256) throw new MappingSetupError("MAPPING_NOT_READY");
  if (!batch.source_system_id || upload.worksheet_name === null || upload.worksheet_index === null) throw new MappingSetupError("MAPPING_NOT_READY");
  if (batch.source_schema_version_id !== GOVERNED_SOURCE_SCHEMA_VERSION_ID) return null;
  const schema = await tx.sourceSchemaVersion.findFirst({ where: { id: batch.source_schema_version_id, organisation_id: organisationId,
    dataset_type_id: GOVERNED_DATASET_TYPE_ID, status: "ACTIVE", dataset_type: { organisation_id: organisationId, source_system_id: batch.source_system_id, active: true } }, select: { id: true } });
  if (!schema) throw new MappingSetupError("MAPPING_NOT_READY");
  if (lock) {
    const activeSchema = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM source_schema_versions
      WHERE id=${schema.id} AND organisation_id=${organisationId} AND status='ACTIVE' FOR SHARE`;
    if (activeSchema.length !== 1) throw new MappingSetupError("MAPPING_STALE");
  }
  const worksheet = await tx.sourceSchemaWorksheet.findFirst({ where: { organisation_id: organisationId, source_schema_version_id: schema.id,
    ordinal_hint: upload.worksheet_index, expected_name: upload.worksheet_name }, select: { id: true, logical_key: true, role: true } });
  if (!worksheet) throw new MappingSetupError("MAPPING_NOT_READY");
  if (worksheet.logical_key !== "runs") return null;
  if (worksheet.role !== "DATA") throw new MappingSetupError("MAPPING_NOT_READY");
  const profiles = await tx.worksheetMappingProfile.findMany({ where: { organisation_id: organisationId, source_schema_worksheet_id: worksheet.id, active: true }, take: 2 });
  if (profiles.length !== 1) throw new MappingSetupError("MAPPING_NOT_READY");
  const profile = profiles[0];
  if (lock) {
    const rows = await tx.$queryRaw<{ active_profile_version_id: string }[]>`SELECT active_profile_version_id FROM worksheet_mapping_profiles
      WHERE id=${profile.id} AND organisation_id=${organisationId} AND active FOR UPDATE`;
    if (rows.length !== 1) throw new MappingSetupError("MAPPING_STALE");
    profile.active_profile_version_id = rows[0].active_profile_version_id;
    await tx.$queryRaw`SELECT id FROM uploads WHERE id=${uploadId} AND organisation_id=${organisationId} FOR UPDATE`;
  }
  const current = await tx.worksheetMappingProfileVersion.findFirst({ where: { id: profile.active_profile_version_id ?? "", organisation_id: organisationId,
    worksheet_mapping_profile_id: profile.id } });
  const structural = await tx.worksheetMappingProfileVersion.findFirst({ where: { worksheet_mapping_profile_id: profile.id, organisation_id: organisationId, version_number: 1 } });
  const parsedStructure = parseProfileDocument(structural?.profile_document);
  if (!current || current.disposition !== "STAGING_DATASET" || !parsedStructure.ok || parsedStructure.document.documentVersion !== 1 ||
    parsedStructure.document.headerRowOneBased !== 3) throw new MappingSetupError("MAPPING_NOT_READY");
  const rows = await tx.sourceSchemaColumn.findMany({ where: { organisation_id: organisationId, source_schema_worksheet_id: worksheet.id }, orderBy: { ordinal: "asc" } });
  const columns = rows.map(c => ({ id: c.id, ordinal: c.ordinal, sourceHeader: c.source_header, sensitivityClass: c.sensitivity_class }));
  if (columns.length !== 21 || columns.some((c, index) => c.ordinal !== index || c.sourceHeader !== RUNS_REVIEW_FIELDS[index].header ||
    c.sensitivityClass !== RUNS_REVIEW_FIELDS[index].sensitivity)) throw new MappingSetupError("MAPPING_NOT_READY");
  const approvals = await tx.$queryRaw<{ review_document: unknown; review_digest: string }[]>`SELECT review_document,review_digest FROM data_hub_mapping_approvals
    WHERE profile_version_id=${current.id} AND profile_id=${profile.id} AND organisation_id=${organisationId}`;
  let review: RunsPilotReview | null = null;
  if (approvals.length) {
    const compiled = buildRunsProfile(approvals[0].review_document, columns);
    const parsed = parseProfileDocument(current.profile_document);
    if (!compiled.ok || !parsed.ok || hash(compiled.document) !== hash(parsed.document) ||
      hash(compiled.review) !== approvals[0].review_digest) throw new MappingSetupError("MAPPING_NOT_READY");
    review = compiled.review;
  }
  const existing = await tx.dataHubRawStagingRun.findFirst({ where: { upload_id: uploadId, organisation_id: organisationId }, select: { id: true } });
  const confirmations = await tx.$queryRaw<{ upload_id: string }[]>`SELECT upload_id FROM data_hub_mapping_use_confirmations
    WHERE upload_id=${uploadId} AND organisation_id=${organisationId} AND profile_version_id=${current.id}
      AND profile_id=${profile.id} AND source_sha256=${batch.sha256}`;
  const fingerprint = hash([organisationId, uploadId, batch.sha256, worksheet.id, profile.id, current.id, current.profile_document]);
  return { profile, current, columns, review, fingerprint, role, sha256: batch.sha256,
    pinned: !!existing || upload.raw_staged_at !== null, confirmed: confirmations.length === 1 };
}
function snapshot(value: Awaited<ReturnType<typeof context>>) {
  return value === null ? { ok: true as const, kind: "NOT_APPLICABLE" as const } : { ok: true as const,
    kind: value.pinned ? "PINNED" as const : "SETUP" as const, fingerprint: value.fingerprint,
    version: value.current.version_number, canSave: ["ADMIN", "SUPER_ADMIN"].includes(value.role),
    saved: value.review !== null, confirmed: value.confirmed, review: value.review ?? createRunsPilotReview() };
}
export async function readMappingSetup(scope: Scope) {
  return prisma.$transaction(async tx => snapshot(await context(tx, scope, false)));
}

export async function changeMappingSetup(scope: Scope, body: unknown) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new MappingSetupError("MAPPING_REVIEW_INVALID");
  const input = body as Record<string, unknown>;
  const expectedKeys = input.action === "SAVE" ? "action,fingerprint,review" : "action,fingerprint";
  if (!["SAVE", "CONFIRM"].includes(input.action as string) || Object.keys(input).sort().join(",") !== expectedKeys ||
    typeof input.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.fingerprint)) throw new MappingSetupError("MAPPING_REVIEW_INVALID");
  return prisma.$transaction(async tx => {
    const state = await context(tx, scope, true);
    if (!state) throw new MappingSetupError("MAPPING_NOT_READY");
    if (state.pinned) throw new MappingSetupError("MAPPING_ALREADY_STARTED");
    if (state.fingerprint !== input.fingerprint) throw new MappingSetupError("MAPPING_STALE");
    const { organisationId, userId, uploadId } = scope;
    if (input.action === "SAVE") {
      if (!["ADMIN", "SUPER_ADMIN"].includes(state.role)) throw new MappingSetupError("FORBIDDEN");
      const compiled = buildRunsProfile(input.review, state.columns);
      if (!compiled.ok) throw new MappingSetupError("MAPPING_REVIEW_INVALID");
      // Reconcile equal choices, including an explicit repeat, without another version.
      if (!state.review || hash(compiled.review) !== hash(state.review)) {
        const aggregate = await tx.worksheetMappingProfileVersion.aggregate({ where: { organisation_id: organisationId, worksheet_mapping_profile_id: state.profile.id }, _max: { version_number: true } });
        const id = randomUUID();
        await tx.worksheetMappingProfileVersion.create({ data: { id, organisation_id: organisationId, worksheet_mapping_profile_id: state.profile.id,
          version_number: (aggregate._max.version_number ?? 0) + 1, disposition: "STAGING_DATASET", profile_document: compiled.document as unknown as Prisma.InputJsonValue, created_by: userId } });
        await tx.$executeRaw`INSERT INTO data_hub_mapping_approvals(profile_version_id,profile_id,organisation_id,review_document,review_digest,approved_by)
          VALUES(${id},${state.profile.id},${organisationId},${JSON.stringify(compiled.review)}::jsonb,${hash(compiled.review)},${userId})`;
        const moved = await tx.worksheetMappingProfile.updateMany({ where: { id: state.profile.id, organisation_id: organisationId,
          active: true, active_profile_version_id: state.current.id }, data: { active_profile_version_id: id } });
        if (moved.count !== 1) throw new MappingSetupError("MAPPING_STALE");
        await tx.auditLog.create({ data: { organisation_id: organisationId, user_id: userId, action: "DATA_HUB_MAPPING_APPROVED",
          resource_type: "worksheet_mapping_profile", resource_id: state.profile.id,
          before_state: { versionId: state.current.id }, after_state: { versionId: id, reviewDigest: hash(compiled.review) } } });
      }
    } else {
      if (!state.review) throw new MappingSetupError("MAPPING_NOT_READY");
      if (!state.confirmed) {
        await tx.$executeRaw`INSERT INTO data_hub_mapping_use_confirmations(upload_id,organisation_id,profile_id,profile_version_id,source_sha256,confirmed_by)
          VALUES(${uploadId},${organisationId},${state.profile.id},${state.current.id},${state.sha256},${userId})`;
        await tx.auditLog.create({ data: { organisation_id: organisationId, user_id: userId, action: "DATA_HUB_MAPPING_USE_CONFIRMED",
          resource_type: "upload", resource_id: uploadId, after_state: { versionId: state.current.id } } });
      }
    }
    return snapshot(await context(tx, scope, false));
  }, { timeout: 15000 });
}

/** Before reading source bytes. The SQL INSERT trigger independently checks atomically. */
export async function hasMappingUseConfirmation(input: { organisationId: string; uploadId: string; sourceSchemaVersionId: string;
  worksheetId: string; profileId: string; versionId: string; sha256: string; columns: RunsGovernedColumn[]; profileDocument: unknown }): Promise<boolean> {
  if (input.sourceSchemaVersionId !== GOVERNED_SOURCE_SCHEMA_VERSION_ID) return true;
  if (!await prisma.sourceSchemaVersion.findFirst({ where: { id: input.sourceSchemaVersionId, organisation_id: input.organisationId, status: "ACTIVE" }, select: { id: true } })) return false;
  const worksheet = await prisma.sourceSchemaWorksheet.findFirst({ where: { id: input.worksheetId, organisation_id: input.organisationId }, select: { logical_key: true } });
  if (!worksheet) return false;
  if (worksheet.logical_key !== "runs") return true;
  if (await prisma.worksheetMappingProfile.count({ where: { organisation_id: input.organisationId, source_schema_worksheet_id: input.worksheetId, active: true } }) !== 1) return false;
  const rows = await prisma.$queryRaw<{ review_document: unknown; review_digest: string }[]>`SELECT a.review_document,a.review_digest
    FROM data_hub_mapping_use_confirmations c JOIN data_hub_mapping_approvals a ON a.profile_version_id=c.profile_version_id
      AND a.profile_id=c.profile_id AND a.organisation_id=c.organisation_id
    WHERE c.organisation_id=${input.organisationId} AND c.upload_id=${input.uploadId} AND c.profile_id=${input.profileId}
      AND c.profile_version_id=${input.versionId} AND c.source_sha256=${input.sha256}`;
  if (rows.length !== 1) return false;
  const compiled = buildRunsProfile(rows[0].review_document, input.columns), parsed = parseProfileDocument(input.profileDocument);
  return compiled.ok && parsed.ok && hash(compiled.review) === rows[0].review_digest && hash(compiled.document) === hash(parsed.document);
}
