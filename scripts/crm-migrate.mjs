import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// Companies / Accounts
await sql.query(`
  CREATE TABLE IF NOT EXISTS crm_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    name            TEXT NOT NULL,
    website         TEXT,
    industry        TEXT,
    company_size    TEXT,
    phone           TEXT,
    address         TEXT,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ crm_companies');

// Contacts
await sql.query(`
  CREATE TABLE IF NOT EXISTS crm_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    job_title       TEXT,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ crm_contacts');

// Deals / Opportunities
await sql.query(`
  CREATE TABLE IF NOT EXISTS crm_deals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
    contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    value           NUMERIC,
    stage           TEXT NOT NULL DEFAULT 'lead'
                      CHECK (stage IN ('lead','qualified','proposal','negotiation','closed_won','closed_lost')),
    probability     INTEGER DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    expected_close  DATE,
    assigned_to     UUID REFERENCES users(id),
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ crm_deals');

// Activities
await sql.query(`
  CREATE TABLE IF NOT EXISTS crm_activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
    company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
    deal_id         UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    type            TEXT NOT NULL CHECK (type IN ('call','email','note','meeting')),
    subject         TEXT NOT NULL,
    body            TEXT,
    activity_date   TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )
`);
console.log('✓ crm_activities');

// Indexes
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_companies_org  ON crm_companies(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_org   ON crm_contacts(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_contacts_co    ON crm_contacts(company_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_deals_org      ON crm_deals(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_deals_stage    ON crm_deals(organisation_id, stage)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_org ON crm_activities(organisation_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_con ON crm_activities(contact_id)`);
await sql.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id)`);
console.log('✓ indexes');

console.log('\nCRM migration complete.');
