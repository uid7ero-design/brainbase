import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';

// Creates the initial super_admin only when no users exist.
// Safe to call multiple times — does nothing if a user already exists.
export async function POST(req: NextRequest) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const existing = await sql`SELECT COUNT(*) as count FROM users`;
  if (Number(existing[0].count) > 0) {
    return NextResponse.json({ error: 'Users already exist. Use /admin/users to manage them.' }, { status: 409 });
  }

  const { username, password, name } = await req.json();
  if (!username || !password || !name) {
    return NextResponse.json({ error: 'username, password, and name required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await sql`INSERT INTO users (username, password_hash, name, role) VALUES (${username}, ${passwordHash}, ${name}, 'super_admin')`;

  return NextResponse.json({ success: true, message: `Super admin "${name}" created. You can now log in.` });
}
