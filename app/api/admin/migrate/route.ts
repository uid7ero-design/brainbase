import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * POST /api/admin/migrate
 * Idempotent — safe to call multiple times. Creates all multi-tenant tables
 * and adds any missing columns to the existing users table.
 * Requires super_admin session.
 */
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 1. organisations
  await sql`
    CREATE TABLE IF NOT EXISTS organisations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 2. Extend users: add organisation_id and email if they don't exist
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES organisations(id),
      ADD COLUMN IF NOT EXISTS email TEXT
  `;

  // 3. uploaded_files
  await sql`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      uploaded_by     UUID NOT NULL REFERENCES users(id),
      file_name       TEXT NOT NULL,
      file_url        TEXT NOT NULL DEFAULT '',
      file_type       TEXT NOT NULL DEFAULT 'xlsx',
      service_type    TEXT NOT NULL DEFAULT 'waste',
      upload_status   TEXT NOT NULL DEFAULT 'processing'
        CHECK (upload_status IN ('processing', 'complete', 'error')),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'waste'`;

  // 4. waste_records
  await sql`
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
  `;

  // 5. fleet_metrics
  await sql`
    CREATE TABLE IF NOT EXISTS fleet_metrics (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      uploaded_file_id UUID REFERENCES uploaded_files(id),
      vehicle_id       TEXT,
      vehicle_type     TEXT,
      make             TEXT,
      year             INTEGER,
      department       TEXT,
      driver           TEXT,
      km               NUMERIC,
      wages            NUMERIC,
      fuel             NUMERIC,
      maintenance      NUMERIC,
      rego             NUMERIC,
      repairs          NUMERIC,
      insurance        NUMERIC,
      depreciation     NUMERIC,
      services         INTEGER,
      defects          INTEGER,
      month            TEXT,
      financial_year   TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 6. service_requests
  await sql`
    CREATE TABLE IF NOT EXISTS service_requests (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      uploaded_file_id UUID REFERENCES uploaded_files(id),
      request_id       TEXT,
      service_type     TEXT,
      suburb           TEXT,
      month            TEXT,
      financial_year   TEXT,
      status           TEXT,
      priority         TEXT,
      days_open        INTEGER,
      cost             NUMERIC,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 7. reports
  await sql`
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
  `;

  // 8. import_mappings — user-configurable column-to-field mappings per service type
  await sql`
    CREATE TABLE IF NOT EXISTS import_mappings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      service_type    TEXT NOT NULL,
      raw_column      TEXT NOT NULL,
      mapped_field    TEXT NOT NULL,
      created_by      UUID REFERENCES users(id),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, service_type, raw_column)
    )
  `;

  // 9. kpi_rules — configurable metric thresholds per org
  await sql`
    CREATE TABLE IF NOT EXISTS kpi_rules (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      metric          TEXT NOT NULL,
      operator        TEXT NOT NULL,
      threshold       NUMERIC NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'warning',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, metric)
    )
  `;

  // 10. audit_logs — immutable action trail
  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      user_id         UUID REFERENCES users(id),
      action          TEXT NOT NULL,
      resource_type   TEXT,
      resource_id     UUID,
      detail          JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Indexes for fast org-scoped lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_uploaded_files_org    ON uploaded_files(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waste_records_org     ON waste_records(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waste_records_file    ON waste_records(uploaded_file_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fleet_metrics_org     ON fleet_metrics(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fleet_metrics_file    ON fleet_metrics(uploaded_file_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_org  ON service_requests(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_org           ON reports(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_import_mappings_org   ON import_mappings(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_kpi_rules_org         ON kpi_rules(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_org        ON audit_logs(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON audit_logs(user_id)`;

  return NextResponse.json({ success: true, message: 'Migration complete.' });
}
