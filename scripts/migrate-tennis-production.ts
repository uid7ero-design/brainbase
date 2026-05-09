import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // organisations.id is TEXT in this DB (Prisma schema) — match that type
  await sql`
    CREATE TABLE IF NOT EXISTS tennis_leads (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organisation_id  TEXT NOT NULL REFERENCES organisations(id),
      name             TEXT NOT NULL,
      email            TEXT NOT NULL,
      phone            TEXT,
      session_type     TEXT,
      message          TEXT,
      status           TEXT NOT NULL DEFAULT 'new',
      notes            TEXT,
      client_token     TEXT DEFAULT gen_random_uuid()::text,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ tennis_leads created');

  // Add columns idempotently in case table already partially existed
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS notes        TEXT`;
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS client_token TEXT DEFAULT gen_random_uuid()::text`;
  console.log('✓ notes + client_token columns ensured');

  // Backfill any NULLs — cast to text handles both TEXT and UUID column types
  const backfilled = await sql`
    UPDATE tennis_leads SET client_token = gen_random_uuid()::text::text WHERE client_token IS NULL RETURNING id
  `.catch(async () => {
    // Column might be UUID type — retry without explicit cast
    return sql`UPDATE tennis_leads SET client_token = gen_random_uuid() WHERE client_token IS NULL RETURNING id`;
  });
  if (backfilled.length > 0) console.log(`✓ backfilled ${backfilled.length} row(s)`);

  await sql`CREATE INDEX IF NOT EXISTS idx_tennis_leads_org     ON tennis_leads(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tennis_leads_created ON tennis_leads(created_at DESC)`;
  console.log('✓ indexes created');

  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      organisation_id   TEXT NOT NULL REFERENCES organisations(id),
      name              TEXT NOT NULL,
      email             TEXT,
      phone             TEXT,
      status            TEXT NOT NULL DEFAULT 'lead',
      address           TEXT,
      age               TEXT,
      program           TEXT,
      session_times     TEXT,
      next_action       TEXT,
      notes             TEXT,
      last_contacted_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, email)
    )
  `;
  console.log('✓ contacts created');

  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_org    ON contacts(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(organisation_id, status)`;

  console.log('\n✓ Migration complete');
}

main().catch(err => { console.error(err); process.exit(1); });
