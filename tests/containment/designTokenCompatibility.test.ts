import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf-8')
const rootStart = css.indexOf(':root {')
const lightStart = css.indexOf(":root[data-theme='light']")
const rootBlock = css.slice(rootStart, lightStart)

const legacyAliases: Record<string, string> = {
  '--bg-base': 'var(--bb-canvas)',
  '--bg-surface': 'var(--bb-surface-1)',
  '--bg-raised': 'var(--bb-surface-2)',
  '--bg-overlay': 'var(--bb-surface-3)',
  '--border': 'var(--bb-border-default)',
  '--border-light': 'var(--bb-border-subtle)',
  '--border-focus': 'var(--bb-border-focus)',
  '--text-primary': 'var(--bb-text-primary)',
  '--text-secondary': 'var(--bb-text-secondary)',
  '--text-muted': 'var(--bb-text-muted)',
  '--purple-600': 'var(--bb-accent-600)',
  '--purple-500': 'var(--bb-accent-500)',
  '--purple-400': 'var(--bb-accent-400)',
  '--purple-300': 'var(--bb-accent-300)',
  '--purple-200': 'var(--bb-accent-300)',
  '--purple-glow': 'var(--bb-accent-glow)',
  '--green': 'var(--bb-success)',
  '--yellow': 'var(--bb-warning)',
  '--red': 'var(--bb-danger)',
  '--cyan': 'var(--bb-info)',
  '--background': 'var(--bb-canvas)',
  '--foreground': 'var(--bb-text-primary)',
}

describe('BrainBase token compatibility bridge', () => {
  it('preserves every legacy global token as an alias', () => {
    for (const [legacy, target] of Object.entries(legacyAliases)) {
      expect(rootBlock, `missing compatibility alias ${legacy}`).toContain(`${legacy}: ${target};`)
    }
  })

  it('marks legacy aliases as compatibility-only so new code does not treat them as canonical', () => {
    expect(rootBlock).toContain('Legacy aliases — compatibility only.')
    expect(rootBlock).toContain('New components must consume --bb-* semantic tokens directly.')
  })

  it('preserves the existing shared app-header offset contract', () => {
    expect(rootBlock).toContain('--app-header-offset: 52px;')
  })
})
