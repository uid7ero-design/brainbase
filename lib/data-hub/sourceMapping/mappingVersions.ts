// Data Hub 5B.2 — MappingVersion immutable creation, read, and
// active-version-switch service.
//
// AUTH BOUNDARY: see sourceSystems.ts / types.ts.

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { validateMappingDocument, type MappingDocument } from "./mappingDocument";
import {
  fail,
  isUniqueViolationOn,
  type ListPageInput,
  type ListPageResult,
  type MappingVersionDTO,
  type SourceMappingDTO,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from "./types";

function toSourceMappingDTO(row: {
  id: string;
  source_system_id: string;
  name: string;
  active: boolean;
  active_mapping_version_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}): SourceMappingDTO {
  return {
    id: row.id,
    sourceSystemId: row.source_system_id,
    name: row.name,
    active: row.active,
    activeMappingVersionId: row.active_mapping_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const MAPPING_VERSION_SELECT = {
  id: true,
  source_mapping_id: true,
  version_number: true,
  mapping_document: true,
  created_by: true,
  created_at: true,
} satisfies Prisma.MappingVersionSelect;

type MappingVersionRow = Prisma.MappingVersionGetPayload<{ select: typeof MAPPING_VERSION_SELECT }>;

function toDTO(row: MappingVersionRow): MappingVersionDTO {
  return {
    id: row.id,
    sourceMappingId: row.source_mapping_id,
    versionNumber: row.version_number,
    // mapping_document is JSONB, already validated at write time by this
    // same module — trusted to already be a MappingDocument shape here,
    // never re-validated on read.
    mappingDocument: row.mapping_document as unknown as MappingDocument,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

function validateLimit(limit: number | undefined): number | null {
  const value = limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) return null;
  return value;
}

const MAX_VERSION_ALLOCATION_ATTEMPTS = 8;

// ---------------------------------------------------------------------------
// createMappingVersion
// ---------------------------------------------------------------------------

export type CreateMappingVersionResult =
  | { ok: true; mappingVersion: MappingVersionDTO }
  | ReturnType<
      typeof fail<
        | "VALIDATION_ERROR"
        | "SOURCE_MAPPING_NOT_FOUND"
        | "SOURCE_MAPPING_INACTIVE"
        | "SOURCE_SYSTEM_INACTIVE"
        | "VERSION_ALLOCATION_CONFLICT"
      >
    >;

/**
 * Creates a new immutable MappingVersion. Version creation and active-
 * version switching are deliberately SEPARATE operations (5B.2 design
 * decision): a newly-created version is never auto-activated. This keeps
 * version history a pure append-only audit trail, and lets a future
 * review step exist before a version affects anything.
 *
 * CONCURRENCY: version_number is allocated by reading the current MAX for
 * this source_mapping_id and attempting an insert with MAX+1, retrying on
 * a genuine P2002 collision against the
 * (source_mapping_id, version_number) unique constraint (never on a
 * blind, unprotected read-then-write) — the real DB constraint remains
 * the final authority; this loop only makes concurrent callers converge
 * on distinct sequential numbers instead of one of them failing outright.
 * Proven under real concurrent load against a real Postgres instance —
 * see scripts/tests/datahubSourceMappingServices.integration.test.ts
 * (run via scripts/tests/verify-datahub-source-mapping-services.sh).
 */
export async function createMappingVersion(
  actor: { organisationId: string; userId: string },
  input: { sourceMappingId?: unknown; mappingDocument?: unknown }
): Promise<CreateMappingVersionResult> {
  if (typeof input.sourceMappingId !== "string" || input.sourceMappingId.length === 0) {
    return fail("VALIDATION_ERROR");
  }
  const sourceMappingId = input.sourceMappingId;

  const docResult = validateMappingDocument(input.mappingDocument);
  if (!docResult.ok) return fail("VALIDATION_ERROR");

  const mapping = await prisma.sourceMapping.findUnique({
    where: { id_organisation_id: { id: sourceMappingId, organisation_id: actor.organisationId } },
    select: { id: true, active: true, source_system_id: true },
  });
  if (!mapping) return fail("SOURCE_MAPPING_NOT_FOUND");
  if (!mapping.active) return fail("SOURCE_MAPPING_INACTIVE");

  const system = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id: mapping.source_system_id, organisation_id: actor.organisationId } },
    select: { active: true },
  });
  if (!system || !system.active) return fail("SOURCE_SYSTEM_INACTIVE");

  for (let attempt = 0; attempt < MAX_VERSION_ALLOCATION_ATTEMPTS; attempt++) {
    const agg = await prisma.mappingVersion.aggregate({
      where: { source_mapping_id: sourceMappingId, organisation_id: actor.organisationId },
      _max: { version_number: true },
    });
    const nextVersion = (agg._max.version_number ?? 0) + 1;

    try {
      const row = await prisma.mappingVersion.create({
        data: {
          organisation_id: actor.organisationId,
          source_mapping_id: sourceMappingId,
          version_number: nextVersion,
          mapping_document: docResult.document as unknown as Prisma.InputJsonValue,
          created_by: actor.userId,
        },
        select: MAPPING_VERSION_SELECT,
      });
      return { ok: true, mappingVersion: toDTO(row) };
    } catch (err) {
      if (isUniqueViolationOn(err, ["source_mapping_id", "version_number"])) {
        continue; // another concurrent creation took this number — retry with a fresh MAX
      }
      throw err;
    }
  }
  return fail("VERSION_ALLOCATION_CONFLICT");
}

// ---------------------------------------------------------------------------
// listMappingVersions / getMappingVersion
// ---------------------------------------------------------------------------

