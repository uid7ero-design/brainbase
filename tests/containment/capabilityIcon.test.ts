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

describe('CapabilityIcon — not wired into any live production surface yet (D.4 is audit + isolated POC only)', () => {
  it('no production page/component imports CapabilityIcon', () => {
    const candidates = [
      'app/page.tsx',
      'app/dashboard/page.tsx',
      'components/dashboard/ModuleAccessCard.tsx',
      'components/nav/TopNav.tsx',
      'components/ops/Sidebar.tsx',
      'components/dashboard/OrganisationDashboard.tsx',
      'components/dashboard/TennisDashboard.tsx',
    ]
    for (const file of candidates) {
      const src = read(file)
      expect(src).not.toMatch(/CapabilityIcon/)
    }
  })
})
