import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf-8')

const topNav = read('components/nav/TopNav.tsx')
const opBar = read('components/ops/OpBar.tsx')
const sidebar = read('components/ops/Sidebar.tsx')

describe('B.4.1 shared chrome token polish', () => {
  it('uses the current-main Geist mono contract in TopNav clock treatment', () => {
    expect(topNav).toContain('var(--font-geist-mono,"Geist Mono",monospace)')
    expect(topNav).not.toContain("'var(--bb-font-mono)'")
  })

  it('uses canonical radii for the OpBar live and alert badges', () => {
    expect(opBar).toContain("padding: '2px 8px', borderRadius: 'var(--bb-radius-pill)'")
    expect(opBar).toContain("minWidth: 16, height: 16, borderRadius: 'var(--bb-radius-md)', padding: '0 4px'")
    expect(opBar).not.toContain("padding: '2px 8px', borderRadius: 20")
    expect(opBar).not.toContain("minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px'")
  })

  it('uses canonical duration and easing tokens for Sidebar fade animations', () => {
    expect(sidebar.match(/animation: 'sb-fade var\(--bb-duration-base\) var\(--bb-ease-standard\)'/g)?.length)
      .toBeGreaterThanOrEqual(3)
    expect(sidebar).not.toContain("animation: 'sb-fade .2s ease'")
  })

  it('preserves the same TopNav clock, OpBar badges, and Sidebar animation hooks', () => {
    expect(topNav).toContain('function Clock()')
    expect(opBar).toContain('>Live</span>')
    expect(opBar).toContain('{alertCount > 0 && (')
    expect(sidebar).toContain('@keyframes sb-fade')
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
