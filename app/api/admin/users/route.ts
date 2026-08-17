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
  if (!session || session.role?.toLowerCase() !== 'super_admin') return forbidden();

  const users = await sql`
    SELECT u.id, u.email, u.name, u.role,
           u.organisation_id, u.email_verified, u.created_at,
           o.name AS org_name
    FROM users u
    LEFT JOIN organisations o ON o.id = u.organisation_id
    ORDER BY u.created_at DESC
  `;
  // Normalise for display: existing rows may hold role in either case
  // depending on which admin path created them (see PATCH/POST below) —
  // the edit form only recognises the lowercase canonical form.
  const normalised = users.map(u => ({ ...u, role: (u.role as string).toLowerCase() }));
  return NextResponse.json({ users: normalised });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role?.toLowerCase() !== 'super_admin') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { name, organisationId, email, password } = body;
  // Normalise case before validating/storing — the DB may already hold
  // either case depending on which admin path wrote the row, and this is
  // the single canonical boundary where role casing is settled (mirrors
  // lib/org.ts's requireSession(), which already lowercases role on read).
  const role: string | undefined = typeof body.role === 'string' ? body.role.toLowerCase() : body.role;

  if (name !== undefined && !name?.trim())
    return NextResponse.json({ error: 'name cannot be blank.' }, { status: 400 });
  if (role !== undefined && !ROLES.includes(role as Role))
    return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}.` }, { status: 400 });
  if (password !== undefined && password.length < 8)
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  try {
    const [current] = await sql`SELECT name, role, organisation_id, email, password_hash FROM users WHERE id = ${id}`;
    if (!current) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    const newName  = (name as string | undefined)?.trim()   ?? (current.name as string);
    const newRole  = (role as string | undefined)            ?? (current.role as string);
    const newOrgId = (organisationId as string | undefined)  ?? (current.organisation_id as string);
    const newEmail = email !== undefined ? (email?.trim() || null) : (current.email as string | null);
    const newHash  = password ? await bcrypt.hash(password as string, 12) : (current.password_hash as string);

    const rows = await sql`
      UPDATE users
      SET name = ${newName}, role = ${newRole}, organisation_id = ${newOrgId},
          email = ${newEmail}, password_hash = ${newHash}
      WHERE id = ${id}
      RETURNING id, email, name, role, organisation_id, email_verified, created_at
    `;

    const [orgRow] = await sql`SELECT name FROM organisations WHERE id = ${newOrgId}`.catch(() => [null]);
    return NextResponse.json({ user: { ...rows[0], org_name: orgRow?.name ?? null } });
  } catch (err) {
    console.error('[admin/users PATCH]', err);
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role?.toLowerCase() !== 'super_admin') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  if (id === session.userId)
    return NextResponse.json({ error: 'Cannot delete your own account.' }, { status: 409 });

  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role?.toLowerCase() !== 'super_admin') return forbidden();

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { username, password, name, organisationId } = body;
  const role: string | undefined = typeof body.role === 'string' ? body.role.toLowerCase() : body.role;
  const emailVal = (username ?? body.email)?.trim().toLowerCase();

  if (!emailVal)                         return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  if (!password || password.length < 8)  return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  if (!name?.trim())                     return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!ROLES.includes(role as Role))     return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}.` }, { status: 400 });
  if (!organisationId)                   return NextResponse.json({ error: 'organisationId is required.' }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const rows = await sql`
      INSERT INTO users (id, email, password_hash, name, role, organisation_id, email_verified)
      VALUES (
        gen_random_uuid()::text,
        ${emailVal},
        ${passwordHash},
        ${name.trim()},
        ${role},
        ${organisationId},
        false
      )
      RETURNING id, email, name, role, organisation_id, email_verified, created_at
    `;
    const user = rows[0];

    const token = await createToken(user.id as string, 'verify', 24 * 60 * 60_000);
    const { subject, html } = verificationEmail(name.trim(), token);
    await sendEmail({ to: emailVal, subject, html }).catch(err =>
      console.error('[users] verification email failed:', err),
    );

    return NextResponse.json({ user }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Email already taken.' }, { status: 409 });
    }
    throw err;
  }
}
