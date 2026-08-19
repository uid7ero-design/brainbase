import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { prisma } from '@/lib/prisma'
import { reconcileFutureInstances, type EndMode } from '@/lib/tennisSchedule'
import { resolveTypeDisplayName } from '@/lib/tennisSessionTypes'
import { validateSessionColourOverride } from '@/lib/sessionDisplay'

const VALID_END_MODES: EndMode[] = ['ongoing', 'after_weeks', 'on_date']

function validateSchedule(body: { end_mode?: string; end_after_weeks?: number | null; end_date?: string | null }): string | null {
  if (body.end_mode !== undefined && !VALID_END_MODES.includes(body.end_mode as EndMode)) {
    return "end_mode must be 'ongoing', 'after_weeks', or 'on_date'"
  }
  if (body.end_mode === 'after_weeks' && (!body.end_after_weeks || body.end_after_weeks < 1 || body.end_after_weeks > 104)) {
    return 'end_after_weeks must be between 1 and 104 when end_mode is after_weeks'
  }
  if (body.end_mode === 'on_date' && !body.end_date) {
    return 'end_date is required when end_mode is on_date'
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  try {
    const sessions = await sql`
      SELECT id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring,
             price_per_session, created_at,
             to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date,
             session_colour_key, archived_at
      FROM sessions
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
    `
    if (!sessions[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const instances = await sql`
      SELECT
        si.id,
        to_char(si.date, 'YYYY-MM-DD') AS date,
        si.start_time,
        si.duration_minutes,
        si.max_capacity,
        si.status,
        si.created_at,
        COALESCE(ec.cnt, 0) AS enrolled_count,
        COALESCE(ec.cnt * s.price_per_session, 0)::int AS revenue,
        COALESCE(ROUND(ec.cnt::numeric / NULLIF(si.max_capacity, 0) * 100), 0)::int AS utilisation
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM bookings b
        WHERE b.session_instance_id = si.id AND b.status != 'cancelled'
      ) ec ON true
      WHERE si.session_id = ${id}
      ORDER BY si.date ASC
    `

    return NextResponse.json({ session: sessions[0], instances })
  } catch (err) {
    console.error('[dashboard/sessions/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params
  let body: Partial<{
    name: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number
    session_type: string; resource_id: string | null; recurring: boolean; price_per_session: number
    start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
    session_colour_key: string | null
  }>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const scheduleErr = validateSchedule(body)
  if (scheduleErr) return NextResponse.json({ error: scheduleErr }, { status: 400 })

  // Distinguish "field omitted" (leave whatever is stored alone) from
  // "field explicitly sent as null/blank" (reset to inherit-from-type) —
  // a plain COALESCE can't express the reset-to-NULL case, so the SET
  // clauses below branch on body.session_colour_key !== undefined instead.
  const colourOverride = validateSessionColourOverride(body.session_colour_key)
  if (colourOverride === 'INVALID') return NextResponse.json({ error: 'Invalid session_colour_key' }, { status: 400 })

  // Optional label: a blank name submitted alongside a session_type falls
  // back to that type's display name (sessions.name stays NOT NULL, no
  // migration was made for this — see resolveTypeDisplayName). A blank
  // name with no session_type in the same request can't be resolved to a
  // type-based fallback, so it's left alone and COALESCE below preserves
  // whatever is already stored, rather than erroring.
  let resolvedName: string | null = null
  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    resolvedName = trimmed || (body.session_type ? await resolveTypeDisplayName(session.organisationId, body.session_type.trim()) : null)
  }

  try {
    // Schedule fields are updated with explicit UPDATE ... SET (not
    // COALESCE-preserve-existing) whenever end_mode is supplied, since
    // end_after_weeks/end_date genuinely need to be able to become NULL
    // when switching modes (e.g. after_weeks -> ongoing must clear
    // end_after_weeks, not silently keep the old value around).
    const rows = body.end_mode !== undefined ? await sql`
      UPDATE sessions SET
        name              = COALESCE(${resolvedName}, name),
        day_of_week       = COALESCE(${body.day_of_week ?? null}, day_of_week),
        start_time        = COALESCE(${body.start_time ?? null}, start_time),
        duration_minutes  = COALESCE(${body.duration_minutes ?? null}, duration_minutes),
        max_capacity      = COALESCE(${body.max_capacity ?? null}, max_capacity),
        session_type      = COALESCE(${body.session_type?.trim() ?? null}, session_type),
        resource_id       = ${body.resource_id !== undefined ? (body.resource_id?.trim() || null) : sql`resource_id`},
        recurring         = COALESCE(${body.recurring ?? null}, recurring),
        price_per_session = COALESCE(${body.price_per_session ?? null}, price_per_session),
        start_date        = ${body.start_date !== undefined ? body.start_date : sql`start_date`}::date,
        end_mode          = ${body.end_mode},
        end_after_weeks   = ${body.end_mode === 'after_weeks' ? body.end_after_weeks ?? null : null},
        end_date          = ${body.end_mode === 'on_date' ? body.end_date ?? null : null}::date,
        session_colour_key = ${body.session_colour_key !== undefined ? colourOverride : sql`session_colour_key`}
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring,
        price_per_session, created_at,
        to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date,
        session_colour_key, archived_at
    ` : await sql`
      UPDATE sessions SET
        name              = COALESCE(${resolvedName}, name),
        day_of_week       = COALESCE(${body.day_of_week ?? null}, day_of_week),
        start_time        = COALESCE(${body.start_time ?? null}, start_time),
        duration_minutes  = COALESCE(${body.duration_minutes ?? null}, duration_minutes),
        max_capacity      = COALESCE(${body.max_capacity ?? null}, max_capacity),
        session_type      = COALESCE(${body.session_type?.trim() ?? null}, session_type),
        resource_id       = ${body.resource_id !== undefined ? (body.resource_id?.trim() || null) : sql`resource_id`},
        recurring         = COALESCE(${body.recurring ?? null}, recurring),
        price_per_session = COALESCE(${body.price_per_session ?? null}, price_per_session),
        start_date        = ${body.start_date !== undefined ? body.start_date : sql`start_date`}::date,
        session_colour_key = ${body.session_colour_key !== undefined ? colourOverride : sql`session_colour_key`}
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type, resource_id, recurring,
        price_per_session, created_at,
        to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date,
        session_colour_key, archived_at
    `
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const updated = rows[0] as {
      id: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number
      session_type: string; start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
      archived_at: string | null
    }

    // An archived session's schedule fields can still be edited (fixing a
    // typo, correcting a price) without that silently un-retiring it —
    // reconcile is the mechanism that generates/extends future instances,
    // so skipping it here is what keeps "edit while archived" safe. Use
    // the dedicated restore endpoint to bring a session back to active
    // maintenance instead.
    const reconcile = updated.archived_at
      ? { generated: 0, cancelledInstances: 0, conflicts: [] }
      : await reconcileFutureInstances({
          organisationId: session.organisationId,
          sessionId: id,
          rules: { day_of_week: updated.day_of_week, start_date: updated.start_date, end_mode: updated.end_mode, end_after_weeks: updated.end_after_weeks, end_date: updated.end_date },
          startTime: updated.start_time, durationMinutes: updated.duration_minutes, maxCapacity: updated.max_capacity, sessionType: updated.session_type,
        })

    return NextResponse.json({ session: rows[0], reconcile })
  } catch (err) {
    console.error('[dashboard/sessions/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  // Verify ownership BEFORE any mutation — no child or parent row may be
  // touched unless this session actually belongs to the caller's organisation.
  const owned = await prisma.session.findFirst({
    where: { id, organisation_id: session.organisationId },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // All three deletes run in a single transaction: if any statement fails,
    // Prisma rolls back the whole batch — no row is left partially deleted.
    await prisma.$transaction([
      prisma.booking.deleteMany({
        where: {
          organisation_id: session.organisationId,
          session_instance: { session_id: id },
        },
      }),
      prisma.sessionInstance.deleteMany({
        where: { session_id: id, organisation_id: session.organisationId },
      }),
      prisma.session.deleteMany({
        where: { id, organisation_id: session.organisationId },
      }),
    ])

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[dashboard/sessions/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
