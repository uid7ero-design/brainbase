import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// Phase C1.6: 'analyst' added for type coherence with the real Postgres
// `UserRole` enum (prisma/schema.prisma: SUPER_ADMIN, ADMIN, MANAGER,
// ANALYST, VIEWER — confirmed via direct schema/DDL inspection, matching
// tests/containment/adminUsersRoleCasing.test.ts's own documented,
// DB-verified enum label set). Before this fix, Role only had 4 of the 5
// real DB values — a user row genuinely CAN hold role = 'ANALYST' (nothing
// in the schema prevents it), and app/actions/auth.ts's login flow casts
// `user.role` straight from the DB with NO runtime validation
// (`(user.role as string).toLowerCase() as Role`), so such a user could
// already log in successfully today, with role='analyst' embedded in a
// real, valid session JWT — TypeScript's `as Role` cast catches nothing at
// runtime. This addition makes the type honest about what the DB can
// actually produce; it deliberately does NOT add 'analyst' anywhere that
// implies a decided privilege level (ROLE_ORDER below, the admin user-
// management UI's role selector, or the create/update role-validation
// allowlist in app/api/admin/users/route.ts) — no evidence anywhere in
// this codebase establishes where Analyst should sit in the privilege
// hierarchy, or whether any real user currently holds it, and neither
// question can be answered without live production data. Per the explicit
// governing principle for this exact situation ("prefer additive
// compatibility over destructive removal" when live usage can't be
// verified): 'analyst' is recognised, never silently rejected by the type
// system, and — via roleGte()'s deliberate fail-closed handling below of
// any role absent from ROLE_ORDER — safely denied every privileged action
// until a future phase makes an explicit, evidence-based placement
// decision. This is unchanged runtime behaviour (an unrecognised role
// already failed every roleGte() check before this fix, via an accidental
// array .indexOf() === -1 quirk); the difference is that it is now an
// intentional, documented, tested guarantee instead of one.
export type Role = 'super_admin' | 'admin' | 'manager' | 'viewer' | 'analyst';

export type SessionPayload = {
  userId: string;
  organisationId: string;
  role: Role;
  name: string;
  expiresAt: string;
};

// Role order — higher index = more privilege. Deliberately omits 'analyst'
// — see the Role type's own comment above for why. roleGte() must return
// false for a role not present here in every comparison, including against
// the lowest defined role ('viewer') — never throw, and never be silently
// "close enough" to any defined role.
export const ROLE_ORDER: Role[] = ['viewer', 'manager', 'admin', 'super_admin'];

export function roleGte(role: Role, min: Role): boolean {
  const roleIdx = ROLE_ORDER.indexOf(role);
  const minIdx = ROLE_ORDER.indexOf(min);
  // Fail closed on EITHER side being outside ROLE_ORDER — not just `role`.
  // If only `role` were checked, an undefined `min` (e.g. a future,
  // unreflected-on `requireRole('analyst')` call) would fall through to
  // `roleIdx >= -1`, which every real role satisfies — silently granting
  // access instead of denying it. An undefined threshold must deny by
  // default, exactly like an undefined role does.
  if (roleIdx === -1 || minIdx === -1) return false;
  return roleIdx >= minIdx;
}

export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;  // 12 hours
export const REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000;  // refresh if < 2h remaining

const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);

export const COOKIE_OPTIONS = (expiresAt: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  expires: expiresAt,
  sameSite: 'lax' as const,
  path: '/',
});

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret);
}

export async function decrypt(token: string | undefined = ''): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, organisationId: string, role: Role, name: string) {
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const token = await encrypt({ userId, organisationId, role, name, expiresAt: expiresAt.toISOString() });
  const cookieStore = await cookies();
  cookieStore.set('session', token, COOKIE_OPTIONS(expiresAt));
}

export async function refreshSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  const session = await decrypt(token);
  if (!session) return false;
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const newToken = await encrypt({ ...session, expiresAt: expiresAt.toISOString() });
  cookieStore.set('session', newToken, COOKIE_OPTIONS(expiresAt));
  return true;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  return decrypt(token);
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}
