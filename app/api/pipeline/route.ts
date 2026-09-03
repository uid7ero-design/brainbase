import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/org'
import sql from '@/lib/db'

async function ensureTable() {
  // Phase C1.2: organisation_id/submitted_by were previously UUID — a type
  // mismatch against the real, TEXT/cuid organisations.id and users.id
  // columns (confirmed throughout this codebase's raw-SQL tables; see
  // scripts/create-organisation-modules.sql's own comment for the same
  // correction made there). A session's real organisationId (e.g.
  // "cjld2cy...") is not valid UUID literal syntax, so every query
  // comparing this column against session.organisationId — across
  // app/api/pipeline/**, app/api/admin/pipeline/**, and
  // app/api/portal/pipeline/** — would fail with "invalid input syntax for
  // type uuid" once this table's live column actually is UUID (this
  // `CREATE TABLE IF NOT EXISTS` only fixes a FRESH install; it cannot
  // retroactively correct an already-existing mismatched column — see
  // scripts/fix-client-pipeline-organisation-id-type.ts, a prepared, NOT
  // executed, migration for that). Also adds the FK constraints this
  // table never had at all in its live (ensureTable-created) form.
  await sql`
    CREATE TABLE IF NOT EXISTS client_pipeline (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      submitted_by    TEXT REFERENCES users(id),
      type            TEXT NOT NULL DEFAULT 'request'
                        CHECK (type IN ('request', 'issue', 'feedback')),
      title           TEXT NOT NULL,
      description     TEXT,
      status          TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'in_progress', 'resolved')),
      priority        TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high')),
      founder_note    TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS client_pipeline_org_idx    ON client_pipeline(organisation_id)`
  await sql`CREATE INDEX IF NOT EXISTS client_pipeline_status_idx ON client_pipeline(status, created_at DESC)`
}

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTable()

  const rows = await sql`
    SELECT id, type, title, description, status, priority, founder_note, created_at
    FROM client_pipeline
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `
  return NextResponse.json({ requests: rows })
}

export async function POST(req: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTable()

  const { type, title, description, priority } = await req.json() as {
    type: string; title: string; description?: string; priority?: string
  }

  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const validTypes     = ['request', 'issue', 'feedback']
  const validPriorities = ['low', 'medium', 'high']

  const rows = await sql`
    INSERT INTO client_pipeline (organisation_id, submitted_by, type, title, description, priority)
    VALUES (
      ${session.organisationId},
      ${session.userId},
      ${validTypes.includes(type) ? type : 'request'},
      ${title.trim()},
      ${description?.trim() || null},
      ${validPriorities.includes(priority ?? '') ? priority : 'medium'}
    )
    RETURNING id, type, title, description, status, priority, created_at
  `
  return NextResponse.json({ request: rows[0] }, { status: 201 })
}
