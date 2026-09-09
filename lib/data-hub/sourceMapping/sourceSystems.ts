// Data Hub 5B.2 — SourceSystem administrative service.
//
// AUTH BOUNDARY: see types.ts header. Every function here takes an
// already-resolved organisationId and never accepts one from an input
// object — tenant scope is a function PARAMETER, never a request-body
// field, so there is no code path by which a caller-supplied
// organisationId could reach a query even by accident.

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  fail,
  isUniqueViolationOn,
  type ActiveFilter,
  type ListPageInput,
  type ListPageResult,
  type SourceSystemDTO,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "./types";

const SOURCE_SYSTEM_SELECT = {
  id: true,
  name: true,
  description: true,
  active: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.SourceSystemSelect;

type SourceSystemRow = Prisma.SourceSystemGetPayload<{ select: typeof SOURCE_SYSTEM_SELECT }>;

function toDTO(row: SourceSystemRow): SourceSystemDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Input validation — hand-rolled, matching this repo's established
// convention (no Zod dependency exists in package.json; not introduced
// here). Trims and bounds; rejects blank/oversized values.
// ---------------------------------------------------------------------------

interface ValidatedMetadata {
  name: string;
  description: string | null;
}

function validateNameAndDescription(input: {
  name?: unknown;
  description?: unknown;
}): { ok: true; value: ValidatedMetadata } | { ok: false } {
  if (typeof input.name !== "string") return { ok: false };
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return { ok: false };

  let description: string | null = null;
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") return { ok: false };
    const trimmed = input.description.trim();
    if (trimmed.length > DESCRIPTION_MAX_LENGTH) return { ok: false };
    description = trimmed.length === 0 ? null : trimmed;
  }

  return { ok: true, value: { name, description } };
}

// ---------------------------------------------------------------------------
// Keyset pagination — identical shape/idiom to
// lib/data-hub/importBatch/read.ts's listImportBatches (see that file's
// own PRECISION doc comment for why created_at is truncated to
// milliseconds on both sides of the cursor comparison).
// ---------------------------------------------------------------------------

interface CursorTuple {
  createdAt: Date;
  id: string;
}

function encodeCursor(tuple: CursorTuple): string {
  return Buffer.from(JSON.stringify({ createdAt: tuple.createdAt.toISOString(), id: tuple.id }), "utf8").toString(
    "base64url"
  );
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
  if (keys.length !== 2 || !keys.includes("createdAt") || !keys.includes("id")) return null;
  const { createdAt, id } = parsed as { createdAt: unknown; id: unknown };
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof createdAt !== "string") return null;
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return { createdAt: parsedDate, id };
}

function validateLimit(limit: number | undefined): number | null {
  const value = limit ?? DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

export type CreateSourceSystemResult =
  | { ok: true; sourceSystem: SourceSystemDTO }
  | ReturnType<typeof fail<"VALIDATION_ERROR" | "DUPLICATE_NAME">>;

export async function createSourceSystem(
  actor: { organisationId: string; userId: string },
  input: { name?: unknown; description?: unknown }
): Promise<CreateSourceSystemResult> {
  const validated = validateNameAndDescription(input);
  if (!validated.ok) return fail("VALIDATION_ERROR");

  try {
    const row = await prisma.sourceSystem.create({
      data: {
        organisation_id: actor.organisationId,
        name: validated.value.name,
        description: validated.value.description,
        created_by: actor.userId,
      },
      select: SOURCE_SYSTEM_SELECT,
    });
    return { ok: true, sourceSystem: toDTO(row) };
  } catch (err) {
    if (isUniqueViolationOn(err, ["organisation_id", "name"])) {
      return fail("DUPLICATE_NAME");
    }
    throw err;
  }
}

export type ListSourceSystemsResult =
  | ({ ok: true } & ListPageResult<SourceSystemDTO>)
  | ReturnType<typeof fail<"INVALID_CURSOR" | "INVALID_LIMIT">>;

export async function listSourceSystems(
  organisationId: string,
  input: ListPageInput & { active?: ActiveFilter }
): Promise<ListSourceSystemsResult> {
  const limit = validateLimit(input.limit);
  if (limit === null) return fail("INVALID_LIMIT");

  let cursorTuple: CursorTuple | null = null;
  if (input.cursor !== undefined) {
    cursorTuple = decodeCursor(input.cursor);
    if (!cursorTuple) return fail("INVALID_CURSOR");
  }

  // Default favors active records (the future import-time consumer only
  // ever wants usable sources) — callers must explicitly ask for
  // active=false or active=all to see anything else.
  const activeFilter = input.active ?? "true";

  const cursorFragment = cursorTuple
    ? Prisma.sql`AND (
        date_trunc('milliseconds', created_at) < ${cursorTuple.createdAt}
        OR (date_trunc('milliseconds', created_at) = ${cursorTuple.createdAt} AND id < ${cursorTuple.id})
      )`
    : Prisma.empty;

  const activeFragment =
    activeFilter === "all" ? Prisma.empty : Prisma.sql`AND active = ${activeFilter === "true"}`;

  const rows = await prisma.$queryRaw<
    { id: string; name: string; description: string | null; active: boolean; created_by: string | null; created_at: Date; updated_at: Date }[]
  >(Prisma.sql`
    SELECT id, name, description, active, created_by,
      date_trunc('milliseconds', created_at) AS created_at, updated_at
    FROM source_systems
    WHERE organisation_id = ${organisationId}
      ${activeFragment}
      ${cursorFragment}
    ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC
    LIMIT ${limit + 1}
  `);

  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasNextPage && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return { ok: true, items: page.map(toDTO), hasNextPage, nextCursor };
}

export type GetSourceSystemResult = { ok: true; sourceSystem: SourceSystemDTO } | ReturnType<typeof fail<"SOURCE_SYSTEM_NOT_FOUND">>;

export async function getSourceSystem(organisationId: string, id: string): Promise<GetSourceSystemResult> {
  const row = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_SYSTEM_SELECT,
  });
  if (!row) return fail("SOURCE_SYSTEM_NOT_FOUND");
  return { ok: true, sourceSystem: toDTO(row) };
}

