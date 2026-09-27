import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'),'utf-8')
const rootStart=css.indexOf(':root {')
const lightStart=css.indexOf(":root[data-theme='light']")
const rootBlock=css.slice(rootStart, lightStart)
const lightBlock=css.slice(lightStart, css.indexOf('@theme inline'))

describe('BrainBase token compatibility after main convergence', () => {
  it('keeps latest-main application palette values while retaining canonical bb tokens', () => {
    for (const literal of ['--bg-base:    #0B0B0C;','--bg-surface: #111113;','--purple-600:  #6D4CD6;','--purple-400:  #9B7BFF;','--text-primary:   #F3EEE6;']) expect(rootBlock).toContain(literal)
    for (const token of ['--bb-canvas:','--bb-surface-1:','--bb-text-primary:','--bb-accent-500:']) expect(rootBlock).toContain(token)
  })
  it('keeps latest-main light application palette aligned', () => {
    // Integration note (main + app visual convergence): main's rollout pinned its own styling
    // here. The reviewed Phase A token implementation supersedes that presentation, so this
    // assertion now pins the reviewed equivalent. Behavioural assertions are unchanged.
    // Phase A raised light --text-secondary from #52525B to the warm AA value #5F5B55 (6.08:1).
    for (const literal of ['--bg-base:    #F5F3EE;','--text-primary:   #15171B;','--text-secondary: #5F5B55;']) expect(lightBlock).toContain(literal)

  })
  it('preserves the shared app-header offset contract', () => { expect(rootBlock).toContain('--app-header-offset: 52px;') })
})
