import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.7J — restores CRM as a real,
// standalone BrainBase product surface. Phase F.7I established that
// commit 61fb116 ("Consolidate business management into Founder OS")
// deliberately repointed the Operations -> CRM nav item from /crm to
// /admin/founder and tombstoned every CRM list page — a decision this
// phase's product authorization explicitly reverses. Static source-text
// assertions — this project has no jsdom/React Testing Library harness
// (same established convention already used by
// organiserCanonicalRoute.test.ts and founderOsDefaultDashboard.test.ts
// for their own server-side/navigation invariants).

const TOPNAV_PATH = path.resolve(__dirname, '../../components/nav/TopNav.tsx')
const CRM_LAYOUT_PATH = path.resolve(__dirname, '../../app/crm/layout.tsx')
const CRM_OVERVIEW_PATH = path.resolve(__dirname, '../../app/crm/page.tsx')
const CRM_COMPANIES_PATH = path.resolve(__dirname, '../../app/crm/companies/page.tsx')
const CRM_CONTACTS_PATH = path.resolve(__dirname, '../../app/crm/contacts/page.tsx')
const CRM_DEALS_PATH = path.resolve(__dirname, '../../app/crm/deals/page.tsx')
const CRM_ACTIVITIES_PATH = path.resolve(__dirname, '../../app/crm/activities/page.tsx')
const FOUNDER_PAGE_PATH = path.resolve(__dirname, '../../app/admin/founder/page.tsx')
const FOUNDER_CLIENTS_API_PATH = path.resolve(__dirname, '../../app/api/admin/founder-clients/route.ts')

