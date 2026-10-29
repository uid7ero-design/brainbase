import 'server-only';
import sql from '@/lib/db';
import type { IntegrationPrincipal } from '@/lib/integrationCredentials/service';

// Essio integration B1 — idempotency/identity foundation for external work.
// Design: docs/integrations/essio.md. B2's create-work route claims identity
// and creates the item in one statement (lib/essioIntegration/createWork.ts);
// this module is the reusable service-level claim/lookup over the same table.
//
// Every link records two fingerprints, never overloaded:
//   * handoffFingerprint — identity/provenance of the frozen external payload;
//   * requestFingerprint — identity of the complete Brainbase creation
//     instruction (target + payload). Replay vs conflict is decided on THIS
//     one, so a key can never be reused to redirect the same payload to a
//     different board or group.
// The original creation target is stored explicitly (targetBoardId /
// targetGroupId): the item's current board/group may later be changed by
// Brainbase users and is never proof of the original intent.
//
// The organisation and source system always come from the authenticated
// principal, never from request input.

export const EXTERNAL_LINK_SOURCE_SYSTEMS = ['essio'] as const;
export type ExternalLinkSourceSystem = (typeof EXTERNAL_LINK_SOURCE_SYSTEMS)[number];

const MAX_KEY_LENGTH = 128;
const MAX_URL_LENGTH = 2048;
const MAX_SNAPSHOT_BYTES = 262_144;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExternalLinkItemState =
  /** Linked to an existing Organiser item. */
  | 'linked'
  /** Identity claimed; no item attached yet (e.g. a crash between steps). */
  | 'unattached'
  /** The Organiser item was deleted; the identity remains. */
  | 'item_deleted';

export interface OrganiserItemExternalLink {
  id: string;
  organisationId: string;
  organiserItemId: string | null;
  sourceSystem: ExternalLinkSourceSystem;
  idempotencyKey: string;
  externalRecommendationId: string;
  sourceUrl: string | null;
  handoffFingerprint: string;
  requestFingerprint: string;
  targetBoardId: string;
  targetGroupId: string | null;
  credentialId: string;
  createdAt: string;
  itemDeletedAt: string | null;
  itemState: ExternalLinkItemState;
}

export type ExternalLinkClaimResult =
  | { outcome: 'created'; link: OrganiserItemExternalLink }
  /** Same key, same request fingerprint: a retry of the same request. */
  | { outcome: 'replayed'; link: OrganiserItemExternalLink }
  /** Same key, different request (payload and/or target): must not be applied. */
  | { outcome: 'fingerprint_conflict'; link: OrganiserItemExternalLink };

export type ExternalLinkErrorCode =
  | 'invalid_principal'
  | 'invalid_idempotency_key'
  | 'invalid_external_recommendation_id'
  | 'invalid_source_url'
  | 'invalid_handoff_fingerprint'
  | 'invalid_request_fingerprint'
  | 'invalid_snapshot'
  | 'invalid_target'
  | 'invalid_organiser_item';

export class ExternalLinkError extends Error {
  readonly code: ExternalLinkErrorCode;
  constructor(code: ExternalLinkErrorCode) {
    super(`External link request rejected (${code})`);
    this.name = 'ExternalLinkError';
    this.code = code;
  }
}

export class ExternalLinkDatabaseError extends Error {
  constructor() {
    super('External link storage is unavailable');
    this.name = 'ExternalLinkDatabaseError';
  }
}

