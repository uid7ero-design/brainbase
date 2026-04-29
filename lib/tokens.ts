import 'server-only';
import { randomBytes } from 'crypto';
import sql from '@/lib/db';

export type TokenType = 'verify' | 'reset';

export async function createToken(
  userId: string,
  type: TokenType,
  ttlMs = 24 * 60 * 60_000,
): Promise<string> {
  const token = randomBytes(32).toString('hex'); // 64 hex chars, 256-bit entropy
  const expiresAt = new Date(Date.now() + ttlMs);

  await sql`
    INSERT INTO email_tokens (user_id, token, type, expires_at)
    VALUES (${userId}, ${token}, ${type}, ${expiresAt.toISOString()})
  `;
  return token;
}

/**
 * Atomically marks the token used and returns the user_id.
 * Returns null if token not found, already used, or expired.
 */
export async function consumeToken(token: string, type: TokenType): Promise<string | null> {
  const rows = await sql`
    UPDATE email_tokens
    SET used_at = NOW()
    WHERE token   = ${token}
      AND type    = ${type}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING user_id
  `;
  return (rows[0]?.user_id as string) ?? null;
}
