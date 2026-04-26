'use server';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { createSession, deleteSession, type Role } from '@/lib/session';

export type LoginState = { error?: string } | undefined;

export async function login(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = (formData.get('username') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!username || !password) return { error: 'Username and password required.' };

  const rows = await sql`
    SELECT * FROM users
    WHERE username = ${username}
    LIMIT 1
  `;
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return { error: 'Invalid username or password.' };
  }

  if (!user.organisation_id) {
    return { error: 'Your account is not linked to an organisation. Contact your administrator.' };
  }

  await createSession(user.id, user.organisation_id, user.role as Role, user.name);
  redirect('/');
}

export async function logout() {
  await deleteSession();
  redirect('/login');
}