interface LinkRow {
  id: string;
  organisation_id: string;
  organiser_item_id: string | null;
  source_system: string;
  idempotency_key: string;
  external_recommendation_id: string;
  source_url: string | null;
  handoff_fingerprint: string;
  request_fingerprint: string;
  target_board_id: string;
  target_group_id: string | null;
  credential_id: string;
  created_at: unknown;
  item_deleted_at: unknown;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toLink(row: LinkRow): OrganiserItemExternalLink {
  const itemDeletedAt = iso(row.item_deleted_at);
  return {
    id: row.id,
    organisationId: row.organisation_id,
    organiserItemId: row.organiser_item_id,
    sourceSystem: row.source_system as ExternalLinkSourceSystem,
    idempotencyKey: row.idempotency_key,
    externalRecommendationId: row.external_recommendation_id,
    sourceUrl: row.source_url,
    handoffFingerprint: row.handoff_fingerprint,
    requestFingerprint: row.request_fingerprint,
    targetBoardId: row.target_board_id,
    targetGroupId: row.target_group_id,
    credentialId: row.credential_id,
    createdAt: iso(row.created_at)!,
    itemDeletedAt,
    itemState: row.organiser_item_id ? 'linked' : itemDeletedAt ? 'item_deleted' : 'unattached',
  };
}

function boundedText(value: unknown, code: ExternalLinkErrorCode): string {
  if (typeof value !== 'string') throw new ExternalLinkError(code);
  if (value !== value.trim() || value.length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new ExternalLinkError(code);
  }
  return value;
}

function principalSource(principal: IntegrationPrincipal): ExternalLinkSourceSystem {
  if (
    principal?.kind !== 'integration' ||
    typeof principal.organisationId !== 'string' ||
    !(EXTERNAL_LINK_SOURCE_SYSTEMS as readonly string[]).includes(principal.integrationKey)
  ) {
    throw new ExternalLinkError('invalid_principal');
  }
  return principal.integrationKey as ExternalLinkSourceSystem;
}

function postgresErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  // Neon surfaces the SQLSTATE as `code`; Prisma-wrapped raw-query errors
  // (used by the integration test seam) carry it as `meta.code`.
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  if (e.meta && typeof e.meta.code === 'string') return e.meta.code;
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return null;
}

/**
 * Insert-first claim of an external request identity, scoped to the
 * principal's organisation and integration. Never creates Organiser work.
 */
