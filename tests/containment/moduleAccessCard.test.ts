import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { WORK_ITEMS, resolveNav, workModuleCards, type NavLink } from '@/components/nav/navModel'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts file in this suite, e.g.
// dashboardPolishStaticCheck.test.ts). The underlying capability-gating
// mechanism itself (organisation_modules / enabledCapabilities / the
// authorizeEventsRequest chain /events sits behind server-side) is already
// covered by this repo's existing containment tests and was NOT modified
// by this task — these tests assert the new UI-layer discoverability
// pieces only: the client-dashboard "Your Tools" card and TopNav's
// narrow-viewport fix.

const cardSource       = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/ModuleAccessCard.tsx'), 'utf-8')
const brainBaseSource  = fs.readFileSync(path.resolve(__dirname, '../../components/BrainBase.jsx'), 'utf-8')
const tennisSource     = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TennisDashboard.tsx'), 'utf-8')
const topNavSource     = fs.readFileSync(path.resolve(__dirname, '../../components/nav/TopNav.tsx'), 'utf-8')
const pageSource       = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/page.tsx'), 'utf-8')
// Nav consolidation update (feat/authenticated-nav-consolidation): the module
// list (labels, hrefs, gates) moved out of ModuleAccessCard into the shared
// pure nav model; the card now derives its rows from workModuleCards().
const navModelSource   = fs.readFileSync(path.resolve(__dirname, '../../components/nav/navModel.ts'), 'utf-8')

describe('ModuleAccessCard — client dashboard "Your Tools" entry', () => {
  it('renders the Events & Ticketing title, description, and Open Events CTA from the wireframe', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // title now comes from the navModel 'events' descriptor label (rendered
    // via title: link.label); description + CTA copy stay in the card.
    expect(navModelSource).toContain("label: 'Events & Ticketing'")
    expect(cardSource).toMatch(/title:\s*link\.label/)
    expect(cardSource).toContain('Create and manage events, registrations and tickets')
    expect(cardSource).toContain('Open Events')
    const events = workModuleCards({ role: 'viewer', enabledCapabilities: ['events'], dashboardVariant: null })
    expect(events.map(l => l.label)).toEqual(['Events & Ticketing'])
  })

  it("the Events entry's destination is /events, not derived from any per-organisation path", () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): href
    // lives in the navModel descriptor; the card passes link.href through.
    expect(navModelSource).toMatch(/id:\s*'events',\s*label:\s*'Events & Ticketing',\s*href:\s*'\/events'/)
    expect(cardSource).toMatch(/href:\s*link\.href/)
    const events = workModuleCards({ role: 'viewer', enabledCapabilities: ['events'], dashboardVariant: null })
    expect(events.map(l => l.href)).toEqual(['/events'])
  })

  it('is driven entirely by an enabledCapabilities prop, computed server-side from the same capability projection app/api/me/route.ts already runs — not a second capability system, and not a client-side fetch that would flash empty on first paint', () => {
    expect(cardSource).toContain('enabledCapabilities')
    expect(cardSource).not.toMatch(/fetch\(/)
    expect(pageSource).toContain("JOIN modules m ON m.key = om.module_key")
    expect(pageSource).toContain('om.enabled = true')
    expect(pageSource).toContain('m.active = true')
  })

  it('never hardcodes School Test Organisation or LD Tennis — entirely capability-key driven, works for any organisation', () => {
    expect(cardSource.toLowerCase()).not.toContain('school-test-organisation')
    expect(cardSource.toLowerCase()).not.toContain('school test organisation')
    expect(cardSource.toLowerCase()).not.toContain('ld-tennis')
    expect(cardSource.toLowerCase()).not.toContain('ld tennis')
    // No organisation id/slug is threaded through the component itself —
    // it only ever receives the already-resolved capability key list.
    expect(cardSource).not.toMatch(/organisationId|organisationSlug|orgId|orgSlug/)
  })

  it("app/dashboard/page.tsx (the caller) never hardcodes an organisation id or slug when computing enabledCapabilities — scoped only by the authenticated session's own organisationId", () => {
    const capBlockIdx = pageSource.indexOf('enabledCapabilities: string[] = []')
    expect(capBlockIdx).toBeGreaterThan(-1)
    const capBlock = pageSource.slice(capBlockIdx, capBlockIdx + 500)
    expect(capBlock).toContain('session.organisationId')
    expect(capBlock.toLowerCase()).not.toContain('school-test-organisation')
    expect(capBlock.toLowerCase()).not.toContain('ld-tennis')
  })

  it('renders nothing (returns null) when no configured capability is enabled — never an empty "Your Tools" section, never a dead-end card for an org without events', () => {
    const returnNullIdx = cardSource.indexOf('if (entries.length === 0) return null')
    expect(returnNullIdx).toBeGreaterThan(-1)
    // The filter that produces `entries` must be capability-gated, not an
    // unconditional list of every configured module.
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // capability filter is now workModuleCards() in navModel; entries is
    // derived from it, and it returns [] when nothing is enabled.
    expect(cardSource).toMatch(/entries: ModuleEntry\[\]\s*=\s*workModuleCards\(\{ role, enabledCapabilities, dashboardVariant \}\)/)
    expect(workModuleCards({ role: 'admin', enabledCapabilities: [], dashboardVariant: null })).toEqual([])
    expect(workModuleCards({ role: '', enabledCapabilities: [], dashboardVariant: null })).toEqual([])
    // Only documented capability bypass: super_admin always sees People.
    expect(workModuleCards({ role: 'super_admin', enabledCapabilities: [], dashboardVariant: null }).map(l => l.id)).toEqual(['people'])
    expect(workModuleCards({ role: 'admin', enabledCapabilities: [], dashboardVariant: 'ld-tennis' })).toEqual([])
  })

  it('is a reusable module list, not an Events-only special case — a future capability is added as a new MODULE_ENTRIES row, not a new component', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // reusable row list is now the navModel WORK_ITEMS descriptor array
    // (card: true entries); a future module is one descriptor there.
    expect(navModelSource).toMatch(/export const WORK_ITEMS: readonly NavEntry\[\] = \[/)
    const cardIds = WORK_ITEMS.filter((e): e is NavLink => e.kind === 'link' && e.card === true).map(e => e.id)
    // Assurance was added exactly this way: one WORK_ITEMS descriptor, no card code change.
    expect(cardIds).toEqual(['events', 'crm', 'commercial', 'organiser', 'people', 'assurance'])
    expect(cardSource).not.toMatch(/const MODULE_ENTRIES/)
  })

  it('fails closed: a capability-query error in the caller yields an empty array, not a thrown error that blocks the dashboard from rendering', () => {
    const capBlockIdx = pageSource.indexOf('let enabledCapabilities: string[] = []')
    const catchBlock = pageSource.slice(capBlockIdx, capBlockIdx + 700)
    expect(catchBlock).toMatch(/catch\s*\{/)
  })
})

