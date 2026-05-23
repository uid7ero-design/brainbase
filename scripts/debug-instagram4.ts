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

async function main() {
  const rows = await sql.query(`SELECT access_token FROM social_connections WHERE platform = 'instagram' LIMIT 1`);
  const token = (rows[0] as { access_token: string }).access_token;

  // Try different page listing endpoints
  const endpoints = [
    `https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`,
    `https://graph.facebook.com/v21.0/me?fields=name,id,accounts{name,id,instagram_business_account}&access_token=${token}`,
    `https://graph.facebook.com/v21.0/me?fields=name,id&access_token=${token}`,
  ];

  for (const url of endpoints) {
    const path = url.split('facebook.com/v21.0')[1].split('?')[0];
    console.log(`\n${path}:`);
    const r = await fetch(url).then(r => r.json());
    console.log(JSON.stringify(r, null, 2));
  }

  // Try app access token to look up the page directly
  console.log('\nTrying app token to look up Brainbase page by name...');
  const appToken = `${APP_ID}|${APP_SECRET}`;
  const search = await fetch(`https://graph.facebook.com/v21.0/pages/search?q=Brainbase&access_token=${appToken}`).then(r => r.json());
  console.log(JSON.stringify(search, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
