'use server';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { getSession, createSession, type Role } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { revokeUserSessionsQuery } from '@/lib/ticketing/sessionRevocation';

export async function updateSecureMode(enabled: boolean): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await sql`
    UPDATE users
    SET preferences = preferences || ${JSON.stringify({ secure_mode: enabled })}::jsonb,
        updated_at = NOW()
    WHERE id = ${session.userId}
  `;
  revalidatePath('/profile');
}

export type ProfileState = { error?: string; success?: string } | undefined;

export async function updateProfile(prevState: ProfileState, formData: FormData): Promise<ProfileState> {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated.' };

  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Name is required.' };

  await sql`UPDATE users SET name = ${name}, updated_at = NOW() WHERE id = ${session.userId}`;
  await createSession(session.userId, session.organisationId, session.role as Role, name);
  revalidatePath('/profile');
  return { success: 'Name updated.' };
}

export async function updatePassword(prevState: ProfileState, formData: FormData): Promise<ProfileState> {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated.' };

  const current = formData.get('current') as string;
  const next = formData.get('password') as string;
  const confirm = formData.get('confirm') as string;

  if (!current || !next || !confirm) return { error: 'All fields required.' };
  if (next !== confirm) return { error: 'New passwords do not match.' };
  if (next.length < 8) return { error: 'Password must be at least 8 characters.' };

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${session.userId}`;
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
    return { error: 'Current password is incorrect.' };
  }

  const hash = await bcrypt.hash(next, 12);
  // Eve (ticketing) sessions of this user are revoked in the SAME transaction as
  // the password write: both happen or neither does, so a failure is reported
  // instead of leaving stale Eve sessions active behind a "success".
  try {
    await sql.transaction([
      sql`UPDATE users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${session.userId}`,
      revokeUserSessionsQuery(session.userId),
    ]);
  } catch {
    return { error: 'Your password could not be updated. Please try again.' };
  }
  return { success: 'Password updated.' };
}
