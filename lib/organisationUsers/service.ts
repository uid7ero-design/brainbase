import 'server-only';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import { BASE_URL, emailLayout, escHtml, sendEmail } from '@/lib/email';
import { CLIENT_ROLES, parsePermissions, USER_MODULES } from './policy';

export class UserAdministrationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function listOrganisationUsers(actor: OrgSession) {
  if (!['admin', 'super_admin'].includes(actor.role)) throw new UserAdministrationError(403, 'Organisation administrator access required.');
  const users = await sql`SELECT u.id,u.name,u.username,u.email,u.role,u.status,a.permissions,
      i.expires_at AS invitation_expires_at,i.accepted_at AS invitation_accepted_at
    FROM users u LEFT JOIN organisation_user_access a ON a.user_id=u.id AND a.organisation_id=u.organisation_id
    LEFT JOIN organisation_user_invitations i ON i.user_id=u.id AND i.organisation_id=u.organisation_id
    WHERE u.organisation_id=${actor.organisationId} AND u.role<>'SUPER_ADMIN' ORDER BY u.name,u.id`;
  const modules = await sql`SELECT m.key,m.name FROM modules m JOIN organisation_modules om ON om.module_key=m.key
    WHERE om.organisation_id=${actor.organisationId} AND om.enabled=true AND m.active=true ORDER BY m.name`;
  return { users, modules: modules.filter(m => m.key in USER_MODULES), currentUserId: actor.userId };
}

