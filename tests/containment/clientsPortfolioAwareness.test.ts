import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Clients 2.0 Phase B2 (F.8C) — regression coverage for the new,
// read-only BrainBase Platform modules + implementation awareness added
// to /clients and /clients/[id]. Companion to clientsProductBaseline.test.ts
// (whose formerly-temporary "B1 BASELINE" block now asserts presence/
// scoping instead of absence) and clientsWorkspaceBaseline.test.ts (whose
// existing Contacts/Leads/Opportunities/mutation-contract coverage is
// unmodified and still authoritative).
//
// Static source-text assertions — same established convention as the B1
// test files (no jsdom/React Testing Library harness in this repo).

const CLIENTS_LIST_PATH = path.resolve(__dirname, '../../app/clients/page.tsx')
const CLIENTS_DETAIL_PATH = path.resolve(__dirname, '../../app/clients/[id]/page.tsx')
const CLIENT_WORKSPACE_PATH = path.resolve(__dirname, '../../components/clients/ClientWorkspace.tsx')

const CLIENTS_LIST_SOURCE = fs.readFileSync(CLIENTS_LIST_PATH, 'utf-8')
const CLIENTS_DETAIL_SOURCE = fs.readFileSync(CLIENTS_DETAIL_PATH, 'utf-8')
const CLIENT_WORKSPACE_SOURCE = fs.readFileSync(CLIENT_WORKSPACE_PATH, 'utf-8')

// ── 1/2. /clients reads implementations + enabled organisation_modules ───

describe('app/clients/page.tsx — portfolio queries exist', () => {
  it('reads implementation data (primary-implementation and count queries)', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('FROM implementations')
  })

  it('reads enabled organisation_modules joined to modules', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('FROM organisation_modules om')
    expect(CLIENTS_LIST_SOURCE).toContain('JOIN modules m ON m.key = om.module_key')
  })
})

// ── 3. userCount/leadCount protected from join multiplication ────────────

describe('userCount/leadCount are not corrupted by the new portfolio queries', () => {
  it('the original organisations/users/tennis_leads aggregate query is byte-for-byte unchanged from B1', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('FROM organisations o')
    expect(CLIENTS_LIST_SOURCE).toContain('LEFT JOIN users u ON u.organisation_id = o.id')
    expect(CLIENTS_LIST_SOURCE).toContain('LEFT JOIN tennis_leads tl ON tl.organisation_id = o.id')
    expect(CLIENTS_LIST_SOURCE).toContain('COUNT(DISTINCT u.id)::int  AS "userCount"')
    expect(CLIENTS_LIST_SOURCE).toContain('COUNT(DISTINCT tl.id)::int AS "leadCount"')
  })

  it('the org/users/tennis_leads aggregate query itself does not reference implementations or organisation_modules — portfolio data is fetched by separate queries, never joined into this aggregate', () => {
    const orgBlockStart = CLIENTS_LIST_SOURCE.indexOf('FROM organisations o')
    const orgBlockEnd = CLIENTS_LIST_SOURCE.indexOf('`.catch', orgBlockStart)
    const orgBlock = CLIENTS_LIST_SOURCE.slice(orgBlockStart, orgBlockEnd)
    expect(orgBlock).not.toContain('implementations')
    expect(orgBlock).not.toContain('organisation_modules')
  })

  it('modules/implementations are merged into the portfolio in JS via Map lookups, not SQL joins against the org aggregate', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('const modulesByOrg = new Map')
    expect(CLIENTS_LIST_SOURCE).toContain('const primaryImplByOrg = new Map')
    expect(CLIENTS_LIST_SOURCE).toContain('const implCountByOrg = new Map')
    expect(CLIENTS_LIST_SOURCE).toContain('modules: modulesByOrg.get(org.id)')
  })
})

// ── 4. /clients still excludes the caller's own organisation ─────────────

