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
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS plan           TEXT`;
  await sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS trial_ends_at  TIMESTAMPTZ`;

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

  // 23. WSTe — GPS service verification engine
  await sql`
    CREATE TABLE IF NOT EXISTS wste_vehicles (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      registration     TEXT NOT NULL,
      make             TEXT,
      model            TEXT,
      vehicle_type     TEXT,
      depot            TEXT,
      active           BOOLEAN DEFAULT TRUE,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, registration)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_runs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      vehicle_id       UUID NOT NULL REFERENCES wste_vehicles(id),
      run_date         DATE NOT NULL,
      driver           TEXT,
      route_name       TEXT,
      suburb           TEXT,
      gps_points       INTEGER DEFAULT 0,
      tickets_matched  INTEGER DEFAULT 0,
      exceptions_count INTEGER DEFAULT 0,
      verified         BOOLEAN DEFAULT FALSE,
      completion_pct   NUMERIC DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_gps_points (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      run_id          UUID NOT NULL REFERENCES wste_runs(id),
      recorded_at     TIMESTAMPTZ NOT NULL,
      lat             NUMERIC NOT NULL,
      lng             NUMERIC NOT NULL,
      speed_kmh       NUMERIC,
      address         TEXT,
      suburb          TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_waste_tickets (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      ticket_ref      TEXT,
      service_date    DATE,
      address         TEXT,
      suburb          TEXT,
      service_type    TEXT,
      run_id          UUID REFERENCES wste_runs(id),
      matched         BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_service_verifications (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      address         TEXT NOT NULL,
      suburb          TEXT,
      verified_at     TIMESTAMPTZ DEFAULT NOW(),
      gps_pass_count  INTEGER DEFAULT 0,
      last_pass_at    TIMESTAMPTZ,
      vehicle_id      UUID REFERENCES wste_vehicles(id),
      run_id          UUID REFERENCES wste_runs(id),
      result          TEXT NOT NULL DEFAULT 'verified' CHECK (result IN ('verified', 'not_found', 'partial'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_exceptions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      run_id          UUID NOT NULL REFERENCES wste_runs(id),
      address         TEXT,
      suburb          TEXT,
      exception_type  TEXT NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
      resolved        BOOLEAN DEFAULT FALSE,
      resolved_at     TIMESTAMPTZ,
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_wste_vehicles_org    ON wste_vehicles(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_runs_org        ON wste_runs(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_runs_date       ON wste_runs(run_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_gps_org         ON wste_gps_points(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_gps_run         ON wste_gps_points(run_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_tickets_org     ON wste_waste_tickets(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_exceptions_org  ON wste_exceptions(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_exceptions_run  ON wste_exceptions(run_id)`;

  // Seed default modules
  await sql`
    INSERT INTO modules (key, name, industry, description) VALUES
      ('waste_recycling',  'Waste & Recycling',   'Local Government',   'Waste, collections, contamination and recycling operations'),
      ('fleet_management', 'Fleet Management',    'Operations',         'Fleet availability, maintenance, defects and cost tracking'),
      ('service_requests', 'Service Requests',    'Customer Operations','Service request lifecycle, backlog and SLA performance'),
      ('logistics_freight','Logistics & Freight', 'Transport',          'Shipment, delivery, route and carrier performance'),
      ('utilities',        'Utilities',           'Infrastructure',     'Water, energy, faults and asset performance'),
      ('construction',     'Construction',        'Project Delivery',   'Project status, budgets, contractors and milestones'),
      ('wste',             'WSTe',                'Local Government',   'Multi-stream waste service verification — GPS, bin lifts, RFID, hard waste, FOGO and exception management')
    ON CONFLICT (key) DO NOTHING
  `;

  // 24. WSTe platform expansion — assets, planned services, service events, evidence

  await sql`
    CREATE TABLE IF NOT EXISTS wste_assets (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      property_id      TEXT,
      asset_type       TEXT NOT NULL DEFAULT 'bin',
      bin_type         TEXT,
      serial_number    TEXT,
      rfid             TEXT,
      volume           TEXT,
      colour           TEXT,
      status           TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'damaged', 'missing', 'retired', 'pending_delivery')),
      last_serviced_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_planned_services (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id       UUID NOT NULL REFERENCES organisations(id),
      property_id           TEXT NOT NULL,
      service_type          TEXT NOT NULL,
      schedule_name         TEXT,
      run_name              TEXT,
      planned_date          DATE NOT NULL,
      planned_window_start  TIME,
      planned_window_end    TIME,
      status                TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled', 'rescheduled')),
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_service_events (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id   UUID NOT NULL REFERENCES organisations(id),
      service_type      TEXT NOT NULL,
      property_id       TEXT,
      ticket_id         TEXT,
      run_id            UUID REFERENCES wste_runs(id),
      vehicle_id        UUID REFERENCES wste_vehicles(id),
      asset_id          UUID REFERENCES wste_assets(id),
      occurred_at       TIMESTAMPTZ,
      latitude          NUMERIC,
      longitude         NUMERIC,
      event_source      TEXT NOT NULL DEFAULT 'gps'
        CHECK (event_source IN ('gps','rfid','lift_sensor','photo','video','driver_note','ticket','weighbridge','manual')),
      event_type        TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'no_evidence'
        CHECK (verification_status IN ('verified','likely_completed','likely_missed','no_evidence','exception','not_applicable')),
      confidence_score  NUMERIC,
      evidence_summary  TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wste_evidence_items (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      service_event_id UUID NOT NULL REFERENCES wste_service_events(id),
      evidence_type    TEXT NOT NULL
        CHECK (evidence_type IN ('gps','rfid','lift_sensor','photo','video','driver_note','ticket','weighbridge','manual')),
      evidence_url     TEXT,
      description      TEXT,
      timestamp        TIMESTAMPTZ,
      metadata         JSONB DEFAULT '{}',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_wste_assets_org          ON wste_assets(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_assets_property     ON wste_assets(property_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_planned_org         ON wste_planned_services(organisation_id, planned_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_planned_property    ON wste_planned_services(property_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_events_org          ON wste_service_events(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_events_property     ON wste_service_events(property_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_events_occurred     ON wste_service_events(occurred_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wste_evidence_event      ON wste_evidence_items(service_event_id)`;

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

  // 25. Onboarding progress — stores multi-step wizard state per org
  await sql`
    CREATE TABLE IF NOT EXISTS onboarding_progress (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      user_id         UUID REFERENCES users(id),
      current_step    INTEGER NOT NULL DEFAULT 1,
      data            JSONB NOT NULL DEFAULT '{}',
      completed       BOOLEAN NOT NULL DEFAULT false,
      completed_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_onboarding_org ON onboarding_progress(organisation_id)`;

  // 26. Department scoping — tag every waste_records row with its source department
  await sql`ALTER TABLE waste_records ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Waste'`;

  // 27. Fleet metrics — operational tracking columns
  await sql`ALTER TABLE fleet_metrics ADD COLUMN IF NOT EXISTS downtime_hours NUMERIC`;
  await sql`ALTER TABLE fleet_metrics ADD COLUMN IF NOT EXISTS route_minutes  NUMERIC`;

  // Back-fill: existing waste_records rows that predate the department column
  await sql`UPDATE waste_records SET department = 'Waste' WHERE department IS NULL`;

  // agent_runs — audit log for every specialist agent invocation
  await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID REFERENCES organisations(id),
      user_id         UUID REFERENCES users(id),
      agent_name      TEXT NOT NULL,
      route_type      TEXT NOT NULL,
      input_query     TEXT,
      confidence      NUMERIC,
      source_rows     INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_org       ON agent_runs(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_runs_created   ON agent_runs(created_at DESC)`;

  // Tennis vertical — leads captured from /tennis landing page
  await sql`
    CREATE TABLE IF NOT EXISTS tennis_leads (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      name             TEXT NOT NULL,
      email            TEXT NOT NULL,
      phone            TEXT,
      session_type     TEXT,
      message          TEXT,
      status           TEXT NOT NULL DEFAULT 'new',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tennis_leads_org     ON tennis_leads(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tennis_leads_created ON tennis_leads(created_at DESC)`;

  // saved_briefings — persisted HLNA agent responses with evidence
  await sql`
    CREATE TABLE IF NOT EXISTS saved_briefings (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      user_id          UUID REFERENCES users(id),
      title            TEXT NOT NULL,
      briefing_type    TEXT,
      agent_name       TEXT,
      response_text    TEXT,
      evidence_json    JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_briefings_org     ON saved_briefings(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_briefings_created ON saved_briefings(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_briefings_user    ON saved_briefings(user_id)`;

  // social_accounts — OAuth-connected social media accounts per org
  await sql`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id      UUID NOT NULL REFERENCES organisations(id),
      platform             TEXT NOT NULL DEFAULT 'instagram',
      account_name         TEXT NOT NULL,
      account_id           TEXT NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      token_expires_at     TIMESTAMPTZ,
      connected_at         TIMESTAMPTZ DEFAULT NOW(),
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at           TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, platform, account_id)
    )
  `;

  // social_posts — synced posts from connected accounts
  await sql`
    CREATE TABLE IF NOT EXISTS social_posts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id   UUID NOT NULL REFERENCES organisations(id),
      social_account_id UUID REFERENCES social_accounts(id),
      platform          TEXT NOT NULL DEFAULT 'instagram',
      platform_post_id  TEXT NOT NULL,
      caption           TEXT,
      media_url         TEXT,
      thumbnail_url     TEXT,
      permalink         TEXT,
      media_type        TEXT,
      likes_count       INTEGER NOT NULL DEFAULT 0,
      comments_count    INTEGER NOT NULL DEFAULT 0,
      engagement_score  INTEGER NOT NULL DEFAULT 0,
      posted_at         TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, platform, platform_post_id)
    )
  `;

  // social_comments — synced comments with HLNA-assigned sentiment
  await sql`
    CREATE TABLE IF NOT EXISTS social_comments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id     UUID NOT NULL REFERENCES organisations(id),
      social_post_id      UUID REFERENCES social_posts(id),
      platform_comment_id TEXT NOT NULL,
      author_name         TEXT,
      text                TEXT NOT NULL,
      sentiment           TEXT DEFAULT 'neutral',
      urgency             BOOLEAN DEFAULT false,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, platform_comment_id)
    )
  `;

  // social_insights — HLNA-generated analysis results
  await sql`
    CREATE TABLE IF NOT EXISTS social_insights (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id   UUID NOT NULL REFERENCES organisations(id),
      insight_type      TEXT,
      title             TEXT NOT NULL,
      summary           TEXT NOT NULL,
      evidence_json     JSONB,
      confidence        TEXT DEFAULT 'medium',
      recommended_action TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_social_accounts_org     ON social_accounts(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_org        ON social_posts(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_account    ON social_posts(social_account_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_posted     ON social_posts(posted_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_comments_org     ON social_comments(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_comments_post    ON social_comments(social_post_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_insights_org     ON social_insights(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_insights_created ON social_insights(created_at DESC)`;

  // 28. Contacts — tennis coaching client CRM
  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id   UUID NOT NULL REFERENCES organisations(id),
      name              TEXT NOT NULL,
      email             TEXT,
      phone             TEXT,
      status            TEXT NOT NULL DEFAULT 'lead'
        CHECK (status IN ('lead', 'contacted', 'active', 'inactive')),
      address           TEXT,
      age               TEXT,
      program           TEXT,
      session_times     TEXT,
      next_action       TEXT,
      last_contacted_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organisation_id, email)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_org    ON contacts(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(organisation_id, status)`;

  // 29. Contact journal — session notes and interaction history
  await sql`
    CREATE TABLE IF NOT EXISTS contact_journal (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      note            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_contact_journal_contact ON contact_journal(contact_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_contact_journal_org     ON contact_journal(organisation_id)`;

  return NextResponse.json({ success: true, message: 'Migration complete.' });
}
