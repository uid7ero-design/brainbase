/**
 * Upserts the super_admin user in brainbase-db.
 * Run with:
 *   $env:DATABASE_URL="...brainbase-db..."; $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","esModuleInterop":true}'; npx ts-node --skipProject --transpile-only scripts/upsert-superadmin.ts
 */
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

(function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    console.log(`Loaded ${name}`);
    break;
  }
})();

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = neon(process.env.DATABASE_URL);

// Existing Brainbase org in brainbase-db
const BB_ORG_ID = '1732569e-6350-495e-aa6a-7218ce7bf749';

const ADMIN_EMAIL = 'uid7ero@gmail.com';
const ADMIN_NAME  = 'James Palmer';
const TEMP_PASS   = 'BrainBase2025!';

async function main() {
  const hash = await bcrypt.hash(TEMP_PASS, 12);
  await sql`
    INSERT INTO users (id, name, email, password_hash, role, status, organisation_id, email_verified, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${ADMIN_NAME}, ${ADMIN_EMAIL}, ${hash}, 'SUPER_ADMIN', 'ACTIVE', ${BB_ORG_ID}, true, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      password_hash   = EXCLUDED.password_hash,
      role            = EXCLUDED.role,
      organisation_id = EXCLUDED.organisation_id,
      name            = EXCLUDED.name,
      updated_at      = NOW()
  `;
  console.log('✅ User upserted:', ADMIN_EMAIL, '(SUPER_ADMIN)');
  console.log('\n  Login: http://localhost:3000/login');
  console.log('  Email:', ADMIN_EMAIL);
  console.log('  Pass: ', TEMP_PASS);
}

main().catch(e => { console.error(e); process.exit(1); });
