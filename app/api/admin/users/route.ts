import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession, type Role } from '@/lib/session';

const ROLES: Role[] = ['viewer', 'manager', 'admin', 'super_admin'];
function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

/** GET /api/admin/users — list all users */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const users = await sql`
    SELECT u.id, u.username, u.name, u.email, u.role, u.organisation_id,
           o.name AS org_name, u.created_at
    FROM users u
    LEFT JOIN organisations o ON o.id = u.organisation_id
    ORDER BY u.created_at DESC
  `;
  return NextResponse.json({ users });
}

/** POST /api/admin/users — create a user */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { username, password, name, email, role, organisationId } = body;

  if (!username?.trim()) return NextResponse.json({ error: 'username is required.' }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  if (!name?.trim()) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}.` }, { status: 400 });
  if (!organisationId) return NextResponse.json({ error: 'organisationId is required.' }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  const clean = username.trim().toLowerCase();

  try {
    const rows = await sql`
      INSERT INTO users (username, password_hash, name, email, role, organisation_id)
      VALUES (
        ${clean},
        ${passwordHash},
        ${name.trim()},
        ${email?.trim() ?? null},
        ${role},
        ${organisationId}
      )
      RETURNING id, username, name, email, role, organisation_id, created_at
    `;
    return NextResponse.json({ user: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
    }
    throw err;
  }
}