interface CursorTuple {
  versionNumber: number;
  id: string;
}

function encodeCursor(tuple: CursorTuple): string {
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorTuple | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("versionNumber") || !keys.includes("id")) return null;
  const { versionNumber, id } = parsed as { versionNumber: unknown; id: unknown };
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof versionNumber !== "number" || !Number.isInteger(versionNumber)) return null;
  return { versionNumber, id };
}

export type ListMappingVersionsResult =
  | ({ ok: true } & ListPageResult<MappingVersionDTO>)
  | ReturnType<typeof fail<"SOURCE_MAPPING_NOT_FOUND" | "INVALID_CURSOR" | "INVALID_LIMIT">>;

/** Tenant-scoped, newest-version-first, bounded/keyset-paginated. */
export async function listMappingVersions(
  organisationId: string,
  sourceMappingId: string,
  input: ListPageInput
): Promise<ListMappingVersionsResult> {
  const mapping = await prisma.sourceMapping.findUnique({
    where: { id_organisation_id: { id: sourceMappingId, organisation_id: organisationId } },
    select: { id: true },
  });
  if (!mapping) return fail("SOURCE_MAPPING_NOT_FOUND");

  const limit = validateLimit(input.limit);
  if (limit === null) return fail("INVALID_LIMIT");

  let cursorTuple: CursorTuple | null = null;
  if (input.cursor !== undefined) {
    cursorTuple = decodeCursor(input.cursor);
    if (!cursorTuple) return fail("INVALID_CURSOR");
  }

  const rows = await prisma.mappingVersion.findMany({
    where: {
      source_mapping_id: sourceMappingId,
      organisation_id: organisationId,
      ...(cursorTuple ? { version_number: { lt: cursorTuple.versionNumber } } : {}),
    },
    select: MAPPING_VERSION_SELECT,
    orderBy: [{ version_number: "desc" }],
    take: limit + 1,
  });

  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasNextPage && last ? encodeCursor({ versionNumber: last.version_number, id: last.id }) : null;

  return { ok: true, items: page.map(toDTO), hasNextPage, nextCursor };
}

export type GetMappingVersionResult = { ok: true; mappingVersion: MappingVersionDTO } | ReturnType<typeof fail<"MAPPING_VERSION_NOT_FOUND">>;

export async function getMappingVersion(organisationId: string, id: string): Promise<GetMappingVersionResult> {
  const row = await prisma.mappingVersion.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: MAPPING_VERSION_SELECT,
  });
  if (!row) return fail("MAPPING_VERSION_NOT_FOUND");
  return { ok: true, mappingVersion: toDTO(row) };
}

// ---------------------------------------------------------------------------
// activateMappingVersion
// ---------------------------------------------------------------------------

export type ActivateMappingVersionResult =
  | { ok: true; sourceMapping: SourceMappingDTO }
  | ReturnType<
      typeof fail<
        | "SOURCE_MAPPING_NOT_FOUND"
        | "SOURCE_MAPPING_INACTIVE"
        | "SOURCE_SYSTEM_INACTIVE"
        | "MAPPING_VERSION_NOT_FOUND"
        | "VERSION_MISMATCH"
      >
    >;

/**
 * Switches SourceMapping.active_mapping_version_id to an EXISTING version
 * that already belongs to this exact SourceMapping and tenant. Never
 * mutates the MappingVersion row itself. Idempotent: re-activating the
 * already-active version succeeds as a no-op write of the same value.
 *
 * All three checks (mapping active, parent system active, version
 * belongs to this mapping) plus the write happen inside one interactive
 * transaction, so a concurrent deactivation cannot race between the
 * checks and the write. The DB's own composite FK
 * (active_mapping_version_id, id, organisation_id) ->
 * (id, source_mapping_id, organisation_id) remains defense-in-depth
 * underneath this — it is not relied upon as the only tenant/mapping
 * check.
 */
export async function activateMappingVersion(
  organisationId: string,
  sourceMappingId: string,
  mappingVersionId: string
): Promise<ActivateMappingVersionResult> {
  return prisma.$transaction(async (tx) => {
    const mapping = await tx.sourceMapping.findUnique({
      where: { id_organisation_id: { id: sourceMappingId, organisation_id: organisationId } },
      select: { id: true, active: true, source_system_id: true },
    });
    if (!mapping) return fail("SOURCE_MAPPING_NOT_FOUND");
    if (!mapping.active) return fail("SOURCE_MAPPING_INACTIVE");

    const system = await tx.sourceSystem.findUnique({
      where: { id_organisation_id: { id: mapping.source_system_id, organisation_id: organisationId } },
      select: { active: true },
    });
    if (!system || !system.active) return fail("SOURCE_SYSTEM_INACTIVE");

    const version = await tx.mappingVersion.findUnique({
      where: { id_organisation_id: { id: mappingVersionId, organisation_id: organisationId } },
      select: { id: true, source_mapping_id: true },
    });
    if (!version) return fail("MAPPING_VERSION_NOT_FOUND");
    if (version.source_mapping_id !== sourceMappingId) return fail("VERSION_MISMATCH");

    const updated = await tx.sourceMapping.update({
      where: { id_organisation_id: { id: sourceMappingId, organisation_id: organisationId } },
      data: { active_mapping_version_id: mappingVersionId },
      select: {
        id: true,
        source_system_id: true,
        name: true,
        active: true,
        active_mapping_version_id: true,
        created_by: true,
        created_at: true,
        updated_at: true,
      },
    });
    return { ok: true, sourceMapping: toSourceMappingDTO(updated) };
  });
}
