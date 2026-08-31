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
  it('isLdTennis / isBrainbaseHQ classification, Dashboard/HLNA/Events entries, and the C.2F dropdown positioning fix are all still present', () => {
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'ld-tennis'/)
    expect(topNavSource).toMatch(/dashboardVariant\s*===\s*'brainbase-hq'/)
    expect(topNavSource).toContain('href="/dashboard"')
    expect(topNavSource).toMatch(/<HlnaItem\s*\n\s*href="\/hlna"/)
    expect(topNavSource).toContain('href="/events"')
    expect(topNavSource).toContain('hasEvents')
    // C.2F dropdown positioning fix.
    expect(topNavSource).toContain('panelPos')
    expect(topNavSource).toContain('triggerRef')
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
