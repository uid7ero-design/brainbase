import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase D.4 — proof-of-concept only. CapabilityIcon maps a canonical
// capability id to a small icon+container treatment. It must never become a
// second source of truth for entitlements/routes/display labels, and must
// never be wired into a live production surface during this phase — this
// test protects both boundaries via static source-text containment (this
// repo's established convention, see AGENTS.md/CLAUDE.md — no jsdom/RTL
// harness exists).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const source = read('components/brand/CapabilityIcon.tsx')
const code = stripComments(source)
const packageJson = read('package.json')

describe('CapabilityIcon — component identity and API', () => {
  it('exists as a shared, exported component with a small, disciplined prop API', () => {
    expect(source).toMatch(/export function CapabilityIcon\(/)
    expect(source).toMatch(/capability:\s*string/)
    expect(source).toMatch(/size\?:\s*CapabilityIconSize/)
    expect(source).toMatch(/state\?:\s*CapabilityIconState/)
  })

  it('maps only the three capability ids confirmed to exist in `modules` today', () => {
    expect(code).toMatch(/crm:\s*{\s*Icon:\s*Users/)
    expect(code).toMatch(/events:\s*{\s*Icon:\s*Ticket/)
    expect(code).toMatch(/organiser:\s*{\s*Icon:\s*CalendarClock/)
  })

  it('reuses lucide-react — no new icon dependency introduced', () => {
    expect(code).toMatch(/from 'lucide-react'/)
    const lucideMatches = packageJson.match(/"lucide-react":\s*"\^?1\.8\.0"/g) ?? []
    expect(lucideMatches.length).toBe(1)
    expect(packageJson).not.toMatch(/@heroicons|react-icons|phosphor-icons|@tabler\/icons/)
  })

  it('falls back to a neutral placeholder glyph for an unmapped capability id instead of throwing', () => {
    expect(code).toMatch(/LayoutGrid/)
    expect(code).toMatch(/CAPABILITY_ICON_MAP\[capability\]/)
    expect(code).not.toMatch(/throw /)
  })
})

describe('CapabilityIcon — sizing and container recipe', () => {
  it('supports the three required render sizes: 16 / 20 / 24 px icon glyphs', () => {
    expect(code).toMatch(/sm:\s*{\s*icon:\s*16/)
    expect(code).toMatch(/md:\s*{\s*icon:\s*20/)
    expect(code).toMatch(/lg:\s*{\s*icon:\s*24/)
  })

  it('the default (md) container matches the exact recipe already shipped on the homepage CAPABILITIES cards', () => {
    expect(code).toMatch(/md:\s*{\s*icon:\s*20,\s*container:\s*38,\s*radius:\s*9\s*}/)
  })

  it('accent colours for crm/events are byte-identical to the homepage CAPABILITIES card colours', () => {
    const homepage = read('app/page.tsx')
    expect(code).toContain("color: '#8A4DFF'")
    expect(homepage).toContain("color: '#8A4DFF'")
    expect(code).toContain("color: '#FBBF24'")
    expect(homepage).toContain("color: '#FBBF24'")
  })
})

describe('CapabilityIcon — states', () => {
  it('supports default / hover / active / disabled states', () => {
    expect(source).toMatch(/export type CapabilityIconState = 'default' \| 'hover' \| 'active' \| 'disabled'/)
  })

  it('disabled state desaturates to a neutral treatment rather than reusing the accent colour', () => {
    const start = code.indexOf('const disabled = ')
    const end = code.indexOf('return (', start)
    const disabledBlock = code.slice(start, end)
    expect(disabledBlock).toMatch(/rgba\(255,255,255,\.35\)/)
    expect(disabledBlock).toMatch(/rgba\(255,255,255,\.03\)/)
  })
})

describe('CapabilityIcon — accessibility', () => {
  it('is aria-hidden by default (icon-only, no label) and only exposes an accessible name when a caller supplies one', () => {
    expect(code).toMatch(/aria-hidden=\{label \? undefined : 'true'\}/)
    expect(code).toMatch(/aria-label=\{label\}/)
  })
})

describe('CapabilityIcon — does not duplicate business logic', () => {
  it('never imports a capability/entitlement/session/db source', () => {
    expect(code).not.toMatch(/requireCapability|requireSession|requireRole/)
    expect(code).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(code).not.toMatch(/from ['"]@\/lib\/capabilities/)
    expect(code).not.toMatch(/from ['"]@\/lib\/org['"]/)
  })

  it('never hardcodes a route/href', () => {
    expect(code).not.toMatch(/href\s*[:=]/)
    expect(code).not.toMatch(/\/(crm|events|organiser)['"`]/)
  })
})

describe('CapabilityIcon — production wiring boundary (Phase D.4.3: + Events/CRM module headers)', () => {
  // D.4 shipped this component fully isolated. D.4.1 approved ModuleAccessCard.
  // D.4.2 approved TopNav (capability-gated items only). D.4.3 approved exactly
  // two more, both module-level page headers: EventsListClient.tsx and
  // app/crm/page.tsx. Every other candidate surface named in the D.4 migration
  // strategy/D.4.3 audit stays untouched; this test protects that boundary
  // going forward.
  it('components/dashboard/ModuleAccessCard.tsx is an approved production call site', () => {
    const src = read('components/dashboard/ModuleAccessCard.tsx')
    expect(src).toMatch(/import \{ CapabilityIcon \} from '@\/components\/brand\/CapabilityIcon'/)
    expect(src).toMatch(/<CapabilityIcon capability=/)
  })

  it('components/nav/TopNav.tsx is an approved production call site (Phase D.4.2)', () => {
    const src = read('components/nav/TopNav.tsx')
    expect(src).toMatch(/import \{ CapabilityIcon \} from '@\/components\/brand\/CapabilityIcon'/)
    expect(src).toMatch(/<CapabilityIcon\b/)
  })

  it('app/events/EventsListClient.tsx is now an approved production call site (Phase D.4.3) — the module landing page\'s own heading, capability="events"', () => {
    const src = read('app/events/EventsListClient.tsx')
    expect(src).toMatch(/import \{ CapabilityIcon \} from '@\/components\/brand\/CapabilityIcon'/)
    expect(src).toMatch(/<CapabilityIcon capability="events"/)
  })

  it('app/crm/page.tsx is now an approved production call site (Phase D.4.3) — the module landing page\'s own heading, capability="crm"', () => {
    const src = read('app/crm/page.tsx')
    expect(src).toMatch(/import \{ CapabilityIcon \} from '@\/components\/brand\/CapabilityIcon'/)
    expect(src).toMatch(/<CapabilityIcon capability="crm"/)
  })

  it('ops Sidebar is NOT a call site — architecturally a separate, non-capability icon system by design', () => {
    const src = read('components/ops/Sidebar.tsx')
    expect(src).not.toMatch(/CapabilityIcon/)
  })

  it('the homepage remains untouched — marketing precedent, not a migration target', () => {
    const src = read('app/page.tsx')
    expect(src).not.toMatch(/CapabilityIcon/)
  })

  it('OrganisationDashboard and TennisDashboard do not import CapabilityIcon directly — any icon they render reaches them only through their existing ModuleAccessCard composition, not a second direct import', () => {
    const orgDashboard = read('components/dashboard/OrganisationDashboard.tsx')
    const tennisDashboard = read('components/dashboard/TennisDashboard.tsx')
    expect(orgDashboard).not.toMatch(/import.*CapabilityIcon/)
    expect(tennisDashboard).not.toMatch(/import.*CapabilityIcon/)
    // Both already compose ModuleAccessCard directly (asserted in
    // moduleAccessCard.test.ts) — confirmed here only as the precondition
    // for why they legitimately render CapabilityIcon transitively.
    expect(orgDashboard).toMatch(/ModuleAccessCard/)
    expect(tennisDashboard).toMatch(/ModuleAccessCard/)
  })
})

describe('CapabilityIcon — Phase D.4.3 secondary-surface audit boundary', () => {
  // Phase D.4.4E superseded the "deliberately left unimplemented" note
  // below: Organiser is now a first-class TopNav item (capability="organiser"
  // on the NavItem, asserted in the TopNav section further down) and has
  // its own dedicated identity treatment in its rail header — see
  // components/organiser/OrganiserRail.tsx and organiserShellBoundary.test.ts.
  // app/organiser/page.tsx itself still does not import CapabilityIcon
  // directly (the identity lives in OrganiserRail/TopNav, not the page
  // body) — that narrower claim still holds and is asserted below.
  it('app/organiser/page.tsx does not import CapabilityIcon directly — the module identity now lives in OrganiserRail\'s header and TopNav\'s NavItem, not the page body itself', () => {
    const src = read('app/organiser/page.tsx')
    expect(src).not.toMatch(/CapabilityIcon/)
  })

  it('components/organiser/OrganiserRail.tsx DOES import and render CapabilityIcon capability="organiser" — its module identity header, the one deliberate non-TopNav placement recommended by the D.4.4D-R audit', () => {
    const src = read('components/organiser/OrganiserRail.tsx')
    expect(src).toMatch(/import \{ CapabilityIcon \} from '@\/components\/brand\/CapabilityIcon'/)
    expect(src).toMatch(/<CapabilityIcon\s*\n?\s*capability="organiser"/)
  })

  it('app/dashboard/pipeline/page.tsx (Requests) does NOT import CapabilityIcon — audited: not a real capability, no `modules` row exists for it', () => {
    const src = read('app/dashboard/pipeline/page.tsx')
    expect(src).not.toMatch(/CapabilityIcon/)
  })

  it('public Events surfaces do NOT import CapabilityIcon — internal module identity stays off unauthenticated, tenant-branded pages', () => {
    const publicFiles = [
      'app/e/[organisationSlug]/PublicEventsHubClient.tsx',
      'app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx',
      'app/e/[organisationSlug]/[eventSlug]/checkout/success/page.tsx',
    ]
    for (const file of publicFiles) {
      const src = read(file)
      expect(src).not.toMatch(/CapabilityIcon/)
    }
  })

  it('BrainBase HQ\'s app/clients/** (internal customer-success tool) does NOT import CapabilityIcon as `crm` — a different concept from the tenant\'s own crm capability', () => {
    const clientsPage = read('app/clients/page.tsx')
    expect(clientsPage).not.toMatch(/CapabilityIcon/)
  })

  it('Founder OS\'s AdminClient.tsx "CRM clients" (founder pipeline) column does NOT import CapabilityIcon — a third, unrelated meaning of "CRM", never the tenant capability', () => {
    const adminClient = read('app/admin/orgs/AdminClient.tsx')
    expect(adminClient).not.toMatch(/CapabilityIcon/)
  })

  it('Events action/sub-screen icons (Calendar, MapPin, ChevronRight in EventsListClient.tsx; the check-in/payments/detail screens) are untouched — the identity icon addition did not replace or remove any existing action icon', () => {
    const eventsListSrc = read('app/events/EventsListClient.tsx')
    expect(eventsListSrc).toMatch(/import \{ Calendar, MapPin, ChevronRight \} from 'lucide-react'/)
    const checkIn = read('app/events/[id]/check-in/CheckInClient.tsx')
    const payments = read('app/events/payments/PaymentsClient.tsx')
    const detail = read('app/events/[id]/EventDetailClient.tsx')
    expect(checkIn).not.toMatch(/CapabilityIcon/)
    expect(payments).not.toMatch(/CapabilityIcon/)
    expect(detail).not.toMatch(/CapabilityIcon/)
  })
})

describe('CapabilityIcon — container prop (Phase D.4.2: dense-context treatment)', () => {
  it('supports an opt-out `container` prop, defaulting to true (ModuleAccessCard\'s existing full-tile usage is unaffected)', () => {
    expect(source).toMatch(/container\?:\s*boolean/)
    expect(code).toMatch(/container = true/)
  })

  it('container=false sizes the wrapper to exactly the glyph and strips background/border/radius — it does not just hide them visually', () => {
    const start = code.indexOf('return (')
    const returnBlock = code.slice(start)
    expect(returnBlock).toMatch(/width:\s*container\s*\?\s*containerSize\s*:\s*icon/)
    expect(returnBlock).toMatch(/height:\s*container\s*\?\s*containerSize\s*:\s*icon/)
    expect(returnBlock).toMatch(/background:\s*container\s*\?\s*background\s*:\s*'transparent'/)
    expect(returnBlock).toMatch(/border:\s*container\s*\?\s*border\s*:\s*'none'/)
  })
})

describe('CapabilityIcon — TopNav wiring specifics (Phase D.4.2)', () => {
  const topNavSource = read('components/nav/TopNav.tsx')
  const topNavCode = stripComments(topNavSource)

  // Phase D.4.4E added Organiser as a third genuinely capability-gated
  // TopNav item (LD Tennis + generic branches, mirroring Events/CRM) — the
  // call-site count grows from 4 to 6 accordingly, and "organiser" is now
  // a valid capability id here, not an excluded one. Phase C3 added a
  // fourth mirrored item, Commercial (gated on 'quotes') — count grows
  // from 6 to 8.
  it('TopNav only ever passes a capability icon to genuinely capability-gated items — exactly 8 call sites (LD Tennis Events/CRM/Commercial/Organiser + generic Events & Ticketing/CRM/Commercial/Organiser), never a fifth capability id', () => {
    const capabilityProps = topNavCode.match(/capability="[a-z]+"/g) ?? []
    expect(capabilityProps).toHaveLength(8)
    for (const prop of capabilityProps) {
      expect(['capability="events"', 'capability="crm"', 'capability="organiser"', 'capability="quotes"']).toContain(prop)
    }
  })

  it('TopNav uses container={false} for every CapabilityIcon usage — the compact, un-boxed nav treatment, not ModuleAccessCard\'s full tile', () => {
    const iconCallCount = (topNavCode.match(/<CapabilityIcon/g) ?? []).length
    const compactCallCount = (topNavCode.match(/container=\{false\}/g) ?? []).length
    expect(iconCallCount).toBeGreaterThan(0)
    expect(compactCallCount).toBe(iconCallCount)
  })

  it('HLNA is never rendered via CapabilityIcon — HlnaItem keeps its own distinct wordmark identity', () => {
    const start = topNavCode.indexOf('function HlnaItem(')
    const end = topNavCode.indexOf('\n}', start)
    const hlnaItemBody = topNavCode.slice(start, end)
    expect(hlnaItemBody).not.toMatch(/CapabilityIcon/)
  })

  // For a given label, find every <NavItem ... label="X" .../> block (a
  // label may legitimately appear more than once — e.g. "Requests" exists
  // in both the LD Tennis and generic branches) and assert none of them
  // carry a capability prop.
  function allNavItemBlocksForLabel(label: string): string[] {
    const blocks: string[] = []
    let searchFrom = 0
    for (;;) {
      const labelIdx = topNavCode.indexOf(`label="${label}"`, searchFrom)
      if (labelIdx === -1) break
      const blockStart = topNavCode.lastIndexOf('<NavItem', labelIdx)
      const blockEnd = topNavCode.indexOf('/>', labelIdx)
      blocks.push(topNavCode.slice(blockStart, blockEnd))
      searchFrom = labelIdx + label.length
    }
    return blocks
  }

  it('Dashboard, Requests, and every HQ-only item (Founder OS, Command, Reports, Data, Clients) never receive a capability prop', () => {
    for (const label of ['Dashboard', 'Requests', 'Founder OS', 'Command', 'Reports', 'Data', 'Clients']) {
      const blocks = allNavItemBlocksForLabel(label)
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block).not.toMatch(/capability=/)
      }
    }
  })

  it('LD Tennis bespoke items (Leads, Sessions, Blog) never receive a capability prop', () => {
    for (const label of ['Leads', 'Sessions', 'Blog']) {
      const blocks = allNavItemBlocksForLabel(label)
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block).not.toMatch(/capability=/)
      }
    }
    // SquadItem is its own component (not NavItem) and was not touched.
    expect(topNavCode).not.toMatch(/<SquadItem[\s\S]{0,80}capability=/)
  })

  it('OpsDropdown\'s own internal CRM shortcut (Brainbase HQ-internal Operations panel) was audited and deliberately left as a text-only row — a structurally different dropdown-row pattern, not a top-level nav pill, so it is out of this phase\'s scope', () => {
    const opsStart = topNavCode.indexOf('const OPS_ITEMS')
    const opsEnd = topNavCode.indexOf('function OpsDropdown')
    const opsItemsBlock = topNavCode.slice(opsStart, opsEnd)
    expect(opsItemsBlock).toMatch(/capabilityKey:\s*'crm'/)
    expect(opsItemsBlock).not.toMatch(/CapabilityIcon/)
  })
})
