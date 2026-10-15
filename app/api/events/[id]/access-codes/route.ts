import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventAccessCodeInput, type EventAccessCodeInput } from '@/lib/events/validation';
import { logEventAccessCodeCreated } from '@/lib/events/auditLog';
import { normaliseCode, findForeignTicketTypeIds } from '@/lib/events/services/promotions';
import { maskAccessCode } from '@/lib/events/services/accessCodes';

type Ctx = { params: Promise<{ id: string }> };

// Phase 4 — presale ACCESS codes, organiser side (eligibility only — see
// lib/events/services/accessCodes.ts).
//   GET   viewer+   list this event's access codes
//   POST  manager+  create one
// Same tenant discipline and "disable, never delete" rule as the
// promotion routes (../promotions/route.ts). The organiser sees the full
// code text here (they need to distribute it); audit rows store it MASKED
// (approval D8).

async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1`;
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const access_codes = await sql`
    SELECT ac.id, ac.code, ac.active, ac.starts_at, ac.ends_at, ac.created_at, ac.updated_at,
      COALESCE((SELECT array_agg(att.ticket_type_id ORDER BY att.ticket_type_id)
        FROM event_access_code_ticket_types att
        WHERE att.access_code_id = ac.id AND att.organisation_id = ac.organisation_id), ARRAY[]::text[]) AS ticket_type_ids,
      (SELECT count(*) FROM event_orders eo
        WHERE eo.access_code_id = ac.id AND eo.organisation_id = ac.organisation_id AND eo.status <> 'CANCELLED')::int AS order_count
    FROM event_access_codes ac
    WHERE ac.event_id = ${id} AND ac.organisation_id = ${session.organisationId}
    ORDER BY ac.created_at DESC, ac.code
  `;
  return NextResponse.json({ access_codes });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: EventAccessCodeInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const error = validateEventAccessCodeInput(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const code = normaliseCode(body.code)!;
  const ticketTypeIds = ((body.ticket_type_ids as string[] | undefined) ?? []).map(ttId => ttId.trim());
  const foreign = await findForeignTicketTypeIds(id, session.organisationId, ticketTypeIds);
  if (foreign.length) return NextResponse.json({ error: 'One or more ticket types do not belong to this event.' }, { status: 400 });

  const duplicate = await sql`
    SELECT id FROM event_access_codes WHERE organisation_id = ${session.organisationId} AND event_id = ${id} AND code = ${code} LIMIT 1
  `;
  if (duplicate.length) return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });

  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH ins AS (
        INSERT INTO event_access_codes (organisation_id, event_id, code, active, starts_at, ends_at)
        VALUES (
          ${session.organisationId}, ${id}, ${code}, ${(body.active as boolean | null | undefined) ?? true},
          ${(body.starts_at as string | null | undefined) || null}, ${(body.ends_at as string | null | undefined) || null}
        )
        RETURNING *
      ),
      ins_tt AS (
        INSERT INTO event_access_code_ticket_types (access_code_id, ticket_type_id, event_id, organisation_id)
        SELECT ins.id, u.ticket_type_id, ${id}, ${session.organisationId} FROM ins, UNNEST(${ticketTypeIds}::text[]) AS u(ticket_type_id)
        RETURNING ticket_type_id
      )
      SELECT ins.*, COALESCE((SELECT array_agg(ins_tt.ticket_type_id ORDER BY ins_tt.ticket_type_id) FROM ins_tt), ARRAY[]::text[]) AS ticket_type_ids
      FROM ins
    ` as Record<string, unknown>[];
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'A code with this name already exists for this event.' }, { status: 409 });
    }
    throw err;
  }
  const created = rows[0];
  await logEventAccessCodeCreated({
    organisationId: session.organisationId, userId: session.userId, eventId: id, accessCodeId: created.id as string,
    after: created as never, mask: maskAccessCode,
  });
  return NextResponse.json({ access_code: { ...created, order_count: 0 } }, { status: 201 });
}
