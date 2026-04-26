'use server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export type OrgFormState = { error?: string; success?: string } | undefined;

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') throw new Error('Unauthorized');
}

function toSlug(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export async function createOrg(prevState: OrgFormState, formData: FormData): Promise<OrgFormState> {
  await requireSuperAdmin();
  const name = (formData.get('name') as string)?.trim();
  const slug = toSlug(formData.get('slug') as string ?? '');
  if (!name || !slug) return { error: 'Name and slug are required.' };

  const existing = await sql`SELECT id FROM organisations WHERE slug = ${slug} LIMIT 1`;
  if (existing.length > 0) return { error: 'That slug is already taken.' };

  await sql`INSERT INTO organisations (name, slug) VALUES (${name}, ${slug})`;
  revalidatePath('/admin/orgs');
  return { success: `Organisation "${name}" created.` };
}

export async function updateOrg(prevState: OrgFormState, formData: FormData): Promise<OrgFormState> {
  await requireSuperAdmin();
  const orgId = formData.get('orgId') as string;
  const name = (formData.get('name') as string)?.trim();
  const slug = toSlug(formData.get('slug') as string ?? '');
  if (!orgId || !name || !slug) return { error: 'All fields required.' };

  const existing = await sql`SELECT id FROM organisations WHERE slug = ${slug} AND id != ${orgId} LIMIT 1`;
  if (existing.length > 0) return { error: 'That slug is already taken.' };

  await sql`UPDATE organisations SET name = ${name}, slug = ${slug} WHERE id = ${orgId}`;
  revalidatePath('/admin/orgs');
  return { success: 'Organisation updated.' };
}

export async function deleteOrg(orgId: string): Promise<{ error?: string }> {
  await requireSuperAdmin();
  const users = await sql`SELECT COUNT(*) AS count FROM users WHERE organisation_id = ${orgId}`;
  if (Number(users[0].count) > 0) return { error: 'Remove all users from this organisation before deleting it.' };
  await sql`DELETE FROM organisations WHERE id = ${orgId}`;
  revalidatePath('/admin/orgs');
  return {};
}
