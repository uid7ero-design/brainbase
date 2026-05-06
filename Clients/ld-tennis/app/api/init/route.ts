import { NextResponse } from 'next/server'
import sql from '@/lib/db'

// GET /api/init — run once to create the leads table
export async function GET() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        phone       TEXT,
        message     TEXT,
        source      TEXT DEFAULT 'tennis-landing',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `
    return NextResponse.json({ success: true, message: 'leads table ready' })
  } catch (err) {
    console.error('GET /api/init error:', err)
    return NextResponse.json({ error: 'Failed to initialise database' }, { status: 500 })
  }
}
