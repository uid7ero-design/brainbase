/**
 * check-both-dbs.ts
 *
 * Run:
 *   HLNA_DATABASE_URL="postgresql://..." BRAINBASE_DATABASE_URL="postgresql://..." \
 *   npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' \
 *   --transpile-only scripts/check-both-dbs.ts
 */

import { neon } from '@neondatabase/serverless';

const HLNA_URL      = process.env.HLNA_DATABASE_URL;
const BRAINBASE_URL = process.env.BRAINBASE_DATABASE_URL;

const LINE = '═'.repeat(52);

type OrgRow = { id: string; name: string };

async function main() {
  if (!HLNA_URL)      throw new Error('HLNA_DATABASE_URL env var is not set');
  if (!BRAINBASE_URL) throw new Error('BRAINBASE_DATABASE_URL env var is not set');

  console.log(`\n${LINE}`);
  console.log('DB CROSS-CHECK — City of Onkaparinga');
  console.log(`${LINE}\n`);

  const hlnaSQL      = neon(HLNA_URL);
  const brainbaseSQL = neon(BRAINBASE_URL);

  const [hlnaRows, brainbaseRows] = await Promise.all([
    hlnaSQL`SELECT id, name FROM organisations WHERE name ILIKE '%onkaparinga%'` as unknown as Promise<OrgRow[]>,
    brainbaseSQL`SELECT id, name FROM organisations WHERE name ILIKE '%onkaparinga%'` as unknown as Promise<OrgRow[]>,
  ]);

  const hlna      = hlnaRows[0]      ?? null;
  const brainbase = brainbaseRows[0] ?? null;

  console.log('HLNA Database — City of Onkaparinga:');
  if (hlna) {
    console.log(`  Name : ${hlna.name}`);
    console.log(`  UUID : ${hlna.id}`);
  } else {
    console.log('  ⚠️  Not found');
  }

  console.log('');
  console.log('BRAINBASE-DB Database — City of Onkaparinga:');
  if (brainbase) {
    console.log(`  Name : ${brainbase.name}`);
    console.log(`  UUID : ${brainbase.id}`);
  } else {
    console.log('  ⚠️  Not found');
  }

  console.log(`\n${LINE}`);

  if (!hlna && !brainbase) {
    console.log('❌  Not found in either database.');
  } else if (hlna && !brainbase) {
    console.log('⚠️   Only exists in HLNA');
  } else if (!hlna && brainbase) {
    console.log('⚠️   Only exists in BRAINBASE-DB');
  } else if (hlna!.id === brainbase!.id) {
    console.log('✅  UUIDs match');
  } else {
    console.log('❌  UUIDs don\'t match');
    console.log(`    HLNA      : ${hlna!.id}`);
    console.log(`    BRAINBASE : ${brainbase!.id}`);
  }

  console.log(`${LINE}\n`);
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1); });
