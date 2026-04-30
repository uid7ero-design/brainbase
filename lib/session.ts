import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export type Role = 'super_admin' | 'admin' | 'manager' | 'viewer';

export type SessionPayload = {
  userId: string;
  organisationId: string;
  role: Role;
  name: string;
  expiresAt: string;
};

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
