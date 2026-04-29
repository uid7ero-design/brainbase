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

  // 11. integrations — connector config per org
  await sql`
    CREATE TABLE IF NOT EXISTS integrations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      connector_id     TEXT NOT NULL,
      name             TEXT NOT NULL,
      config           JSONB NOT NULL DEFAULT '{}',
      target_table     TEXT NOT NULL,
      schedule         TEXT NOT NULL DEFAULT '0 2 * * *',
      enabled          BOOLEAN NOT NULL DEFAULT true,
      last_synced_at   TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_count  INTEGER,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 12. sync_jobs — per-run log
  await sql`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      integration_id   UUID NOT NULL REFERENCES integrations(id),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      started_at       TIMESTAMPTZ DEFAULT NOW(),
      completed_at     TIMESTAMPTZ,
      status           TEXT NOT NULL DEFAULT 'running',
      records_synced   INTEGER DEFAULT 0,
      error_message    TEXT
    )
  `;

  // 13. data_snapshots — daily aggregated metrics for trend analysis
  await sql`
    CREATE TABLE IF NOT EXISTS data_snapshots (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      snapshot_date    DATE NOT NULL DEFAULT CURRENT_DATE,
      data_type        TEXT NOT NULL,
      metrics          JSONB NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, snapshot_date, data_type)
    )
  `;

  // 14. Email verification columns on users
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN    DEFAULT false`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`;

  // 15. email_tokens — password-reset and email-verification tokens
  await sql`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      type       TEXT NOT NULL CHECK (type IN ('verify', 'reset')),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 16. User profile fields
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name    TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name     TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name  TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url    TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio           TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title     TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS department    TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone      TEXT DEFAULT 'Australia/Adelaide'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences   JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ`;

  // 17. Organisation profile fields
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS logo_url       TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS website        TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS industry       TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS size           TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address        TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_email  TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_phone  TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS settings       JSONB DEFAULT '{}'`;

  // 18. Module registry — platform-wide module definitions
  await sql`
    CREATE TABLE IF NOT EXISTS modules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key         TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      industry    TEXT,
      description TEXT,
      status      TEXT DEFAULT 'active',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 19. Organisation modules — which modules each org has enabled
  await sql`
    CREATE TABLE IF NOT EXISTS organisation_modules (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      module_id       UUID NOT NULL REFERENCES modules(id),
      enabled         BOOLEAN DEFAULT TRUE,
      config          JSONB DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, module_id)
    )
  `;

  // 20. Metric snapshots — cross-module universal metric layer
  await sql`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      module_key      TEXT NOT NULL,
      metric_key      TEXT NOT NULL,
      metric_label    TEXT,
      value           NUMERIC,
      unit            TEXT,
      period_start    DATE,
      period_end      DATE,
      dimension       TEXT,
      dimension_value TEXT,
      source_table    TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 21. Extend import_mappings with module_key
  await sql`ALTER TABLE import_mappings ADD COLUMN IF NOT EXISTS module_key TEXT`;

  // 22. Extend kpi_rules with module_key
  await sql`ALTER TABLE kpi_rules ADD COLUMN IF NOT EXISTS module_key TEXT`;

  // Seed default modules
  await sql`
    INSERT INTO modules (key, name, industry, description) VALUES
      ('waste_recycling',  'Waste & Recycling',   'Local Government',   'Waste, collections, contamination and recycling operations'),
      ('fleet_management', 'Fleet Management',    'Operations',         'Fleet availability, maintenance, defects and cost tracking'),
      ('service_requests', 'Service Requests',    'Customer Operations','Service request lifecycle, backlog and SLA performance'),
      ('logistics_freight','Logistics & Freight', 'Transport',          'Shipment, delivery, route and carrier performance'),
      ('utilities',        'Utilities',           'Infrastructure',     'Water, energy, faults and asset performance'),
      ('construction',     'Construction',        'Project Delivery',   'Project status, budgets, contractors and milestones')
    ON CONFLICT (key) DO NOTHING
  `;

  // Indexes for fast org-scoped lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_uploaded_files_org         ON uploaded_files(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waste_records_org          ON waste_records(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waste_records_file         ON waste_records(uploaded_file_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fleet_metrics_org          ON fleet_metrics(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fleet_metrics_file         ON fleet_metrics(uploaded_file_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_org       ON service_requests(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_org                ON reports(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_import_mappings_org        ON import_mappings(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_kpi_rules_org              ON kpi_rules(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_org             ON audit_logs(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_user            ON audit_logs(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_integrations_org           ON integrations(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_jobs_integration      ON sync_jobs(integration_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_jobs_org              ON sync_jobs(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_org_date         ON data_snapshots(organisation_id, snapshot_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_tokens_token         ON email_tokens(token)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_tokens_user          ON email_tokens(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_org_modules_org            ON organisation_modules(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_metric_snapshots_org       ON metric_snapshots(organisation_id, module_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_metric_snapshots_metric    ON metric_snapshots(metric_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_metric_snapshots_period    ON metric_snapshots(period_start, period_end)`;

  return NextResponse.json({ success: true, message: 'Migration complete.' });
}
