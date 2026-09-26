import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.resolve(__dirname, '../../components/ops/theme.ts'), 'utf-8')

const publicKeys = [
  'theme',
  'toggleTheme',
  'isDark',
  'ink',
  'paper',
  'pageBg',
  'panelBgSolid',
  'menuBg',
  'sidebarBg',
  'headerBg',
  'accent',
  'accentLight',
  'accentText',
  'scrim',
]

describe('BrainBase Ops theme compatibility bridge', () => {
  it('preserves the existing useOpsTheme public API surface', () => {
    for (const key of publicKeys) {
      expect(source, 'missing existing Ops theme key: ' + key).toContain(key)
    }
    expect(source).toContain('export function useOpsTheme()')
    expect(source).toContain('export type OpsTheme = ReturnType<typeof useOpsTheme>')
  })

  it('resolves stable Ops palette roles through canonical semantic BrainBase tokens', () => {
    expect(source).toContain("pageBg:       'var(--bb-canvas)'")
    expect(source).toContain("panelBgSolid: 'var(--bb-surface-1)'")
    expect(source).toContain("menuBg:       'var(--bb-surface-3)'")
    expect(source).toContain("sidebarBg:    'var(--bb-shell-sidebar)'")
    expect(source).toContain("headerBg:     'var(--bb-shell-header)'")
    expect(source).toContain("accent:       'var(--bb-accent-500)'")
    expect(source).toContain("accentLight:  'var(--bb-accent-400)'")
    expect(source).toContain("accentText:   'var(--bb-accent-300)'")
    expect(source).toContain("scrim:        'var(--bb-scrim)'")
  })

  it('does not duplicate the old hardcoded Ops palette values', () => {
    for (const literal of [
      "'#07080B'",
      "'#0B0C10'",
      "'#14161B'",
      "'rgba(6,7,10,.97)'",
      "'rgba(6,7,10,.95)'",
      "'#8B5CF6'",
      "'#A78BFA'",
      "'#C4B5FD'",
      "'#F5F6F8'",
      "'#FFFFFF'",
      "'rgba(255,255,255,.98)'",
      "'rgba(255,255,255,.96)'",
      "'#7C3AED'",
      "'#6D28D9'",
      "'rgba(15,17,23,.35)'",
    ]) {
      expect(source).not.toContain(literal)
    }
  })

  it('keeps ink() and paper() as compatibility helpers instead of removing them', () => {
    expect(source).toContain('export function ink(theme: Theme, alpha: number): string')
    expect(source).toContain('export function paper(theme: Theme, alpha: number): string')
    expect(source).toContain('ink: (alpha: number) => ink(theme, alpha)')
    expect(source).toContain('paper: (alpha: number) => paper(theme, alpha)')
  })

  it('does not add auth, API, database, routing, or persistence dependencies', () => {
    expect(source).not.toMatch(/@\/lib\/(db|auth|session)/)
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('useRouter')
    expect(source).not.toContain('localStorage')
  })
})
