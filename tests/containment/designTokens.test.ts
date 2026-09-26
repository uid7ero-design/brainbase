import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf-8')

const rootStart = css.indexOf(':root {')
const lightStart = css.indexOf(":root[data-theme='light']")
const themeStart = css.indexOf('@theme inline')
const rootBlock = css.slice(rootStart, lightStart)
const lightBlock = css.slice(lightStart, themeStart)

const requiredRootTokens = [
  '--bb-canvas',
  '--bb-surface-1',
  '--bb-surface-2',
  '--bb-surface-3',
  '--bb-surface-soft',
  '--bb-surface-hover',
  '--bb-surface-selected',
  '--bb-scrim',
  '--bb-text-primary',
  '--bb-text-secondary',
  '--bb-text-tertiary',
  '--bb-text-muted',
  '--bb-text-disabled',
  '--bb-border-subtle',
  '--bb-border-default',
  '--bb-border-strong',
  '--bb-border-hover',
  '--bb-border-focus',
  '--bb-border-accent',
  '--bb-accent-500',
  '--bb-accent-blue',
  '--bb-gradient-accent',
  '--bb-success',
  '--bb-warning',
  '--bb-danger',
  '--bb-info',
  '--bb-font-sans',
  '--bb-space-6',
  '--bb-radius-md',
  '--bb-shadow-panel',
  '--bb-blur-nav',
  '--bb-duration-base',
  '--bb-ease-standard',
  '--bb-control-height-md',
  '--bb-row-height-default',
  '--bb-z-modal',
  '--bb-chart-1',
]

const requiredLightTokens = [
  '--bb-canvas',
  '--bb-surface-1',
  '--bb-surface-2',
  '--bb-surface-3',
  '--bb-surface-hover',
  '--bb-surface-selected',
  '--bb-scrim',
  '--bb-text-primary',
  '--bb-text-secondary',
  '--bb-text-tertiary',
  '--bb-text-muted',
  '--bb-text-disabled',
  '--bb-border-subtle',
  '--bb-border-default',
  '--bb-border-strong',
  '--bb-border-hover',
  '--bb-border-focus',
  '--bb-border-accent',
  '--bb-accent-500',
  '--bb-success',
  '--bb-warning',
  '--bb-danger',
  '--bb-info',
]

describe('BrainBase canonical design tokens', () => {
  it('defines the required semantic foundation in :root', () => {
    expect(rootStart).toBeGreaterThan(-1)
    for (const token of requiredRootTokens) {
      expect(rootBlock, `missing ${token} from :root`).toContain(`${token}:`)
    }
  })

  it('overrides every theme-dependent semantic token in light mode', () => {
    expect(lightStart).toBeGreaterThan(rootStart)
    for (const token of requiredLightTokens) {
      expect(lightBlock, `missing ${token} from light theme`).toContain(`${token}:`)
    }
  })

  it('keeps brand gradients and hierarchy explicit rather than page-local', () => {
    expect(rootBlock).toContain('--bb-gradient-accent: linear-gradient(100deg, #6D4CD6 0%, #9B7BFF 55%, #5677FF 100%)')
    expect(rootBlock).toContain('--bb-gradient-display: linear-gradient(100deg, #7A59E6 0%, #9B7BFF 46%, #5677FF 100%)')
    expect(rootBlock).toContain('--bb-text-primary: #F3EEE6')
    expect(lightBlock).toContain('--bb-text-primary: #15171B')
  })

  it('keeps interaction motion short and separates data-visualisation colours from status colours', () => {
    expect(rootBlock).toContain('--bb-duration-fast: 140ms')
    expect(rootBlock).toContain('--bb-duration-base: 180ms')
    expect(rootBlock).toContain('--bb-chart-1: #7A59E6')
    expect(rootBlock).toContain('--bb-success: #22C55E')
  })
})
