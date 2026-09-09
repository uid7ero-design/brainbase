// Data Hub 5B.2 — SourceMapping administrative service.
//
// AUTH BOUNDARY: see sourceSystems.ts / types.ts. organisationId is
// always a function parameter derived from the caller's trusted session,
// never accepted from an input object.

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  fail,
  isUniqueViolationOn,
  type ActiveFilter,
  type ListPageInput,
  type ListPageResult,
  type SourceMappingDTO,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  NAME_MAX_LENGTH,
} from "./types";

const SOURCE_MAPPING_SELECT = {
  id: true,
  source_system_id: true,
  name: true,
  active: true,
  active_mapping_version_id: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.SourceMappingSelect;

type SourceMappingRow = Prisma.SourceMappingGetPayload<{ select: typeof SOURCE_MAPPING_SELECT }>;

function toDTO(row: SourceMappingRow): SourceMappingDTO {
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

function validateName(input: { name?: unknown }): { ok: true; name: string } | { ok: false } {
  if (typeof input.name !== "string") return { ok: false };
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, name };
}

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

export type CreateSourceMappingResult =
  | { ok: true; sourceMapping: SourceMappingDTO }
  | ReturnType<typeof fail<"VALIDATION_ERROR" | "SOURCE_SYSTEM_NOT_FOUND" | "SOURCE_SYSTEM_INACTIVE" | "DUPLICATE_NAME">>;

/**
 * Creates a SourceMapping under an explicitly tenant-verified
 * SourceSystem. `active=true`, `active_mapping_version_id=null` — no
 * MappingVersion is ever auto-created here.
 *
 * SOURCE_SYSTEM_INACTIVE is a deliberate conservative default (5B.2
 * discovery): an inactive source should not acquire new active
 * configuration. Existing SourceMappings under it remain fully readable
 * and manageable; only NEW mapping creation is blocked.
 */
export async function createSourceMapping(
  actor: { organisationId: string; userId: string },
  input: { sourceSystemId?: unknown; name?: unknown }
): Promise<CreateSourceMappingResult> {
  const validatedName = validateName(input);
  if (!validatedName.ok || typeof input.sourceSystemId !== "string" || input.sourceSystemId.length === 0) {
    return fail("VALIDATION_ERROR");
  }
  const sourceSystemId = input.sourceSystemId;

  const parent = await prisma.sourceSystem.findUnique({
    where: { id_organisation_id: { id: sourceSystemId, organisation_id: actor.organisationId } },
    select: { id: true, active: true },
  });
  if (!parent) return fail("SOURCE_SYSTEM_NOT_FOUND");
  if (!parent.active) return fail("SOURCE_SYSTEM_INACTIVE");

  try {
    const row = await prisma.sourceMapping.create({
      data: {
        organisation_id: actor.organisationId,
        source_system_id: sourceSystemId,
        name: validatedName.name,
        created_by: actor.userId,
      },
      select: SOURCE_MAPPING_SELECT,
    });
    return { ok: true, sourceMapping: toDTO(row) };
  } catch (err) {
    if (isUniqueViolationOn(err, ["source_system_id", "name"])) {
      return fail("DUPLICATE_NAME");
    }
    throw err;
  }
}

export type ListSourceMappingsResult =
  | ({ ok: true } & ListPageResult<SourceMappingDTO>)
  | ReturnType<typeof fail<"INVALID_CURSOR" | "INVALID_LIMIT">>;

export async function listSourceMappings(
  organisationId: string,
  input: ListPageInput & { active?: ActiveFilter; sourceSystemId?: string }
): Promise<ListSourceMappingsResult> {
  const limit = validateLimit(input.limit);
  if (limit === null) return fail("INVALID_LIMIT");

  let cursorTuple: CursorTuple | null = null;
  if (input.cursor !== undefined) {
    cursorTuple = decodeCursor(input.cursor);
    if (!cursorTuple) return fail("INVALID_CURSOR");
  }

  const activeFilter = input.active ?? "true";

  const cursorFragment = cursorTuple
    ? Prisma.sql`AND (
        date_trunc('milliseconds', created_at) < ${cursorTuple.createdAt}
        OR (date_trunc('milliseconds', created_at) = ${cursorTuple.createdAt} AND id < ${cursorTuple.id})
      )`
    : Prisma.empty;

  const activeFragment =
    activeFilter === "all" ? Prisma.empty : Prisma.sql`AND active = ${activeFilter === "true"}`;

  // source_system_id is always additionally constrained by
  // organisation_id above — a foreign-tenant sourceSystemId simply
  // matches zero rows, never leaking whether it exists elsewhere.
  const sourceSystemFragment = input.sourceSystemId
    ? Prisma.sql`AND source_system_id = ${input.sourceSystemId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    {
      id: string;
      source_system_id: string;
      name: string;
      active: boolean;
      active_mapping_version_id: string | null;
      created_by: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >(Prisma.sql`
    SELECT id, source_system_id, name, active, active_mapping_version_id, created_by,
      date_trunc('milliseconds', created_at) AS created_at, updated_at
    FROM source_mappings
    WHERE organisation_id = ${organisationId}
      ${activeFragment}
      ${sourceSystemFragment}
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

export type GetSourceMappingResult = { ok: true; sourceMapping: SourceMappingDTO } | ReturnType<typeof fail<"SOURCE_MAPPING_NOT_FOUND">>;

export async function getSourceMapping(organisationId: string, id: string): Promise<GetSourceMappingResult> {
  const row = await prisma.sourceMapping.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_MAPPING_SELECT,
  });
  if (!row) return fail("SOURCE_MAPPING_NOT_FOUND");
  return { ok: true, sourceMapping: toDTO(row) };
}

