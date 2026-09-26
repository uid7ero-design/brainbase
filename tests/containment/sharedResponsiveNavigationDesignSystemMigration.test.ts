import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const topNav = fs.readFileSync(
  path.resolve(__dirname, '../../components/nav/TopNav.tsx'),
  'utf-8',
)

const sidebar = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/Sidebar.tsx'),
  'utf-8',
)

const shell = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/WorkspaceShell.tsx'),
  'utf-8',
)

describe('B.4 shared responsive navigation design-system migration', () => {
  it('keeps the existing narrow-width TopNav strategy: natural-width items inside a horizontally scrollable centre row', () => {
    expect(topNav).toContain("overflowX: 'auto'")
    expect(topNav).toContain("overflowY: 'hidden'")
    expect(topNav).toContain("scrollbarWidth: 'none'")
    expect(topNav).toContain("msOverflowStyle: 'none'")
    expect(topNav).toContain('flex: 1')
    expect(topNav).toContain('minWidth: 0')
    expect(topNav).toContain("gap: 'var(--bb-space-1)'")
  })

  it('keeps the public-nav spacing and call-to-action on canonical spacing tokens without changing destinations', () => {
    expect(topNav).toContain("gap: 'var(--bb-space-2)'")
    expect(topNav).toContain("marginLeft: 'var(--bb-space-2)'")
    expect(topNav).toContain('href="/#product"')
    expect(topNav).toContain('href="/client-operations"')
    expect(topNav).toContain('href="/web-systems"')
    expect(topNav).toContain('href="/pricing"')
    expect(topNav).toContain('href="/demo"')
    expect(topNav).toContain('href="/login"')
    expect(topNav).toContain('href="/request-demo"')
  })

  it('preserves capability-driven authenticated navigation exactly', () => {
    for (const text of [
      'const hasEvents =',
      "enabledCapabilities.includes(\n      'events'",
      'const hasCrm =',
      "enabledCapabilities.includes(\n      'crm'",
      'const hasOrganiser =',
      "enabledCapabilities.includes(\n      'organiser'",
      'const hasCommercial =',
      "'quotes',",
      "'invoicing',",
      "'purchasing',",
      'const hasPeople =',
      "'people',",
    ]) {
      expect(topNav).toContain(text)
    }

    for (const href of ['/events', '/crm', '/organiser', '/commercial', '/people']) {
      expect(topNav).toContain('href="' + href + '"')
    }
  })

  it('preserves role visibility and super-admin-specific navigation boundaries', () => {
    expect(topNav).toContain("const isSuperAdmin =\n    role === 'super_admin'")
    expect(topNav).toContain("const isManagerPlus =\n    ['manager', 'admin', 'super_admin'].includes(")
    expect(topNav).toContain('{isSuperAdmin && (')
    expect(topNav).toContain('<AdminDropdown')
    expect(topNav).toContain("(role === 'admin' || role === 'super_admin')")
    expect(topNav).toContain('href="/settings/branding"')
  })

  it('preserves profile, logout, and responsive system-cluster interactions', () => {
    expect(topNav).toContain('href="/account/profile"')
    expect(topNav).toContain("borderRadius: 'var(--bb-radius-pill)'")
    expect(topNav).toContain("await import(\n                '@/app/actions/auth'")
    expect(topNav).toContain('await logout()')
    expect(topNav).toContain("justifyContent:\n            'flex-end'")
    expect(topNav).toContain('flexShrink: 0')
  })

  it('preserves dropdown portal interaction so narrow navigation is not clipped by the scroll container', () => {
    expect(topNav.match(/createPortal\(/g)?.length).toBe(2)
    expect(topNav).toContain("centre nav row it lives in has `overflowX: 'auto'`")
    expect(topNav).toContain("overflowX:'auto' silently clips this panel")
    expect(topNav.match(/rect\.bottom \+ 10/g)?.length).toBe(2)
  })

  it('preserves the shared Ops shell collapse interaction and stored responsive state', () => {
    expect(sidebar).toContain('width: collapsed ? 56 : 220')
    expect(sidebar).toContain('minWidth: collapsed ? 56 : 220')
    expect(sidebar).toContain("flexDirection: collapsed ? 'column' : 'row'")
    expect(sidebar).toContain("transform: collapsed ? 'rotate(180deg)' : 'none'")
    expect(shell).toContain("localStorage.getItem('ops-sidebar-collapsed')")
    expect(shell).toContain("localStorage.setItem('ops-sidebar-collapsed', String(next))")
  })

  it('does not invent a second mobile navigation state or bypass capability/role boundaries', () => {
    expect(topNav).not.toContain('mobileOpen')
    expect(topNav).not.toContain('mobileMenuOpen')
    expect(topNav).not.toContain('hamburger')
    expect(topNav).not.toContain('window.innerWidth')
    expect(topNav).not.toContain('matchMedia')
    expect(sidebar).not.toContain('enabledCapabilities')
    expect(sidebar).not.toContain('role ===')
  })

  it('keeps responsive surfaces on canonical BrainBase design tokens', () => {
    for (const token of [
      '--bb-shell-header',
      '--bb-border-subtle',
      '--bb-blur-nav',
      '--bb-z-header',
      '--bb-space-1',
      '--bb-space-2',
      '--bb-radius-pill',
      '--bb-surface-selected',
      '--bb-surface-hover',
      '--bb-border-accent',
      '--bb-text-secondary',
      '--bb-text-muted',
    ]) {
      expect(topNav).toContain(token)
    }
  })
})
