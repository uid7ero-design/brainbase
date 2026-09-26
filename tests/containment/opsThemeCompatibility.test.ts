import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../components/ops/theme.ts'), 'utf-8')

const publicKeys = ['theme','toggleTheme','isDark','ink','paper','pageBg','panelBgSolid','menuBg','sidebarBg','headerBg','accent','accentLight','accentText','scrim']

describe('BrainBase Ops theme compatibility bridge', () => {
  it('preserves the existing useOpsTheme public API surface', () => {
    for (const key of publicKeys) expect(source).toContain(key)
    expect(source).toContain('export function useOpsTheme()')
    expect(source).toContain('export type OpsTheme = ReturnType<typeof useOpsTheme>')
  })
  it('matches the latest main HLNA-family dark and light palette', () => {
    for (const literal of ["pageBg:       '#0B0B0C'","panelBgSolid: '#111113'","accent:       '#9B7BFF'","pageBg:       '#F5F3EE'","accent:       '#6D4CD6'"]) expect(source).toContain(literal)
  })
  it('keeps ink() and paper() compatibility helpers', () => {
    expect(source).toContain('export function ink(theme: Theme, alpha: number): string')
    expect(source).toContain('export function paper(theme: Theme, alpha: number): string')
  })
  it('does not add auth, API, database, routing, or persistence dependencies', () => {
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('useRouter')
    expect(source).not.toContain('localStorage')
  })
})
