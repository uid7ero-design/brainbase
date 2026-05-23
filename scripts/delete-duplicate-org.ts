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
const PHANTOM = '0c0397b1-a9a6-4ae5-86f5-283aeb502e73';

async function main() {
  // Delete users in the phantom org first
  const users = await sql.query(`SELECT id, name, email FROM users WHERE organisation_id = $1`, [PHANTOM]);
  for (const u of users) {
    console.log(`Deleting user: ${u.id} (${u.name} / ${u.email})`);
  }
  await sql.query(`DELETE FROM users WHERE organisation_id = $1`, [PHANTOM]);
  console.log(`Deleted ${users.length} user(s).`);

  // Delete the org
  await sql.query(`DELETE FROM organisations WHERE id = $1`, [PHANTOM]);
  console.log(`Deleted phantom org ${PHANTOM}.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
