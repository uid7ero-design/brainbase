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

async function count(table: string, orgId: string) {
  const r = await sql.query(`SELECT COUNT(*) AS n FROM ${table} WHERE organisation_id = $1`, [orgId]);
  return (r[0] as { n: string }).n;
}

async function main() {
  const orgs = await sql`SELECT id, name, slug, created_at FROM organisations WHERE name ILIKE '%tennis%' ORDER BY created_at`;
  console.log('\nLD Tennis orgs:');
  for (const o of orgs) {
    console.log(`\n  id:   ${o.id}\n  name: ${o.name}\n  slug: ${o.slug}\n  created: ${o.created_at}`);
    const tables = ['users', 'tennis_leads', 'contacts', 'bookings', 'sessions', 'uploads'];
    for (const t of tables) {
      const n = await count(t, o.id as string);
      if (Number(n) > 0) console.log(`    ${t}: ${n}`);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
