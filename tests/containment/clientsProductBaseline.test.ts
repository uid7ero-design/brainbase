import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Clients 2.0 Phase B1 (F.7Y) — regression-test foundation for the CURRENT
// /clients and /clients/[id] product, established BEFORE any Phase B2
// redesign begins (see the F.7X discovery report). This file protects the
// page-level architecture: authorization, the list query contract, and
// tenant scoping on the detail page, plus explicit boundary assertions
// proving Clients does not depend on CRM or Founder OS persistence, and a
// deliberately-temporary baseline assertion that it does not yet consume
// implementations/organisation_modules (expected to change in Phase B2 —
// see the dedicated describe block below for why that's intentional).
//
// Static source-text assertions for the two server-component pages —
// this project has no jsdom/React Testing Library harness, and Next.js's
// redirect()/notFound() primitives require a real request-scoped
// rendering context a plain vitest environment doesn't provide. This is
// the same established convention already used throughout this repo for
// server-component pages (see organiserCanonicalRoute.test.ts,
// organiserDirectNavigation.test.ts, founderOsDefaultDashboard.test.ts).

const CLIENTS_LIST_PATH = path.resolve(__dirname, '../../app/clients/page.tsx')
const CLIENTS_DETAIL_PATH = path.resolve(__dirname, '../../app/clients/[id]/page.tsx')
const CLIENT_WORKSPACE_PATH = path.resolve(__dirname, '../../components/clients/ClientWorkspace.tsx')

const CLIENTS_LIST_SOURCE = fs.readFileSync(CLIENTS_LIST_PATH, 'utf-8')
const CLIENTS_DETAIL_SOURCE = fs.readFileSync(CLIENTS_DETAIL_PATH, 'utf-8')
const CLIENT_WORKSPACE_SOURCE = fs.readFileSync(CLIENT_WORKSPACE_PATH, 'utf-8')

// ── A. Client list authorization ────────────────────────────────────────

describe('app/clients/page.tsx — super_admin-only authorization', () => {
  it('gates the entire page behind requireRole(\'super_admin\')', () => {
    expect(CLIENTS_LIST_SOURCE).toContain("await requireRole('super_admin')")
  })

  it('imports requireRole from the canonical, DB-revalidated @/lib/org primitive — not a raw session/JWT check', () => {
    expect(CLIENTS_LIST_SOURCE).toContain("import { requireRole } from '@/lib/org'")
    expect(CLIENTS_LIST_SOURCE).not.toContain("from '@/lib/session'")
  })

  it('redirects (rather than silently rendering) when the role check throws — a non-super_admin cannot reach the page merely by navigating to it', () => {
    expect(CLIENTS_LIST_SOURCE).toMatch(/try\s*\{\s*session\s*=\s*await requireRole\('super_admin'\)\s*\}\s*catch\s*\{\s*redirect\('\/dashboard'\)\s*\}/)
  })

  it('the org-exclusion query is not reachable before the auth check — requireRole runs first in source order', () => {
    const authIndex = CLIENTS_LIST_SOURCE.indexOf("requireRole('super_admin')")
    const queryIndex = CLIENTS_LIST_SOURCE.indexOf('FROM organisations')
    expect(authIndex).toBeGreaterThan(-1)
    expect(queryIndex).toBeGreaterThan(-1)
    expect(authIndex).toBeLessThan(queryIndex)
  })
})

// ── B. Client detail authorization ──────────────────────────────────────

