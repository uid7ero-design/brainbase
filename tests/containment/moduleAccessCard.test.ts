import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

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

describe('ModuleAccessCard — client dashboard "Your Tools" entry', () => {
  it('renders the Events & Ticketing title, description, and Open Events CTA from the wireframe', () => {
    expect(cardSource).toContain('Events & Ticketing')
    expect(cardSource).toContain('Create and manage events, registrations and tickets')
    expect(cardSource).toContain('Open Events')
  })

  it("the Events entry's destination is /events, not derived from any per-organisation path", () => {
    expect(cardSource).toMatch(/href:\s*'\/events'/)
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
    expect(cardSource).toMatch(/entries\s*=\s*MODULE_ENTRIES\.filter\(e => enabledCapabilities\.includes\(e\.key\)\)/)
  })

  it('is a reusable module list, not an Events-only special case — a future capability is added as a new MODULE_ENTRIES row, not a new component', () => {
    expect(cardSource).toMatch(/const MODULE_ENTRIES: ModuleEntry\[\] = \[/)
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
    expect(tennisSource).toMatch(/<ModuleAccessCard enabledCapabilities=\{enabledCapabilities\} \/>/)
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
    expect(cardSource).toMatch(/<CapabilityIcon capability=\{entry\.key\}/)
    // The capability id passed through is the same `entry.key` MODULE_ENTRIES
    // and the enabledCapabilities filter already use — not a second,
    // hand-picked identifier.
    expect(cardSource).not.toMatch(/capability=["'](crm|events|organiser)["']/)
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
    expect(cardSource).toMatch(/entries\s*=\s*MODULE_ENTRIES\.filter\(e => enabledCapabilities\.includes\(e\.key\)\)/)
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
    const shrinkCount = (topNavSource.match(/flexShrink: 0,/g) ?? []).length
    // 5 distinct item/wrapper components carry the fix; >= keeps this
    // resilient to incidental additional flexShrink:0 usages elsewhere in
    // the file without being a false negative if the count grows.
    expect(shrinkCount).toBeGreaterThanOrEqual(5)
  })

  it('the existing capability-gated Events link is untouched (still present, still gated) in both the client-org and internal-staff nav branches', () => {
    const eventsOccurrences = (topNavSource.match(/enabledCapabilities\.includes\(\s*\n?\s*'events',?\s*\n?\s*\)/g) ?? []).length
    expect(eventsOccurrences).toBe(2)
    expect(topNavSource).toMatch(/href="\/events"/)
  })
})
