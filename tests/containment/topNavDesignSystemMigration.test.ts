import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../components/nav/TopNav.tsx'),'utf-8').replace(/\r\n/g,'\n')
const chromeCss = fs.readFileSync(path.resolve(__dirname, '../../components/nav/AppChrome.module.css'),'utf-8')

describe('B.1 TopNav design-system migration after main convergence', () => {
  it('uses the latest main application/brand tokens', () => {
    // Integration note: the reviewed Phase B chrome keeps its treatment in AppChrome.module.css on the
    // Phase A app tokens; the retired --purple-* ramp is intentionally no longer used.
    for (const token of ['--bg-base','--bg-overlay','--border','--brand-brainbase-accent','--text-primary','--text-secondary','--text-muted']) expect(source + chromeCss).toContain(token)
    expect(source + chromeCss).not.toMatch(/--purple-\d/)
  })
  it('preserves routing and capability visibility', () => {
    for (const text of ["const hasOrganiser =","const hasCrm =","const hasPeople =","const hasCommercial =",'href="/organiser"','href="/commercial"','href="/people"','href="/data-hub/import"','href="/reports"','href="/data"']) expect(source).toContain(text)
  })
  it('preserves dropdown portals and the certified overflow strategy', () => {
    expect(source.match(/createPortal\(/g)?.length).toBe(2)
    expect(source).toContain("justifyContent: 'flex-start'")
    expect(source).toContain("overflowX: 'auto'")
    expect(source).toContain("overflowY: 'hidden'")
  })
  it('preserves session, logout, and public-event suppression behavior', () => {
    expect(source).toContain("fetch('/api/me')")
    expect(source).toContain('await logout()')
    expect(source).toContain('resolvePublicEventTheme(')
    expect(source).toContain("'/tennis'")
    expect(source).toContain("'/connect'")
  })
  it('does not add persistence or backend dependencies', () => {
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('sql`')
  })
})
