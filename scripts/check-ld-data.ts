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
const LD = '8ecd003b-583f-4616-a830-8dbf8aa51d2c';

async function count(table: string) {
  const r = await sql.query(`SELECT COUNT(*) AS n FROM ${table} WHERE organisation_id = $1`, [LD]);
  return (r[0] as { n: string }).n;
}

async function main() {
  const tables = [
    'tennis_leads', 'contacts', 'bookings', 'sessions',
    'session_instances', 'bin_maintenance_jobs', 'illegal_dumping',
    'missed_collections', 'debtor_accounts', 'metrics', 'uploads',
  ];
  console.log('LD Tennis org:', LD);
  for (const t of tables) {
    console.log(t.padEnd(25), await count(t));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
