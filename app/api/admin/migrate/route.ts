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

  const steps: string[] = [];
  function step(label: string) { steps.push(label); }

  try {

  // 1. organisations
  step('1. organisations');
  await sql`
    CREATE TABLE IF NOT EXISTS organisations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      slug       TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 2. Extend users: add organisation_id and email if they don't exist
  step('2. users columns');
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES organisations(id),
      ADD COLUMN IF NOT EXISTS email TEXT
  `;

  // 3. uploaded_files
  await sql`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      uploaded_by     TEXT NOT NULL REFERENCES users(id),
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

  step('seed modules');
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

  step('tennis_leads');
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
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS notes        TEXT`;
  await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS client_token TEXT DEFAULT gen_random_uuid()::text`;
  // Backfill nulls — try TEXT cast first, fall back for UUID-typed columns
  await sql`UPDATE tennis_leads SET client_token = gen_random_uuid()::text WHERE client_token IS NULL`.catch(async () => {
    await sql`UPDATE tennis_leads SET client_token = gen_random_uuid() WHERE client_token IS NULL`.catch(() => {});
  });
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

  step('28. contacts');
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

  step('30. client_pipeline');
  await sql`
    CREATE TABLE IF NOT EXISTS client_pipeline (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id  UUID NOT NULL REFERENCES organisations(id),
      submitted_by     UUID REFERENCES users(id),
      type             TEXT NOT NULL DEFAULT 'request'
        CHECK (type IN ('request', 'issue', 'feedback')),
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_progress', 'resolved')),
      priority         TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
      founder_note     TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_org     ON client_pipeline(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_status  ON client_pipeline(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_client_pipeline_created ON client_pipeline(created_at DESC)`;

  step('31. pipeline_messages');
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pipeline_id     UUID NOT NULL REFERENCES client_pipeline(id) ON DELETE CASCADE,
      organisation_id UUID NOT NULL REFERENCES organisations(id),
      author_type     TEXT NOT NULL,
      body            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_messages_pipeline ON pipeline_messages(pipeline_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pipeline_messages_created  ON pipeline_messages(created_at)`;

  // 32. Expand client_pipeline status to include awaiting_client
  step('32. client_pipeline awaiting_client status');
  await sql`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'client_pipeline'
          AND constraint_type = 'CHECK'
          AND constraint_name ILIKE '%status%'
      LOOP
        EXECUTE 'ALTER TABLE client_pipeline DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
      END LOOP;
    END $$
  `;
  await sql`
    ALTER TABLE client_pipeline
      ADD CONSTRAINT client_pipeline_status_check
      CHECK (status IN ('new', 'in_progress', 'awaiting_client', 'resolved'))
  `;

  step('33. organiser_boards');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_boards (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name            TEXT NOT NULL,
      color           TEXT,
      icon            TEXT,
      position        INTEGER NOT NULL DEFAULT 0,
      created_by      TEXT REFERENCES users(id),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  step('34. organiser_groups');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_groups (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name            TEXT NOT NULL,
      color           TEXT,
      position        INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  step('35. organiser_items');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      group_id        UUID REFERENCES organiser_groups(id) ON DELETE SET NULL,
      parent_item_id  UUID REFERENCES organiser_items(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'Not Started',
      priority        TEXT,
      owner           TEXT,
      due_date        DATE,
      notes           TEXT,
      fields          JSONB NOT NULL DEFAULT '{}',
      position        INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_boards_org        ON organiser_boards(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_groups_board      ON organiser_groups(board_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_groups_org        ON organiser_groups(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_items_board       ON organiser_items(board_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_items_org         ON organiser_items(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_items_group       ON organiser_items(group_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_items_parent      ON organiser_items(parent_item_id)`;

  step('36. organiser_columns');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_columns (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'status', 'checkbox')),
      options         JSONB NOT NULL DEFAULT '[]',
      position        INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  step('37. organiser_items.custom_values');
  await sql`ALTER TABLE organiser_items ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'`;

  step('38. organiser_item_files');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_item_files (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id         UUID NOT NULL REFERENCES organiser_items(id) ON DELETE CASCADE,
      board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      file_name       TEXT NOT NULL,
      file_url        TEXT NOT NULL,
      file_size       INTEGER,
      uploaded_by     TEXT REFERENCES users(id),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  step('39. organiser_item_updates');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_item_updates (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id         UUID NOT NULL REFERENCES organiser_items(id) ON DELETE CASCADE,
      board_id        UUID NOT NULL REFERENCES organiser_boards(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      author_name     TEXT,
      body            TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_columns_board      ON organiser_columns(board_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_columns_org        ON organiser_columns(organisation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_item_files_item    ON organiser_item_files(item_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_item_updates_item  ON organiser_item_updates(item_id)`;

  // Phase D.4.5B — organiser_activity. Append-only history/audit log for
  // Organiser (see the D.4.5A audit report for the full design rationale).
  // Deliberately NOT reusing the existing generic audit_logs table (staff-
  // only system-of-record, single resource_type/resource_id pair — doesn't
  // support Organiser's board+item-scoped query patterns cleanly). No FK
  // from board_id/item_id/entity_id to any organiser entity table — every
  // organiser_* entity table cascades hard on delete (see steps 34-39
  // above), so a real FK here would destroy exactly the history rows that
  // matter most (activity describing something that has since been
  // deleted). organisation_id remains a real FK (tenant lifecycle, matches
  // every other organiser_* table). actor_user_id uses ON DELETE SET NULL
  // so a later user deletion never erases history — actor_name is always
  // a point-in-time display-name snapshot, never re-derived by joining to
  // users at read time. event_type/entity_type are CHECK-constrained
  // (matching organiser_columns.type's own existing inline CHECK
  // convention just above) rather than a Postgres ENUM, so extending the
  // taxonomy later is a plain ALTER TABLE ... DROP/ADD CONSTRAINT, not an
  // ALTER TYPE migration. This table starts empty — no backfill, no
  // synthetic rows for pre-existing boards/items (see the D.4.5A audit's
  // explicit "do not fabricate actor_name = 'Unknown'" instruction) — and
  // nothing writes to it yet; D.4.5B is schema + shared helper only.
  step('40. organiser_activity');
  await sql`
    CREATE TABLE IF NOT EXISTS organiser_activity (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      board_id        UUID NOT NULL,
      item_id         UUID,
      actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name      TEXT NOT NULL,
      event_type      TEXT NOT NULL CHECK (event_type IN (
                         'board.created', 'board.updated', 'board.deleted',
                         'group.created', 'group.updated', 'group.deleted',
                         'column.created', 'column.updated', 'column.deleted',
                         'item.created', 'item.updated', 'item.moved', 'item.deleted',
                         'comment.created',
                         'file.added', 'file.deleted',
                         'import.completed'
                       )),
      entity_type     TEXT NOT NULL CHECK (entity_type IN ('board', 'group', 'item', 'column', 'file', 'comment', 'import')),
      entity_id       TEXT NOT NULL,
      before_json     JSONB,
      after_json      JSONB,
      metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_activity_org   ON organiser_activity(organisation_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_activity_board ON organiser_activity(board_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_activity_item  ON organiser_activity(item_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organiser_activity_actor ON organiser_activity(actor_user_id, created_at DESC)`;

  // Phase D.4.5C-B — Gate A resolution (see the phase report). The item
  // routes' race-safe before/after capture happens entirely INSIDE one
  // Postgres statement (a FOR UPDATE-locked "old" CTE + the UPDATE +
  // the organiser_activity INSERT), so D.4.5B's TypeScript sanitisation
  // helpers (which operate on JS values) can never see the true, locked
  // "old" row — there is nothing in JS to sanitise before the statement
  // executes. This small, pure SQL function is the same policy
  // (MAX_ACTIVITY_STRING_LENGTH=200, the same '…(truncated)' marker,
  // non-string objects/arrays stringified-and-truncated rather than
  // walked further, primitives/null passed through) re-expressed in SQL
  // so it can run inside that same statement. Parity with
  // lib/organiser/activity.ts's sanitiseActivityFieldValue is proven,
  // case-by-case, in tests/containment/organiserActivitySanitisationParity
  // .test.ts and empirically via scripts/tests/
  // verify-organiser-item-activity-concurrency.sh (real Postgres 16) —
  // the one known, disclosed divergence is Unicode counting: Postgres's
  // length()/left() count codepoints, JS's .length/.slice() count UTF-16
  // code units, so text containing supplementary-plane characters (e.g.
  // emoji outside the Basic Multilingual Plane) and exceeding 200 units
  // truncates at a different point on each side — both sides still
  // truncate safely with the same explicit marker, they just disagree on
  // the exact cutoff for that narrow class of input. Not a Postgres ENUM;
  // CREATE OR REPLACE is this function's own idempotent equivalent of the
  // CREATE TABLE/INDEX IF NOT EXISTS convention used everywhere else in
  // this file.
  //
  // Phase D.4.5C-M — this function was originally deployed standalone,
  // ahead of the item route runtime callers that reference it (PR #98 /
  // commit c925f99), specifically so the production database had both
  // organiser_activity and this function available BEFORE any runtime
  // code path could call either — see D.4.5C-M/M.2/M.3's own reports.
  // That standalone deployment already matches this exact SQL, so this
  // step remains a safe no-op in production; the runtime callers this
  // PR adds are covered by tests/containment/organiserItemActivity
  // .test.ts.
  step('41. organiser_activity_sanitise_scalar');
  await sql`
    CREATE OR REPLACE FUNCTION organiser_activity_sanitise_scalar(value jsonb)
    RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $f$
      SELECT CASE
        WHEN value IS NULL OR jsonb_typeof(value) = 'null' THEN value
        WHEN jsonb_typeof(value) = 'string' THEN
          to_jsonb(
            CASE WHEN length(value #>> '{}') > 200
              THEN left(value #>> '{}', 200) || '…(truncated)'
              ELSE value #>> '{}'
            END
          )
        WHEN jsonb_typeof(value) IN ('object', 'array') THEN
          to_jsonb(
            CASE WHEN length(value::text) > 200
              THEN left(value::text, 200) || '…(truncated)'
              ELSE value::text
            END
          )
        ELSE value
      END
    $f$
  `;

  // Contact classification hotfix — wires the already-approved, already-
  // audited migration (scripts/add-crm-contact-classification.sql,
  // proven via scripts/tests/verify-crm-contact-classification-migration.sh
  // against a real disposable Postgres instance) into this route so it can
  // be applied to Production through the same authenticated mechanism as
  // every other schema change here. Semantics copied verbatim from that
  // file: additive-only, nullable column, no default, no backfill of any
  // kind — every existing crm_contacts row keeps classification = NULL.
  // The idempotent guarded-DO-block technique for the CHECK constraint is
  // the same one already used above at step 32 (client_pipeline), not a
  // new pattern. tests/containment/adminMigrateContactClassificationStep
  // .test.ts proves this step and the standalone .sql file can never drift
  // apart silently.
  step('42. crm_contacts.classification');
  await sql`ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_classification_check'
      ) THEN
        ALTER TABLE crm_contacts
          ADD CONSTRAINT crm_contacts_classification_check
          CHECK (classification IS NULL OR classification IN (
            'CLIENT',
            'LEAD',
            'EVENT_CONTACT',
            'SUPPLIER',
            'PARTNER',
            'OTHER'
          ));
      END IF;
    END $$
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification ON crm_contacts(organisation_id, classification)`;

  return NextResponse.json({ success: true, message: 'Migration complete.', steps });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : undefined;
    console.error('[MIGRATE ERROR] failed at step:', steps.at(-1), '\n', err);
    return NextResponse.json({
      error:       message,
      failedAfter: steps.at(-1) ?? 'start',
      stack,
    }, { status: 500 });
  }
}