describe('Client dashboard mounting — School Test Organisation (BrainBase shell) and LD Tennis (TennisDashboard)', () => {
  it('BrainBase.jsx (the generic client shell every non-LD-Tennis, non-Brainbase-HQ organisation lands on at /dashboard) imports ModuleAccessCard and passes through its own enabledCapabilities prop', () => {
    expect(brainBaseSource).toContain("import { ModuleAccessCard } from \"./dashboard/ModuleAccessCard\"")
    expect(brainBaseSource).toContain('function BrainBase({ enabledCapabilities = [], isSuperAdmin = false })')
    expect(brainBaseSource).toMatch(/<ModuleAccessCard enabledCapabilities=\{enabledCapabilities\} \/>/)
  })

  it('TennisDashboard.tsx (LD Tennis\'s own bespoke /dashboard body) also imports ModuleAccessCard and passes through its own enabledCapabilities prop, so the same capability-driven entry appears there too', () => {
    expect(tennisSource).toContain("import { ModuleAccessCard } from './ModuleAccessCard'")
    expect(tennisSource).toContain('enabledCapabilities?: string[]')
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // TennisDashboard now also forwards the real role so role-gated modules
    // (Organiser: manager+) are offered where the route admits the user.
    expect(tennisSource).toMatch(/<ModuleAccessCard enabledCapabilities=\{enabledCapabilities\} role=\{role\} \/>/)
    expect(tennisSource).toContain('role?: string')
  })

  // Updated during the D.2.3 origin/main reconciliation merge: the
  // generic fallthrough no longer renders <BrainBase enabledCapabilities
  // ={...} isSuperAdmin={...} /> — Phase C.2C replaced it with
  // OrganisationDashboard (see organisationDashboardSeparation.test.ts),
  // which is what actually renders on this branch for every non-LD-
  // Tennis, non-Brainbase-HQ organisation today. BrainBase.jsx's own
  // enabledCapabilities-forwarding to ModuleAccessCard (asserted above)
  // remains structurally correct — it is simply no longer reached from
  // this call site; its one remaining caller is the session-less
  // auth-failure fallback (see navPersonaCoverage.test.ts).
  it('app/dashboard/page.tsx passes the server-computed enabledCapabilities into both dashboard variants that are actually reachable today (TennisDashboard and OrganisationDashboard)', () => {
    expect(pageSource).toMatch(/<TennisDashboard[\s\S]{0,900}enabledCapabilities=\{enabledCapabilities\}/)
    expect(pageSource).toMatch(/<OrganisationDashboard[\s\S]{0,300}enabledCapabilities=\{enabledCapabilities\}/)
  })
})

