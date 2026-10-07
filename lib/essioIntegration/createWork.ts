import 'server-only';
import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import type { IntegrationPrincipal } from '@/lib/integrationCredentials/service';
import { essioSystemActor, systemActorActivityFields } from '@/lib/organiser/systemActor';
import {
  canonicalEssioCreateTarget,
  composeEssioWorkNotes,
  essioCreateRequestFingerprint,
  essioPayloadFingerprint,
  type EssioHandoffV1,
} from './handoffPayload';

// Essio integration B2 — create Organiser work from a frozen Essio handoff.
// Design: docs/integrations/essio.md.
//
// One SQL statement (writable CTEs, hence one transaction) does all of:
//   1. validate the target board/group against the credential organisation,
//   2. claim the idempotency key (organiser_item_external_links, ON CONFLICT
//      DO NOTHING on (organisation_id, source_system, idempotency_key)),
//   3. create exactly one organiser_items row (only if the claim succeeded),
//   4. write its item.created organiser_activity row as the Essio system actor.
// Any failure aborts the whole statement: no partial link, item or activity.
// A concurrent duplicate waits on the unique key, then claims nothing and is
// answered from the existing link (replay).
//
// Replay vs conflict is decided on the Brainbase create-request fingerprint
// (target + handoff), never on the handoff alone: the same key can never
// redirect the same handoff to a different board or group. The Essio handoff
// fingerprint is stored separately as provenance.
//
// Brainbase owns priority, assignee, due date and status: none is taken from
// Essio. The item starts with the Organiser default status.

export interface EssioWorkTarget {
  boardId: string;
  groupId: string | null;
}

export interface EssioWorkItemRef {
  id: string;
  boardId: string;
  status: string;
}

export type CreateEssioWorkResult =
  | { outcome: 'created'; idempotencyKey: string; acceptedAt: string; workItem: EssioWorkItemRef }
  | { outcome: 'replayed'; idempotencyKey: string; acceptedAt: string; workItem: EssioWorkItemRef }
  | { outcome: 'item_deleted'; idempotencyKey: string; acceptedAt: string; deletedAt: string }
  | { outcome: 'fingerprint_conflict'; idempotencyKey: string }
  /** A link exists without an item (not produced by this path); not resolvable here. */
  | { outcome: 'unattached'; idempotencyKey: string }
  | { outcome: 'target_not_found' }
  | { outcome: 'group_not_found' };

