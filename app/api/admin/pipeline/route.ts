import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export async function GET() {
  try { await requireRole('super_admin') } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const rows = await sql`
    SELECT
      cp.id, cp.type, cp.title, cp.description, cp.status, cp.priority,
      cp.founder_note, cp.created_at, cp.updated_at,
      o.name AS org_name,
      u.name AS submitted_by_name
    FROM client_pipeline cp
    LEFT JOIN organisations o ON o.id = cp.organisation_id
    LEFT JOIN users u ON u.id = cp.submitted_by
    ORDER BY
      CASE cp.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      CASE cp.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      cp.created_at DESC
  `.catch(() => [])

  return NextResponse.json({ requests: rows })
}