export type UpdateSourceMappingResult =
  | { ok: true; sourceMapping: SourceMappingDTO }
  | ReturnType<typeof fail<"SOURCE_MAPPING_NOT_FOUND" | "VALIDATION_ERROR" | "DUPLICATE_NAME">>;

/**
 * Updates ONLY name. Never switches active_mapping_version_id — that is
 * exclusively mappingVersions.ts's activateMappingVersion(), a dedicated
 * operation, never reachable through this generic update.
 */
export async function updateSourceMapping(
  organisationId: string,
  id: string,
  input: { name?: unknown }
): Promise<UpdateSourceMappingResult> {
  const validated = validateName(input);
  if (!validated.ok) return fail("VALIDATION_ERROR");

  try {
    const result = await prisma.sourceMapping.updateMany({
      where: { id, organisation_id: organisationId },
      data: { name: validated.name },
    });
    if (result.count === 0) return fail("SOURCE_MAPPING_NOT_FOUND");
  } catch (err) {
    if (isUniqueViolationOn(err, ["source_system_id", "name"])) {
      return fail("DUPLICATE_NAME");
    }
    throw err;
  }

  const row = await prisma.sourceMapping.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_MAPPING_SELECT,
  });
  if (!row) return fail("SOURCE_MAPPING_NOT_FOUND");
  return { ok: true, sourceMapping: toDTO(row) };
}

export type SetSourceMappingActiveResult =
  | { ok: true; sourceMapping: SourceMappingDTO }
  | ReturnType<typeof fail<"SOURCE_MAPPING_NOT_FOUND">>;

/**
 * Deactivate/reactivate. Never clears active_mapping_version_id —
 * history/pointer is preserved exactly as-is; only future version
 * creation/activation under this mapping is blocked while inactive
 * (enforced in mappingVersions.ts).
 */
export async function setSourceMappingActive(
  organisationId: string,
  id: string,
  active: boolean
): Promise<SetSourceMappingActiveResult> {
  const result = await prisma.sourceMapping.updateMany({
    where: { id, organisation_id: organisationId },
    data: { active },
  });
  if (result.count === 0) return fail("SOURCE_MAPPING_NOT_FOUND");

  const row = await prisma.sourceMapping.findUnique({
    where: { id_organisation_id: { id, organisation_id: organisationId } },
    select: SOURCE_MAPPING_SELECT,
  });
  if (!row) return fail("SOURCE_MAPPING_NOT_FOUND");
  return { ok: true, sourceMapping: toDTO(row) };
}
