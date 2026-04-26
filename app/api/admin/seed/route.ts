import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';

/**
 * POST /api/admin/seed
 * Creates the initial organisation + super_admin user.
 * Only works when no users exist. Safe to call once.
 *
 * Body: { orgName, orgSlug, username, password, name }
 */
export async function POST(req: NextRequest) {
  // Ensure base tables exist
  await sql`
    CREATE TABLE IF NOT EXISTS organisations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID REFERENCES organisations(id),
      username        TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      name            TEXT NOT NULL,
      email           TEXT,
      role            TEXT NOT NULL DEFAULT 'viewer',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const existing = await sql`SELECT COUNT(*) AS count FROM users`;
  if (Number(existing[0].count) > 0) {
    return NextResponse.json(
      { error: 'Users already exist. Use /admin/users to manage them.' },
      { status: 409 },
    );
  }

  const { orgName, orgSlug, username, password, name, email } = await req.json();

  if (!orgName || !orgSlug || !username || !password || !name) {
    return NextResponse.json(
      { error: 'orgName, orgSlug, username, password, and name are required.' },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  // Slug: lowercase, hyphens only
  const slug = orgSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const orgRows = await sql`
    INSERT INTO organisations (name, slug) VALUES (${orgName}, ${slug})
    RETURNING id
  `;
  const orgId = orgRows[0].id;

  const passwordHash = await bcrypt.hash(password, 12);
  await sql`
    INSERT INTO users (organisation_id, username, password_hash, name, email, role)
    VALUES (${orgId}, ${username}, ${passwordHash}, ${name}, ${email ?? null}, 'super_admin')
  `;

  return NextResponse.json({
    success: true,
    message: `Organisation "${orgName}" and super admin "${name}" created. You can now log in.`,
  });
}
