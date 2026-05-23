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

async function main() {
  const rows = await sql.query(`SELECT * FROM social_connections WHERE platform = 'instagram'`);
  if (!rows.length) { console.log('No Instagram connections found.'); return; }

  const conn = rows[0] as { access_token: string; instagram_account_id: string | null; platform_username: string | null };
  console.log('Stored connection:');
  console.log('  instagram_account_id:', conn.instagram_account_id);
  console.log('  platform_username:   ', conn.platform_username);
  console.log('  token (first 20):    ', conn.access_token?.slice(0, 20) + '...');

  const token = conn.access_token;

  console.log('\nChecking /me...');
  const me = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`).then(r => r.json());
  console.log('  me:', JSON.stringify(me));

  console.log('\nChecking /me/accounts (Pages)...');
  const pages = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`).then(r => r.json()) as { data?: Array<{ id: string; name: string; access_token: string }> };
  console.log('  pages:', JSON.stringify(pages.data?.map(p => ({ id: p.id, name: p.name }))));

  if (pages.data?.length) {
    for (const page of pages.data) {
      console.log(`\nChecking page ${page.name} (${page.id}) for Instagram...`);
      const ig = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`).then(r => r.json());
      console.log('  ig_business_account:', JSON.stringify(ig));
    }
  }

  if (conn.instagram_account_id) {
    console.log('\nFetching media...');
    const media = await fetch(`https://graph.facebook.com/v21.0/${conn.instagram_account_id}/media?fields=id,caption,media_type,timestamp&limit=3&access_token=${token}`).then(r => r.json());
    console.log('  media:', JSON.stringify(media));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
