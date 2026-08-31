import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Phase D.1 — Hybrid Orbit brand rollout, global assets + core surfaces.
// Static source-text containment per this repo's convention (no jsdom/RTL
// harness — see AGENTS.md/CLAUDE.md and every prior phase's test file).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

const topNavSource = read('components/nav/TopNav.tsx')
const wordmarkSource = read('components/brand/BrainBaseWordmark.tsx')
const hlnaWorkspaceSource = read('components/helena/HelenaWorkspace.jsx')
const loginSource = read('app/login/page.tsx')
const homepageSource = read('app/page.tsx')
const layoutSource = read('app/layout.tsx')
const helenaOrbitalSource = read('components/brand/HelenaOrbital.tsx')

// Phase D.2 — secondary public surfaces.
const webSystemsSource = read('app/web-systems/page.tsx')
const signupSource = read('app/signup/page.tsx')
const requestDemoSource = read('app/request-demo/page.tsx')
const clientOperationsSource = read('app/client-operations/page.tsx')
const clientOperationsDemoSource = read('app/client-operations/demo/page.tsx')
const demoSource = read('app/demo/page.tsx')
const connectSource = read('app/connect/page.tsx')
const publicEventClientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')

const D2_SURFACES: Array<[string, string]> = [
  ['web-systems', webSystemsSource],
  ['signup', signupSource],
  ['request-demo', requestDemoSource],
  ['client-operations', clientOperationsSource],
  ['client-operations/demo', clientOperationsDemoSource],
  ['demo', demoSource],
  ['connect', connectSource],
  ['PublicEventClient', publicEventClientSource],
]

describe('Phase D.1 — TopNav uses the approved Hybrid Orbit brand asset', () => {
  it('Logo renders BrainBaseWordmark, not a raw brainbase-logo-dark.svg Image', () => {
    expect(topNavSource).toContain("import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark'")
    const logoFnStart = topNavSource.indexOf('function Logo(')
    const logoFnEnd = topNavSource.indexOf('\n// ─', logoFnStart + 1)
    const logoBody = topNavSource.slice(logoFnStart, logoFnEnd)
    expect(logoBody).toContain('<BrainBaseWordmark')
    expect(logoBody).not.toContain('brainbase-logo-dark.svg')
  })

  it('the old next/image Image import is gone now that Logo no longer uses it directly', () => {
    expect(topNavSource).not.toMatch(/import Image from 'next\/image'/)
  })

  it('BrainBaseWordmark itself references the approved kit-copied asset, with an accessible alt', () => {
    expect(wordmarkSource).toContain("src=\"/Brand/brainbase-horizontal-color.svg\"")
    expect(wordmarkSource).toMatch(/alt="BR.INB.SE"/)
  })
})

