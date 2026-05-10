import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function propagateRecurring(
  newInstanceId: string,
  sessionId: string,
  organisationId: string,
  newDate: string,
  maxCapacity: number,
  sessionType: string,
  startTime: string,
) {
  // Find the closest instance before this date
  const prevRows = await sql`
    SELECT id FROM session_instances
    WHERE session_id = ${sessionId} AND date < ${newDate}::date AND status = 'scheduled'
    ORDER BY date DESC LIMIT 1
  `
  if (!prevRows[0]) return

  const prevId = prevRows[0].id as string

  // Get recurring bookings from that instance
  const recurring = await sql`
    SELECT client_name, client_email FROM bookings
    WHERE session_instance_id = ${prevId} AND is_recurring = true AND status != 'cancelled'
  `
  if (recurring.length === 0) return

  // Count only non-recurring slots already taken (new enrollments count against capacity)
  const countRows = await sql`
    SELECT COUNT(*)::int AS cnt FROM bookings
    WHERE session_instance_id = ${newInstanceId} AND status != 'cancelled'
  `
  let enrolled = (countRows[0] as { cnt: number }).cnt

  for (const r of recurring as { client_name: string; client_email: string | null }[]) {
    // Duplicate check first — already-enrolled players don't consume a capacity slot
    const dup = await sql`
      SELECT 1 FROM bookings
      WHERE session_instance_id = ${newInstanceId}
        AND client_name = ${r.client_name}
        AND (${r.client_email ?? null}::text IS NULL OR client_email = ${r.client_email ?? null})
        AND status != 'cancelled'
      LIMIT 1
    `
    if (dup.length > 0) continue

    // Only gate genuinely new insertions against capacity
    if (enrolled >= maxCapacity) continue

    await sql`
      INSERT INTO bookings
        (id, organisation_id, session_id, session_instance_id, client_name, client_email, date, time, session_type, status, paid, is_recurring)
      VALUES
        (${crypto.randomUUID()}, ${organisationId}, ${sessionId}, ${newInstanceId},
         ${r.client_name}, ${r.client_email ?? null}, ${newDate}, ${startTime}, ${sessionType},
         'confirmed', false, true)
    `
    enrolled++
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let authSession
  try { authSession = await requireRole('manager') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const { id } = await params

  const rows = await sql`
    SELECT id, organisation_id, name, day_of_week, start_time, duration_minutes, max_capacity, session_type
    FROM sessions WHERE id = ${id} AND organisation_id = ${authSession.organisationId}
  `
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tmpl = rows[0] as {
    id: string; organisation_id: string; name: string; day_of_week: number
    start_time: string; duration_minutes: number; max_capacity: number; session_type: string
  }

  const now = new Date()
  let daysUntilNext = ((tmpl.day_of_week - now.getDay()) + 7) % 7
  if (daysUntilNext === 0) daysUntilNext = 7

  // Delete ALL instances without active bookings (past and future) so stale wrong-day rows are cleared
  try {
    await sql`
      DELETE FROM session_instances
      WHERE session_id = ${id}
        AND id NOT IN (
          SELECT session_instance_id FROM bookings
          WHERE session_instance_id IS NOT NULL AND status != 'cancelled'
        )
    `
  } catch (err) {
    console.error('[generate-instances] DELETE FAILED:', err)
  }

  // Insert 6 weekly occurrences and propagate recurring bookings
  const inserted: string[] = []
  for (let w = 0; w < 6; w++) {
    const base = new Date()
    base.setDate(base.getDate() + daysUntilNext + w * 7)
    const targetDate = toLocalDateStr(base)
    try {
      await sql`
        INSERT INTO session_instances
          (id, session_id, organisation_id, date, start_time, duration_minutes, max_capacity, status)
        VALUES (
          ${crypto.randomUUID()}, ${tmpl.id}, ${tmpl.organisation_id},
          ${targetDate}::date, ${tmpl.start_time}, ${tmpl.duration_minutes}, ${tmpl.max_capacity},
          'scheduled'
        )
        ON CONFLICT (session_id, date) DO NOTHING
      `
      inserted.push(targetDate)
    } catch (err) {
      console.error('[generate-instances] INSERT FAILED for', targetDate, err)
      continue
    }

    // Resolve the instance id (may already exist via ON CONFLICT)
    try {
      const instRows = await sql`
        SELECT id FROM session_instances WHERE session_id = ${tmpl.id} AND date = ${targetDate}::date
      `
      if (instRows[0]) {
        await propagateRecurring(
          instRows[0].id as string, tmpl.id, tmpl.organisation_id,
          targetDate, tmpl.max_capacity, tmpl.session_type, tmpl.start_time,
        )
      }
    } catch (err) {
      console.error('[generate-instances] PROPAGATE FAILED for', targetDate, err)
    }
  }

  const instances = await sql`
    SELECT
      si.id,
      si.session_id,
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

  return NextResponse.json({ instances, generated: inserted.length })
}
