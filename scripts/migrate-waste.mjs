import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:REDACTED@ep-bitter-field-a7t5kwxy.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

await sql.query(`
  CREATE TABLE IF NOT EXISTS uploaded_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    file_name       TEXT NOT NULL,
    file_url        TEXT NOT NULL DEFAULT '',
    file_type       TEXT NOT NULL DEFAULT 'xlsx',
    upload_status   TEXT NOT NULL DEFAULT 'processing'
      CHECK (upload_status IN ('processing', 'complete', 'error')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ uploaded_files');

await sql.query(`
  CREATE TABLE IF NOT EXISTS waste_records (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id    UUID NOT NULL REFERENCES organisations(id),
    uploaded_file_id   UUID REFERENCES uploaded_files(id),
    service_type       TEXT,
    suburb             TEXT,
    month              TEXT,
    financial_year     TEXT,
    tonnes             NUMERIC,
    collections        INTEGER,
    contamination_rate NUMERIC,
    cost               NUMERIC,
    created_at         TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ waste_records');

await sql.query(`
  CREATE TABLE IF NOT EXISTS reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES organisations(id),
    created_by       UUID NOT NULL REFERENCES users(id),
    report_type      TEXT NOT NULL,
    report_title     TEXT NOT NULL,
    report_content   TEXT NOT NULL,
    source_file_id   UUID REFERENCES uploaded_files(id),
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ reports');

await sql.query(`CREATE INDEX IF NOT EXISTS idx_uploaded_files_org ON uploaded_files(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_waste_records_org  ON waste_records(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_waste_records_file ON waste_records(uploaded_file_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_reports_org        ON reports(organisation_id)`);
console.log('✓ indexes\n\nMigration complete.');
