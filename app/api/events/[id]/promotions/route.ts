import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventPromotionCodeInput, type EventPromotionCodeInput } from '@/lib/events/validation';
import { logEventPromotionCodeCreated } from '@/lib/events/auditLog';
import { normaliseCode, findForeignTicketTypeIds } from '@/lib/events/services/promotions';

type Ctx = { params: Promise<{ id: string }> };

// Phase 4 — promotional codes, organiser side.
//   GET   viewer+   list this event's codes with live redemption counts
//   POST  manager+  create one
// There is deliberately NO DELETE: a code that has been used is part of
// every order's snapshot history, so "stop this code" is PATCH
// { active: false } (see [promotionId]/route.ts). Tenant scoping: the
// event must belong to the caller's organisation (404 otherwise, never
// revealing whether the id exists elsewhere), every ticket-type
// assignment must belong to THIS event, and the database enforces both
// again through the composite FKs in
// scripts/create-events-promotions-presales-sale-windows.sql.

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] ?? null;
}

// Redemption figures use the D3 accounting (see
// lib/events/services/promotions.ts): paid/refunded orders always count
// (redeemed), live unexpired holds count (pending), expired/failed/
// cancelled unpaid holds never do.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const promotions = await sql`
    SELECT pc.id, pc.code, pc.discount_type, pc.discount_value, pc.active, pc.starts_at, pc.ends_at,
      pc.max_redemptions, pc.min_cart_cents, pc.created_at, pc.updated_at,
      COALESCE((SELECT array_agg(ptt.ticket_type_id ORDER BY ptt.ticket_type_id)
        FROM event_promotion_code_ticket_types ptt
        WHERE ptt.promotion_code_id = pc.id AND ptt.organisation_id = pc.organisation_id), ARRAY[]::text[]) AS ticket_type_ids,
      (SELECT count(*) FROM event_orders eo
        WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
          AND (eo.payment_status IN ('PAID', 'REFUNDED') OR (eo.status <> 'CANCELLED' AND eo.payment_status = 'NOT_REQUIRED')))::int AS redeemed_count,
      (SELECT count(*) FROM event_orders eo
        WHERE eo.promotion_code_id = pc.id AND eo.organisation_id = pc.organisation_id
          AND eo.status <> 'CANCELLED' AND eo.payment_status = 'PENDING' AND eo.expires_at > NOW())::int AS pending_count
    FROM event_promotion_codes pc
    WHERE pc.event_id = ${id} AND pc.organisation_id = ${session.organisationId}
    ORDER BY pc.created_at DESC, pc.code
  `;
  return NextResponse.json({ promotions });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: EventPromotionCodeInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const error = validateEventPromotionCodeInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const code = normaliseCode(body.code)!;
  const ticketTypeIds = ((body.ticket_type_ids as string[] | undefined) ?? []).map(ttId => ttId.trim());
  const foreign = await findForeignTicketTypeIds(id, session.organisationId, ticketTypeIds);
  if (foreign.length) return NextResponse.json({ error: 'One or more ticket types do not belong to this event.' }, { status: 400 });

  const duplicate = await sql`
    SELECT id FROM event_promotion_codes WHERE organisation_id = ${session.organisationId} AND event_id = ${id} AND code = ${code} LIMIT 1
  `;
  if (duplicate.length) return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });

  // One statement: the code row and its ticket-type assignments are
  // created together or not at all.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH ins AS (
        INSERT INTO event_promotion_codes (organisation_id, event_id, code, discount_type, discount_value, active, starts_at, ends_at, max_redemptions, min_cart_cents)
        VALUES (
          ${session.organisationId}, ${id}, ${code}, ${body.discount_type as string}, ${body.discount_value as number},
          ${(body.active as boolean | null | undefined) ?? true},
          ${(body.starts_at as string | null | undefined) || null}, ${(body.ends_at as string | null | undefined) || null},
          ${(body.max_redemptions as number | null | undefined) ?? null}, ${(body.min_cart_cents as number | null | undefined) ?? null}
        )
        RETURNING *
      ),
      ins_tt AS (
        INSERT INTO event_promotion_code_ticket_types (promotion_code_id, ticket_type_id, event_id, organisation_id)
        SELECT ins.id, u.ticket_type_id, ${id}, ${session.organisationId} FROM ins, UNNEST(${ticketTypeIds}::text[]) AS u(ticket_type_id)
        RETURNING ticket_type_id
      )
      SELECT ins.*, COALESCE((SELECT array_agg(ins_tt.ticket_type_id ORDER BY ins_tt.ticket_type_id) FROM ins_tt), ARRAY[]::text[]) AS ticket_type_ids
      FROM ins
    ` as Record<string, unknown>[];
  } catch (err) {
    // Unique (organisation_id, event_id, code) raced with another create.
    if ((err as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });
    }
    throw err;
  }
  const created = rows[0];
  await logEventPromotionCodeCreated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, promotionCodeId: created.id as string, after: created as never,
  });
  return NextResponse.json({ promotion: { ...created, redeemed_count: 0, pending_count: 0 } }, { status: 201 });
}
