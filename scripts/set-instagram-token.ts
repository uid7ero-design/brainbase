import path from 'path';
import fs from 'fs';
import { neon } from '@neondatabase/serverless';

(function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
})();

const sql = neon(process.env.DATABASE_URL!);
const APP_ID = process.env.META_APP_ID!;
const APP_SECRET = process.env.META_APP_SECRET!;
const BRAINBASE_ORG_ID = '1732569e-6350-495e-aa6a-7218ce7bf749';

const pageToken = process.argv[2];
if (!pageToken) { console.error('Usage: npx tsx scripts/set-instagram-token.ts <page_access_token>'); process.exit(1); }

async function main() {
  // Exchange for long-lived token
  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${pageToken}`
  );
  const longData = await longRes.json() as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (longData.error) { console.error('Token exchange failed:', longData.error.message); process.exit(1); }
  const token = longData.access_token ?? pageToken;
  const expiresAt = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000).toISOString() : null;
  console.log('Long-lived token obtained, expires:', expiresAt ?? 'never');

  // Find connected Instagram Business Account via this Page token
  const pageId = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`).then(r => r.json()) as { id?: string; name?: string };
  console.log('Page:', pageId.name, pageId.id);

  const igRes = await fetch(`https://graph.facebook.com/v21.0/${pageId.id}?fields=instagram_business_account&access_token=${token}`).then(r => r.json()) as { instagram_business_account?: { id: string } };
  const igAccountId = igRes.instagram_business_account?.id ?? null;
  console.log('Instagram account ID:', igAccountId);

  let igUsername: string | null = null;
  if (igAccountId) {
    const nameRes = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}?fields=username&access_token=${token}`).then(r => r.json()) as { username?: string };
    igUsername = nameRes.username ?? null;
    console.log('Instagram username:', igUsername);

    // Test media fetch
    const media = await fetch(`https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,media_type,timestamp&limit=3&access_token=${token}`).then(r => r.json()) as { data?: unknown[] };
    console.log('Posts found:', media.data?.length ?? 0);
  }

  await sql.query(`
    INSERT INTO social_connections (organisation_id, platform, access_token, token_expires_at, instagram_account_id, platform_username)
    VALUES ($1, 'instagram', $2, $3, $4, $5)
    ON CONFLICT (organisation_id, platform)
    DO UPDATE SET access_token=$2, token_expires_at=$3, instagram_account_id=$4, platform_username=$5, updated_at=NOW()
  `, [BRAINBASE_ORG_ID, token, expiresAt, igAccountId, igUsername]);

  console.log('Stored successfully.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
