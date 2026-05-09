import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS client_pipeline (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      submitted_by     UUID REFERENCES users(id),
      type             TEXT NOT NULL DEFAULT 'request',
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'new',
      priority         TEXT NOT NULL DEFAULT 'medium',
      founder_note     TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ client_pipeline created');

  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_org     ON client_pipeline(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_status  ON client_pipeline(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_created ON client_pipeline(created_at DESC)`;
  console.log('✓ indexes created');

  // Verify columns
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'client_pipeline'
    ORDER BY ordinal_position
  `;
  console.log('  columns:', cols.map(r => r.column_name).join(', '));

  console.log('\n✓ client_pipeline migration complete');
}

main().catch(err => { console.error(err); process.exit(1); });
