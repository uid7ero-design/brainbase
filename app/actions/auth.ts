'use server';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession, deleteSession, getSession, type Role } from '@/lib/session';

export type LoginState = { error?: string; redirectTo?: string } | undefined;

export async function login(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = (formData.get('username') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  const result = await sql`SELECT * FROM users WHERE username = ${username}`;
  const user = result[0];

  if (!user) {
    return { error: 'Invalid username or password.' };
  }

  const valid = await bcrypt.compare(password, user.password_hash as string);
  if (!valid) {
    return { error: 'Invalid username or password.' };
  }

  await createSession(
    user.id as string,
    user.organisation_id as string,
    user.role as Role,
    user.name as string,
  );

  const ldTennisOrgId = process.env.LD_TENNIS_ORG_ID ?? '';
  const redirectTo = user.role === 'super_admin'
    ? '/admin/founder'
    : (ldTennisOrgId && user.organisation_id === ldTennisOrgId) ? '/dashboard/leads' : '/dashboard';

  return { redirectTo };
}

export async function logout() {
  const session = await getSession();
  await deleteSession();
  const ldTennisOrgId = process.env.LD_TENNIS_ORG_ID ?? '';
  if (ldTennisOrgId && session?.organisationId === ldTennisOrgId) redirect('/tennis');
  redirect('/login');
}
