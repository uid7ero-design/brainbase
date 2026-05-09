import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const rows = await sql`
    SELECT
      cp.id, cp.type, cp.title, cp.description, cp.status, cp.priority,
      cp.founder_note, cp.created_at, cp.updated_at,
      cp.organisation_id,
      o.name AS org_name,
      u.name AS submitted_by_name,
      (
        SELECT json_agg(pm ORDER BY pm.created_at ASC)
        FROM pipeline_messages pm
        WHERE pm.pipeline_id = cp.id
      ) AS messages,
      (
        SELECT row_to_json(b)
        FROM (
          SELECT id, date, time, session_type, status, confirmed_at
          FROM bookings
          WHERE pipeline_id = cp.id::text
          ORDER BY created_at DESC
          LIMIT 1
        ) b
      ) AS booking
    FROM client_pipeline cp
    LEFT JOIN organisations o ON o.id = cp.organisation_id
    LEFT JOIN users u ON u.id = cp.submitted_by
    ORDER BY
      CASE cp.status WHEN 'new' THEN 0 WHEN 'awaiting_client' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
      CASE cp.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      cp.created_at DESC
  `.catch(err => { console.error('[PIPELINE GET ERROR]', err); return [] })

  return NextResponse.json({ requests: rows })
}
