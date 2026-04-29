import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession, type Role } from '@/lib/session';
import { createToken } from '@/lib/tokens';
import { sendEmail, verificationEmail } from '@/lib/email';

const ROLES: Role[] = ['viewer', 'manager', 'admin', 'super_admin'];
function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const users = await sql`
    SELECT u.id, u.username, u.name, u.email, u.role,
           u.organisation_id, u.email_verified, u.created_at,
           o.name AS org_name
    FROM users u
    LEFT JOIN organisations o ON o.id = u.organisation_id
    ORDER BY u.created_at DESC
  `;
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { username, password, name, email, role, organisationId } = body;

  if (!username?.trim())               return NextResponse.json({ error: 'username is required.' }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  if (!name?.trim())                   return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!ROLES.includes(role))           return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}.` }, { status: 400 });
  if (!organisationId)                 return NextResponse.json({ error: 'organisationId is required.' }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  const clean = username.trim().toLowerCase();
  const cleanEmail = email?.trim() || null;

  try {
    const rows = await sql`
      INSERT INTO users (username, password_hash, name, email, role, organisation_id, email_verified)
      VALUES (
        ${clean},
        ${passwordHash},
        ${name.trim()},
        ${cleanEmail},
        ${role},
        ${organisationId},
        ${cleanEmail ? false : true}
      )
      RETURNING id, username, name, email, role, organisation_id, email_verified, created_at
    `;
    const user = rows[0];

    // Send verification email if address was provided
    if (cleanEmail) {
      const token = await createToken(user.id as string, 'verify', 24 * 60 * 60_000);
      const { subject, html } = verificationEmail(name.trim(), token);
      await sendEmail({ to: cleanEmail, subject, html }).catch(err =>
        console.error('[users] verification email failed:', err),
      );
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
    }
    throw err;
  }
}
