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
    const hash = await bcrypt.hash(password, 12);

    // organisations.id/.updated_at and users.id/.updated_at all have NO
    // database-level default (Organisation.id/.updated_at and
    // User.id/.updated_at are all Prisma-Client-only conventions —
    // @default(cuid())/@updatedAt — never realized as a real Postgres
    // DEFAULT; confirmed independently by app/api/admin/orgs/route.ts's
    // POST handler and app/api/admin/users/route.ts's POST handler,
    // which already fix the identical gap for each table). Both ids are
    // generated here in JS with crypto.randomUUID() rather than
    // gen_random_uuid()::text specifically so the organisation id is
    // known up front and can be shared into the users INSERT without
    // depending on the first statement's own RETURNING output — which
    // sql.transaction()'s flat, pre-built query array (see below) does
    // not support.
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // Both inserts are committed as one atomic unit via the neon
    // serverless driver's own sql.transaction() primitive — already
    // established against this exact sql client by
    // lib/commercial/invoices.ts / lib/commercial/documentNumbering.ts.
    // Previously these were two separate auto-committed statements, so a
    // failure on the users INSERT could leave an orphan organisation
    // with zero users — reproduced for real during PR #216's live
    // Preview smoke test. organisation_id/user id are never cast to
    // ::uuid in raw SQL — both columns are TEXT (cuid-based), per
    // CLAUDE.md's own documented convention.
    await sql.transaction([
      sql`
        INSERT INTO organisations (id, name, slug, plan, status, settings, updated_at)
        VALUES (${orgId}, ${orgName.trim()}, ${uniqueSlug}, 'TRIAL', 'ACTIVE', '{}', now())
      `,
      // KNOWN OPEN GAP (tracked on PR #216, not fixed here): users.username
      // is NOT NULL + UNIQUE with no database-level default, and is
      // deliberately NOT supplied by this INSERT. app/signup/page.tsx
      // never collects a username, and every other raw-SQL users INSERT
      // in this codebase (app/api/admin/users/route.ts,
      // app/actions/users.ts) treats username as a distinct,
      // separately-collected, human-chosen value — app/api/admin/users/
      // route.ts's own comment documents a prior bug where email was
      // wrongly used as a username fallback. There is no established
      // convention for deriving one at self-service signup, so this
      // statement still fails on users.username until that product
      // decision is made; left unresolved deliberately rather than
      // inventing one.
      sql`
        INSERT INTO users (id, name, email, password_hash, role, status, organisation_id, email_verified, updated_at)
        VALUES (${userId}, ${name.trim()}, ${emailLower}, ${hash}, 'ADMIN', 'ACTIVE', ${orgId}, true, now())
      `,
    ]);

    await createSession(userId, orgId, 'admin', name.trim());

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