export async function saveOrganisationUser(actor: OrgSession, input: unknown) {
  if (!['admin', 'super_admin'].includes(actor.role)) throw new UserAdministrationError(403, 'Organisation administrator access required.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserAdministrationError(400, 'Invalid request.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(k => !['action','id','name','email','role','status','permissions'].includes(k))) throw new UserAdministrationError(400, 'Unexpected field.');
  const action = body.action;
  if (!['invite','update','resend'].includes(String(action))) throw new UserAdministrationError(400, 'Invalid action.');
  const creating = action === 'invite';
  const id = creating ? randomUUID() : typeof body.id === 'string' ? body.id : '';
  if (!id || id === actor.userId) throw new UserAdministrationError(400, 'Ask another administrator to change your own access.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = String(body.role ?? '').toLowerCase();
  const status = body.status === 'ACTIVE' ? 'ACTIVE' : body.status === 'INACTIVE' ? 'INACTIVE' : '';
  let permissions;
  try { permissions = parsePermissions(body.permissions); } catch { throw new UserAdministrationError(400, 'Choose valid module permissions.'); }
  if (!name || name.length>200 || !CLIENT_ROLES.includes(role as typeof CLIENT_ROLES[number])) throw new UserAdministrationError(400, 'Name and a valid organisation role are required.');
  if (creating && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)) throw new UserAdministrationError(400, 'Enter a valid email address.');
  if (action === 'update' && !status) throw new UserAdministrationError(400, 'Choose Active or Inactive.');
  const enabled = await sql`SELECT m.key FROM modules m JOIN organisation_modules om ON m.key=om.module_key
    WHERE om.organisation_id=${actor.organisationId} AND om.enabled=true AND m.active=true`;
  if (Object.entries(permissions).some(([key,level]) => level !== 'none' && !enabled.some(row=>row.key===key))) throw new UserAdministrationError(400, 'Permissions must be within your organisation’s enabled modules.');
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  // Invited accounts have an unknowable password until single-use acceptance.
  const passwordHash = creating ? await bcrypt.hash(randomBytes(32).toString('hex'), 12) : '';
  const auditId = randomUUID();
  const [, result] = await sql.transaction(tx => [
    tx`SELECT pg_advisory_xact_lock(hashtextextended(${`organisation-users:${actor.organisationId}`},0))`,
    tx`WITH actor AS MATERIALIZED (
      SELECT id FROM users WHERE id=${actor.userId} AND status='ACTIVE'
        AND (role='SUPER_ADMIN' OR (organisation_id=${actor.organisationId} AND role='ADMIN'))
        AND EXISTS(SELECT 1 FROM organisations WHERE id=${actor.organisationId} AND status='ACTIVE')
    ), target AS MATERIALIZED (
      SELECT * FROM users WHERE id=${id} AND organisation_id=${actor.organisationId} AND role<>'SUPER_ADMIN' FOR UPDATE
    ), eligible AS MATERIALIZED (
      SELECT 1 WHERE EXISTS(SELECT 1 FROM actor)
      AND NOT EXISTS(SELECT 1 FROM organisation_user_access WHERE user_id=${id} AND organisation_id<>${actor.organisationId})
      AND NOT EXISTS(SELECT 1 FROM organisation_user_invitations WHERE user_id=${id} AND organisation_id<>${actor.organisationId})
      AND (${action === 'update'} OR (SELECT count(*) FROM audit_logs WHERE organisation_id=${actor.organisationId}
        AND action IN ('organisation_user.invite','organisation_user.resend') AND created_at>now()-interval '1 hour')<20)
      AND (
        (${creating} AND NOT EXISTS(SELECT 1 FROM users WHERE lower(email)=${email} OR lower(username)=${email}))
        OR (NOT ${creating} AND EXISTS(SELECT 1 FROM target) AND (
          ${action !== 'resend'} OR EXISTS(SELECT 1 FROM target WHERE status='INVITED')
        ) AND NOT (
          ${action === 'update'} AND EXISTS(SELECT 1 FROM target WHERE role='ADMIN' AND status='ACTIVE')
          AND (${role !== 'admin'} OR ${status !== 'ACTIVE'})
          AND (SELECT count(*) FROM users WHERE organisation_id=${actor.organisationId} AND role='ADMIN' AND status='ACTIVE')<=1
        ))
      )
    ), inserted AS (
      INSERT INTO users(id,organisation_id,username,email,name,role,status,password_hash,created_at,updated_at)
      SELECT ${id},${actor.organisationId},${email},${email},${name},${role.toUpperCase()}::"UserRole",'INVITED',${passwordHash},now(),now()
      FROM eligible WHERE ${creating} RETURNING id,email,name,role::text,status::text
    ), updated AS (
      UPDATE users SET name=${name},role=${role.toUpperCase()}::"UserRole",
        status=CASE WHEN ${status === 'INACTIVE'} THEN 'INACTIVE'::"UserStatus"
          WHEN EXISTS(SELECT 1 FROM organisation_user_invitations WHERE user_id=users.id AND accepted_at IS NULL) THEN 'INVITED'::"UserStatus"
          ELSE 'ACTIVE'::"UserStatus" END,updated_at=now()
      WHERE id=${id} AND organisation_id=${actor.organisationId} AND EXISTS(SELECT 1 FROM eligible) AND ${action === 'update'}
      RETURNING id,email,name,role::text,status::text
    ), changed AS MATERIALIZED (
      SELECT * FROM inserted UNION ALL SELECT * FROM updated
      UNION ALL SELECT id,email,name,role::text,status::text FROM target WHERE ${action === 'resend'} AND EXISTS(SELECT 1 FROM eligible)
    ), policy AS (
      INSERT INTO organisation_user_access(user_id,organisation_id,permissions,updated_by)
      SELECT id,${actor.organisationId},${JSON.stringify(permissions)}::jsonb,${actor.userId} FROM changed
      WHERE ${action !== 'resend'}
      ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions,updated_at=now(),updated_by=EXCLUDED.updated_by
      WHERE organisation_user_access.organisation_id=EXCLUDED.organisation_id RETURNING user_id
    ), invitation AS (
      INSERT INTO organisation_user_invitations(user_id,organisation_id,token_hash,expires_at,created_by)
      SELECT id,${actor.organisationId},${hash},now()+interval '48 hours',${actor.userId} FROM changed WHERE ${action !== 'update'}
      ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,accepted_at=NULL,created_at=now(),created_by=EXCLUDED.created_by
      WHERE organisation_user_invitations.organisation_id=EXCLUDED.organisation_id RETURNING user_id
    ), audit AS (
      INSERT INTO audit_logs(id,organisation_id,user_id,action,resource_type,resource_id,before_state,after_state)
      SELECT ${auditId},${actor.organisationId},${actor.userId},${`organisation_user.${action}`},'user',id,
        (SELECT jsonb_build_object('role',role,'status',status) FROM target),
        jsonb_build_object('role',role,'status',status,'permissions',${JSON.stringify(permissions)}::jsonb)
      FROM changed RETURNING id
    ) SELECT changed.id,changed.email,changed.name FROM changed WHERE EXISTS(SELECT 1 FROM audit)
      AND (${action === 'resend'} OR EXISTS(SELECT 1 FROM policy))
      AND (${action === 'update'} OR EXISTS(SELECT 1 FROM invitation))`,
  ]);
  const user = result[0];
  if (!user) throw new UserAdministrationError(409, 'The change could not be saved. Check current access, account details and the last active administrator.');
  let delivery: 'not_requested'|'sent'|'unconfirmed' = 'not_requested';
  if (action !== 'update') {
    try {
      const link = `${BASE_URL}/accept-invitation#token=${encodeURIComponent(token)}`;
      const sent = await sendEmail({ to: String(user.email), subject: 'Your BrainBase organisation invitation',
        html: emailLayout(`<h2>You have been invited to BrainBase</h2><p>Hello ${escHtml(String(user.name))},</p><p>Set your password to join your organisation. This link expires in 48 hours. Your username is ${escHtml(String(user.email))}.</p><p><a href="${escHtml(link)}">Accept invitation and set password</a></p>`) });
      delivery = sent.status === 'sent' ? 'sent' : 'unconfirmed';
    } catch { delivery = 'unconfirmed'; }
  }
  return { id: user.id, delivery };
}

