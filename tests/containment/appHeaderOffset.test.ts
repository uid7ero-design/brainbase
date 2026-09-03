import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.5C-W2 — shared app-header offset. Before this, TopNav's own
// `height: 52` and every fixed/sticky consumer that needs to render
// immediately below it (OrganiserShell, WorkspaceShell, AdminAside,
// CrmSidebar, Founder OS, the deployments page, client detail,
// OnboardingWizard) each independently hardcoded a bare `top: 52`
// literal — see the D.4.5C-W1 audit. That silently broke for any
// super_admin session once components/admin/OrgSwitcher.tsx started
// rendering a real, non-zero-height bar in normal document flow above
// TopNav: TopNav itself stayed exactly 52px tall, but no longer started
// at viewport y=0, so every hardcoded consumer rendered its content
// partially underneath TopNav's own lower portion.
//
// Static source-text containment only — this repo has no jsdom/React
// Testing Library harness (see AGENTS.md/CLAUDE.md and every other
// containment test file's own note), so this suite proves the shared
// primitive's SOURCE (one constant, one CSS custom property, one
// measurement effect, and every migrated consumer reading the same
// primitive) rather than rendered pixel geometry, which this repo's
// test stack cannot observe.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const headerOffsetSource = read('lib/layout/headerOffset.ts')
const topNavSource = stripComments(read('components/nav/TopNav.tsx'))
const orgSwitcherSource = stripComments(read('components/admin/OrgSwitcher.tsx'))
const globalsCss = read('app/globals.css')

describe('lib/layout/headerOffset.ts — one shared source of truth', () => {
  it('exports exactly one numeric height constant (TOP_NAV_HEIGHT_PX = 52)', () => {
    expect(headerOffsetSource).toMatch(/export const TOP_NAV_HEIGHT_PX = 52;/)
  })

  it('exports the CSS custom property name and a ready-to-use var() reference', () => {
    expect(headerOffsetSource).toMatch(/export const APP_HEADER_OFFSET_CSS_VAR = '--app-header-offset';/)
    expect(headerOffsetSource).toMatch(/export const APP_HEADER_OFFSET_VAR = `var\(\$\{APP_HEADER_OFFSET_CSS_VAR\}\)`;/)
  })

  it('exports a setter that combines TOP_NAV_HEIGHT_PX with the given extra height — consumers never compute this themselves', () => {
    expect(headerOffsetSource).toMatch(/export function setAppHeaderExtraOffsetPx\(extraPx: number\): void/)
    expect(headerOffsetSource).toMatch(/APP_HEADER_OFFSET_CSS_VAR,\s*\n\s*`\$\{TOP_NAV_HEIGHT_PX \+ extraPx\}px`,/)
  })

  it('the setter is a no-op during SSR (no document) rather than throwing', () => {
    expect(headerOffsetSource).toMatch(/if \(typeof document === 'undefined'\) return;/)
  })
})

describe('app/globals.css — correct default before any client JS runs', () => {
  it('defaults --app-header-offset to exactly 52px — correct for non-super_admin sessions and the very first paint', () => {
    expect(globalsCss).toMatch(/--app-header-offset:\s*52px;/)
  })
})

describe('components/nav/TopNav.tsx — uses the shared constant, not a duplicated literal', () => {
  it('imports TOP_NAV_HEIGHT_PX from the shared module', () => {
    expect(topNavSource).toMatch(/import \{ TOP_NAV_HEIGHT_PX \} from '@\/lib\/layout\/headerOffset';/)
  })

  it('both PublicNav and AppNav use TOP_NAV_HEIGHT_PX for height, not a bare 52 literal', () => {
    const occurrences = [...topNavSource.matchAll(/height: TOP_NAV_HEIGHT_PX,/g)]
    expect(occurrences.length).toBe(2)
    expect(topNavSource).not.toMatch(/height: 52,/)
  })
})

