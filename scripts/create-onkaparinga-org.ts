/**
 * create-onkaparinga-org.ts
 *
 * Run:
 *   DATABASE_URL="postgresql://..." npx ts-node --skipProject \
 *   --compilerOptions '{"module":"commonjs","esModuleInterop":true}' \
 *   --transpile-only scripts/create-onkaparinga-org.ts
 */

import * as fs   from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Minimal .env loader
(function loadEnv() {
  const envFile = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
})();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const prisma = new PrismaClient();

const LINE = '═'.repeat(55);

const NAME = 'City of Onkaparinga';
const SLUG = 'city-of-onkaparinga';

const DB_URL = process.env.DATABASE_URL!;

async function main() {
  let org: { id: string; name: string; slug: string };
  let created = false;

  try {
    // Try to create
    org = await prisma.organisation.create({
      data: { name: NAME, slug: SLUG },
      select: { id: true, name: true, slug: true },
    });
    created = true;
  } catch (e: unknown) {
    // Unique constraint violation — fetch existing
    const code = (e as { code?: string }).code;
    if (code === 'P2002') {
      const existing = await prisma.organisation.findUnique({
        where: { slug: SLUG },
        select: { id: true, name: true, slug: true },
      });
      if (!existing) throw e;
      org = existing;
      console.log('✅ Organisation already exists — fetched existing record.\n');
    } else {
      throw e;
    }
  }

  const label = created ? 'ORGANISATION CREATED' : 'ORGANISATION EXISTS';

  console.log(`\n${LINE}`);
  console.log(label);
  console.log(`${LINE}`);
  console.log(`Name: ${org.name}`);
  console.log(`Slug: ${org.slug}`);
  console.log(`UUID: ${org.id}`);
  console.log(`${LINE}`);
  console.log('NEXT STEP: Run data ingestion');
  console.log(`${LINE}`);
  console.log('');
  console.log(`LD_TENNIS_ORG_ID="${org.id}" \\`);
  console.log(`DATABASE_URL="${DB_URL}" \\`);
  console.log(`npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' --transpile-only \\`);
  console.log('scripts/ingest-from-folders.ts');
  console.log(`\n${LINE}\n`);
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
