import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
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

export async function GET() {
  let session
  try { session = await requireRole('viewer') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  try {
    const sessions = await sql`
      SELECT
        s.id, s.name, s.day_of_week, s.start_time, s.duration_minutes,
        s.max_capacity, s.session_type, s.resource_id, s.recurring, s.price_per_session, s.created_at,
        to_char(s.start_date, 'YYYY-MM-DD') AS start_date, s.end_mode, s.end_after_weeks,
        to_char(s.end_date, 'YYYY-MM-DD') AS end_date, s.session_colour_key,
        -- Unique roster players, not total booking rows: a weekly player
        -- propagated across 6 future instances has 6 booking rows but is
        -- one player. Bookings sharing a recurring_group_id collapse to a
        -- single count; one-off/drop-in bookings (recurring_group_id NULL)
        -- each count individually via their own id.
        COALESCE(
          (SELECT COUNT(DISTINCT COALESCE(b.recurring_group_id, b.id))::int FROM bookings b
           WHERE b.session_id = s.id AND b.status != 'cancelled'),
          0
        ) AS enrolled_count
      FROM sessions s
      WHERE s.organisation_id = ${session.organisationId}
      ORDER BY s.day_of_week, s.start_time
    `

    // GET returns data only — no write side effect. Automatic horizon
    // top-up now happens via an explicit, awaited POST (see
    // /api/dashboard/sessions/reconcile/route.ts), not as an unawaited
    // side effect of a read. A fire-and-forget write here was rejected:
    // in a serverless request the process can be frozen/recycled the
    // instant the response is sent, before the write actually lands, and
    // a GET mutating state at all is surprising behaviour for anything
    // that might refetch, prefetch, or cache this endpoint later.
    return NextResponse.json({ sessions })
  } catch {
    // bookings table may not exist yet — fall back to count-free query
    try {
      const sessions = await sql`
        SELECT id, name, day_of_week, start_time, duration_minutes,
               max_capacity, session_type, resource_id, recurring, created_at
        FROM sessions
        WHERE organisation_id = ${session.organisationId}
        ORDER BY day_of_week, start_time
      `
      return NextResponse.json({ sessions: sessions.map(s => ({ ...s, enrolled_count: 0 })) })
    } catch (err2) {
      console.error('[dashboard/sessions GET]', err2)
      return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
    }
  }
}

export async function POST(req: NextRequest) {
  let session
  try { session = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let body: {
    name?: string; day_of_week: number; start_time: string
    duration_minutes?: number; max_capacity?: number
    session_type: string; resource_id?: string; recurring?: boolean
    price_per_session?: number
    start_date?: string | null; end_mode?: EndMode; end_after_weeks?: number | null; end_date?: string | null
    session_colour_key?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  // Session Type is the primary identity now — name (the optional custom
  // label) is no longer required from the caller. The sessions.name column
  // itself is still NOT NULL with no default (no migration was made for
  // this), so a blank/omitted name falls back to the type's own display
  // name below rather than being rejected here.
  if (body.day_of_week == null || !body.start_time || !body.session_type?.trim()) {
    return NextResponse.json({ error: 'day_of_week, start_time, and session_type are required' }, { status: 400 })
  }
  const scheduleErr = validateSchedule(body)
  if (scheduleErr) return NextResponse.json({ error: scheduleErr }, { status: 400 })

  const colourOverride = validateSessionColourOverride(body.session_colour_key)
  if (colourOverride === 'INVALID') return NextResponse.json({ error: 'Invalid session_colour_key' }, { status: 400 })

  const endMode = body.end_mode ?? 'ongoing'
  const startDate = body.start_date ?? null

  try {
    const id = crypto.randomUUID()
    const name = body.name?.trim() || await resolveTypeDisplayName(session.organisationId, body.session_type.trim())
    const rows = await sql`
      INSERT INTO sessions (
        id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity,
        session_type, resource_id, recurring, price_per_session, start_date, end_mode, end_after_weeks, end_date,
        session_colour_key
      )
      VALUES (
        ${id}, ${session.organisationId}, ${name}, ${body.day_of_week},
        ${body.start_time}, ${body.duration_minutes ?? 60}, ${body.max_capacity ?? 8},
        ${body.session_type.trim()}, ${body.resource_id?.trim() ?? null}, ${body.recurring ?? true},
        ${body.price_per_session ?? 0}, ${startDate}::date, ${endMode},
        ${endMode === 'after_weeks' ? body.end_after_weeks : null},
        ${endMode === 'on_date' ? body.end_date : null}::date,
        ${colourOverride}
      )
      RETURNING id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type,
        resource_id, recurring, price_per_session, created_at,
        to_char(start_date, 'YYYY-MM-DD') AS start_date, end_mode, end_after_weeks, to_char(end_date, 'YYYY-MM-DD') AS end_date,
        session_colour_key
    `
    const created = rows[0] as { id: string; day_of_week: number; start_time: string; duration_minutes: number; max_capacity: number; session_type: string; start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null }

    const reconcile = await reconcileFutureInstances({
      organisationId: session.organisationId,
      sessionId: id,
      rules: { day_of_week: created.day_of_week, start_date: created.start_date, end_mode: created.end_mode, end_after_weeks: created.end_after_weeks, end_date: created.end_date },
      startTime: created.start_time, durationMinutes: created.duration_minutes, maxCapacity: created.max_capacity, sessionType: created.session_type,
    })

    return NextResponse.json({ session: { ...rows[0], enrolled_count: 0 }, reconcile }, { status: 201 })
  } catch (err) {
    console.error('[dashboard/sessions POST]', err)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}