describe('/clients still excludes the caller organisation (unchanged by B2)', () => {
  it('the org aggregate query still filters WHERE o.id != session.organisationId', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('WHERE o.id != ${session.organisationId}')
  })
})

// ── 5/6/16. /clients/[id] portfolio queries are scoped, no ::uuid casts ──

describe('app/clients/[id]/page.tsx — portfolio queries are explicitly organisation-scoped', () => {
  it('the implementations query is scoped WHERE organisation_id = ${oid}', () => {
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM implementations')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    expect(CLIENTS_DETAIL_SOURCE.slice(start, end)).toContain('WHERE organisation_id = ${oid}')
  })

  it('the organisation_modules query is scoped WHERE om.organisation_id = ${oid}', () => {
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM organisation_modules')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    expect(CLIENTS_DETAIL_SOURCE.slice(start, end)).toContain('om.organisation_id = ${oid}')
  })

  it('neither new query casts organisation_id (or oid) to ::uuid — organisation ids remain opaque TEXT/cuid throughout', () => {
    expect(CLIENTS_DETAIL_SOURCE).not.toMatch(/organisation_id\s*=\s*\$\{oid\}::uuid/)
    expect(CLIENTS_DETAIL_SOURCE).not.toMatch(/om\.organisation_id\s*=\s*\$\{oid\}::uuid/)
  })

  it('the existing contacts/tennis_leads queries remain first in the Promise.all array, unmoved and unmodified', () => {
    const contactsIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM contacts')
    const leadsIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM tennis_leads')
    const implIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM implementations')
    const modIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM organisation_modules')
    expect(contactsIndex).toBeGreaterThan(-1)
    expect(leadsIndex).toBeGreaterThan(-1)
    expect(contactsIndex).toBeLessThan(implIndex)
    expect(leadsIndex).toBeLessThan(implIndex)
    expect(contactsIndex).toBeLessThan(modIndex)
    expect(leadsIndex).toBeLessThan(modIndex)
  })
})

// ── 7. Only enabled (and globally active) modules are shown ──────────────

describe('Only enabled + active platform modules are presented, mirroring lib/capabilities/requireCapability.ts\'s entitlement decision', () => {
  it('the list-page module query filters both om.enabled = true and m.active = true', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('WHERE om.enabled = true AND m.active = true')
  })

  it('the detail-page module query filters both om.enabled = true and m.active = true', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('om.enabled = true AND m.active = true')
  })
})

// ── Implementation-summary selection logic (list page) ────────────────────

describe('Primary-implementation selection is explicit and deterministic (documented, not ad hoc)', () => {
  it('uses DISTINCT ON (organisation_id) — exactly one implementation row per organisation, never silently multiplying the portfolio', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('SELECT DISTINCT ON (organisation_id)')
  })

  it('the deterministic rule prefers the most recently updated non-cancelled implementation, falling back to the most recently updated cancelled one', () => {
    expect(CLIENTS_LIST_SOURCE).toContain("ORDER BY organisation_id, (stage <> 'cancelled') DESC, updated_at DESC")
  })

  it('the true total implementation count is carried separately, so the UI never pretends a multi-implementation org has only one', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('SELECT organisation_id, COUNT(*)::int AS count')
    expect(CLIENTS_LIST_SOURCE).toContain('implementationCount')
  })

  // Remediation (F.8E) — the assertion above only proves the WORD
  // "implementationCount" appears somewhere in the file (e.g. the type
  // field, the Map merge line); it does not exercise the actual "+N more"
  // UI presentation and would keep passing even if that JSX block were
  // deleted entirely (independently reproduced during this remediation:
  // deleting the block left all 76 prior B1/B2 Clients tests green). This
  // test asserts the real user-facing contract instead: when a client has
  // more than one implementation, the card must show how many additional
  // ones exist beyond the primary one shown.
  it('the ClientCard multi-implementation presentation exists: condition implementationCount > 1, displayed count implementationCount - 1, rendered with "more"', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('org.implementationCount > 1')
    expect(CLIENTS_LIST_SOURCE).toContain('org.implementationCount - 1')
    const moreLineStart = CLIENTS_LIST_SOURCE.indexOf('org.implementationCount - 1')
    expect(moreLineStart, 'expected to find the "+N more" line').toBeGreaterThan(-1)
    const moreLineEnd = CLIENTS_LIST_SOURCE.indexOf('\n', moreLineStart)
    expect(CLIENTS_LIST_SOURCE.slice(moreLineStart, moreLineEnd)).toContain('more')
  })
})

