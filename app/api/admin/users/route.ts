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
    // users.role is a real Postgres enum (UserRole: SUPER_ADMIN, ADMIN,
    // MANAGER, ANALYST, VIEWER) — uppercase-only labels, not a TEXT column.
    // `role` was already validated against the lowercase canonical Role
    // values above; it must be uppercased here to match the enum, mirroring
    // app/actions/users.ts's createUser, which already does this correctly.
    const newRole  = (role as string | undefined)?.toUpperCase() ?? (current.role as string);
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
    const updated = { ...rows[0], role: (rows[0].role as string).toLowerCase() };
    return NextResponse.json({ user: { ...updated, org_name: orgRow?.name ?? null } });
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
  // users.username (a short handle — the create-user form's own
  // "Username" field, e.g. "jane.smith") and users.email (a real
  // address — the form's separate, OPTIONAL "Email" field) are two
  // genuinely distinct, separately-collected columns: username NOT
  // NULL + UNIQUE, email nullable + UNIQUE. This previously collapsed
  // them into one value (falling email back onto username, then never
  // writing to the username column at all) — a stale leftover from
  // before the form had two separate inputs, confirmed by
  // AdminClient.tsx's own createUser form JSX already rendering both.
  const usernameVal = username?.trim();
  const emailVal = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;

  if (!usernameVal)                      return NextResponse.json({ error: 'Username is required.' }, { status: 400 });
  if (!password || password.length < 8)  return NextResponse.json({ error: 'password must be at least 8 characters.' }, { status: 400 });
  if (!name?.trim())                     return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (!ROLES.includes(role as Role))     return NextResponse.json({ error: `role must be one of: ${ROLES.join(', ')}.` }, { status: 400 });
  if (!organisationId)                   return NextResponse.json({ error: 'organisationId is required.' }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    // users.role is a real Postgres enum (UserRole) with uppercase-only
    // labels — see the matching comment in PATCH above. username and
    // updated_at are both NOT NULL with NO database-level default
    // (confirmed via information_schema.columns against DEV) —
    // User.updated_at's Prisma model is a plain `@updatedAt`, a
    // Prisma-Client-only mechanism never translated into an actual
    // Postgres DEFAULT, matching the exact same class of defect
    // app/api/admin/orgs/route.ts's own POST handler had (organisations
    // .id/.updated_at) — this raw SQL INSERT must supply both itself.
    const rows = await sql`
      INSERT INTO users (id, username, email, password_hash, name, role, organisation_id, email_verified, updated_at)
      VALUES (
        gen_random_uuid()::text,
        ${usernameVal},
        ${emailVal},
        ${passwordHash},
        ${name.trim()},
        ${(role as string).toUpperCase()},
        ${organisationId},
        false,
        now()
      )
      RETURNING id, username, email, name, role, organisation_id, email_verified, created_at
    `;
    const user = { ...rows[0], role: (rows[0].role as string).toLowerCase() };

    // A verification email only makes sense if the user was actually
    // given a real address — email is optional (the form's own
    // required={f.key !== 'email'} already reflects this), so a
    // username-only account (no email) simply skips this step rather
    // than emailing an invented/fallback address.
    //
    // The user row above is already committed at this point (a plain
    // INSERT auto-commits; this is not wrapped in a transaction with
    // what follows) — so a failure in this step must never be allowed
    // to make the route report the whole request as failed. Both
    // createToken() and sendEmail() are wrapped in the SAME try/catch
    // (not just sendEmail(), as before) — confirmed against real DEV
    // that createToken() can itself throw (the environment's
    // email_tokens table does not currently exist), which previously
    // escaped to the outer catch and returned a 500 for an operation
    // that had, in fact, already succeeded.
    if (emailVal) {
      try {
        const token = await createToken(rows[0].id as string, 'verify', 24 * 60 * 60_000);
        const { subject, html } = verificationEmail(name.trim(), token);
        await sendEmail({ to: emailVal, subject, html });
      } catch (err) {
        console.error('[users] verification email failed (user was still created):', err);
      }
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      const field = msg.includes('username') ? 'Username' : 'Email';
      return NextResponse.json({ error: `${field} already taken.` }, { status: 409 });
    }
    console.error('[admin users] create failed', err);
    return NextResponse.json({ error: `Create failed: ${msg}` }, { status: 500 });
  }
}
