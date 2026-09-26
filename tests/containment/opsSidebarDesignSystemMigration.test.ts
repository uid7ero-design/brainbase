import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const sidebar = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/Sidebar.tsx'),
  'utf-8',
)

const shell = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/WorkspaceShell.tsx'),
  'utf-8',
)

describe('B.2 shared Ops sidebar shell design-system migration', () => {
  it('uses canonical BrainBase shell, text, surface, border, radius, motion, and status tokens', () => {
    for (const token of [
      '--bb-font-sans',
      '--bb-shell-sidebar',
      '--bb-border-default',
      '--bb-border-subtle',
      '--bb-text-primary',
      '--bb-text-secondary',
      '--bb-text-tertiary',
      '--bb-text-muted',
      '--bb-surface-soft',
      '--bb-surface-hover',
      '--bb-surface-selected',
      '--bb-accent-300',
      '--bb-accent-500',
      '--bb-success',
      '--bb-success-soft',
      '--bb-danger',
      '--bb-radius-md',
      '--bb-duration-fast',
      '--bb-duration-slow',
      '--bb-ease-standard',
      '--bb-z-raised',
    ]) {
      expect(sidebar).toContain(token)
    }

    for (const token of ['var(--bg-base)', 'var(--font-inter)', 't.pageBg']) {
      expect(shell).toContain(token)
    }
  })

  it('preserves every existing sidebar destination and section grouping', () => {
    for (const section of ['Core', 'Operational', 'Admin']) {
      expect(sidebar).toContain(`label: '${section}'`)
    }

    for (const href of [
      '/command',
      '/dashboard',
      '/briefings',
      '/reports',
      '/data',
      '/command/alerts',
      '/dashboard/waste',
      '/dashboard/bin-maintenance',
      '/dashboard/illegal-dumping',
      '/dashboard/parks',
      '/dashboard/compliance',
      '/dashboard/facilities',
      '/dashboard/roads',
      '/admin/orgs',
      '/admin/users',
      '/account/profile',
    ]) {
      expect(sidebar).toContain(`href: '${href}'`)
    }
  })

  it('preserves active-route matching, collapsed labels, alert visibility, and theme-toggle behavior', () => {
    expect(sidebar).toContain('const active = exact ? pathname === href : pathname.startsWith(href)')
    expect(sidebar).toContain('title={collapsed ? label : undefined}')
    expect(sidebar).toContain('{!collapsed && (')
    expect(sidebar).toContain('{alertColor && !collapsed && (')
    expect(sidebar).toContain("item.href === '/command/alerts' && alertCount > 0")
    expect(sidebar).toContain('onClick={onToggle}')
    expect(sidebar).toContain('onClick={t.toggleTheme}')
    expect(sidebar).toContain("title={t.isDark ? 'Switch to light theme' : 'Switch to dark theme'}")
    expect(sidebar).toContain('{t.isDark ? I.sun : I.moon}')
  })

  it('preserves collapsed/expanded dimensions and transition-driven responsive interaction', () => {
    expect(sidebar).toContain('width: collapsed ? 56 : 220')
    expect(sidebar).toContain('minWidth: collapsed ? 56 : 220')
    expect(sidebar).toContain("padding: collapsed ? '10px 6px' : '10px 10px'")
    expect(sidebar).toContain("flexDirection: collapsed ? 'column' : 'row'")
    expect(sidebar).toContain("transform: collapsed ? 'rotate(180deg)' : 'none'")
    expect(sidebar).toContain("'width var(--bb-duration-slow) var(--bb-ease-standard)")
    expect(sidebar).toContain("overflowY: 'auto'")
    expect(sidebar).toContain("overflowX: 'hidden'")
  })

  it('preserves collapse persistence and session-loading behavior in WorkspaceShell', () => {
    expect(shell).toContain("localStorage.getItem('ops-sidebar-collapsed')")
    expect(shell).toContain("if (saved === 'true') setCollapsed(true)")
    expect(shell).toContain("localStorage.setItem('ops-sidebar-collapsed', String(next))")
    expect(shell).toContain("fetch('/api/me')")
    expect(shell).toContain("if (d?.role) setSession({ name: d.name, role: d.role, avatarUrl: d.profile?.avatar_url ?? undefined })")
    expect(shell).toContain('const [mounted, setMounted]')
    expect(shell).toContain('if (!mounted)')
  })

  it('preserves shell composition, header offset, optional Intel Rail, and child canvas behavior', () => {
    expect(shell).toContain('top: APP_HEADER_OFFSET_VAR')
    expect(shell).toContain('<Sidebar')
    expect(shell).toContain('collapsed={collapsed}')
    expect(shell).toContain('onToggle={toggle}')
    expect(shell).toContain('pathname={pathname ??')
    expect(shell).toContain('<OpBar')
    expect(shell).toContain('{children}')
    expect(shell).toContain('{intelRail && <IntelRail />}')
    expect(shell).toContain("overflowY: 'auto'")
    expect(shell).toContain("overflowX: 'hidden'")
  })

  it('does not introduce capability, role, auth, routing, data, or persistence logic into Sidebar itself', () => {
    expect(sidebar).not.toContain('enabledCapabilities')
    expect(sidebar).not.toContain('enabledModules')
    expect(sidebar).not.toContain('role ===')
    expect(sidebar).not.toContain("fetch(")
    expect(sidebar).not.toContain('localStorage')
    expect(sidebar).not.toMatch(/@\/lib\/(db|auth|session)/)
  })

  it('removes legacy hardcoded sidebar chrome/status literals while preserving decorative shell layers', () => {
    for (const literal of [
      "var(--font-inter)",
      "'rgba(139,92,246,.12)'",
      "'rgba(34,197,94,.06)'",
      "'rgba(22,163,74,.08)'",
      "'#22C55E'",
      "'#16A34A'",
      "'#EF4444'",
    ]) {
      expect(sidebar).not.toContain(literal)
    }

    expect(shell).toContain('ws-breathe')
    expect(shell).toContain('Calm engineering grid')
    expect(shell).not.toContain('radial-gradient')
    expect(shell).toContain("backgroundSize: '32px 32px'")
  })
})
