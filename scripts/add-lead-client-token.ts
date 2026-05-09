import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS client_token UUID DEFAULT gen_random_uuid()`;
  await sql`UPDATE tennis_leads SET client_token = gen_random_uuid() WHERE client_token IS NULL`;
  console.log('✓ client_token column added to tennis_leads');
}

main().catch(err => { console.error(err); process.exit(1); });