export class EssioWorkDatabaseError extends Error {
  constructor() {
    super('Essio work storage is unavailable');
    this.name = 'EssioWorkDatabaseError';
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

interface CreateRow {
  board_found: boolean;
  group_valid: boolean | null;
  link_id: string | null;
  accepted_at: unknown;
  item_id: string | null;
  item_board_id: string | null;
  item_status: string | null;
}

interface ExistingRow {
  request_fingerprint: string;
  organiser_item_id: string | null;
  item_deleted_at: unknown;
  created_at: unknown;
  item_board_id: string | null;
  item_status: string | null;
}

async function findExisting(organisationId: string, idempotencyKey: string): Promise<ExistingRow | null> {
  const [row] = (await sql`
    SELECT l.request_fingerprint, l.organiser_item_id::text AS organiser_item_id, l.item_deleted_at, l.created_at,
           i.board_id::text AS item_board_id, i.status AS item_status
    FROM organiser_item_external_links l
    LEFT JOIN organiser_items i ON i.id = l.organiser_item_id AND i.organisation_id = l.organisation_id
    WHERE l.organisation_id = ${organisationId}::text
      AND l.source_system = 'essio'
      AND l.idempotency_key = ${idempotencyKey}::text
  `) as ExistingRow[];
  return row ?? null;
}

function replayResult(existing: ExistingRow, idempotencyKey: string, requestFingerprint: string): CreateEssioWorkResult {
  // Any difference in the complete request (handoff or target) is a conflict,
  // including after the item was deleted.
  if (existing.request_fingerprint !== requestFingerprint) return { outcome: 'fingerprint_conflict', idempotencyKey };
  if (existing.organiser_item_id && existing.item_board_id && existing.item_status !== null) {
    return {
      outcome: 'replayed',
      idempotencyKey,
      acceptedAt: iso(existing.created_at),
      workItem: { id: existing.organiser_item_id, boardId: existing.item_board_id, status: existing.item_status },
    };
  }
  if (existing.item_deleted_at !== null && existing.item_deleted_at !== undefined) {
    return { outcome: 'item_deleted', idempotencyKey, acceptedAt: iso(existing.created_at), deletedAt: iso(existing.item_deleted_at) };
  }
  return { outcome: 'unattached', idempotencyKey };
}

/**
 * Creates (or replays) the Organiser item for a validated Essio handoff. The
 * organisation is the principal's; the payload must already have passed
 * validateEssioHandoffV1.
 */
export async function createEssioWork(
  principal: IntegrationPrincipal,
  payload: EssioHandoffV1,
  target: EssioWorkTarget,
): Promise<CreateEssioWorkResult> {
  if (principal.kind !== 'integration' || principal.integrationKey !== 'essio') {
    throw new Error('createEssioWork requires an Essio integration principal');
  }
  const organisationId = principal.organisationId;
  const idempotencyKey = payload.idempotency_key;
  const createTarget = canonicalEssioCreateTarget(target);
  const handoffFingerprint = essioPayloadFingerprint(payload);
  const requestFingerprint = essioCreateRequestFingerprint(createTarget, payload);
  const actor = systemActorActivityFields(essioSystemActor(principal));
  const metadata = JSON.stringify({
    ...actor.metadata,
    idempotency_key: idempotencyKey,
    external_recommendation_id: payload.recommendation.id,
    handoff_fingerprint: handoffFingerprint,
    request_fingerprint: requestFingerprint,
  });
  const itemId = randomUUID();
  const name = payload.content.title.trim();
  const notes = composeEssioWorkNotes(payload);

  let row: CreateRow | undefined;
  try {
    [row] = (await sql`
      WITH target AS (
        SELECT b.id AS board_id,
               (
                 ${createTarget.group_id}::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM organiser_groups g
                   WHERE g.id = ${createTarget.group_id}::uuid AND g.board_id = b.id AND g.organisation_id = ${organisationId}::text
                 )
               ) AS group_valid
        FROM organiser_boards b
        WHERE b.id = ${createTarget.board_id}::uuid AND b.organisation_id = ${organisationId}::text
      ),
      claim AS (
        INSERT INTO organiser_item_external_links (
          organisation_id, organiser_item_id, source_system, idempotency_key, external_recommendation_id,
          source_url, handoff_fingerprint, request_fingerprint, handoff_snapshot,
          target_board_id, target_group_id, credential_id
        )
        SELECT ${organisationId}::text, ${itemId}::uuid, 'essio', ${idempotencyKey}::text,
               ${payload.recommendation.id}::text, ${payload.source.deep_link}::text, ${handoffFingerprint}::text,
               ${requestFingerprint}::text, ${JSON.stringify(payload)}::jsonb,
               ${createTarget.board_id}::uuid, ${createTarget.group_id}::uuid, ${principal.credentialId}::uuid
        FROM target
        WHERE target.group_valid
        ON CONFLICT ON CONSTRAINT organiser_item_external_links_idempotency_key DO NOTHING
        RETURNING id, created_at
      ),
      item AS (
        INSERT INTO organiser_items (id, board_id, organisation_id, group_id, name, notes, position)
        SELECT ${itemId}::uuid, target.board_id, ${organisationId}::text, ${createTarget.group_id}::uuid,
               ${name}::text, ${notes}::text,
               (SELECT COALESCE(MAX(p.position), -1) + 1 FROM organiser_items p
                WHERE p.board_id = target.board_id AND p.parent_item_id IS NULL)
        FROM target, claim
        RETURNING id, board_id, group_id, parent_item_id, name, status
      ),
      activity AS (
        INSERT INTO organiser_activity (
          organisation_id, board_id, item_id, actor_user_id, actor_name,
          event_type, entity_type, entity_id, before_json, after_json, metadata_json
        )
        SELECT ${organisationId}::text, item.board_id, item.id, NULL, ${actor.actorName}::text,
               'item.created', 'item', item.id::text, NULL,
               jsonb_build_object(
                 'name', organiser_activity_sanitise_scalar(to_jsonb(item.name)),
                 'status', organiser_activity_sanitise_scalar(to_jsonb(item.status)),
                 'group_id', to_jsonb(item.group_id),
                 'parent_item_id', to_jsonb(item.parent_item_id)
               ),
               ${metadata}::jsonb
        FROM item
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM target) AS board_found,
             (SELECT group_valid FROM target) AS group_valid,
             claim.id::text AS link_id,
             claim.created_at AS accepted_at,
             item.id::text AS item_id,
             item.board_id::text AS item_board_id,
             item.status AS item_status
      FROM (SELECT 1) AS one
      LEFT JOIN claim ON true
      LEFT JOIN item ON true
    `) as CreateRow[];
  } catch {
    throw new EssioWorkDatabaseError();
  }
  if (!row) throw new EssioWorkDatabaseError();

  if (row.link_id && row.item_id && row.item_board_id && row.item_status !== null) {
    return {
      outcome: 'created',
      idempotencyKey,
      acceptedAt: iso(row.accepted_at),
      workItem: { id: row.item_id, boardId: row.item_board_id, status: row.item_status },
    };
  }

  // Nothing was claimed: either the key already exists (replay / conflict /
  // deleted — answered regardless of the target, which may since have been
  // deleted) or the target is invalid.
  let existing: ExistingRow | null;
  try {
    existing = await findExisting(organisationId, idempotencyKey);
  } catch {
    throw new EssioWorkDatabaseError();
  }
  if (existing) return replayResult(existing, idempotencyKey, requestFingerprint);
  if (!row.board_found) return { outcome: 'target_not_found' };
  if (!row.group_valid) return { outcome: 'group_not_found' };
  throw new EssioWorkDatabaseError(); // claimed nothing, yet no existing link: not expected
}
