'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession, deleteSession, type Role } from '@/lib/session';
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit';

export type LoginState = { error?: string; unverified?: boolean } | undefined;

export async function login(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = (formData.get('username') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!username || !password) return { error: 'Username and password required.' };

  const ip = ((await headers()).get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!checkRateLimit(`login:${ip}`, 10, 15 * 60_000)) {
    return { error: 'Too many login attempts. Please wait 15 minutes and try again.' };
  }

  const rows = await sql`SELECT * FROM users WHERE username = ${username} OR email = ${username} LIMIT 1`;
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash as string))) {
    return { error: 'Invalid username or password.' };
  }

  if (!user.organisation_id) {
    return { error: 'Account not linked to an organisation. Contact your administrator.' };
  }

  // Email verification gate — only blocks if email is present and unverified
  if (user.email && !user.email_verified) {
    return {
      error: 'Please verify your email address before signing in.',
      unverified: true,
    };
  }

  resetRateLimit(`login:${ip}`);
  await createSession(
    user.id as string,
    user.organisation_id as string,
    user.role as Role,
    user.name as string,
  );

  const ldTennisOrgId = process.env.LD_TENNIS_ORG_ID ?? '';
  const landingRoute = (ldTennisOrgId && user.organisation_id === ldTennisOrgId)
    ? '/dashboard/leads'
    : '/dashboard';
  redirect(landingRoute);
}

export async function logout() {
  await deleteSession();
  redirect('/login');
}