export async function acceptOrganisationInvitation(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length<12 || password.length>200) throw new UserAdministrationError(400, 'Use a valid invitation and a password of 12–200 characters.');
  const hash = await bcrypt.hash(password,12);
  const tokenDigest = tokenHash(token);
  const [, result] = await sql.transaction(tx => [
    tx`SELECT pg_advisory_xact_lock(hashtextextended(${`organisation-invitation:${tokenDigest}`},0))`,
    tx`WITH invitation AS MATERIALIZED (
      SELECT i.user_id,i.organisation_id FROM organisation_user_invitations i
      JOIN users u ON u.id=i.user_id AND u.organisation_id=i.organisation_id
      JOIN organisations o ON o.id=i.organisation_id
      WHERE i.token_hash=${tokenDigest} AND i.accepted_at IS NULL AND i.expires_at>now()
        AND u.status='INVITED' AND o.status='ACTIVE' FOR UPDATE OF i,u
    ), changed AS (
      UPDATE users SET password_hash=${hash},status='ACTIVE',email_verified=true,updated_at=now()
      WHERE id IN(SELECT user_id FROM invitation) RETURNING id,organisation_id
    ), consumed AS (
      UPDATE organisation_user_invitations SET accepted_at=now() WHERE token_hash=${tokenDigest}
        AND user_id IN(SELECT id FROM changed) RETURNING user_id
    ), audit AS (
      INSERT INTO audit_logs(id,organisation_id,user_id,action,resource_type,resource_id,after_state)
      SELECT ${randomUUID()},organisation_id,id,'organisation_user.invitation_accepted','user',id,'{"status":"ACTIVE"}'::jsonb FROM changed RETURNING id
    ) SELECT id FROM changed WHERE EXISTS(SELECT 1 FROM consumed) AND EXISTS(SELECT 1 FROM audit)`,
  ]);
  if (!result.length) throw new UserAdministrationError(400, 'This invitation is invalid, expired or already used. Ask your administrator for a new invitation.');
  return { ok: true };
}
