import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/nav/TopNav.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n')

describe('B.1 TopNav design-system migration', () => {
  it('uses canonical BrainBase shell, text, border, motion, and accent tokens', () => {
    for (const token of [
      '--bb-font-sans',
      '--bb-shell-header',
      '--bb-border-subtle',
      '--bb-border-default',
      '--bb-text-primary',
      '--bb-text-secondary',
      '--bb-text-tertiary',
      '--bb-text-muted',
      '--bb-text-disabled',
      '--bb-accent-300',
      '--bb-accent-400',
      '--bb-surface-hover',
      '--bb-surface-selected',
      '--bb-border-accent',
      '--bb-gradient-accent',
      '--bb-blur-nav',
      '--bb-duration-fast',
      '--bb-duration-base',
      '--bb-z-header',
    ]) {
      expect(source).toContain(token)
    }
  })

  it('preserves the existing TopNav routing and capability visibility logic', () => {
    for (const text of [
      "const hasOrganiser =",
      "const hasCrm =",
      "const hasPeople =",
      "const hasCommercial =",
      "'organiser',",
      "'crm',",
      "'people',",
      "'quotes',",
      "'invoicing',",
      "'purchasing',",
      "href=\"/organiser\"",
      "href=\"/commercial\"",
      "href=\"/people\"",
      "href=\"/data-hub/import\"",
      "href=\"/reports\"",
      "href=\"/data\"",
    ]) {
      expect(source).toContain(text)
    }
    expect(source).toContain("const isSuperAdmin =\n    role === 'super_admin'")
    expect(source).toContain("const isManagerPlus =\n    ['manager', 'admin', 'super_admin'].includes(")
  })

  it('preserves dropdown portal positioning and hover timing behavior', () => {
    expect(source.match(/createPortal\(/g)?.length).toBe(2)
    expect(source.match(/rect\.bottom \+ 10/g)?.length).toBe(2)
    expect(source.match(/setTimeout\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source.match(/140,/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).toContain("overflowX: 'auto'")
    expect(source).toContain("overflowY: 'hidden'")
  })

  it('preserves session loading, logout, and public-event suppression behavior', () => {
    expect(source).toContain("fetch('/api/me')")
    expect(source).toContain("await import(\n                '@/app/actions/auth'")
    expect(source).toContain('await logout()')
    expect(source).toContain("pathname?.startsWith(\n      '/tennis'")
    expect(source).toContain("pathname?.startsWith(\n      '/connect'")
    expect(source).toContain('resolvePublicEventTheme(')
  })

  it('removes legacy hardcoded chrome literals while leaving brand SVG artwork untouched', () => {
    for (const literal of [
      "'rgba(7,8,11,.92)'",
      "'rgba(7,5,16,.98)'",
      "'rgba(255,255,255,.45)'",
      "'rgba(255,255,255,.05)'",
      "'rgba(139,92,246,.10)'",
      "'rgba(139,92,246,.22)'",
      "'#C4B5FD'",
    ]) {
      expect(source).not.toContain(literal)
    }
    expect(source).toContain('stopColor="#6D28D9"')
    expect(source).toContain('stopColor="#C084FC"')
  })

  it('does not add data, auth, routing, or persistence dependencies', () => {
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('sql`')
  })
})
