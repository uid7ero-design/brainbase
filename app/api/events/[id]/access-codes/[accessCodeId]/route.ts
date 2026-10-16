import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventAccessCodeInput, mergeField, type EventAccessCodeInput } from '@/lib/events/validation';
import { logEventAccessCodeUpdated } from '@/lib/events/auditLog';
import { normaliseCode, findForeignTicketTypeIds } from '@/lib/events/services/promotions';
import { maskAccessCode } from '@/lib/events/services/accessCodes';

type Ctx = { params: Promise<{ id: string; accessCodeId: string }> };

// Phase 4 — edit / disable one access code (manager+). Same merge,
// validation and single-statement reconciliation as the promotion PATCH
// (../../promotions/[promotionId]/route.ts); audit rows store the code
// masked. Disabling or re-scoping a code only affects FUTURE purchases:
// an order already placed with it keeps its snapshot.

async function loadOwnedAccessCode(eventId: string, accessCodeId: string, organisationId: string) {
  const rows = await sql`
    SELECT ac.*,
      COALESCE((SELECT array_agg(att.ticket_type_id ORDER BY att.ticket_type_id)
        FROM event_access_code_ticket_types att
        WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id), ARRAY[]::text[]) AS ticket_type_ids
    FROM event_access_codes ac
    WHERE ac.id = ${accessCodeId} AND ac.event_id = ${eventId} AND ac.organisation_id = ${organisationId}
    LIMIT 1
  `;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, accessCodeId } = await params;

  const existing = await loadOwnedAccessCode(id, accessCodeId, session.organisationId);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Partial<EventAccessCodeInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const merged: EventAccessCodeInput = {
    code: mergeField(body, 'code', existing.code),
    active: mergeField(body, 'active', existing.active),
    starts_at: mergeField(body, 'starts_at', existing.starts_at instanceof Date ? existing.starts_at.toISOString() : existing.starts_at),
    ends_at: mergeField(body, 'ends_at', existing.ends_at instanceof Date ? existing.ends_at.toISOString() : existing.ends_at),
    ticket_type_ids: mergeField(body, 'ticket_type_ids', existing.ticket_type_ids),
  };
  const error = validateEventAccessCodeInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const code = normaliseCode(merged.code)!;
  const ticketTypeIds = ((merged.ticket_type_ids as string[] | null | undefined) ?? []).map(ttId => ttId.trim());
  const foreign = await findForeignTicketTypeIds(id, session.organisationId, ticketTypeIds);
  if (foreign.length) return NextResponse.json({ error: 'One or more ticket types do not belong to this event.' }, { status: 400 });

  if (code !== existing.code) {
    const duplicate = await sql`
      SELECT id FROM event_access_codes
      WHERE organisation_id = ${session.organisationId} AND event_id = ${id} AND code = ${code} AND id <> ${accessCodeId} LIMIT 1
    `;
    if (duplicate.length) return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH upd AS (
        UPDATE event_access_codes SET
          code = ${code}, active = ${(merged.active as boolean | null | undefined) ?? true},
          starts_at = ${(merged.starts_at as string | null | undefined) || null}, ends_at = ${(merged.ends_at as string | null | undefined) || null},
          updated_at = now()
        WHERE id = ${accessCodeId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING *
      ),
      del_tt AS (
        DELETE FROM event_access_code_ticket_types
        WHERE access_code_id = ${accessCodeId} AND organisation_id = ${session.organisationId}
          AND NOT (ticket_type_id = ANY(${ticketTypeIds}::text[]))
        RETURNING ticket_type_id
      ),
      ins_tt AS (
        INSERT INTO event_access_code_ticket_types (access_code_id, ticket_type_id, event_id, organisation_id)
        SELECT upd.id, u.ticket_type_id, ${id}, ${session.organisationId} FROM upd, UNNEST(${ticketTypeIds}::text[]) AS u(ticket_type_id)
        ON CONFLICT (access_code_id, ticket_type_id) DO NOTHING
        RETURNING ticket_type_id
      )
      SELECT upd.*, (SELECT count(*) FROM del_tt) AS removed_assignments, (SELECT count(*) FROM ins_tt) AS added_assignments
      FROM upd
    ` as Record<string, unknown>[];
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });
    }
    throw err;
  }
  if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { removed_assignments: _removed, added_assignments: _added, ...updated } = rows[0];
  void _removed; void _added;
  updated.ticket_type_ids = [...ticketTypeIds].sort();

  await logEventAccessCodeUpdated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, accessCodeId,
    before: existing as never, after: updated as never, mask: maskAccessCode,
  });
  return NextResponse.json({ access_code: updated });
}
