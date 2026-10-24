import 'server-only';
import sql from '@/lib/db';
import { parsePermissions, type UserPermissions } from './policy';

export async function getUserPermissions(organisationId: string, userId: string): Promise<UserPermissions | null> {
  const rows = await sql`SELECT permissions,organisation_id FROM organisation_user_access WHERE user_id=${userId}`;
  if(rows.length && rows[0].organisation_id!==organisationId) throw new Error('Access organisation mismatch');
  return rows.length ? parsePermissions(rows[0].permissions) : null;
}

export async function visibleCapabilities(organisationId: string, userId: string, role: string) {
  const rows = await sql`SELECT m.key,m.name FROM modules m JOIN organisation_modules om ON om.module_key=m.key
    WHERE om.organisation_id=${organisationId} AND om.enabled=true AND m.active=true ORDER BY m.name`;
  if (role === 'super_admin') return rows;
  const permissions = await getUserPermissions(organisationId, userId);
  return permissions === null ? rows : rows.filter(row => ['view', 'use'].includes(permissions[row.key as keyof UserPermissions] ?? 'none'));
}