export type UpdateSourceSystemResult =
  | { ok: true; sourceSystem: SourceSystemDTO }
  | ReturnType<typeof fail<"SOURCE_SYSTEM_NOT_FOUND" | "VALIDATION_ERROR" | "DUPLICATE_NAME">>;

/**
 * Updates ONLY name/description. id, organisation_id, created_by,
 * created_at are never accepted as input and therefore can never be
 * mutated through this function regardless of what a caller's request
 * body contains — see the route layer's own hand-constructed input for
 * the matching HTTP-boundary proof.
 */
export async function updateSourceSystem(
  organisationId: string,
  id: string,
  input: { name?: unknown; description?: unknown }
): Promise<UpdateSourceSystemResult> {
  const validated = validateNameAndDescription(input);
  if (!validated.ok) return fail("VALIDATION_ERROR");

  try {
    const result = await prisma.sourceSystem.updateMany({
      where: { id, organisation_id: organisationId },
      data: { name: validated.value.name, description: validated.value.description },
    });
    if (result.count === 0) return fail("SOURCE_SYSTEM_NOT_FOUND");
  } catch (err) {
    if (isUniqueViolationOn(err, ["organisation_id", "name"])) {
      return fail("DUPLICATE_NAME");
    }
    throw err;
  }

  const row = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_SYSTEM_SELECT,
  });
  // Cannot be null here (we just successfully updated it above, and this
  // service never runs concurrently with a delete — no delete capability
  // exists at all), but handled defensively rather than asserted.
  if (!row) return fail("SOURCE_SYSTEM_NOT_FOUND");
  return { ok: true, sourceSystem: toDTO(row) };
}

export type SetSourceSystemActiveResult =
  | { ok: true; sourceSystem: SourceSystemDTO }
  | ReturnType<typeof fail<"SOURCE_SYSTEM_NOT_FOUND">>;

/**
 * Deactivate/reactivate. Never cascades: SourceMapping.active,
 * SourceMapping.active_mapping_version_id, and every MappingVersion under
 * this system are left completely untouched — deactivating a
 * SourceSystem only blocks FUTURE SourceMapping creation under it
 * (enforced in sourceMappings.ts's createSourceMapping) and future
 * MappingVersion creation/activation (enforced in
 * mappingVersions.ts). All history remains readable.
 */
export async function setSourceSystemActive(
  organisationId: string,
  id: string,
  active: boolean
): Promise<SetSourceSystemActiveResult> {
  const result = await prisma.sourceSystem.updateMany({
    where: { id, organisation_id: organisationId },
    data: { active },
  });
  if (result.count === 0) return fail("SOURCE_SYSTEM_NOT_FOUND");

  const row = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_SYSTEM_SELECT,
  });
  if (!row) return fail("SOURCE_SYSTEM_NOT_FOUND");
  return { ok: true, sourceSystem: toDTO(row) };
}