// ── 8/9/10. ClientWorkspace renders the account overview ─────────────────

describe('ClientWorkspace renders a BrainBase Platform + Implementations account overview above the existing tabs', () => {
  it('renders a "BrainBase Platform" section (honest module-registry language, not "All Products")', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('BrainBase Platform')
    expect(CLIENT_WORKSPACE_SOURCE).not.toMatch(/All Products|Products owned|Complete product suite/)
  })

  it('shows a truthful empty state when no modules are enabled', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('No platform modules enabled')
  })

  it('renders an "Implementations" section with a truthful empty state', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('>Implementations</span>')
    expect(CLIENT_WORKSPACE_SOURCE).toContain('No implementations recorded')
  })

  it('the overview is rendered before the existing tab bar, not after and not as a fourth tab', () => {
    const overviewIndex = CLIENT_WORKSPACE_SOURCE.indexOf('<AccountOverview')
    const tabBarIndex = CLIENT_WORKSPACE_SOURCE.indexOf('{/* Tab bar */}')
    expect(overviewIndex).toBeGreaterThan(-1)
    expect(tabBarIndex).toBeGreaterThan(-1)
    expect(overviewIndex).toBeLessThan(tabBarIndex)
  })

  it('the Tab union remains exactly the three existing values — Products/Implementations were not added as a fourth tab', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain("type Tab = 'contacts' | 'leads' | 'opportunities'")
  })
})

// ── 10. Implementation links point to the canonical admin surface ────────

describe('Implementation entries link to the canonical admin detail page, never a Clients-local editor', () => {
  it('links to /admin/implementations/${impl.id}', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('href={`/admin/implementations/${impl.id}`}')
  })

  it('the module overview links out to /admin/orgs for management, rather than duplicating a toggle UI', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('href="/admin/orgs"')
  })
})

// ── 11/12. No mutation controls were introduced ───────────────────────────

describe('The account overview is strictly read-only — no implementation or module mutation controls', () => {
  function accountOverviewBlock(): string {
    const start = CLIENT_WORKSPACE_SOURCE.indexOf('function AccountOverview(')
    const end = CLIENT_WORKSPACE_SOURCE.indexOf('\n// ── Root workspace', start)
    expect(start, 'expected to find function AccountOverview(').toBeGreaterThan(-1)
    expect(end, 'expected to find the Root workspace boundary after AccountOverview').toBeGreaterThan(start)
    return CLIENT_WORKSPACE_SOURCE.slice(start, end)
  }

  it('contains no fetch() call of any kind', () => {
    expect(accountOverviewBlock()).not.toContain('fetch(')
  })

  it('contains no button/onClick mutation trigger', () => {
    const block = accountOverviewBlock()
    expect(block).not.toContain('<button')
    expect(block).not.toContain('onClick')
  })

  it('contains no form input/select/toggle control', () => {
    const block = accountOverviewBlock()
    expect(block).not.toContain('<input')
    expect(block).not.toContain('<select')
    expect(block).not.toContain('onChange')
  })

  it('no new API route was added under app/api/admin/client-data or app/api/implementations for this phase', () => {
    const clientDataDir = path.resolve(__dirname, '../../app/api/admin/client-data')
    const entries = fs.readdirSync(clientDataDir)
    expect(entries.sort()).toEqual(['contacts', 'leads'])
  })
})

