import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.7A — CRM schema-creation source
// repair. Production evidence (F.6Z) showed crm_companies, crm_contacts,
// crm_deals, and crm_activities do not exist in Production, and that the
// migration as originally written could never have succeeded there: it
// declared organisation_id/created_by/assigned_to as UUID columns with
// foreign keys to organisations(id) and users(id), both of which are
// TEXT (cuid) on this platform, and PostgreSQL cannot create a foreign
// key between incompatible column types. This suite proves the repaired
// migration source now uses TEXT for every cross-boundary identifier
// while leaving CRM-internal ids (own primary keys and the foreign keys
// among the four CRM tables themselves) as UUID, unchanged.

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/crm-migrate.mjs')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf-8')

// Extract every `await sql.query(`...`)` template-literal body in source
// order. This is more robust than trying to strip `//` comments and
// re-parse the whole file, since the SQL itself lives entirely inside
// backtick-delimited blocks the JS comments never touch.
const STATEMENTS = [...SCRIPT_SOURCE.matchAll(/await sql\.query\(`([\s\S]*?)`\)/g)].map(m => m[1])

function statementFor(tableCreateName: string): string {
  const stmt = STATEMENTS.find(s => new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${tableCreateName}\\b`).test(s))
  if (!stmt) throw new Error(`No CREATE TABLE statement found for ${tableCreateName}`)
  return stmt
}

const companies = statementFor('crm_companies')
const contacts = statementFor('crm_contacts')
const deals = statementFor('crm_deals')
const activities = statementFor('crm_activities')
const ALL_TABLES = { crm_companies: companies, crm_contacts: contacts, crm_deals: deals, crm_activities: activities }

describe('scripts/crm-migrate.mjs — CRM schema source repair (Phase F.7A)', () => {
  it('declares all four CRM tables', () => {
    expect(STATEMENTS.some(s => /CREATE TABLE IF NOT EXISTS\s+crm_companies\b/.test(s))).toBe(true)
    expect(STATEMENTS.some(s => /CREATE TABLE IF NOT EXISTS\s+crm_contacts\b/.test(s))).toBe(true)
    expect(STATEMENTS.some(s => /CREATE TABLE IF NOT EXISTS\s+crm_deals\b/.test(s))).toBe(true)
    expect(STATEMENTS.some(s => /CREATE TABLE IF NOT EXISTS\s+crm_activities\b/.test(s))).toBe(true)
  })

  describe.each(Object.entries(ALL_TABLES))('%s', (_name, stmt) => {
    it('organisation_id is TEXT NOT NULL', () => {
      expect(stmt).toMatch(/organisation_id\s+TEXT\s+NOT NULL/)
    })

    it('organisation_id is UUID nowhere in this table', () => {
      expect(stmt).not.toMatch(/organisation_id\s+UUID/)
    })

    it('organisation_id references organisations(id)', () => {
      expect(stmt).toMatch(/organisation_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+organisations\(id\)/)
    })

    it('created_by, where present, is TEXT referencing users(id)', () => {
      if (/created_by/.test(stmt)) {
        expect(stmt).toMatch(/created_by\s+TEXT\s+REFERENCES\s+users\(id\)/)
        expect(stmt).not.toMatch(/created_by\s+UUID/)
      }
    })

    it('primary key id remains native UUID', () => {
      expect(stmt).toMatch(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
    })

    it('introduces no ::uuid (or other) cast workaround for platform ids', () => {
      expect(stmt).not.toMatch(/::uuid/i)
      expect(stmt).not.toMatch(/::text/i)
    })
  })

  it('crm_deals.assigned_to is TEXT referencing users(id)', () => {
    expect(deals).toMatch(/assigned_to\s+TEXT\s+REFERENCES\s+users\(id\)/)
    expect(deals).not.toMatch(/assigned_to\s+UUID/)
  })

  it('crm_contacts.company_id remains UUID, referencing crm_companies(id), ON DELETE SET NULL preserved', () => {
    expect(contacts).toMatch(/company_id\s+UUID\s+REFERENCES\s+crm_companies\(id\)\s+ON DELETE SET NULL/)
  })

  it('crm_deals.company_id/contact_id remain UUID referencing CRM-internal tables, ON DELETE SET NULL preserved', () => {
    expect(deals).toMatch(/company_id\s+UUID\s+REFERENCES\s+crm_companies\(id\)\s+ON DELETE SET NULL/)
    expect(deals).toMatch(/contact_id\s+UUID\s+REFERENCES\s+crm_contacts\(id\)\s+ON DELETE SET NULL/)
  })

  it('crm_activities.contact_id/company_id/deal_id remain UUID referencing CRM-internal tables, ON DELETE SET NULL preserved', () => {
    expect(activities).toMatch(/contact_id\s+UUID\s+REFERENCES\s+crm_contacts\(id\)\s+ON DELETE SET NULL/)
    expect(activities).toMatch(/company_id\s+UUID\s+REFERENCES\s+crm_companies\(id\)\s+ON DELETE SET NULL/)
    expect(activities).toMatch(/deal_id\s+UUID\s+REFERENCES\s+crm_deals\(id\)\s+ON DELETE SET NULL/)
  })

  it('crm_deals.stage CHECK constraint is unchanged', () => {
    expect(deals).toMatch(/CHECK \(stage IN \('lead','qualified','proposal','negotiation','closed_won','closed_lost'\)\)/)
  })

  it('crm_deals.probability CHECK constraint is unchanged', () => {
    expect(deals).toMatch(/CHECK \(probability BETWEEN 0 AND 100\)/)
  })

  it('crm_activities.type CHECK constraint is unchanged', () => {
    expect(activities).toMatch(/CHECK \(type IN \('call','email','note','meeting'\)\)/)
  })

  it('all 8 expected indexes remain represented', () => {
    const indexStatements = STATEMENTS.filter(s => /CREATE INDEX IF NOT EXISTS/.test(s)).join('\n')
    expect(indexStatements).toMatch(/idx_crm_companies_org\s+ON crm_companies\(organisation_id\)/)
    expect(indexStatements).toMatch(/idx_crm_contacts_org\s+ON crm_contacts\(organisation_id\)/)
    expect(indexStatements).toMatch(/idx_crm_contacts_co\s+ON crm_contacts\(company_id\)/)
    expect(indexStatements).toMatch(/idx_crm_deals_org\s+ON crm_deals\(organisation_id\)/)
    expect(indexStatements).toMatch(/idx_crm_deals_stage\s+ON crm_deals\(organisation_id, stage\)/)
    expect(indexStatements).toMatch(/idx_crm_activities_org\s+ON crm_activities\(organisation_id\)/)
    expect(indexStatements).toMatch(/idx_crm_activities_con\s+ON crm_activities\(contact_id\)/)
    expect(indexStatements).toMatch(/idx_crm_activities_deal\s+ON crm_activities\(deal_id\)/)
  })

  it('application-facing table and column names are unchanged from the pre-repair source', () => {
    // Guards against the repair having silently renamed anything the
    // live /api/crm/** routes depend on.
    for (const col of ['id', 'organisation_id', 'name', 'website', 'industry', 'company_size', 'phone', 'address', 'notes', 'created_by', 'created_at', 'updated_at']) {
      expect(companies).toMatch(new RegExp(`\\b${col}\\b`))
    }
    for (const col of ['first_name', 'last_name', 'email', 'job_title', 'company_id']) {
      expect(contacts).toMatch(new RegExp(`\\b${col}\\b`))
    }
    for (const col of ['title', 'value', 'stage', 'probability', 'expected_close', 'assigned_to', 'contact_id']) {
      expect(deals).toMatch(new RegExp(`\\b${col}\\b`))
    }
    for (const col of ['type', 'subject', 'body', 'activity_date', 'deal_id']) {
      expect(activities).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })
})
