import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession } from '@/lib/session';

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
}

export async function POST(req: NextRequest) {
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
  const slug       = slugify(orgName.trim());
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    // Create org with trial status
    const uniqueSlug = `${slug}-${Math.floor(Math.random() * 9000) + 1000}`;
    const [org] = await sql`
      INSERT INTO organisations (name, slug, plan, trial_ends_at)
      VALUES (${orgName.trim()}, ${uniqueSlug}, 'trial', ${trialEndsAt.toISOString()})
      RETURNING id
    `;

    const hash = await bcrypt.hash(password, 12);

    const [user] = await sql`
      INSERT INTO users (username, name, email, password_hash, role, organisation_id, email_verified)
      VALUES (
        ${emailLower},
        ${name.trim()},
        ${emailLower},
        ${hash},
        'admin',
        ${org.id}::uuid,
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
