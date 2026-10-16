import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventPromotionCodeInput, mergeField, type EventPromotionCodeInput } from '@/lib/events/validation';
import { logEventPromotionCodeUpdated } from '@/lib/events/auditLog';
import { normaliseCode, findForeignTicketTypeIds } from '@/lib/events/services/promotions';

type Ctx = { params: Promise<{ id: string; promotionId: string }> };

// Phase 4 — edit / disable one promotional code (manager+). PATCH merges
// by property presence (mergeField — an explicit null clears an optional
// field such as ends_at or max_redemptions), re-validates the whole
// merged row, and applies the row update together with the ticket-type
// assignment change in ONE statement. Disabling is PATCH { active:
// false }; there is no DELETE (see ../route.ts).
//
// Changing or disabling a code NEVER alters an existing order: orders
// carry their own discount snapshot (event_orders.discount_cents /
// promotion_code_snapshot) and are never recomputed. A concurrent
// reservation that holds this code's row FOR UPDATE simply makes this
// UPDATE wait its turn; it never reads a half-applied rule.

async function loadOwnedPromotion(eventId: string, promotionId: string, organisationId: string) {
  const rows = await sql`
    SELECT pc.*,
      COALESCE((SELECT array_agg(ptt.ticket_type_id ORDER BY ptt.ticket_type_id)
        FROM event_promotion_code_ticket_types ptt
        WHERE ptt.promotion_code_id = pc.id AND ptt.organisation_id = pc.organisation_id), ARRAY[]::text[]) AS ticket_type_ids
    FROM event_promotion_codes pc
    WHERE pc.id = ${promotionId} AND pc.event_id = ${eventId} AND pc.organisation_id = ${organisationId}
    LIMIT 1
  `;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id, promotionId } = await params;

  const existing = await loadOwnedPromotion(id, promotionId, session.organisationId);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Partial<EventPromotionCodeInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const merged: EventPromotionCodeInput = {
    code: mergeField(body, 'code', existing.code),
    discount_type: mergeField(body, 'discount_type', existing.discount_type),
    discount_value: mergeField(body, 'discount_value', existing.discount_value),
    active: mergeField(body, 'active', existing.active),
    starts_at: mergeField(body, 'starts_at', existing.starts_at instanceof Date ? existing.starts_at.toISOString() : existing.starts_at),
    ends_at: mergeField(body, 'ends_at', existing.ends_at instanceof Date ? existing.ends_at.toISOString() : existing.ends_at),
    max_redemptions: mergeField(body, 'max_redemptions', existing.max_redemptions),
    min_cart_cents: mergeField(body, 'min_cart_cents', existing.min_cart_cents),
    ticket_type_ids: mergeField(body, 'ticket_type_ids', existing.ticket_type_ids),
  };
  const error = validateEventPromotionCodeInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const code = normaliseCode(merged.code)!;
  const ticketTypeIds = ((merged.ticket_type_ids as string[] | null | undefined) ?? []).map(ttId => ttId.trim());
  const foreign = await findForeignTicketTypeIds(id, session.organisationId, ticketTypeIds);
  if (foreign.length) return NextResponse.json({ error: 'One or more ticket types do not belong to this event.' }, { status: 400 });

  if (code !== existing.code) {
    const duplicate = await sql`
      SELECT id FROM event_promotion_codes
      WHERE organisation_id = ${session.organisationId} AND event_id = ${id} AND code = ${code} AND id <> ${promotionId} LIMIT 1
    `;
    if (duplicate.length) return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });
  }

  // Row update + assignment reconciliation in one statement. The DELETE
  // removes only assignments no longer wanted and the INSERT is ON
  // CONFLICT DO NOTHING, so the two never touch the same row within the
  // statement's single snapshot.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH upd AS (
        UPDATE event_promotion_codes SET
          code = ${code}, discount_type = ${merged.discount_type as string}, discount_value = ${merged.discount_value as number},
          active = ${(merged.active as boolean | null | undefined) ?? true},
          starts_at = ${(merged.starts_at as string | null | undefined) || null}, ends_at = ${(merged.ends_at as string | null | undefined) || null},
          max_redemptions = ${(merged.max_redemptions as number | null | undefined) ?? null}, min_cart_cents = ${(merged.min_cart_cents as number | null | undefined) ?? null},
          updated_at = now()
        WHERE id = ${promotionId} AND event_id = ${id} AND organisation_id = ${session.organisationId}
        RETURNING *
      ),
      del_tt AS (
        DELETE FROM event_promotion_code_ticket_types
        WHERE promotion_code_id = ${promotionId} AND organisation_id = ${session.organisationId}
          AND NOT (ticket_type_id = ANY(${ticketTypeIds}::text[]))
        RETURNING ticket_type_id
      ),
      ins_tt AS (
        INSERT INTO event_promotion_code_ticket_types (promotion_code_id, ticket_type_id, event_id, organisation_id)
        SELECT upd.id, u.ticket_type_id, ${id}, ${session.organisationId} FROM upd, UNNEST(${ticketTypeIds}::text[]) AS u(ticket_type_id)
        ON CONFLICT (promotion_code_id, ticket_type_id) DO NOTHING
        RETURNING ticket_type_id
      )
      SELECT upd.*, ${ticketTypeIds}::text[] AS ticket_type_ids,
        (SELECT count(*) FROM del_tt) AS removed_assignments, (SELECT count(*) FROM ins_tt) AS added_assignments
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

  await logEventPromotionCodeUpdated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, promotionCodeId: promotionId,
    before: existing as never, after: updated as never,
  });
  return NextResponse.json({ promotion: updated });
}
