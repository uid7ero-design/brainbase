import { NextResponse } from 'next/server';
import sql from '@/lib/db';

/** GET /api/health/db — confirms DB connectivity. No auth required. */
export async function GET() {
  try {
    const start = Date.now();
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true, latencyMs: Date.now() - start });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 503 },
    );
  }
}