describe('ModuleAccessCard — Phase D.4.1 CapabilityIcon wiring', () => {
  it('imports and renders CapabilityIcon, passing only the canonical capability id — no icon/colour lookup logic duplicated locally', () => {
    expect(cardSource).toContain("import { CapabilityIcon } from '@/components/brand/CapabilityIcon'")
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // icon key now comes from the navModel descriptor's `icon` (entry.icon =
    // link.icon ?? link.id) — the same descriptor the capability gate lives
    // on, not a second hand-picked identifier.
    expect(cardSource).toMatch(/<CapabilityIcon capability=\{entry\.icon\}/)
    expect(cardSource).toMatch(/icon:\s*link\.icon \?\? link\.id/)
    expect(cardSource).not.toMatch(/capability=["'](crm|events|organiser|quotes|people)["']/)
  })

  it('title/description/href/cta ownership stays entirely with ModuleAccessCard/MODULE_ENTRIES — CapabilityIcon receives no copy or routing props', () => {
    const iconCallIdx = cardSource.indexOf('<CapabilityIcon capability=')
    const iconCallEnd = cardSource.indexOf('/>', iconCallIdx)
    const iconCall = cardSource.slice(iconCallIdx, iconCallEnd)
    expect(iconCall).not.toMatch(/title=|description=|href=|cta=/)
    // Title/description/CTA/href still come from the same MODULE_ENTRIES
    // rows and entry.* accessors as before this phase.
    expect(cardSource).toMatch(/\{entry\.title\}/)
    expect(cardSource).toMatch(/\{entry\.description\}/)
    expect(cardSource).toMatch(/\{entry\.cta\}/)
    expect(cardSource).toMatch(/href=\{entry\.href\}/)
  })

  it('no entitlement/gating logic moved into CapabilityIcon — the enabledCapabilities filter still lives in ModuleAccessCard alone', () => {
    const iconSource = fs.readFileSync(path.resolve(__dirname, '../../components/brand/CapabilityIcon.tsx'), 'utf-8')
    // Comment-stripped: the header documents the shared `capability`
    // id in prose (mentions enabledCapabilities to explain provenance),
    // which is not the same as the component actually reading it.
    const iconCode = iconSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(iconCode).not.toMatch(/enabledCapabilities/)
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // gating filter moved from a local MODULE_ENTRIES.filter to the shared
    // navModel.workModuleCards — still outside CapabilityIcon.
    expect(cardSource).toMatch(/entries: ModuleEntry\[\]\s*=\s*workModuleCards\(\{ role, enabledCapabilities, dashboardVariant \}\)/)
    expect(iconCode).not.toMatch(/workModuleCards|navModel/)
  })

  it('the icon is decorative (no aria-label passed) since the card title right below it already supplies an accessible name', () => {
    const iconCallIdx = cardSource.indexOf('<CapabilityIcon capability=')
    const iconCallEnd = cardSource.indexOf('/>', iconCallIdx)
    const iconCall = cardSource.slice(iconCallIdx, iconCallEnd)
    expect(iconCall).not.toMatch(/label=/)
  })

  it('an unmapped capability id would not crash the card — CapabilityIcon itself falls back to a neutral glyph rather than throwing', () => {
    const iconSource = fs.readFileSync(path.resolve(__dirname, '../../components/brand/CapabilityIcon.tsx'), 'utf-8')
    expect(iconSource).toMatch(/CAPABILITY_ICON_MAP\[capability\]/)
    expect(iconSource).not.toMatch(/throw /)
  })

  it('existing card behaviour (capability gating, empty-state null return, non-hardcoded org) is unchanged by the icon wiring', () => {
    expect(cardSource).toContain('if (entries.length === 0) return null')
    expect(cardSource.toLowerCase()).not.toContain('ld-tennis')
    expect(cardSource.toLowerCase()).not.toContain('school-test-organisation')
  })
})

describe('TopNav — Events remains reachable when the authenticated nav is crowded/narrow', () => {
  it('the centre nav row scrolls horizontally instead of clipping/squeezing pill text when it does not fit', () => {
    const centreIdx = topNavSource.indexOf('{/* Centre navigation')
    expect(centreIdx).toBeGreaterThan(-1)
    const centreBlock = topNavSource.slice(centreIdx, centreIdx + 1200)
    expect(centreBlock).toContain("overflowX: 'auto'")
  })

  it('every nav item (NavItem, HlnaItem, SquadItem, OpsDropdown, AdminDropdown) is flexShrink: 0, so items keep their legible natural width and the row scrolls instead of squeezing text', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // five bespoke item components (NavItem, HlnaItem, SquadItem,
    // OpsDropdown, AdminDropdown) collapsed into two generic ones — NavPill
    // (every top-level link, incl. HLNA) and NavMenu (every dropdown
    // wrapper: Work/Manage/Brainbase/Account). Each must still be
    // flexShrink: 0.
    const pillIdx = topNavSource.indexOf('function NavPill(')
    expect(pillIdx).toBeGreaterThan(-1)
    const pillBlock = topNavSource.slice(pillIdx, topNavSource.indexOf('\n}\n', pillIdx))
    expect(pillBlock).toMatch(/style=\{\{ flexShrink: 0 \}\}/)
    const menuIdx = topNavSource.indexOf('function NavMenu(')
    expect(menuIdx).toBeGreaterThan(-1)
    const menuBlock = topNavSource.slice(menuIdx, topNavSource.indexOf('\n}\n', menuIdx))
    expect(menuBlock).toMatch(/style=\{\{ position: 'relative', flexShrink: 0 \}\}/)
    // No other top-level item component exists that could skip the fix.
    expect(topNavSource).not.toMatch(/function (NavItem|HlnaItem|SquadItem|OpsDropdown|AdminDropdown)\(/)
    const shrinkCount = (topNavSource.match(/flexShrink: 0\b/g) ?? []).length
    expect(shrinkCount).toBeGreaterThanOrEqual(3)
  })

  it('the existing capability-gated Events link is untouched (still present, still gated) in both the client-org and internal-staff nav branches', () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // two per-branch `enabledCapabilities.includes('events')` checks became
    // ONE navModel descriptor gated on the 'events' capability, rendered by
    // TopNav's single universal path for every tenant variant.
    expect(navModelSource).toMatch(/id:\s*'events',\s*label:\s*'Events & Ticketing',\s*href:\s*'\/events'[\s\S]{0,200}gate:\s*\{\s*anyCapability:\s*\['events'\]\s*\}/)
    expect(topNavSource).toMatch(/resolveNav\(\{ role, enabledCapabilities, dashboardVariant \}\)/)
    expect(topNavSource).not.toMatch(/enabledCapabilities\.includes\(/)
    for (const variant of [null, 'ld-tennis', 'brainbase-hq'] as const) {
      for (const role of ['viewer', 'super_admin']) {
        const withEvents = resolveNav({ role, enabledCapabilities: ['events'], dashboardVariant: variant })
        expect(withEvents.work.some(e => e.kind === 'link' && e.id === 'events' && e.href === '/events')).toBe(true)
        const without = resolveNav({ role, enabledCapabilities: [], dashboardVariant: variant })
        expect(without.work.some(e => e.id === 'events')).toBe(false)
      }
    }
  })
})
