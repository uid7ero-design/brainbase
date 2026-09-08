import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6H-R4A — the generic migration/bootstrap route's modules and
// organisation_modules steps (18/19) previously described a pre-"Modular
// Platform Foundation" registry design (modules: id UUID PK, industry TEXT,
// status TEXT; organisation_modules: module_id UUID REFERENCES modules(id))
// that was superseded by a later, deliberate redesign — scripts/
// create-modules.sql, scripts/create-organisation-modules.sql, and
// prisma/schema.prisma's PlatformModule/OrganisationModule models — already
// the sole schema every live capability-gating call site depends on
// (app/api/me/route.ts, app/api/chat/route.ts, lib/agents/briefingAgent.ts,
// lib/capabilities/requireCapability.ts, and others all join on
// modules.key = organisation_modules.module_key, never modules.id/
// organisation_modules.module_id). This test proves the migrate route's own
// bootstrap now agrees with that canonical contract, and cannot silently
// drift back to the stale shape.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const routeSource = read('app/api/admin/migrate/route.ts')
const createModulesSql = read('scripts/create-modules.sql')
const seedModulesSql = read('scripts/seed-modules-registry.sql')
const createOrgModulesSql = read('scripts/create-organisation-modules.sql')

function blockFor(marker: string): string {
  const start = routeSource.indexOf(marker)
  expect(start, `marker "${marker}" not found in route source`).toBeGreaterThan(-1)
  const end = routeSource.indexOf('\n  `;', start)
  return routeSource.slice(start, end)
}

describe('app/api/admin/migrate/route.ts — modules canonical registry alignment (D.4.6H-R4A)', () => {
  const modulesBlock = () => blockFor('CREATE TABLE IF NOT EXISTS modules (')

  it('modules: key is TEXT PRIMARY KEY — no surrogate id column', () => {
    const block = modulesBlock()
    expect(block).toMatch(/key\s+TEXT\s+PRIMARY\s+KEY/)
    expect(block).not.toMatch(/\bid\s+UUID/)
  })

  it('modules: no industry column', () => {
    expect(modulesBlock()).not.toMatch(/\bindustry\b/)
  })

  it('modules: no status column', () => {
    expect(modulesBlock()).not.toMatch(/\bstatus\b/)
  })

  it('modules: active is BOOLEAN NOT NULL DEFAULT true, matching scripts/create-modules.sql exactly', () => {
    const block = modulesBlock()
    expect(block).toMatch(/active\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+true/)
    expect(createModulesSql).toMatch(/active\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+true/)
  })

  it('modules: created_at and updated_at are both present, TIMESTAMPTZ, matching the canonical source', () => {
    const block = modulesBlock()
    expect(block).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/)
    expect(block).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/)
  })

  it('no legacy 7-row industry seed remains in the modules INSERT statement itself', () => {
    const seedStart = routeSource.indexOf('INSERT INTO modules (')
    const seedEnd = routeSource.indexOf('\n  `;', seedStart)
    const seedBlock = routeSource.slice(seedStart, seedEnd)
    for (const legacyKey of ["'waste_recycling'", "'fleet_management'", "'service_requests'", "'logistics_freight'", "'utilities'", "'construction'", "'wste'"]) {
      expect(seedBlock).not.toContain(legacyKey)
    }
  })

  it('canonical seed registers exactly crm and organiser, matching scripts/seed-modules-registry.sql', () => {
    const seedStart = routeSource.indexOf('INSERT INTO modules (key, name, description, active) VALUES')
    expect(seedStart).toBeGreaterThan(-1)
    const seedEnd = routeSource.indexOf('\n  `;', seedStart)
    const seedBlock = routeSource.slice(seedStart, seedEnd)
    expect(seedBlock).toContain("'crm'")
    expect(seedBlock).toContain("'organiser'")
    // Exactly two rows: two ON CONFLICT-guarded VALUES entries, no more.
    const rowCount = (seedBlock.match(/^\s*\('/gm) || []).length
    expect(rowCount).toBe(2)
    expect(seedBlock).toMatch(/ON CONFLICT \(key\) DO NOTHING/)
    // Parity with the canonical standalone seed script's own key set.
    expect(seedModulesSql).toContain("'crm'")
    expect(seedModulesSql).toContain("'organiser'")
  })

  const orgModulesBlock = () => blockFor('CREATE TABLE IF NOT EXISTS organisation_modules (')

  it('organisation_modules: id is TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text — not a native UUID column', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/id\s+TEXT\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)::text/)
    expect(block).not.toMatch(/id\s+UUID/)
  })

  it('organisation_modules: module_key TEXT REFERENCES modules(key) — no module_id / REFERENCES modules(id) anywhere in executable code (comments may legitimately name it while explaining the fix)', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/module_key\s+TEXT\s+NOT\s+NULL/)
    expect(block).toMatch(/FOREIGN KEY \(module_key\) REFERENCES modules\(key\)/)
    // Strip // line comments before asserting — this file's own explanatory
    // comments legitimately name "module_id" in prose describing the fix.
    const codeOnly = routeSource.replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/module_id/)
    expect(codeOnly).not.toMatch(/REFERENCES modules\(id\)/)
  })

  it('organisation_modules: enabled is BOOLEAN NOT NULL DEFAULT false, matching the canonical source (not the stale DEFAULT TRUE)', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/)
    expect(createOrgModulesSql).toMatch(/enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/)
  })

  it('organisation_modules: config is JSONB NOT NULL DEFAULT \'{}\'', () => {
    expect(orgModulesBlock()).toMatch(/config\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'/)
  })

  it('organisation_modules: both created_at and updated_at present (the stale version was missing updated_at)', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/)
    expect(block).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/)
  })

  it('organisation_modules: both FKs use ON DELETE RESTRICT with named constraints, matching the canonical source', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/CONSTRAINT organisation_modules_organisation_id_fkey\s*\n\s*FOREIGN KEY \(organisation_id\) REFERENCES organisations\(id\) ON DELETE RESTRICT/)
    expect(block).toMatch(/CONSTRAINT organisation_modules_module_key_fkey\s*\n\s*FOREIGN KEY \(module_key\) REFERENCES modules\(key\) ON DELETE RESTRICT/)
  })

  it('organisation_modules: UNIQUE(organisation_id, module_key), not UNIQUE(organisation_id, module_id)', () => {
    const block = orgModulesBlock()
    expect(block).toMatch(/UNIQUE\s*\(organisation_id,\s*module_key\)/)
    expect(block).not.toMatch(/UNIQUE\s*\(organisation_id,\s*module_id\)/)
  })

  it('no destructive statement was introduced (no ALTER COLUMN TYPE, no USING cast, no DROP COLUMN, no DROP TABLE, no ALTER TYPE) anywhere touching modules or organisation_modules', () => {
    expect(routeSource).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i)
    expect(routeSource).not.toMatch(/USING\s+\w+::/i)
    expect(routeSource).not.toMatch(/DROP\s+COLUMN/i)
    expect(routeSource).not.toMatch(/DROP\s+TABLE/i)
  })

  it('app/api/admin/seed-demo/route.ts is explicitly untouched by this phase (out of scope, known remaining debt)', () => {
    const seedDemoSource = read('app/api/admin/seed-demo/route.ts')
    // Still contains its own pre-existing, separately-tracked module_id
    // reference — proves this phase did not silently also fix it.
    expect(seedDemoSource).toContain('module_id')
  })
})
