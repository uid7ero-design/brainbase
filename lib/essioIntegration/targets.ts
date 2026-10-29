import 'server-only';
import sql from '@/lib/db';
import type { IntegrationPrincipal } from '@/lib/integrationCredentials/service';

// Essio integration B2 — target discovery: the Organiser boards (and their
// groups) of the credential's organisation, so Essio can map a site to a
// board and optional group. Ids and display names only — no items, users,
// colours, positions or other organisation data. Deterministic order: the
// Organiser's own position, then name, then id.

export interface EssioTargetGroup {
  id: string;
  name: string;
}

export interface EssioTargetBoard {
  id: string;
  name: string;
  groups: EssioTargetGroup[];
}

export interface EssioTargets {
  organisation: { id: string; name: string };
  boards: EssioTargetBoard[];
}

export class EssioTargetsDatabaseError extends Error {
  constructor() {
    super('Essio target discovery is unavailable');
    this.name = 'EssioTargetsDatabaseError';
  }
}

interface Row {
  organisation_name: string;
  board_id: string | null;
  board_name: string | null;
  group_id: string | null;
  group_name: string | null;
}

export async function listEssioTargets(principal: IntegrationPrincipal): Promise<EssioTargets> {
  if (principal.kind !== 'integration' || principal.integrationKey !== 'essio') {
    throw new Error('listEssioTargets requires an Essio integration principal');
  }
  let rows: Row[];
  try {
    rows = (await sql`
      SELECT o.name AS organisation_name,
             b.id::text AS board_id, b.name AS board_name,
             g.id::text AS group_id, g.name AS group_name
      FROM organisations o
      LEFT JOIN organiser_boards b ON b.organisation_id = o.id
      LEFT JOIN organiser_groups g ON g.board_id = b.id AND g.organisation_id = o.id
      WHERE o.id = ${principal.organisationId}::text
      ORDER BY b.position NULLS LAST, b.name, b.id, g.position NULLS LAST, g.name, g.id
    `) as Row[];
  } catch {
    throw new EssioTargetsDatabaseError();
  }
  if (rows.length === 0) throw new EssioTargetsDatabaseError(); // credential organisation must exist (FK)

  const boards: EssioTargetBoard[] = [];
  const byId = new Map<string, EssioTargetBoard>();
  for (const row of rows) {
    if (!row.board_id || row.board_name === null) continue;
    let board = byId.get(row.board_id);
    if (!board) {
      board = { id: row.board_id, name: row.board_name, groups: [] };
      byId.set(row.board_id, board);
      boards.push(board);
    }
    if (row.group_id && row.group_name !== null) board.groups.push({ id: row.group_id, name: row.group_name });
  }
  return { organisation: { id: principal.organisationId, name: rows[0].organisation_name }, boards };
}
