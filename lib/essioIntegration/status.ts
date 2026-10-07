import 'server-only';
import sql from '@/lib/db';
import type { IntegrationPrincipal } from '@/lib/integrationCredentials/service';

// Essio integration B3 — read the status of Essio-created Organiser work.
// Design: docs/integrations/essio.md.
//
// Addressed by the Essio idempotency key (the Essio handoff id): Essio holds it
// from before delivery, it never changes, and it survives deletion of the
// Organiser item (whose id the external link then no longer carries). The
// lookup is always constrained to the credential's organisation and
// source_system = 'essio', so only items Essio itself created are visible;
// anything else is indistinguishable from an unknown key.
//
// Read only. Returns the minimum Essio needs: item id, raw status + normalised
// category, updated_at and the current board-level URL. Never notes, owner,
// assignee, priority, due date, comments, snapshot or credential data.

export const ESSIO_STATUS_CATEGORIES = ['not_started', 'in_progress', 'blocked', 'done', 'other'] as const;
export type EssioStatusCategory = (typeof ESSIO_STATUS_CATEGORIES)[number];

const KNOWN_STATUSES: Readonly<Record<string, EssioStatusCategory>> = Object.freeze({
  'not started': 'not_started',
  'working on it': 'in_progress',
  stuck: 'blocked',
  done: 'done',
});

/**
 * Maps a free-text Organiser status to a category for Essio. Deterministic:
 * the four statuses the Organiser app uses (case and surrounding whitespace
 * ignored); anything else, including custom text, is 'other'. The raw value
 * is always returned unchanged alongside.
 */
export function normaliseOrganiserStatus(raw: string): EssioStatusCategory {
  return KNOWN_STATUSES[raw.trim().toLowerCase()] ?? 'other';
}

export type ReadEssioWorkResult =
  | {
      state: 'linked';
      idempotencyKey: string;
      workItem: { id: string; boardId: string; status: string; updatedAt: string | null };
    }
  | { state: 'item_deleted'; idempotencyKey: string; deletedAt: string }
  /** No Essio work exists for this key in the credential's organisation. */
  | { state: 'not_found' };

export class EssioStatusDatabaseError extends Error {
  constructor() {
    super('Essio status read is unavailable');
    this.name = 'EssioStatusDatabaseError';
  }
}

interface Row {
  organiser_item_id: string | null;
  item_deleted_at: unknown;
  item_id: string | null;
  board_id: string | null;
  status: string | null;
  updated_at: unknown;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export async function readEssioWork(principal: IntegrationPrincipal, idempotencyKey: string): Promise<ReadEssioWorkResult> {
  if (principal.kind !== 'integration' || principal.integrationKey !== 'essio') {
    throw new Error('readEssioWork requires an Essio integration principal');
  }
  let row: Row | undefined;
  try {
    [row] = (await sql`
      SELECT l.organiser_item_id::text AS organiser_item_id, l.item_deleted_at,
             i.id::text AS item_id, i.board_id::text AS board_id, i.status, i.updated_at
      FROM organiser_item_external_links l
      LEFT JOIN organiser_items i ON i.id = l.organiser_item_id AND i.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${principal.organisationId}::text
        AND l.source_system = 'essio'
        AND l.idempotency_key = ${idempotencyKey}::text
    `) as Row[];
  } catch {
    throw new EssioStatusDatabaseError();
  }
  if (!row) return { state: 'not_found' };
  if (row.item_id && row.board_id && row.status !== null) {
    return {
      state: 'linked',
      idempotencyKey,
      workItem: { id: row.item_id, boardId: row.board_id, status: row.status, updatedAt: iso(row.updated_at) },
    };
  }
  const deletedAt = iso(row.item_deleted_at);
  if (deletedAt) return { state: 'item_deleted', idempotencyKey, deletedAt };
  // An identity without an item that was never deleted is not created by the
  // B2 API (it writes link and item atomically); there is no work to report.
  return { state: 'not_found' };
}
