import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pipeline_id     UUID NOT NULL REFERENCES client_pipeline(id) ON DELETE CASCADE,
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      author_type     TEXT NOT NULL CHECK (author_type IN ('founder', 'client')),
      body            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ pipeline_messages created');

  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_messages_pipeline ON pipeline_messages(pipeline_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_messages_created  ON pipeline_messages(created_at)`;
  console.log('✓ indexes created');

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_messages'
    ORDER BY ordinal_position
  `;
  console.log('  columns:', cols.map(r => r.column_name).join(', '));

  console.log('\n✓ pipeline_messages migration complete');
}

main().catch(err => { console.error(err); process.exit(1); });
