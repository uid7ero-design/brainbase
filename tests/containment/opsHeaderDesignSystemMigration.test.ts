import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/OpBar.tsx'),
  'utf-8',
)

describe('B.3 shared Ops header design-system migration', () => {
  it('uses canonical BrainBase header, typography, border, status, accent, motion, and avatar tokens', () => {
    for (const token of [
      '--bb-font-sans',
      '--bb-font-mono',
      '--bb-shell-header',
      '--bb-blur-nav',
      '--bb-border-default',
      '--bb-border-subtle',
      '--bb-border-strong',
      '--bb-shadow-sm',
      '--bb-z-raised',
      '--bb-text-secondary',
      '--bb-text-muted',
      '--bb-accent-500',
      '--bb-accent-400',
      '--bb-accent-300',
      '--bb-success',
      '--bb-success-soft',
      '--bb-info',
      '--bb-warning',
      '--bb-danger',
      '--bb-surface-soft',
      '--bb-surface-hover',
      '--bb-gradient-accent',
      '--bb-radius-pill',
      '--bb-duration-fast',
      '--bb-ease-standard',
    ]) {
      expect(source).toContain(token)
    }
  })

  it('preserves title, live status, upload count, AI status, alerts, clock, and profile composition', () => {
    expect(source).toContain("title = 'Command Centre'")
    expect(source).toContain('>Live</span>')
    expect(source).toContain('{uploadingCount > 0 && (')
    expect(source).toContain('{uploadingCount} uploading')
    expect(source).toContain('HLNΛ active')
    expect(source).toContain('href="/command/alerts"')
    expect(source).toContain('{alertCount > 0 && (')
    expect(source).toContain('<Clock />')
    expect(source).toContain('href="/account/profile"')
  })

  it('preserves the live clock timing, Australian formatting, and interval cleanup', () => {
    expect(source).toContain("toLocaleTimeString('en-AU'")
    expect(source).toContain("hour12: false")
    expect(source).toContain("toLocaleDateString('en-AU'")
    expect(source).toContain('const id = setInterval(tick, 1000)')
    expect(source).toContain('return () => clearInterval(id)')
  })

  it('preserves alert and upload visibility conditions exactly', () => {
    expect(source).toContain('{uploadingCount > 0 && (')
    expect(source).toContain("stroke={alertCount > 0 ? 'var(--bb-warning)' : 'var(--bb-text-muted)'}")
    expect(source).toContain('{alertCount > 0 && (')
  })

  it('preserves session avatar/initials/name fallback behavior', () => {
    expect(source).toContain("session?.name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() ?? '??'")
    expect(source).toContain("background: session?.avatarUrl ? 'transparent' : 'var(--bb-gradient-accent)'")
    expect(source).toContain('? <img src={session.avatarUrl} alt=""')
    expect(source).toContain("{session?.name?.split(' ')[0] ?? 'Profile'}")
  })

  it('preserves profile hover behavior while using semantic surface/border tokens', () => {
    expect(source).toContain("e.currentTarget.style.background = 'var(--bb-surface-hover)'")
    expect(source).toContain("e.currentTarget.style.borderColor = 'var(--bb-border-strong)'")
    expect(source).toContain("e.currentTarget.style.background = 'var(--bb-surface-soft)'")
    expect(source).toContain("e.currentTarget.style.borderColor = 'var(--bb-border-subtle)'")
  })

  it('removes the legacy Ops theme adapter and hardcoded header chrome', () => {
    expect(source).not.toContain('useOpsTheme')
    for (const literal of [
      'var(--font-inter)',
      'var(--font-geist-mono',
      "'rgba(34,197,94,.07)'",
      "'#22C55E'",
      "'#16A34A'",
      "'#F59E0B'",
      "'#EF4444'",
      "'linear-gradient(135deg,#6D28D9,#A78BFA)'",
    ]) {
      expect(source).not.toContain(literal)
    }
  })

  it('does not add routing, auth, database, persistence, or network behavior', () => {
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('useRouter')
  })
})
