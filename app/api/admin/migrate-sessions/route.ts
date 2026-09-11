import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/org'
import { getClientIp } from '@/lib/clientIp'
import { logSessionMigrationExecuted } from '@/lib/admin/auditLog'
import sql from '@/lib/db'

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

// SEC-1B1: request metadata for audit logging — matches the identical
// helper already established in the other SEC-1A/SEC-1B1 admin routes.
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req)
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') }
}

export async function POST(req: NextRequest) {
  // SEC-1B1: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // (lib/org.ts) re-reads the caller's current role/organisation
  // assignment from the database on every call, so a since-demoted,
  // since-reassigned, or deleted user's still-valid JWT can no longer
  // trigger this migration.
  let session
  try { session = await requireRole('super_admin') } catch { return forbidden() }

  const results: string[] = []

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id               TEXT PRIMARY KEY,
        organisation_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        day_of_week      INTEGER NOT NULL,
        start_time       TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        max_capacity     INTEGER NOT NULL DEFAULT 8,
        session_type     TEXT NOT NULL,
        resource_id      TEXT,
        recurring        BOOLEAN NOT NULL DEFAULT true,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `
    results.push('✓ sessions table')
  } catch (e) { results.push(`✗ sessions: ${(e as Error).message}`) }

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(organisation_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day_of_week)`
    results.push('✓ sessions indexes')
  } catch (e) { results.push(`✗ sessions indexes: ${(e as Error).message}`) }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS session_instances (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        organisation_id  TEXT NOT NULL,
        date             DATE NOT NULL,
        start_time       TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        max_capacity     INTEGER NOT NULL DEFAULT 8,
        status           TEXT NOT NULL DEFAULT 'scheduled',
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (session_id, date)
      )
    `
    results.push('✓ session_instances table')
  } catch (e) { results.push(`✗ session_instances: ${(e as Error).message}`) }

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_session_id ON session_instances(session_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_date       ON session_instances(date)`
    await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_org        ON session_instances(organisation_id)`
    results.push('✓ session_instances indexes')
  } catch (e) { results.push(`✗ session_instances indexes: ${(e as Error).message}`) }

  try {
    await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS session_instance_id TEXT REFERENCES session_instances(id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_bookings_session_instance_id ON bookings(session_instance_id)`
    results.push('✓ bookings.session_instance_id column')
  } catch (e) { results.push(`  (bookings skipped: ${(e as Error).message})`) }

  // SEC-1B1: audit — this route was previously entirely unaudited. This
  // route has no overall failure path (every step catches its own error
  // into `results` and the route always responds 200) — matching that
  // existing design, the audit event is written unconditionally on
  // completion, carrying the same per-step results summary the response
  // itself returns. Best-effort per ADR-0003 — a dropped audit write
  // never affects this response.
  {
    const { ipAddress, userAgent } = requestMeta(req)
    await logSessionMigrationExecuted({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      results,
      ipAddress,
      userAgent,
    })
  }

  return NextResponse.json({ ok: true, results })
}