const TOPNAV_SOURCE = fs.readFileSync(TOPNAV_PATH, 'utf-8')
const CRM_LAYOUT_SOURCE = fs.readFileSync(CRM_LAYOUT_PATH, 'utf-8')
const CRM_OVERVIEW_SOURCE = fs.readFileSync(CRM_OVERVIEW_PATH, 'utf-8')
const CRM_COMPANIES_SOURCE = fs.readFileSync(CRM_COMPANIES_PATH, 'utf-8')
const CRM_CONTACTS_SOURCE = fs.readFileSync(CRM_CONTACTS_PATH, 'utf-8')
const CRM_DEALS_SOURCE = fs.readFileSync(CRM_DEALS_PATH, 'utf-8')
const CRM_ACTIVITIES_SOURCE = fs.readFileSync(CRM_ACTIVITIES_PATH, 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(FOUNDER_PAGE_PATH, 'utf-8')
const FOUNDER_CLIENTS_API_SOURCE = fs.readFileSync(FOUNDER_CLIENTS_API_PATH, 'utf-8')

const CRM_PAGE_SOURCES = [CRM_OVERVIEW_SOURCE, CRM_COMPANIES_SOURCE, CRM_CONTACTS_SOURCE, CRM_DEALS_SOURCE, CRM_ACTIVITIES_SOURCE]

// ── 1. Operations -> CRM canonical destination ─────────────────────────────

describe('Operations -> CRM nav item targets the standalone CRM product', () => {
  it('the OPS_ITEMS CRM entry href is /crm', () => {
    const opsBlockStart = TOPNAV_SOURCE.indexOf('const OPS_ITEMS = [')
    const opsBlockEnd = TOPNAV_SOURCE.indexOf('];', opsBlockStart)
    const opsBlock = TOPNAV_SOURCE.slice(opsBlockStart, opsBlockEnd)
    const crmEntryStart = opsBlock.indexOf("label: 'CRM'")
    const crmEntry = opsBlock.slice(crmEntryStart, opsBlock.indexOf('},', crmEntryStart))
    expect(crmEntry).toContain("href: '/crm'")
  })

  it('no OPS_ITEMS entry (CRM or otherwise) targets /admin/founder', () => {
    const opsBlockStart = TOPNAV_SOURCE.indexOf('const OPS_ITEMS = [')
    const opsBlockEnd = TOPNAV_SOURCE.indexOf('];', opsBlockStart)
    const opsBlock = TOPNAV_SOURCE.slice(opsBlockStart, opsBlockEnd)
    expect(opsBlock).not.toContain('/admin/founder')
  })

  it('Waste, Fleet, and Social entries are unchanged — this was a scoped fix, not a broad nav redesign', () => {
    expect(TOPNAV_SOURCE).toContain("href: '/dashboard/wste'")
    expect(TOPNAV_SOURCE).toContain("href: '/dashboard/fleet'")
    expect(TOPNAV_SOURCE).toContain("href: '/dashboard/social'")
  })
})

// ── 5. Capability-aware navigation ──────────────────────────────────────────

describe('Operations -> CRM visibility is capability-aware', () => {
  it('the CRM OPS_ITEMS entry carries a capabilityKey of "crm"', () => {
    const opsBlockStart = TOPNAV_SOURCE.indexOf('const OPS_ITEMS = [')
    const opsBlockEnd = TOPNAV_SOURCE.indexOf('];', opsBlockStart)
    const opsBlock = TOPNAV_SOURCE.slice(opsBlockStart, opsBlockEnd)
    const crmEntryStart = opsBlock.indexOf("label: 'CRM'")
    const crmEntry = opsBlock.slice(crmEntryStart, opsBlock.indexOf('},', crmEntryStart))
    expect(crmEntry).toContain("capabilityKey: 'crm'")
  })

  it('OpsDropdown filters items by capabilityKey against enabledCapabilities — an item with a key is shown only when present', () => {
    expect(TOPNAV_SOURCE).toContain('!item.capabilityKey ||')
    expect(TOPNAV_SOURCE).toContain('enabledCapabilities.includes(')
  })

  it('OpsDropdown receives enabledCapabilities as a prop from its caller', () => {
    const dropdownCallStart = TOPNAV_SOURCE.indexOf('<OpsDropdown')
    const dropdownCall = TOPNAV_SOURCE.slice(dropdownCallStart, TOPNAV_SOURCE.indexOf('/>', dropdownCallStart) + 2)
    expect(dropdownCall).toContain('enabledCapabilities')
  })

  it('the Session type and the /api/me response mapping both carry enabledCapabilities, matching the established enabledModules pattern', () => {
    expect(TOPNAV_SOURCE).toContain('enabledCapabilities?: string[]')
    expect(TOPNAV_SOURCE).toContain('enabledCapabilities: (')
  })

  it('app/layout.tsx computes enabledCapabilities server-side from organisation_modules/modules and passes it through serverSession — required because serverSession (not the client /api/me fetch) is what actually renders', () => {
    const rootLayout = fs.readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf-8')
    expect(rootLayout).toContain('enabledCapabilities')
    expect(rootLayout).toContain('FROM organisation_modules om')
    expect(rootLayout).toMatch(/JOIN modules m ON m\.key = om\.module_key/)
  })
})

// ── 2/10. No tombstone remains in any standalone CRM page ──────────────────

describe('Standalone CRM pages no longer render the Founder OS tombstone', () => {
  it('none of the five standalone CRM pages import or render CrmMoved', () => {
    for (const src of CRM_PAGE_SOURCES) {
      expect(src).not.toContain('CrmMoved')
    }
  })

  it('none of the five standalone CRM pages contain the "moved to Founder OS" messaging', () => {
    for (const src of CRM_PAGE_SOURCES) {
      expect(src).not.toMatch(/is now managed in Founder OS/i)
      expect(src).not.toMatch(/moved to Founder OS/i)
    }
  })

  it('no standalone CRM page links to /admin/founder', () => {
    for (const src of CRM_PAGE_SOURCES) {
      expect(src).not.toContain('/admin/founder')
    }
    expect(CRM_LAYOUT_SOURCE).not.toContain('/admin/founder')
  })

  it('the CRM layout no longer carries deprecation-notice or dimmed-navigation presentation', () => {
    expect(CRM_LAYOUT_SOURCE).not.toContain('Moved to Founder OS')
    expect(CRM_LAYOUT_SOURCE).not.toMatch(/opacity:\s*0\.4/)
  })

  it('the CrmMoved tombstone component itself no longer exists — proven unused before removal, not left behind as dead code', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../app/crm/_components/CrmMoved.tsx'))).toBe(false)
  })
})

// ── 3. CRM stays outside the super_admin-only Founder OS layout ────────────

describe('CRM remains outside app/admin/** and is not super_admin-gated', () => {
  it('app/crm/layout.tsx exists as its own layout (not nested under app/admin/)', () => {
    expect(fs.existsSync(CRM_LAYOUT_PATH)).toBe(true)
    expect(fs.existsSync(path.resolve(__dirname, '../../app/admin/crm'))).toBe(false)
  })

  it('the CRM layout does not require super_admin — unlike app/admin/layout.tsx, which gates its whole subtree to it', () => {
    expect(CRM_LAYOUT_SOURCE).not.toContain("role !== 'super_admin'")
    expect(CRM_LAYOUT_SOURCE).not.toContain("'super_admin'")
  })

  it("app/admin/layout.tsx's own super_admin gate is unchanged — this phase did not weaken or touch it", () => {
    const adminLayout = fs.readFileSync(path.resolve(__dirname, '../../app/admin/layout.tsx'), 'utf-8')
    expect(adminLayout).toContain("session.role !== 'super_admin'")
  })
})

// ── 4. Page-level capability enforcement ────────────────────────────────────