describe('Phase D.1 — no accidental external brand-kit path at runtime', () => {
  const productionSources = [topNavSource, wordmarkSource, hlnaWorkspaceSource, loginSource, homepageSource, layoutSource]
  it('no production file references the external OneDrive brand-kit path', () => {
    for (const src of productionSources) {
      expect(src).not.toMatch(/OneDrive/i)
      expect(src).not.toContain('Brainbase The Brand Kit')
      expect(src).not.toContain('BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE')
    }
  })

  it('BrainBaseWordmark only ever references a repository-owned /Brand/ runtime path', () => {
    expect(wordmarkSource).toMatch(/src="\/Brand\//)
    expect(wordmarkSource).not.toMatch(/[A-Za-z]:[\\/]/)
  })
})

describe('Phase D.1 — /hlna keeps HelenaOrbital for the living assistant; the static mark never substitutes for it', () => {
  it('HelenaWorkspace.jsx still imports and renders HelenaOrbital for the living visual', () => {
    expect(hlnaWorkspaceSource).toContain('import { HelenaOrbital } from "../brand/HelenaOrbital"')
    expect(hlnaWorkspaceSource).toMatch(/<HelenaOrbital/)
  })

  it('the static BrainBaseWordmark is used only in the page header, never as a replacement for HelenaOrbital in the main content', () => {
    expect(hlnaWorkspaceSource).toContain('import { BrainBaseWordmark } from "../brand/BrainBaseWordmark"')
    const headerStart = hlnaWorkspaceSource.indexOf('<header')
    const headerEnd = hlnaWorkspaceSource.indexOf('</header>', headerStart) + '</header>'.length
    const headerRegion = hlnaWorkspaceSource.slice(headerStart, headerEnd)
    expect(headerRegion).toContain('<BrainBaseWordmark')
    // HelenaOrbital must not appear inside the static header region.
    expect(headerRegion).not.toContain('HelenaOrbital')
    // And BrainBaseWordmark must not appear outside the header (i.e. not
    // duplicated into the main two-column conversation area).
    const outsideHeader = hlnaWorkspaceSource.slice(0, headerStart) + hlnaWorkspaceSource.slice(headerEnd)
    expect(outsideHeader).not.toContain('<BrainBaseWordmark')
  })

  it('HelenaOrbital.tsx itself is untouched by this phase (motion system locked)', () => {
    // No brand-kit or wordmark reference should ever appear inside the
    // living assistant's own motion component.
    expect(helenaOrbitalSource).not.toContain('BrainBaseWordmark')
    expect(helenaOrbitalSource).not.toContain('brainbase-horizontal-color')
  })
})

describe('Phase D.1 — tenant-aware nav remains intact', () => {
  it('isLdTennis / isBrainbaseHQ classification, Dashboard/HLNA/Events entries, and the dropdown positioning fix are all still present', () => {
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'ld-tennis'/)
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'brainbase-hq'/)
    expect(topNavSource).toContain('href="/dashboard"')
    expect(topNavSource).toMatch(/<HlnaItem\s*\n\s*href="\/hlna"/)
    expect(topNavSource).toContain('href="/events"')
    expect(topNavSource).toContain('hasEvents')
    // Dropdown positioning fix — superseded during the D.2.3 origin/main
    // reconciliation: C.2F's own plain-position:'fixed' implementation
    // (panelPos/triggerRef) was replaced with origin/main's independently-
    // developed createPortal(..., document.body) implementation (coords/
    // wrapperRef), judged strictly more robust — see
    // founderNavDropdownRegression.test.ts for the dedicated suite.
    expect(topNavSource).toContain('coords')
    expect(topNavSource).toContain('wrapperRef')
    expect(topNavSource).toContain('createPortal')
    expect(topNavSource).toMatch(/position:\s*'fixed'/)
  })

  it('does not reintroduce the old isClientOrg heuristic', () => {
    expect(topNavSource).not.toContain('isClientOrg')
    expect(topNavSource).not.toContain('enabledModules.length')
  })
})

describe('Phase D.1 — favicon / metadata reference resolvable repository-owned files', () => {
  it('app/layout.tsx metadata still points at repository /Brand/ paths, and those files exist', () => {
    expect(layoutSource).toContain("url: '/Brand/favicon.ico'")
    expect(layoutSource).toContain("url: '/Brand/android-chrome-192x192.png'")
    expect(layoutSource).toContain("url: '/Brand/android-chrome-512x512.png'")
    expect(layoutSource).toContain("url: '/Brand/apple-touch-icon.png'")

    for (const relPath of [
      'public/Brand/favicon.ico',
      'public/Brand/android-chrome-192x192.png',
      'public/Brand/android-chrome-512x512.png',
      'public/Brand/apple-touch-icon.png',
      'public/Brand/brainbase-horizontal-color.svg',
      'app/favicon.ico',
    ]) {
      expect(fs.existsSync(path.join(root, relPath)), `${relPath} must exist on disk`).toBe(true)
    }
  })
})

describe('Phase D.1 — replaced surfaces no longer reference the old lens-style logo', () => {
  it('TopNav, /hlna header, login, and homepage no longer reference brainbase-logo-dark.svg', () => {
    for (const [name, src] of [
      ['TopNav', topNavSource],
      ['HelenaWorkspace', hlnaWorkspaceSource],
      ['login', loginSource],
      ['homepage', homepageSource],
    ] as const) {
      expect(src, `${name} must not still reference the old lens-style logo`).not.toContain('brainbase-logo-dark.svg')
    }
  })

  it('login page still preserves its ambient HlnaOrb background untouched (atmospheric, out of scope this phase)', () => {
    expect(loginSource).toContain("import { HlnaOrb } from '@/components/brand/HlnaOrb'")
    expect(loginSource).toMatch(/<HlnaOrb/)
  })
})

describe('Phase D.1 — scope containment', () => {
  it('does not touch dashboard architecture, Events internals, auth behaviour, or the tenant-aware prompt', () => {
    const orgDashboard = read('components/dashboard/OrganisationDashboard.tsx')
    const chatRoute = read('app/api/chat/route.ts')
    expect(orgDashboard).not.toContain('BrainBaseWordmark')
    expect(chatRoute).not.toContain('BrainBaseWordmark')
  })

  it('does not introduce OrbitalBackground', () => {
    expect(topNavSource).not.toContain('OrbitalBackground')
    expect(loginSource).not.toContain('OrbitalBackground')
    expect(homepageSource).not.toContain('OrbitalBackground')
    expect(hlnaWorkspaceSource).not.toContain('OrbitalBackground')
  })
})

