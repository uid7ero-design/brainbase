import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession } from '@/lib/session';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`signup:${getClientIp(req)}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { name, email, orgName, password } = body as Record<string, string>;

  if (!name?.trim() || !email?.trim() || !orgName?.trim() || !password) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  const emailLower = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }
  const slug = slugify(orgName.trim());

  try {
    const uniqueSlug = `${slug}-${Math.floor(Math.random() * 9000) + 1000}`;
    // organisations.id and .updated_at both have NO database-level default
    // — Organisation.id's Prisma model declares `@default(cuid())` and
    // .updated_at uses plain `@updatedAt`, both APPLICATION-side defaults
    // Prisma Client applies itself, never realized as a real Postgres
    // DEFAULT expression. A raw SQL INSERT that omits them always fails
    // with "null value in column ... violates not-null constraint".
    // gen_random_uuid()::text / now() match the exact same established
    // pattern app/api/admin/orgs/route.ts already uses for this identical
    // gap.
    const [org] = await sql`
      INSERT INTO organisations (id, name, slug, plan, status, settings, updated_at)
      VALUES (gen_random_uuid()::text, ${orgName.trim()}, ${uniqueSlug}, 'TRIAL', 'ACTIVE', '{}', now())
      RETURNING id
    `;

    const hash = await bcrypt.hash(password, 12);

    // organisation_id is TEXT (cuid-based), never cast to ::uuid in raw
    // SQL — see CLAUDE.md's own documented convention. org.id here is a
    // gen_random_uuid()::text string, which is already the correct type
    // for this column; casting it to ::uuid would attempt to insert a
    // uuid-typed value into a text column.
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash, role, status, organisation_id, email_verified)
      VALUES (
        ${name.trim()},
        ${emailLower},
        ${hash},
        'ADMIN',
        'ACTIVE',
        ${org.id},
        true
      )
      RETURNING id, name, role, organisation_id
    `;

    await createSession(
      user.id as string,
      user.organisation_id as string,
      user.role as 'admin',
      user.name as string,
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('already exists')) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }
    console.error('[signup]', msg);
    return NextResponse.json({ error: 'Signup failed. Please try again.' }, { status: 500 });
  }
}
