import { NextResponse } from 'next/server'
import sql from '@/lib/db'

const ORG_ID = process.env.LD_TENNIS_ORG_ID

export async function GET() {
  if (!ORG_ID) return NextResponse.json({ sessions: [] })

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr   = today.toISOString().split('T')[0]
    const windowEnd  = new Date(today)
    windowEnd.setDate(today.getDate() + 28)
    const windowStr  = windowEnd.toISOString().split('T')[0]

    const instances = await sql`
      SELECT
        si.id, si.session_id, si.date, si.start_time, si.duration_minutes, si.max_capacity, si.status,
        s.name AS session_name, s.session_type, s.resource_id,
        COALESCE(
          (SELECT COUNT(*)::int FROM bookings b
           WHERE b.session_instance_id = si.id AND b.status != 'cancelled'),
          0
        ) AS enrolled_count
      FROM session_instances si
      JOIN sessions s ON s.id = si.session_id
      WHERE s.organisation_id = ${ORG_ID}
        AND si.date >= ${todayStr}::date
        AND si.date <= ${windowStr}::date
        AND si.status = 'scheduled'
      ORDER BY si.date ASC, si.start_time ASC
    `

    return NextResponse.json({ sessions: instances })
  } catch (err) {
    console.error('[tennis/sessions GET]', err)
    return NextResponse.json({ sessions: [] })
  }
}
