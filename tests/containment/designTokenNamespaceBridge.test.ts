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
    // Integration (main + app visual convergence): the bridge pins the canonical
    // public values of this file (#aaa6a0 / #66625d since b9b0583); the earlier
    // #aaa6b4 / #66636d pins pre-dated that palette and would regress it.
    // Scoped to the bridge block so a stale value there cannot hide behind the canonical :root copy.
    const bridge = publicTokens.slice(publicTokens.indexOf('Public/app token collision bridge'))
    // The overrides must live under the scoped public selectors inside the bridge itself.
    for (const sel of [':root .bb-public,', ':root .bb-scope-dark {', ":root[data-theme='light'] .bb-public,", ':root .bb-scope-light {'])
      expect(bridge).toContain(sel)
    expect(bridge).toContain('--bb-text-muted: #aaa6a0;')
    expect(bridge).toContain('--bb-text-muted: #66625d;')
    expect(bridge).toContain('--bb-border-strong: #3a3835;')
    expect(bridge).toContain('--bb-accent-soft: rgba(155, 123, 255, 0.09);')
    expect(bridge).not.toMatch(/#aaa6b4|#66636d|168, 121, 255/)
    expect(publicTokens).toContain('--bb-radius-sm: 4px;')
    expect(publicTokens).toContain('--bb-radius-lg: 10px;')
  })
})
