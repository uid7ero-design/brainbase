import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Clients 2.0 Phase B1 (F.7Y) — regression-test foundation for the CURRENT
// /clients and /clients/[id] product, established BEFORE any Phase B2
// redesign begins (see the F.7X discovery report). This file protects the
// page-level architecture: authorization, the list query contract, and
// tenant scoping on the detail page, plus explicit boundary assertions
// proving Clients does not depend on CRM or Founder OS persistence.
//
// Phase B2 (F.8C) intentionally invalidated the B1 "does not yet consume
// implementations/organisation_modules" baseline block — see the
// "B2: Clients now reads..." describe block below (formerly "B1 BASELINE"),
// updated to assert the new, correctly-scoped read paths instead of their
// absence. tests/containment/clientsPortfolioAwareness.test.ts carries the
// more detailed B2 coverage (join-multiplication protection, implementation-
// summary selection, module enabled-filtering, UI rendering).
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

  it('excludes the caller\'s own organisation using session.homeOrganisationId (the founder\'s TRUE org, unaffected by org_override impersonation), not a hardcoded id and not the override-substituted session.organisationId', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('WHERE o.id != ${session.homeOrganisationId}')
    expect(CLIENTS_LIST_SOURCE).not.toContain('WHERE o.id != ${session.organisationId}')
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
    expect(CLIENTS_DETAIL_SOURCE).toContain('SELECT id, name, status, plan FROM organisations WHERE id = ${oid} LIMIT 1')
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
  const FORBIDDEN_FOUNDER_TERMS = [
    '/api/admin/founder-', 'client_onboarding', 'client_pipeline', 'web_service_leads', 'managed_services',
  ]

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

// ── K. B2: Clients now reads implementations + organisation_modules ──────

describe('B2 (F.8C) — Clients now reads implementations and organisation_modules, correctly scoped', () => {
  // Formerly "B1 BASELINE" — this describe block previously asserted the
  // ABSENCE of implementations/organisation_modules reads. Phase B2
  // deliberately introduced them (portfolio/account-overview awareness),
  // so this block now asserts their PRESENCE with correct scoping instead.
  // Deeper B2-specific coverage (join-multiplication protection,
  // implementation-summary selection, enabled-only module filtering, UI
  // rendering) lives in clientsPortfolioAwareness.test.ts.

  it('app/clients/page.tsx now queries both implementations and organisation_modules', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('FROM implementations')
    expect(CLIENTS_LIST_SOURCE).toContain('FROM organisation_modules')
  })

  it('app/clients/[id]/page.tsx now queries both implementations and organisation_modules, each scoped by organisation_id = ${oid}', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM implementations')
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM organisation_modules')
    const implBlockStart = CLIENTS_DETAIL_SOURCE.indexOf('FROM implementations')
    const implBlockEnd = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', implBlockStart)
    expect(CLIENTS_DETAIL_SOURCE.slice(implBlockStart, implBlockEnd)).toContain('WHERE organisation_id = ${oid}')

    const modBlockStart = CLIENTS_DETAIL_SOURCE.indexOf('FROM organisation_modules')
    const modBlockEnd = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', modBlockStart)
    expect(CLIENTS_DETAIL_SOURCE.slice(modBlockStart, modBlockEnd)).toContain('om.organisation_id = ${oid}')
  })

  it('components/clients/ClientWorkspace.tsx now references both implementations and organisation modules via typed props, not a direct query (it is a client component)', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('export type Implementation')
    expect(CLIENT_WORKSPACE_SOURCE).toContain('export type PlatformModule')
    expect(CLIENT_WORKSPACE_SOURCE).not.toMatch(/await sql`/)
  })

  it('neither page CALLS checkCapability(/requireCapability( — Clients access remains purely role-based, unchanged by B2 (the detail page comment mentions requireCapability.ts by name as documentation only, not an invocation, so this checks for an actual call rather than a bare substring)', () => {
    expect(CLIENTS_LIST_SOURCE).not.toMatch(/checkCapability\(|requireCapability\(/)
    expect(CLIENTS_DETAIL_SOURCE).not.toMatch(/checkCapability\(|requireCapability\(/)
  })
})

// ── L. B3: organisation status/plan + account People, correctly scoped ──

describe('B3 (F.9B) — Clients now reads organisation status/plan and account People', () => {
  it('app/clients/page.tsx selects o.status and o.plan in the org aggregate query', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('o.status,')
    expect(CLIENTS_LIST_SOURCE).toContain('o.plan,')
  })

  it('app/clients/[id]/page.tsx selects status and plan in the id-scoped organisation lookup', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('SELECT id, name, status, plan FROM organisations WHERE id = ${oid} LIMIT 1')
  })

  it('app/clients/[id]/page.tsx now queries users (People), scoped by organisation_id = ${oid}', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM users')
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM users')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    const block = CLIENTS_DETAIL_SOURCE.slice(start, end)
    expect(block).toContain('WHERE organisation_id = ${oid}')
    expect(block).toContain('ORDER BY last_login_at DESC NULLS LAST')
  })

  it('the People query selects exactly the required canonical fields', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('SELECT id, name, email, role, last_login_at')
  })

  it('the People query is never joined into the list-page org/users/tennis_leads aggregate — it lives only in app/clients/[id]/page.tsx', () => {
    expect(CLIENTS_LIST_SOURCE).not.toContain('last_login_at')
  })

  it('components/clients/ClientWorkspace.tsx defines a Person type for account-user visibility', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('export type Person')
  })
})
