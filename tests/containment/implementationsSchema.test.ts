import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Client Implementations Phase 2A — schema contract. Static source-text
// assertions against the migration file (disposable-Postgres validation of
// the actual constraints/FKs/idempotency was performed separately — see
// the Phase 2A checkpoint report; this suite locks in the intended shape
// so a future edit can't silently drift from what was validated).

const MIGRATION = path.resolve(__dirname, '../../scripts/create-implementations.sql')
const source = fs.readFileSync(MIGRATION, 'utf-8')

describe('scripts/create-implementations.sql — table shape', () => {
  it('creates the table idempotently (IF NOT EXISTS)', () => {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS implementations')
  })

  it('uses TEXT ids (gen_random_uuid()::text), matching the current repository convention — not the legacy UUID convention used by client_pipeline/crm_*', () => {
    expect(source).toMatch(/id\s+TEXT\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)::text/)
  })

  it('organisation_id is TEXT NOT NULL and references organisations(id) — an implementation must belong to a real organisation', () => {
    expect(source).toMatch(/organisation_id\s+TEXT\s+NOT NULL REFERENCES organisations\(id\)/)
  })

  it('organisation_id has no ON DELETE clause on its own FK line (defaults to NO ACTION) — deleting an org with attached implementations must fail loudly, not silently orphan/cascade', () => {
    const orgFkLine = source.split('\n').find(l => /organisation_id\s+TEXT\s+NOT NULL REFERENCES organisations/.test(l))
    expect(orgFkLine).toBeDefined()
    expect(orgFkLine).not.toContain('ON DELETE')
  })

  it('owner_user_id references users(id) ON DELETE SET NULL', () => {
    expect(source).toMatch(/owner_user_id\s+TEXT\s+REFERENCES users\(id\) ON DELETE SET NULL/)
  })

  it('source_lead_id references web_service_leads(id) ON DELETE SET NULL', () => {
    expect(source).toMatch(/source_lead_id\s+TEXT\s+REFERENCES web_service_leads\(id\) ON DELETE SET NULL/)
  })

  it('source_proposal_id references deployment_proposals(id) ON DELETE SET NULL', () => {
    expect(source).toMatch(/source_proposal_id\s+TEXT\s+REFERENCES deployment_proposals\(id\) ON DELETE SET NULL/)
  })

  it('health is an explicit CHECK-constrained field with exactly the 3 allowed values', () => {
    expect(source).toMatch(/health\s+TEXT\s+NOT NULL DEFAULT 'on_track'/)
    expect(source).toContain("CHECK (health IN ('on_track', 'at_risk', 'blocked'))")
  })

  it('stage uses a deliberately small, generic, vertical-agnostic vocabulary — not Web Systems\' web-build-specific onboarding_stage vocabulary', () => {
    const webBuildSpecificTerms = ['content_collection', 'infrastructure_setup', 'website_build', 'integrations', 'maintenance']
    for (const term of webBuildSpecificTerms) {
      expect(source).not.toContain(`'${term}'`)
    }
    const expectedStages = ['planning', 'discovery', 'setup', 'build', 'client_review', 'testing', 'ready_to_launch', 'live', 'on_hold', 'cancelled']
    for (const stage of expectedStages) {
      expect(source).toContain(`'${stage}'`)
    }
  })

  it('stage is plain TEXT + CHECK, not a native Postgres ENUM — matching client_onboarding.onboarding_stage\'s convention, avoiding the append-only-enum rigidity documented for web_service_leads.status', () => {
    expect(source).not.toMatch(/CREATE TYPE\s+\w*stage\w*\s+AS ENUM/i)
    expect(source).toMatch(/stage\s+TEXT\s+NOT NULL DEFAULT 'planning'/)
  })

  it('name is required (NOT NULL)', () => {
    expect(source).toMatch(/name\s+TEXT\s+NOT NULL/)
  })

  it('has indexes on organisation_id and stage', () => {
    expect(source).toContain('CREATE INDEX IF NOT EXISTS idx_implementations_org   ON implementations(organisation_id)')
    expect(source).toContain('CREATE INDEX IF NOT EXISTS idx_implementations_stage ON implementations(stage)')
  })

  it('has an idempotent updated_at trigger (DROP TRIGGER IF EXISTS then CREATE), reusing the existing shared set_updated_at() function', () => {
    expect(source).toContain('DROP TRIGGER IF EXISTS trg_implementations_updated_at ON implementations')
    expect(source).toContain('CREATE TRIGGER trg_implementations_updated_at')
    expect(source).toContain('EXECUTE FUNCTION set_updated_at()')
  })

  it('created_at/updated_at are NOT NULL with sensible defaults', () => {
    expect(source).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT now\(\)/)
    expect(source).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT now\(\)/)
  })

  it('does not touch organiser, managed_services, client_onboarding, deployment_proposals, client_pipeline, or crm_* schema', () => {
    for (const forbidden of ['organiser_', 'managed_services', 'client_onboarding', 'deployment_proposals', 'client_pipeline', 'crm_']) {
      // deployment_proposals/web_service_leads appear legitimately as FK targets — only
      // flag CREATE/ALTER statements against them, not the FK reference lines themselves.
      const alteringLines = source
        .split('\n')
        .filter(l => l.includes(forbidden) && /CREATE TABLE|ALTER TABLE|DROP TABLE/.test(l))
      expect(alteringLines).toEqual([])
    }
  })
})