describe('app/clients/[id]/page.tsx — super_admin-only authorization', () => {
  it('gates the entire page behind requireRole(\'super_admin\'), independently of the list page\'s own check', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("await requireRole('super_admin')")
  })

  it('imports requireRole from the canonical @/lib/org primitive', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain("import { requireRole } from '@/lib/org'")
  })

  it('redirects when the role check throws, before any organisation lookup runs', () => {
    expect(CLIENTS_DETAIL_SOURCE).toMatch(/try\s*\{\s*await requireRole\('super_admin'\)\s*\}\s*catch\s*\{\s*redirect\('\/dashboard'\)\s*\}/)
    const authIndex = CLIENTS_DETAIL_SOURCE.indexOf("requireRole('super_admin')")
    const lookupIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM organisations')
    expect(authIndex).toBeGreaterThan(-1)
    expect(lookupIndex).toBeGreaterThan(-1)
    expect(authIndex).toBeLessThan(lookupIndex)
  })

  it('a requested organisation id that does not exist resolves to a real 404 (notFound()), not a silent/partial render', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('if (!orgs[0]) notFound()')
  })
})

// ── C. Client list query contract ───────────────────────────────────────

describe('app/clients/page.tsx — list query contract', () => {
  it('sources the list from organisations directly (no separate "clients" table)', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('FROM organisations o')
  })

  it('joins users by organisation_id to produce a user count', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('LEFT JOIN users u ON u.organisation_id = o.id')
    expect(CLIENTS_LIST_SOURCE).toContain('COUNT(DISTINCT u.id)::int  AS "userCount"')
  })

  it('joins tennis_leads by organisation_id to produce a lead count', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('LEFT JOIN tennis_leads tl ON tl.organisation_id = o.id')
    expect(CLIENTS_LIST_SOURCE).toContain('COUNT(DISTINCT tl.id)::int AS "leadCount"')
  })

  it('excludes the caller\'s own organisation using session.organisationId, not a hardcoded id', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('WHERE o.id != ${session.organisationId}')
  })

  it('selects exactly the fields the list UI depends on: id, name, slug, and the two joined counts', () => {
    expect(CLIENTS_LIST_SOURCE).toMatch(/SELECT\s+o\.id,\s+o\.name,\s+o\.slug,\s+o\.created_at,/)
    expect(CLIENTS_LIST_SOURCE).toContain('type ClientOrg = {')
    expect(CLIENTS_LIST_SOURCE).toMatch(/id: string\s+name: string\s+slug: string \| null/)
  })
})

// ── D. Client detail tenant scoping ─────────────────────────────────────

describe('app/clients/[id]/page.tsx — tenant scoping on both datasets', () => {
  it('scopes the contacts query to the requested organisation id', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM contacts')
    expect(CLIENTS_DETAIL_SOURCE).toContain('WHERE organisation_id = ${oid}')
  })

  it('scopes the tennis_leads query to the requested organisation id', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM tennis_leads')
  })

  it('every WHERE clause filtering contacts/tennis_leads in this file uses organisation_id = ${oid} — no query touches these tables without that filter', () => {
    // Guards against a future edit accidentally adding an unscoped query
    // against either table (e.g. a second contacts/tennis_leads SELECT
    // that forgets the WHERE clause).
    const contactsBlockStart = CLIENTS_DETAIL_SOURCE.indexOf('FROM contacts')
    const contactsBlockEnd = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', contactsBlockStart)
    const contactsBlock = CLIENTS_DETAIL_SOURCE.slice(contactsBlockStart, contactsBlockEnd)
    expect(contactsBlock).toContain('WHERE organisation_id = ${oid}')

    const leadsBlockStart = CLIENTS_DETAIL_SOURCE.indexOf('FROM tennis_leads')
    const leadsBlockEnd = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', leadsBlockStart)
    const leadsBlock = CLIENTS_DETAIL_SOURCE.slice(leadsBlockStart, leadsBlockEnd)
    expect(leadsBlock).toContain('WHERE organisation_id = ${oid}')
  })

  it('the organisation lookup itself (for the banner) is also scoped by id, not a bare SELECT of every org', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('SELECT id, name FROM organisations WHERE id = ${oid} LIMIT 1')
  })
})

// ── I. CRM separation ────────────────────────────────────────────────────