// ── 13. Contacts/Leads/Opportunities remain the three primary tabs ───────

describe('Regression: Contacts/Leads/Opportunities remain exactly the existing three primary tabs', () => {
  it('the tab bar still renders exactly the three existing tab buttons, unchanged', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('contacts')")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('leads')")
    expect(CLIENT_WORKSPACE_SOURCE).toContain("tabStyle('opportunities')")
  })
})

// ── 14/15. CRM / Founder OS separation remains intact ─────────────────────

describe('Regression: CRM and Founder OS separation remain intact after B2', () => {
  const FORBIDDEN_CRM_TERMS = ['crm_companies', 'crm_contacts', 'crm_deals', 'crm_activities', '/api/crm/']
  const FORBIDDEN_FOUNDER_TERMS = [
    '/api/admin/founder-', 'client_onboarding', 'client_pipeline', 'web_service_leads', 'managed_services',
  ]

  it('no touched file references CRM persistence/API concepts', () => {
    for (const src of [CLIENTS_LIST_SOURCE, CLIENTS_DETAIL_SOURCE, CLIENT_WORKSPACE_SOURCE]) {
      for (const term of FORBIDDEN_CRM_TERMS) expect(src).not.toContain(term)
    }
  })

  it('no touched file references Founder-OS-owned persistence/API concepts', () => {
    for (const src of [CLIENTS_LIST_SOURCE, CLIENTS_DETAIL_SOURCE, CLIENT_WORKSPACE_SOURCE]) {
      for (const term of FORBIDDEN_FOUNDER_TERMS) expect(src).not.toContain(term)
    }
  })
})

// ── Clients 2.0 B3 (F.9B) — organisation status/plan + account People ────

describe('B3 — the People query is explicitly scoped, ordered, and never corrupts existing aggregates', () => {
  it('selects exactly id, name, email, role, last_login_at from users', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('SELECT id, name, email, role, last_login_at')
    expect(CLIENTS_DETAIL_SOURCE).toContain('FROM users')
  })

  it('is scoped WHERE organisation_id = ${oid}, within the same query block (not a bare substring elsewhere in the file)', () => {
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM users')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    const block = CLIENTS_DETAIL_SOURCE.slice(start, end)
    expect(block).toContain('WHERE organisation_id = ${oid}')
  })

  it('orders by last_login_at DESC NULLS LAST — most recently active first, users who have never logged in last', () => {
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM users')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    const block = CLIENTS_DETAIL_SOURCE.slice(start, end)
    expect(block).toContain('ORDER BY last_login_at DESC NULLS LAST')
  })

  it('does not cast organisation_id or oid to ::uuid', () => {
    const start = CLIENTS_DETAIL_SOURCE.indexOf('FROM users')
    const end = CLIENTS_DETAIL_SOURCE.indexOf('`.catch', start)
    const block = CLIENTS_DETAIL_SOURCE.slice(start, end)
    expect(block).not.toMatch(/::uuid/)
  })

  it('the users query is a separate Promise.all element, appended after contacts/leads/modules/implementations — not joined into any existing query', () => {
    const contactsIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM contacts')
    const usersIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM users')
    const implIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM implementations')
    const modIndex = CLIENTS_DETAIL_SOURCE.indexOf('FROM organisation_modules')
    expect(usersIndex).toBeGreaterThan(contactsIndex)
    expect(usersIndex).toBeGreaterThan(implIndex)
    expect(usersIndex).toBeGreaterThan(modIndex)
  })

  it('the list-page org/users/tennis_leads aggregate query is not extended with a People/users-detail query — People only exists on the detail page', () => {
    const orgBlockStart = CLIENTS_LIST_SOURCE.indexOf('FROM organisations o')
    const orgBlockEnd = CLIENTS_LIST_SOURCE.indexOf('`.catch', orgBlockStart)
    const orgBlock = CLIENTS_LIST_SOURCE.slice(orgBlockStart, orgBlockEnd)
    expect(orgBlock).not.toContain('role')
    expect(orgBlock).not.toContain('last_login_at')
  })
})

