import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/ops/OpBar.tsx'),
  'utf-8',
)

describe('B.3 shared Ops header design-system migration', () => {
  it('uses canonical BrainBase header, typography, border, status, accent, motion, and avatar tokens', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D1 OpBar implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    for (const token of ['var(--bb-font-sans)', 'var(--bb-font-mono)', 'var(--border)', 'var(--text-secondary)', 'var(--text-muted)', 'var(--status-success)', 'var(--status-warning)', 'var(--brand-brainbase-accent)', 'var(--radius-sm)'])
      expect(source).toContain(token)
    // D1: flat header — no backdrop blur, decorative shadow or gradient avatar.
    expect(source).not.toMatch(/backdropFilter|--bb-blur-nav|--bb-gradient-accent|linear-gradient/)

  })

  it('preserves title, live status, upload count, AI status, alerts, clock, and profile composition', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D1 OpBar implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    expect(source).toContain("title = 'Command Centre'")
    expect(source).toContain('>Live</span>')
    expect(source).toContain('{uploadingCount > 0 && (')
    expect(source).toContain('{uploadingCount} uploading')
    // D1 writes the plain wordmark in status prose.
    expect(source).toContain('HLNA active')
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
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D1 OpBar implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    expect(source).toContain('{uploadingCount > 0 && (')
    expect(source).toContain("stroke={alertCount > 0 ? 'var(--status-warning)' : 'var(--text-muted)'}")
    expect(source).toContain('{alertCount > 0 && (')

  })

  it('preserves session avatar/initials/name fallback behavior', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D1 OpBar implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    expect(source).toContain("session?.name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() ?? '??'")
    expect(source).toContain("background: session?.avatarUrl ? 'transparent' : 'var(--brand-brainbase-accent-muted)'")
    expect(source).toContain('? <img src={session.avatarUrl} alt=""')
    expect(source).toContain("{session?.name?.split(' ')[0] ?? 'Profile'}")

  })

  it('preserves profile hover behavior while using semantic surface/border tokens', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase D1 OpBar implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    expect(source).toContain("onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}")
    expect(source).toContain("onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}")

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
