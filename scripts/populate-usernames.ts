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
  const users = await sql`SELECT id, email FROM users WHERE username IS NULL`;
  console.log(`${users.length} users need a username`);
  for (const u of users) {
    const derived = ((u.email as string) || '').split('@')[0].replace(/[^a-z0-9_.-]/gi, '').toLowerCase() || (u.id as string).slice(0, 8);
    await sql`UPDATE users SET username = ${derived} WHERE id = ${u.id as string}`;
    console.log(`  ${u.email} → ${derived}`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
