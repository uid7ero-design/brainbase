import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf-8')

const topNav = read('components/nav/TopNav.tsx')
const opBar = read('components/ops/OpBar.tsx')
const sidebar = read('components/ops/Sidebar.tsx')

const chromeCss = read('components/nav/AppChrome.module.css')

describe('B.4.1 shared chrome token polish', () => {
  it('uses the current-main Geist mono contract in TopNav clock treatment', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(chromeCss).toContain("font-family: var(--font-geist-mono, 'Geist Mono', monospace)")
    expect(topNav).not.toContain("'var(--bb-font-mono)'")

  })

  it('uses canonical radii for the OpBar live and alert badges', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(opBar).toContain("padding: '2px 7px', borderRadius: 'var(--radius-sm)'")
    expect(opBar).toContain("minWidth: 16, height: 16, borderRadius: 'var(--radius-sm)', padding: '0 4px'")
    expect(opBar).not.toContain("padding: '2px 8px', borderRadius: 20")
    expect(opBar).not.toContain("minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px'")

  })

  it('uses canonical duration and easing tokens for Sidebar fade animations', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    // Phase D1 removed the Sidebar's decorative entrance fade entirely (no motion to tokenise).
    expect(sidebar).not.toContain("animation: 'sb-fade .2s ease'")
    expect(sidebar).not.toContain('@keyframes sb-fade')

  })

  it('preserves the same TopNav clock, OpBar badges, and Sidebar animation hooks', () => {
    // Integration note (main + app visual convergence): main's B.x rollout pinned its own
    // inline chrome styling. The reviewed Phase B (TopNav / AppChrome.module.css) and Phase D1
    // (OpBar / Sidebar) implementations supersede that presentation, so this assertion now pins
    // the reviewed equivalent. Behavioural assertions in this file are unchanged.
    expect(topNav).toContain('function Clock()')
    expect(opBar).toContain('>Live</span>')
    expect(opBar).toContain('{alertCount > 0 && (')
    expect(sidebar).toContain('href="/dashboard"')

  })

  it('does not add behavior, capability, role, network, or persistence logic', () => {
    const beforeSensitivePatterns = [
      /enabledCapabilities/g,
      /role ===/g,
      /fetch\(/g,
      /localStorage/g,
      /sessionStorage/g,
    ]

    for (const pattern of beforeSensitivePatterns) {
      expect(opBar.match(pattern) ?? []).toHaveLength(0)
    }
  })
})