export async function claimOrganiserItemExternalLink(
  principal: IntegrationPrincipal,
  input: {
    idempotencyKey: string;
    externalRecommendationId: string;
    sourceUrl: string | null;
    handoffFingerprint: string;
    requestFingerprint: string;
    handoffSnapshot: Record<string, unknown>;
    target: { boardId: string; groupId: string | null };
    /** Optional: attach an existing same-organisation item at claim time. */
    organiserItemId?: string | null;
  },
): Promise<ExternalLinkClaimResult> {
  const sourceSystem = principalSource(principal);
  const idempotencyKey = boundedText(input.idempotencyKey, 'invalid_idempotency_key');
  const externalRecommendationId = boundedText(
    input.externalRecommendationId,
    'invalid_external_recommendation_id',
  );
  const sourceUrl = input.sourceUrl ?? null;
  if (
    sourceUrl !== null &&
    (typeof sourceUrl !== 'string' || sourceUrl.length > MAX_URL_LENGTH || !/^https?:\/\/\S+$/i.test(sourceUrl))
  ) {
    throw new ExternalLinkError('invalid_source_url');
  }
  if (typeof input.handoffFingerprint !== 'string' || !FINGERPRINT_RE.test(input.handoffFingerprint)) {
    throw new ExternalLinkError('invalid_handoff_fingerprint');
  }
  if (typeof input.requestFingerprint !== 'string' || !FINGERPRINT_RE.test(input.requestFingerprint)) {
    throw new ExternalLinkError('invalid_request_fingerprint');
  }
  if (!input.handoffSnapshot || typeof input.handoffSnapshot !== 'object' || Array.isArray(input.handoffSnapshot)) {
    throw new ExternalLinkError('invalid_snapshot');
  }
  const snapshotJson = JSON.stringify(input.handoffSnapshot);
  if (Buffer.byteLength(snapshotJson, 'utf8') > MAX_SNAPSHOT_BYTES) throw new ExternalLinkError('invalid_snapshot');
  const target = input.target;
  if (
    !target ||
    typeof target.boardId !== 'string' ||
    !UUID_RE.test(target.boardId) ||
    (target.groupId !== null && (typeof target.groupId !== 'string' || !UUID_RE.test(target.groupId)))
  ) {
    throw new ExternalLinkError('invalid_target');
  }
  const organiserItemId = input.organiserItemId ?? null;
  if (organiserItemId !== null && (typeof organiserItemId !== 'string' || !UUID_RE.test(organiserItemId))) {
    throw new ExternalLinkError('invalid_organiser_item');
  }

  let inserted: LinkRow[];
  try {
    inserted = (await sql`
      INSERT INTO organiser_item_external_links (
        organisation_id, organiser_item_id, source_system, idempotency_key, external_recommendation_id,
        source_url, handoff_fingerprint, request_fingerprint, handoff_snapshot,
        target_board_id, target_group_id, credential_id
      ) VALUES (
        ${principal.organisationId}::text, ${organiserItemId}::uuid, ${sourceSystem}::text,
        ${idempotencyKey}::text, ${externalRecommendationId}::text, ${sourceUrl}::text,
        ${input.handoffFingerprint}::text, ${input.requestFingerprint}::text, ${snapshotJson}::jsonb,
        ${target.boardId}::uuid, ${target.groupId}::uuid, ${principal.credentialId}::uuid
      )
      ON CONFLICT ON CONSTRAINT organiser_item_external_links_idempotency_key DO NOTHING
      RETURNING id::text AS id, organisation_id, organiser_item_id::text AS organiser_item_id,
                source_system, idempotency_key, external_recommendation_id, source_url,
                handoff_fingerprint, request_fingerprint, target_board_id::text AS target_board_id,
                target_group_id::text AS target_group_id, credential_id::text AS credential_id,
                created_at, item_deleted_at
    `) as LinkRow[];
  } catch (err) {
    // 23503: the item (or credential) does not exist in this organisation.
    // 23505 on the item index: the item already belongs to another request.
    const code = postgresErrorCode(err);
    if (organiserItemId !== null && (code === '23503' || code === '23505')) {
      throw new ExternalLinkError('invalid_organiser_item');
    }
    throw new ExternalLinkDatabaseError();
  }
  if (inserted[0]) return { outcome: 'created', link: toLink(inserted[0]) };

  const existing = await findOrganiserItemExternalLink(principal, idempotencyKey);
  if (!existing) throw new ExternalLinkDatabaseError(); // conflicting row vanished: cannot happen (rows are never deleted)
  return existing.requestFingerprint === input.requestFingerprint
    ? { outcome: 'replayed', link: existing }
    : { outcome: 'fingerprint_conflict', link: existing };
}

/** Looks up a request identity within the principal's organisation and source. */
export async function findOrganiserItemExternalLink(
  principal: IntegrationPrincipal,
  idempotencyKey: string,
): Promise<OrganiserItemExternalLink | null> {
  const sourceSystem = principalSource(principal);
  const key = boundedText(idempotencyKey, 'invalid_idempotency_key');
  try {
    const [row] = (await sql`
      SELECT id::text AS id, organisation_id, organiser_item_id::text AS organiser_item_id,
             source_system, idempotency_key, external_recommendation_id, source_url,
             handoff_fingerprint, request_fingerprint, target_board_id::text AS target_board_id,
             target_group_id::text AS target_group_id, credential_id::text AS credential_id,
             created_at, item_deleted_at
      FROM organiser_item_external_links
      WHERE organisation_id = ${principal.organisationId}::text
        AND source_system = ${sourceSystem}::text
        AND idempotency_key = ${key}::text
    `) as LinkRow[];
    return row ? toLink(row) : null;
  } catch {
    throw new ExternalLinkDatabaseError();
  }
}