describe('components/admin/OrgSwitcher.tsx — measures its own real height, never a hardcoded guess', () => {
  it('imports setAppHeaderExtraOffsetPx from the shared module', () => {
    expect(orgSwitcherSource).toMatch(/import \{ setAppHeaderExtraOffsetPx \} from '@\/lib\/layout\/headerOffset';/)
  })

  it('measures via dropRef.current.offsetHeight — real rendered geometry, not a duplicated pixel constant', () => {
    expect(orgSwitcherSource).toMatch(/dropRef\.current\?\.offsetHeight \?\? 0/)
    // setAppHeaderExtraOffsetPx(0) (the explicit "no extra height" reset
    // for a resolved non-super_admin role) is fine — only a non-zero
    // hardcoded guess would defeat the point of measuring at all.
    expect(orgSwitcherSource).not.toMatch(/setAppHeaderExtraOffsetPx\([1-9]\d*\)/)
  })

  it('the super_admin path sets a non-zero extra offset; the non-super_admin path explicitly resets to 0 (no stale offset survives a role change)', () => {
    expect(orgSwitcherSource).toMatch(/if \(state\.role === 'super_admin'\) \{\s*\n\s*setAppHeaderExtraOffsetPx\(dropRef\.current\?\.offsetHeight \?\? 0\);\s*\n\s*\} else \{\s*\n\s*setAppHeaderExtraOffsetPx\(0\);\s*\n\s*\}/)
  })

  it('does not use a ResizeObserver — a single effect keyed on state.role is sufficient, since this bar\'s height never changes after its role-driven render decision', () => {
    expect(orgSwitcherSource).not.toMatch(/ResizeObserver/)
  })

  it('the measurement effect is keyed on [state.role] only', () => {
    expect(orgSwitcherSource).toMatch(/\}, \[state\.role\]\);/)
  })
})

describe('migrated consumers — every confirmed affected file uses the shared primitive, no independent top: 52 remains', () => {
  const consumers = [
    'components/organiser/OrganiserShell.tsx',
    'components/ops/WorkspaceShell.tsx',
    'components/admin/AdminAside.tsx',
    'app/crm/_components/CrmSidebar.tsx',
    'app/admin/founder/page.tsx',
    'app/admin/deployments/page.tsx',
    'app/clients/[id]/page.tsx',
    'app/onboarding/_components/OnboardingWizard.tsx',
  ]

  for (const consumerPath of consumers) {
    it(`${consumerPath} imports the shared offset primitive and no longer contains a bare top: 52 (or calc(100vh - 52px))`, () => {
      const source = stripComments(read(consumerPath))
      expect(source, `${consumerPath} must import from @/lib/layout/headerOffset`).toMatch(/from '@\/lib\/layout\/headerOffset'/)
      expect(source, `${consumerPath} must not contain a bare top: 52`).not.toMatch(/top:\s*52\b/)
      expect(source, `${consumerPath} must not contain a hardcoded calc(100vh - 52px)`).not.toContain('calc(100vh - 52px)')
    })
  }

  it('no consumer double-applies the offset (e.g. wrapping APP_HEADER_OFFSET_VAR in an additional +52 or nested calc referencing the raw 52 literal)', () => {
    for (const consumerPath of consumers) {
      const source = stripComments(read(consumerPath))
      expect(source, `${consumerPath} must not add a second 52px on top of the shared primitive`).not.toMatch(/APP_HEADER_OFFSET_VAR[^)]*\+\s*52/)
    }
  })
})

describe('OrganiserShell — unaffected design intent (Sidebar/OpBar exclusion) survives this migration', () => {
  it('still imports no Sidebar/OpBar/WorkspaceShell', () => {
    const source = stripComments(read('components/organiser/OrganiserShell.tsx'))
    expect(source).not.toMatch(/from '\.\/Sidebar'/)
    expect(source).not.toMatch(/from '\.\/OpBar'/)
    expect(source).not.toMatch(/WorkspaceShell/)
  })
})
