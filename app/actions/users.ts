'use server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession, type Role } from '@/lib/session';
import { revalidatePath } from 'next/cache';

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') throw new Error('Unauthorized');
}

export type UserFormState = { error?: string; success?: string } | undefined;

export async function createUser(prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireSuperAdmin();

  const name = (formData.get('name') as string)?.trim();
  const username = (formData.get('username') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;
  const role = formData.get('role') as Role;
  const orgId = formData.get('orgId') as string;

  const validRoles: Role[] = ['super_admin', 'admin', 'manager', 'viewer'];
  if (!name || !username || !password || !validRoles.includes(role) || !orgId) {
    return { error: 'All fields required and role must be valid.' };
  }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };

  const existing = await sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`;
  if (existing.length > 0) return { error: 'Username already taken.' };

  const passwordHash = await bcrypt.hash(password, 12);
  await sql`INSERT INTO users (username, password_hash, name, role, organisation_id) VALUES (${username}, ${passwordHash}, ${name}, ${role}, ${orgId})`;

  revalidatePath('/admin/users');
  return { success: `User "${name}" created.` };
}

export async function updateUserRole(userId: string, role: Role) {
  await requireSuperAdmin();
  const validRoles: Role[] = ['super_admin', 'admin', 'manager', 'viewer'];
  if (!validRoles.includes(role)) throw new Error('Invalid role');
  await sql`UPDATE users SET role = ${role}, updated_at = NOW() WHERE id = ${userId}`;
  revalidatePath('/admin/users');
}

export async function resetUserPassword(prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireSuperAdmin();
  const userId = formData.get('userId') as string;
  const password = formData.get('password') as string;
  if (!userId || !password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  const passwordHash = await bcrypt.hash(password, 12);
  await sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW() WHERE id = ${userId}`;
  revalidatePath('/admin/users');
  return { success: 'Password updated.' };
}

export async function updateUserDetails(prevState: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireSuperAdmin();
  const userId = formData.get('userId') as string;
  const name = (formData.get('name') as string)?.trim();
  const username = (formData.get('username') as string)?.trim().toLowerCase();
  if (!userId || !name || !username) return { error: 'All fields required.' };

  const existing = await sql`SELECT id FROM users WHERE username = ${username} AND id != ${userId} LIMIT 1`;
  if (existing.length > 0) return { error: 'Username already taken.' };

  await sql`UPDATE users SET name = ${name}, username = ${username}, updated_at = NOW() WHERE id = ${userId}`;
  revalidatePath('/admin/users');
  return { success: 'User updated.' };
}

export async function deleteUser(userId: string) {
  await requireSuperAdmin();
  const session = await getSession();
  if (session?.userId === userId) throw new Error('Cannot delete your own account.');
  await sql`DELETE FROM users WHERE id = ${userId}`;
  revalidatePath('/admin/users');
}
