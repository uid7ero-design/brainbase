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
  await sql.query(`
    CREATE TABLE IF NOT EXISTS social_connections (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      access_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ,
      platform_user_id TEXT,
      platform_username TEXT,
      instagram_account_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(organisation_id, platform)
    )
  `);
  console.log('social_connections table ready.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