describe('Clients does not reference CRM persistence or API concepts (boundary test, not a CRM test)', () => {
  const FORBIDDEN_CRM_TERMS = ['crm_companies', 'crm_contacts', 'crm_deals', 'crm_activities', '/api/crm/']

  it('app/clients/page.tsx contains no CRM table/route reference', () => {
    for (const term of FORBIDDEN_CRM_TERMS) {
      expect(CLIENTS_LIST_SOURCE, `page.tsx should not reference ${term}`).not.toContain(term)
    }
  })

  it('app/clients/[id]/page.tsx contains no CRM table/route reference', () => {
    for (const term of FORBIDDEN_CRM_TERMS) {
      expect(CLIENTS_DETAIL_SOURCE, `[id]/page.tsx should not reference ${term}`).not.toContain(term)
    }
  })

  it('components/clients/ClientWorkspace.tsx contains no CRM table/route reference', () => {
    for (const term of FORBIDDEN_CRM_TERMS) {
      expect(CLIENT_WORKSPACE_SOURCE, `ClientWorkspace.tsx should not reference ${term}`).not.toContain(term)
    }
  })
})

// ── J. Founder OS separation ─────────────────────────────────────────────

describe('Clients does not depend on Founder-OS-owned persistence/API concepts', () => {
  const FORBIDDEN_FOUNDER_TERMS = ['/api/admin/founder-', 'client_onboarding', 'client_pipeline']

  it('app/clients/page.tsx contains no Founder OS table/route reference', () => {
    for (const term of FORBIDDEN_FOUNDER_TERMS) {
      expect(CLIENTS_LIST_SOURCE, `page.tsx should not reference ${term}`).not.toContain(term)
    }
  })

  it('app/clients/[id]/page.tsx contains no Founder OS table/route reference', () => {
    for (const term of FORBIDDEN_FOUNDER_TERMS) {
      expect(CLIENTS_DETAIL_SOURCE, `[id]/page.tsx should not reference ${term}`).not.toContain(term)
    }
  })

  it('components/clients/ClientWorkspace.tsx contains no Founder OS table/route reference', () => {
    for (const term of FORBIDDEN_FOUNDER_TERMS) {
      expect(CLIENT_WORKSPACE_SOURCE, `ClientWorkspace.tsx should not reference ${term}`).not.toContain(term)
    }
  })
})

// ── K. Pre-B2 baseline: no implementations/modules consumption yet ───────

describe('B1 BASELINE (intentionally temporary) — Clients does not yet read implementations or organisation_modules', () => {
  // This describe block captures the PRE-Phase-B2 state on purpose. The
  // F.7X discovery report's recommended Phase B2 slice is specifically
  // "surface implementations + organisation_modules data in Clients" —
  // so these exact assertions are EXPECTED to be removed/updated as part
  // of implementing B2, not a regression to preserve indefinitely. Their
  // purpose is to make that future removal an obvious, intentional edit
  // (grep for "B1 BASELINE" when B2 lands) rather than something that
  // looks like an unexplained, unreviewed change to test coverage.

  it('app/clients/page.tsx does not query implementations or organisation_modules', () => {
    expect(CLIENTS_LIST_SOURCE).not.toContain('implementations')
    expect(CLIENTS_LIST_SOURCE).not.toContain('organisation_modules')
  })

  it('app/clients/[id]/page.tsx does not query implementations or organisation_modules', () => {
    expect(CLIENTS_DETAIL_SOURCE).not.toContain('implementations')
    expect(CLIENTS_DETAIL_SOURCE).not.toContain('organisation_modules')
  })

  it('components/clients/ClientWorkspace.tsx does not reference implementations or organisation_modules', () => {
    expect(CLIENT_WORKSPACE_SOURCE).not.toContain('implementations')
    expect(CLIENT_WORKSPACE_SOURCE).not.toContain('organisation_modules')
  })

  it('neither page calls checkCapability/requireCapability — Clients access remains purely role-based pre-B2', () => {
    expect(CLIENTS_LIST_SOURCE).not.toMatch(/checkCapability|requireCapability/)
    expect(CLIENTS_DETAIL_SOURCE).not.toMatch(/checkCapability|requireCapability/)
  })
})
