/**
 * Restores the BrainBase org + admin user after a DB reset.
 * Run with:
 *   npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' --transpile-only scripts/restore-user.ts
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

// Load .env.local (the app's live DB), falling back to .env
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

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — check .env.local');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// LD Tennis org (existing client — keep its known UUID)
// ⚠️ UNVERIFIED: scripts/delete-duplicate-org.ts labels this exact UUID
// `PHANTOM` and deletes it + its users. scripts/check-ld-data.ts uses a
// different UUID (8ecd003b-583f-4616-a830-8dbf8aa51d2c) for "the" LD Tennis
// org. Confirm which UUID is actually live (match the production
// LD_TENNIS_ORG_ID env var against /admin/orgs) before running this — it
// may otherwise recreate a deleted duplicate organisation.
const LD_ORG_ID   = '0c0397b1-a9a6-4ae5-86f5-283aeb502e73';
const LD_ORG_NAME = 'LD Tennis';
const LD_ORG_SLUG = 'ld-tennis';

// BrainBase platform org (super admin home)
const BB_ORG_ID   = 'bb000000-0000-0000-0000-000000000001';
const BB_ORG_NAME = 'BrainBase';
const BB_ORG_SLUG = 'brainbase';

const ADMIN_EMAIL  = 'uid7ero@gmail.com';
const ADMIN_NAME   = 'James Palmer';
const TEMP_PASS    = 'BrainBase2025!';

async function upsertOrg(id: string, name: string, slug: string, plan = 'PROFESSIONAL') {
  await sql`
    INSERT INTO organisations (id, name, slug, plan, status, settings, created_at, updated_at)
    VALUES (${id}, ${name}, ${slug}, ${plan}, 'ACTIVE', '{}', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
  `;
  console.log('✅ Org:', name, id);
}

async function upsertUser(email: string, name: string, hash: string, role: string, orgId: string) {
  await sql`
    INSERT INTO users (id, name, email, password_hash, role, status, organisation_id, email_verified, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${name}, ${email}, ${hash}, ${role}, 'ACTIVE', ${orgId}, true, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      password_hash   = EXCLUDED.password_hash,
      role            = EXCLUDED.role,
      organisation_id = EXCLUDED.organisation_id,
      updated_at      = NOW()
  `;
  console.log('✅ User:', email, `(${role})`);
}

async function main() {
  console.log('\n── Orgs ────────────────────────────────────────');
  await upsertOrg(LD_ORG_ID,  LD_ORG_NAME,  LD_ORG_SLUG);
  await upsertOrg(BB_ORG_ID,  BB_ORG_NAME,  BB_ORG_SLUG);

  console.log('\n── Hashing password ────────────────────────────');
  const hash = await bcrypt.hash(TEMP_PASS, 12);

  console.log('\n── Users ───────────────────────────────────────');
  // Same email — super_admin in BrainBase org (role comparison is now case-insensitive)
  await upsertUser(ADMIN_EMAIL, ADMIN_NAME, hash, 'SUPER_ADMIN', BB_ORG_ID);

  console.log('\n══════════════════════════════════════════════');
  console.log('  Login at: http://localhost:3000/login');
  console.log('  Email:   ', ADMIN_EMAIL);
  console.log('  Password:', TEMP_PASS);
  console.log('  → Redirects to /admin/founder (super admin)');
  console.log('══════════════════════════════════════════════\n');
}

main().catch(e => { console.error(e); process.exit(1); });
