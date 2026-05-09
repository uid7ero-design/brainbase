import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import sql from '@/lib/db'

export async function POST() {
  const session = await getSession()
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  return NextResponse.json({ ok: true, results })
}
