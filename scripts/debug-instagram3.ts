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

  console.log('Checking granted permissions...');
  const perms = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`).then(r => r.json()) as { data?: Array<{ permission: string; status: string }> };
  console.log(JSON.stringify(perms.data, null, 2));

  console.log('\nTrying /me/accounts with limit...');
  const pages = await fetch(`https://graph.facebook.com/v21.0/me/accounts?limit=20&access_token=${token}`).then(r => r.json());
  console.log(JSON.stringify(pages, null, 2));

  // Try business account lookup
  console.log('\nTrying business scoped account...');
  const biz = await fetch(`https://graph.facebook.com/v21.0/me?fields=businesses&access_token=${token}`).then(r => r.json());
  console.log(JSON.stringify(biz, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
