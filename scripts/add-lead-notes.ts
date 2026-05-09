import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS notes TEXT`;
  console.log('✓ notes column added to tennis_leads');
}

main().catch(err => { console.error(err); process.exit(1); });
