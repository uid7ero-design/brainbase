import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT PRIMARY KEY,
      organisation_id  TEXT NOT NULL,
      name             TEXT NOT NULL,
      day_of_week      INTEGER NOT NULL,
      start_time       TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      max_capacity     INTEGER NOT NULL DEFAULT 8,
      session_type     TEXT NOT NULL,
      resource_id      TEXT,
      recurring        BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ sessions created');

  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_org        ON sessions(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_day        ON sessions(day_of_week)`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_instances (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      organisation_id  TEXT NOT NULL,
      date             DATE NOT NULL,
      start_time       TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      max_capacity     INTEGER NOT NULL DEFAULT 8,
      status           TEXT NOT NULL DEFAULT 'scheduled',
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (session_id, date)
    )
  `;
  console.log('✓ session_instances created');

  await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_session_id ON session_instances(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_date       ON session_instances(date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_session_instances_org        ON session_instances(organisation_id)`;

  // Add session_instance_id to bookings if that table exists
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS session_instance_id TEXT REFERENCES session_instances(id)`.catch(() => {
    console.log('  (bookings table not found — skipping session_instance_id column)');
  });
  await sql`CREATE INDEX IF NOT EXISTS idx_bookings_session_instance_id ON bookings(session_instance_id)`.catch(() => {});

  console.log('\n✓ Sessions migration complete');
}

main().catch(err => { console.error(err); process.exit(1); });