describe('CRM capability enforcement is enforced at the page/layout level, not only the API level', () => {
  it('the CRM layout resolves a real, DB-revalidated session via requireSession() — the same primitive app/api/crm/** routes use', () => {
    expect(CRM_LAYOUT_SOURCE).toContain("import { requireSession } from '@/lib/org'")
    expect(CRM_LAYOUT_SOURCE).toContain('await requireSession()')
  })

  it('the CRM layout checks the "crm" capability via the canonical checkCapability primitive — not a new parallel mechanism', () => {
    expect(CRM_LAYOUT_SOURCE).toContain("import { checkCapability } from '@/lib/capabilities/requireCapability'")
    expect(CRM_LAYOUT_SOURCE).toContain("checkCapability(session.organisationId, 'crm')")
  })

  it('an unentitled organisation renders a clear non-functioning state, not the actual CRM UI (children are not rendered when the capability check fails)', () => {
    const deniedBranchStart = CRM_LAYOUT_SOURCE.indexOf('if (!capability.allowed)')
    const deniedBranchEnd = CRM_LAYOUT_SOURCE.indexOf('\n  }', deniedBranchStart)
    const deniedBranch = CRM_LAYOUT_SOURCE.slice(deniedBranchStart, deniedBranchEnd)
    expect(deniedBranch).not.toContain('{children}')
  })

  it('an entitled organisation renders the real CRM shell (sidebar + children)', () => {
    expect(CRM_LAYOUT_SOURCE).toContain('<CrmSidebar')
    expect(CRM_LAYOUT_SOURCE).toContain('{children}')
  })
})

// ── 6-9. List pages use the current /api/crm/** contract ───────────────────

describe('Restored list pages call the current, unchanged /api/crm/** contract', () => {
  it('Companies list fetches /api/crm/companies', () => {
    expect(CRM_COMPANIES_SOURCE).toContain("fetch('/api/crm/companies')")
  })
  it('Contacts list fetches /api/crm/contacts', () => {
    // Contact classification phase added an optional ?classification=
    // query param (lib/crm/classification.ts's own filter), so the fetch
    // call became a template literal rather than the earlier plain
    // string literal — the base endpoint contract this test guards is
    // unchanged, matching the same template-literal style already used
    // below for the Deals/Activities detail-route fetches.
    expect(CRM_CONTACTS_SOURCE).toContain('fetch(`/api/crm/contacts')
  })
  it('Deals list fetches /api/crm/deals and PUTs stage changes to /api/crm/deals/${id}', () => {
    expect(CRM_DEALS_SOURCE).toContain("fetch('/api/crm/deals')")
    expect(CRM_DEALS_SOURCE).toContain('fetch(`/api/crm/deals/${dealId}`')
  })
  it('Activities list fetches /api/crm/activities and deletes via /api/crm/activities/${id}', () => {
    expect(CRM_ACTIVITIES_SOURCE).toContain("fetch('/api/crm/activities")
    expect(CRM_ACTIVITIES_SOURCE).toContain('fetch(`/api/crm/activities/${id}`')
  })
  it('none of the restored pages call any /api/admin/founder-* endpoint', () => {
    for (const src of CRM_PAGE_SOURCES) {
      expect(src).not.toMatch(/\/api\/admin\/founder-/)
    }
  })
})

// ── 11. Detail-page integration ─────────────────────────────────────────────

describe('Restored list pages link to the existing, live CRM detail pages', () => {
  it('Companies list links each row to /crm/companies/${id}, matching the existing app/crm/companies/[id]/page.tsx route', () => {
    expect(CRM_COMPANIES_SOURCE).toContain('`/crm/companies/${c.id}`')
    expect(fs.existsSync(path.resolve(__dirname, '../../app/crm/companies/[id]/page.tsx'))).toBe(true)
  })
  it('Contacts list links each row to /crm/contacts/${id}, matching the existing app/crm/contacts/[id]/page.tsx route', () => {
    expect(CRM_CONTACTS_SOURCE).toContain('`/crm/contacts/${c.id}`')
    expect(fs.existsSync(path.resolve(__dirname, '../../app/crm/contacts/[id]/page.tsx'))).toBe(true)
  })
})

// ── 12. Founder OS is untouched ─────────────────────────────────────────────

describe('Founder OS is untouched by the CRM restoration', () => {
  it('Founder OS still sources its own "clients" pipeline from the separate founder-clients API, not /api/crm/**', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("fetch('/api/admin/founder-clients')")
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/fetch\(['"`]\/api\/crm\//)
  })

  it('the founder-clients API still proxies to the external founder backend and is still super_admin-gated — unchanged by this phase', () => {
    expect(FOUNDER_CLIENTS_API_SOURCE).toContain("session.role !== 'super_admin'")
    expect(FOUNDER_CLIENTS_API_SOURCE).toContain('NEXT_PUBLIC_API_URL')
  })

  it('no CRM page reads from or writes to the founder-clients/founder-action APIs, and no Founder OS code reads from crm_companies/crm_contacts/crm_deals/crm_activities', () => {
    for (const src of CRM_PAGE_SOURCES) {
      expect(src).not.toMatch(/founder-clients|founder-action/)
    }
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/crm_companies|crm_contacts|crm_deals|crm_activities/)
  })
})
