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
  const rows = await sql.query(`SELECT access_token FROM social_connections WHERE platform = 'instagram' LIMIT 1`);
  const token = (rows[0] as { access_token: string }).access_token;

  const r = await fetch(`https://graph.facebook.com/v21.0/me?fields=instagram_accounts&access_token=${token}`);
  const data = await r.json();
  console.log('instagram_accounts:', JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