describe('Phase D.2 — secondary public surfaces use BrainBaseWordmark, not the old lens-style logo', () => {
  it('every D.2 surface imports and renders BrainBaseWordmark', () => {
    for (const [name, src] of D2_SURFACES) {
      expect(src, `${name} must import BrainBaseWordmark`).toContain("from '@/components/brand/BrainBaseWordmark'")
      expect(src, `${name} must render <BrainBaseWordmark`).toContain('<BrainBaseWordmark')
    }
  })

  it('none of the D.2 surfaces still reference the old brainbase-logo-dark.svg asset', () => {
    for (const [name, src] of D2_SURFACES) {
      expect(src, `${name} must not still reference the old lens-style logo`).not.toContain('brainbase-logo-dark.svg')
    }
  })

  it('no duplicate shared logo component was introduced — every surface imports the same D.1 BrainBaseWordmark path', () => {
    for (const [name, src] of D2_SURFACES) {
      const importLine = src.match(/import \{ BrainBaseWordmark \} from '([^']+)'/)
      expect(importLine, `${name} must import BrainBaseWordmark from the canonical path`).not.toBeNull()
      expect(importLine![1]).toBe('@/components/brand/BrainBaseWordmark')
    }
  })
})

describe('Phase D.2 — ambient/assistant HlnaOrb usage is preserved where it existed', () => {
  it('signup keeps its ambient HlnaOrb background untouched', () => {
    expect(signupSource).toContain("import { HlnaOrb } from '@/components/brand/HlnaOrb'")
    expect(signupSource).toMatch(/<HlnaOrb/)
  })

  it('demo keeps its two functional assistant-state HlnaOrb instances untouched (state driven by `thinking`)', () => {
    expect(demoSource).toContain("import { HlnaOrb } from '@/components/brand/HlnaOrb'")
    const hlnaOrbCount = (demoSource.match(/<HlnaOrb/g) ?? []).length
    expect(hlnaOrbCount).toBe(2)
    expect(demoSource).toMatch(/state=\{\s*\n?\s*thinking/)
  })

  it('web-systems, request-demo, client-operations, client-operations/demo, connect, and PublicEventClient had no HlnaOrb to preserve — confirms nothing was accidentally added', () => {
    for (const [name, src] of [
      ['web-systems', webSystemsSource],
      ['request-demo', requestDemoSource],
      ['client-operations', clientOperationsSource],
      ['client-operations/demo', clientOperationsDemoSource],
      ['connect', connectSource],
      ['PublicEventClient', publicEventClientSource],
    ] as const) {
      expect(src, `${name} must not have gained a new HlnaOrb usage`).not.toContain('HlnaOrb')
    }
  })
})

describe('Phase D.2 — PublicEventClient: platform branding replaced, event functionality untouched', () => {
  it('the header still says "Powered by BrainBase" and only the platform mark image changed', () => {
    expect(publicEventClientSource).toContain('Powered by BrainBase')
    expect(publicEventClientSource).toMatch(/function EventHeader\(\)/)
  })

  it('registration, ticketing, and event-data plumbing are untouched', () => {
    expect(publicEventClientSource).toContain('ticket_types')
    expect(publicEventClientSource).toContain('purchaserEmail')
    expect(publicEventClientSource).toContain('PublicEventDetail')
    expect(publicEventClientSource).toContain('availabilityState')
  })

  it('no organisation/event-specific branding field was introduced or removed near the header', () => {
    const fnStart = publicEventClientSource.indexOf('function EventHeader()')
    const fnEnd = publicEventClientSource.indexOf('\n}', fnStart) + 2
    const headerBody = publicEventClientSource.slice(fnStart, fnEnd)
    expect(headerBody).not.toMatch(/organisationSlug|eventSlug|event\.name|event\.title/)
  })
})

describe('Phase D.2 — repository-wide old logo audit', () => {
  it('the old brainbase-logo-dark.svg / brainbase-logo-light.svg paths no longer appear in any D.1 or D.2 live surface', () => {
    const liveSources = [topNavSource, hlnaWorkspaceSource, loginSource, homepageSource, ...D2_SURFACES.map(([, s]) => s)]
    for (const src of liveSources) {
      expect(src).not.toContain('brainbase-logo-dark.svg')
      expect(src).not.toContain('brainbase-logo-light.svg')
    }
  })
})

describe('Phase D.2 — no accidental external brand-kit path in the new surfaces', () => {
  it('none of the D.2 surfaces reference the external OneDrive brand-kit path', () => {
    for (const [name, src] of D2_SURFACES) {
      expect(src, `${name} must not reference OneDrive`).not.toMatch(/OneDrive/i)
      expect(src, `${name} must not reference the brand kit folder name`).not.toContain('BrainBase_Hybrid_Orbit_Brand_Kit_COMPLETE')
    }
  })
})
