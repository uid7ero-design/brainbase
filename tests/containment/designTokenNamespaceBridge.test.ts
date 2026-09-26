import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const appTokens = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf-8')
const publicTokens = fs.readFileSync(path.resolve(__dirname, '../../styles/brainbase-tokens.css'), 'utf-8')

describe('design token namespace bridge after public-site convergence', () => {
  it('keeps the authenticated-app semantic tokens defined in globals', () => {
    for (const token of [
      '--bb-font-sans', '--bb-font-mono', '--bb-radius-sm', '--bb-radius-lg',
      '--bb-text-muted', '--bb-border-strong', '--bb-accent-soft',
      '--bb-success-soft', '--bb-warning-soft', '--bb-info-soft',
    ]) expect(appTokens).toContain(`${token}:`)
  })

  it('pins the overlapping public token values inside public scopes at higher specificity', () => {
    expect(publicTokens).toContain(':root .bb-public,')
    expect(publicTokens).toContain(':root .bb-scope-dark {')
    expect(publicTokens).toContain(":root[data-theme='light'] .bb-public,")
    expect(publicTokens).toContain(':root .bb-scope-light {')
    expect(publicTokens).toContain('--bb-text-muted: #aaa6b4;')
    expect(publicTokens).toContain('--bb-text-muted: #66636d;')
    expect(publicTokens).toContain('--bb-radius-sm: 4px;')
    expect(publicTokens).toContain('--bb-radius-lg: 10px;')
  })
})