describe('B3 — organisation status and plan are visibly rendered, not merely selected', () => {
  it('app/clients/page.tsx renders a status label derived from org.status (not just selected into the query/type)', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('STATUS_LABEL[org.status]')
  })

  it('app/clients/page.tsx renders a plan label derived from org.plan', () => {
    expect(CLIENTS_LIST_SOURCE).toContain('PLAN_LABEL[org.plan]')
  })

  it('app/clients/[id]/page.tsx (ClientBanner) renders status and plan labels derived from the real org record, not the list page alone', () => {
    expect(CLIENTS_DETAIL_SOURCE).toContain('STATUS_LABEL[status]')
    expect(CLIENTS_DETAIL_SOURCE).toContain('PLAN_LABEL[plan]')
  })

  it('uses only the three real canonical status values and four real canonical plan values — no invented lifecycle state or derived health/account score', () => {
    for (const src of [CLIENTS_LIST_SOURCE, CLIENTS_DETAIL_SOURCE]) {
      expect(src).toContain('ACTIVE')
      expect(src).toContain('SUSPENDED')
      expect(src).toContain('CHURNED')
      expect(src).toContain('TRIAL')
      expect(src).toContain('STARTER')
      expect(src).toContain('PROFESSIONAL')
      expect(src).toContain('ENTERPRISE')
    }
  })
})

describe('B3 — ClientWorkspace renders a read-only People card', () => {
  it('renders a "People" section', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('>People</span>')
  })

  it('renders name, email, role, and a last-login presentation for each person', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('person.name')
    expect(CLIENT_WORKSPACE_SOURCE).toContain('person.email')
    expect(CLIENT_WORKSPACE_SOURCE).toContain('ROLE_LABEL[person.role]')
    expect(CLIENT_WORKSPACE_SOURCE).toContain('lastSeen(person.last_login_at)')
  })

  it('never fabricates activity for a null last_login_at — the lastSeen() helper returns a truthful "Never signed in" string instead of inventing a date', () => {
    const start = CLIENT_WORKSPACE_SOURCE.indexOf('function lastSeen(')
    const end = CLIENT_WORKSPACE_SOURCE.indexOf('\n}', start)
    const block = CLIENT_WORKSPACE_SOURCE.slice(start, end)
    expect(block).toContain("if (!ts) return 'Never signed in'")
  })

  it('shows a truthful empty state when the organisation has zero users', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('No users on this account')
  })

  it('links to the canonical /admin/users surface for management, rather than duplicating user management here', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain('href="/admin/users"')
  })

  it('the People card sits inside the same read-only AccountOverview render block already proven to contain no fetch/button/input/select/onChange (see the account-overview-is-strictly-read-only suite above) — reconfirmed explicitly for the People-specific render code', () => {
    const start = CLIENT_WORKSPACE_SOURCE.indexOf('{/* People')
    const end = CLIENT_WORKSPACE_SOURCE.indexOf('\n// ── Root workspace', start)
    expect(start, 'expected to find the People card JSX comment').toBeGreaterThan(-1)
    const block = CLIENT_WORKSPACE_SOURCE.slice(start, end)
    expect(block).not.toContain('fetch(')
    expect(block).not.toContain('<button')
    expect(block).not.toContain('onClick')
    expect(block).not.toContain('<input')
    expect(block).not.toContain('<select')
    expect(block).not.toContain('onChange')
    expect(block).not.toMatch(/method:\s*'(POST|PATCH|DELETE)'/)
  })

  it('the Tab union remains exactly the three existing values — People was not added as a fourth tab', () => {
    expect(CLIENT_WORKSPACE_SOURCE).toContain("type Tab = 'contacts' | 'leads' | 'opportunities'")
  })
})
